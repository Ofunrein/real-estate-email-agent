#!/usr/bin/env python3
"""Fill missing Neon property fields via Groq/OpenAI (never Anthropic). No Apify."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Any

import psycopg2
import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.properties_repair import clean_cell, normalize_property_record
from core.sheet_schema import PROPERTIES_HEADERS

ENRICH_FIELDS = (
    "description",
    "neighborhood",
    "beds",
    "baths",
    "property_type",
    "features",
    "listing_url",
    "status",
)

PROMPT = """You fill missing real-estate listing fields from partial row data.
Return a JSON array with one object per input row, same order. Each object may include only these keys:
description, neighborhood, property_type, features, beds, baths, status

Rules:
- description: 1-2 factual sentences from address, beds, baths, sqft, property_type, neighborhood, price. No hype.
- neighborhood: Austin-metro neighborhood name from address/zip/city when inferable; else "".
- property_type: Single-Family Home, Condo, Townhouse, Multi-Family, Apartment, or "".
- features: comma-separated likely features from type/size; else "".
- beds/baths: only if clearly inferable from context; else "".
- status: For Sale, Pending, Sold, or "" if unknown.
- Never invent price, sqft, year_built, or listing_url.
- Empty string for anything you cannot support from the row.
Return raw JSON only."""


def load_env() -> None:
    load_dotenv(".env")
    atlas = os.path.expanduser("~/Downloads/atlas/.env")
    if os.path.exists(atlas):
        load_dotenv(atlas, override=False)


def llm_providers() -> list[tuple[str, str, str]]:
    providers: list[tuple[str, str, str]] = []
    groq = os.getenv("GROQ_API_KEY", "").strip()
    if groq:
        providers.append(
            (
                "https://api.groq.com/openai/v1/chat/completions",
                groq,
                os.getenv("ENRICH_GROQ_MODEL", "llama-3.3-70b-versatile"),
            )
        )
    openai = os.getenv("OPENAI_API_KEY", "").strip()
    if openai:
        providers.append(
            (
                "https://api.openai.com/v1/chat/completions",
                openai,
                os.getenv("ENRICH_OPENAI_MODEL", "gpt-4o-mini"),
            )
        )
    return providers


def call_llm(rows: list[dict[str, str]], *, url: str, api_key: str, model: str) -> list[dict[str, str]]:
    payload_rows = []
    for row in rows:
        payload_rows.append(
            {
                "address": row.get("address", ""),
                "city": row.get("city", ""),
                "state": row.get("state", ""),
                "zip": row.get("zip", ""),
                "price": row.get("price", ""),
                "beds": row.get("beds", ""),
                "baths": row.get("baths", ""),
                "sqft": row.get("sqft", ""),
                "property_type": row.get("property_type", ""),
                "neighborhood": row.get("neighborhood", ""),
                "missing": [field for field in ENRICH_FIELDS if not clean_cell(row.get(field, ""))],
            }
        )
    body = {
        "model": model,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": PROMPT},
            {"role": "user", "content": json.dumps(payload_rows)},
        ],
    }
    last_error: Exception | None = None
    for attempt in range(6):
        response = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=body,
            timeout=120,
        )
        if response.status_code == 429:
            last_error = requests.HTTPError(f"429 rate limit for {url}", response=response)
            time.sleep(min(60, 2 ** attempt))
            continue
        try:
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"].strip()
            content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content, flags=re.I)
            parsed = json.loads(content)
            if isinstance(parsed, dict) and "results" in parsed:
                parsed = parsed["results"]
            if not isinstance(parsed, list):
                raise ValueError(f"Expected JSON array, got {type(parsed).__name__}")
            return [item if isinstance(item, dict) else {} for item in parsed]
        except Exception as exc:
            last_error = exc
            time.sleep(1 + attempt)
    raise RuntimeError(str(last_error or "LLM call failed"))


def fetch_rows(conn, client_id: str, *, limit: int, only_description: bool, only_neighborhood: bool) -> list[dict[str, str]]:
    columns = ", ".join(["city"] + list(PROPERTIES_HEADERS))
    with conn.cursor() as cur:
        cur.execute(
            f"select {columns} from properties where client_id = %s order by address asc",
            (client_id,),
        )
        raw = cur.fetchall()
    rows: list[dict[str, str]] = []
    for values in raw:
        city = "" if values[0] is None else str(values[0])
        record = dict(
            zip(PROPERTIES_HEADERS, ["" if value is None else str(value) for value in values[1:]])
        )
        record["city"] = city
        normalized = normalize_property_record(record)
        missing = [field for field in ENRICH_FIELDS if not clean_cell(normalized.get(field, ""))]
        if not missing:
            continue
        if only_description and "description" not in missing:
            continue
        if only_neighborhood and "neighborhood" not in missing:
            continue
        rows.append(normalized)
        if limit and len(rows) >= limit:
            break
    return rows


def apply_patch(record: dict[str, str], patch: dict[str, Any]) -> dict[str, str]:
    merged = dict(record)
    for field in ENRICH_FIELDS:
        if clean_cell(merged.get(field, "")):
            continue
        value = clean_cell(str(patch.get(field, "") if patch.get(field) is not None else ""))
        if value:
            merged[field] = value
    return merged


def update_row(conn, client_id: str, address: str, merged: dict[str, str]) -> None:
    assignments = ", ".join(f"{field} = %s" for field in ENRICH_FIELDS)
    values = [merged.get(field, "") for field in ENRICH_FIELDS]
    with conn.cursor() as cur:
        cur.execute(
            f"""
            update properties
               set {assignments},
                   updated_at = now()
             where client_id = %s
               and address = %s
            """,
            [*values, client_id, address],
        )


def fill_stats(rows: list[dict[str, str]]) -> dict[str, dict[str, int]]:
    total = len(rows)
    stats: dict[str, dict[str, int]] = {}
    for field in ENRICH_FIELDS:
        filled = sum(1 for row in rows if clean_cell(row.get(field, "")))
        stats[field] = {"filled": filled, "total": total, "missing": total - filled}
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="AI-enrich missing Neon property fields (Groq/OpenAI).")
    parser.add_argument("--limit", type=int, default=0, help="Max rows to process (0 = all).")
    parser.add_argument("--batch-size", type=int, default=12)
    parser.add_argument("--only-description", action="store_true")
    parser.add_argument("--only-neighborhood", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    load_env()
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1

    providers = llm_providers()
    if not providers:
        print("GROQ_API_KEY or OPENAI_API_KEY is required", file=sys.stderr)
        return 1

    client_id = os.getenv("CLIENT_ID", "austin-realty").strip()
    conn = psycopg2.connect(database_url)
    try:
        targets = fetch_rows(
            conn,
            client_id,
            limit=args.limit,
            only_description=args.only_description,
            only_neighborhood=args.only_neighborhood,
        )
        before = fill_stats(targets)
        updated: list[dict[str, object]] = []
        field_fills = {field: 0 for field in ENRICH_FIELDS}
        errors: list[str] = []

        provider_idx = 0
        for start in range(0, len(targets), args.batch_size):
            batch = targets[start : start + args.batch_size]
            patches = None
            for offset in range(len(providers)):
                url, api_key, model = providers[(provider_idx + offset) % len(providers)]
                try:
                    patches = call_llm(batch, url=url, api_key=api_key, model=model)
                    provider_idx = (provider_idx + offset) % len(providers)
                    break
                except Exception as exc:
                    errors.append(f"batch@{start} ({model}): {exc}")
                    time.sleep(3)
            if patches is None:
                continue
            if len(patches) != len(batch):
                errors.append(f"batch@{start}: expected {len(batch)} patches, got {len(patches)}")
                continue
            for record, patch in zip(batch, patches):
                merged = apply_patch(record, patch)
                filled = [
                    field
                    for field in ENRICH_FIELDS
                    if not clean_cell(record.get(field, "")) and clean_cell(merged.get(field, ""))
                ]
                if not filled:
                    continue
                if not args.dry_run:
                    update_row(conn, client_id, record["address"], merged)
                for field in filled:
                    field_fills[field] += 1
                updated.append({"address": record.get("address", ""), "filled_fields": filled})
            if not args.dry_run:
                conn.commit()
            time.sleep(1.2)

        after_targets = fetch_rows(
            conn,
            client_id,
            limit=0,
            only_description=False,
            only_neighborhood=False,
        )
        result = {
            "providers": [f"{'groq' if 'groq.com' in item[0] else 'openai'}:{item[2]}" for item in providers],
            "dry_run": args.dry_run,
            "targets": len(targets),
            "rows_updated": len(updated),
            "field_fills": field_fills,
            "missing_before": before,
            "errors": errors[:20],
            "sample_updates": updated[:10],
        }
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(json.dumps(result, indent=2))
        return 0 if not errors or updated else 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
