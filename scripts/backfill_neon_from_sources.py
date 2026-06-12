#!/usr/bin/env python3
"""Fill empty Neon property fields from local CSV and prebuilt Apify indexes (free, no live runs)."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

import psycopg2
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.properties_repair import clean_cell, normalize_property_record
from core.sheet_schema import PROPERTIES_HEADERS
from scripts.property_hygiene import (
    DEFAULT_ZILLOW_CSV,
    _apply_missing_values,
    _index_match,
    build_zillow_csv_index,
)

REQUIRED_FIELDS = [
    "address",
    "price",
    "beds",
    "baths",
    "state",
    "zip",
    "description",
    "neighborhood",
    "property_type",
    "features",
    "days_on_market",
    "photo_url",
    "sqft",
    "year_built",
    "status",
    "listing_url",
]

UPDATE_FIELDS = [field for field in REQUIRED_FIELDS if field != "address"]

REPAIRABLE_FIELDS = ("price", "beds", "baths")


def _parse_price(value: str) -> float | None:
    digits = re.sub(r"[^\d.]", "", str(value or ""))
    if not digits:
        return None
    try:
        return float(digits)
    except ValueError:
        return None


def is_corrupt_price(value: str) -> bool:
    price = _parse_price(value)
    if price is None:
        return True
    if price == 0:
        return True
    if price >= 1_000_000_000:
        return True
    return False


def _zpid_from_url(url: str) -> str:
    match = re.search(r"/(\d+)_zpid", url or "")
    return match.group(1) if match else ""


def _build_zpid_index(index: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    zpid_index: dict[str, dict[str, str]] = {}
    for record in index.values():
        zpid = _zpid_from_url(record.get("listing_url", ""))
        if zpid and zpid not in zpid_index:
            zpid_index[zpid] = record
    return zpid_index


def _source_match(
    record: dict[str, str],
    *,
    csv_index: dict[str, dict[str, str]],
    apify_index: dict[str, dict[str, str]],
    detail_index: dict[str, dict[str, str]],
    zpid_index: dict[str, dict[str, str]],
) -> tuple[dict[str, str], list[str]]:
    sources: list[str] = []
    merged: dict[str, str] = {}
    for label, index in (
        ("zillow_csv", csv_index),
        ("apify_search", apify_index),
        ("apify_detail", detail_index),
    ):
        if not index:
            continue
        match = _index_match(record, index)
        if match:
            merged = dict(match) if not merged else merged
            if label not in sources:
                sources.append(label)
    zpid = _zpid_from_url(record.get("listing_url", ""))
    if zpid:
        match = zpid_index.get(zpid)
        if match:
            merged = dict(match) if not merged else merged
            if "apify_zpid" not in sources:
                sources.append("apify_zpid")
    return merged, sources


def _apply_repair_values(target: dict[str, str], source: dict[str, str]) -> list[str]:
    changed: list[str] = []
    for field in PROPERTIES_HEADERS:
        if field == "address":
            continue
        source_value = clean_cell(source.get(field, ""))
        if not source_value:
            continue
        current_value = clean_cell(target.get(field, ""))
        if field == "price":
            if not is_corrupt_price(current_value):
                continue
            if is_corrupt_price(source_value):
                continue
        elif current_value:
            continue
        target[field] = source_value
        changed.append(field)
    return changed


def load_apify_index(path: str) -> dict[str, dict[str, str]]:
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload.get("index", payload)


def merge_sources(
    record: dict[str, str],
    *,
    csv_index: dict[str, dict[str, str]],
    apify_index: dict[str, dict[str, str]],
    detail_index: dict[str, dict[str, str]],
    zpid_index: dict[str, dict[str, str]],
) -> tuple[dict[str, str], list[str], list[str]]:
    merged = dict(record)
    match, sources = _source_match(
        record,
        csv_index=csv_index,
        apify_index=apify_index,
        detail_index=detail_index,
        zpid_index=zpid_index,
    )
    if not match:
        return merged, sources, []

    filled_fields = _apply_repair_values(merged, match)
    if _apply_missing_values(merged, match):
        for field in UPDATE_FIELDS:
            if (
                not clean_cell(record.get(field, ""))
                and clean_cell(merged.get(field, ""))
                and field not in filled_fields
            ):
                filled_fields.append(field)
    return merged, sources, filled_fields


def fetch_properties(conn, client_id: str) -> list[dict[str, str]]:
    columns = ", ".join(PROPERTIES_HEADERS)
    with conn.cursor() as cur:
        cur.execute(
            f"select {columns} from properties where client_id = %s order by address asc",
            (client_id,),
        )
        rows = cur.fetchall()
    return [
        dict(zip(PROPERTIES_HEADERS, ["" if value is None else str(value) for value in row]))
        for row in rows
    ]


def update_property(conn, client_id: str, address: str, merged: dict[str, str]) -> None:
    assignments = ", ".join(f"{field} = %s" for field in UPDATE_FIELDS)
    values = [merged.get(field, "") for field in UPDATE_FIELDS]
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill empty Neon property fields from free local sources.")
    parser.add_argument("--source-csv", default=DEFAULT_ZILLOW_CSV, help="Local Zillow detail CSV.")
    parser.add_argument(
        "--apify-index-path",
        default="reports/apify-search-core-index.json",
        help="Prebuilt Apify search index JSON.",
    )
    parser.add_argument(
        "--apify-detail-index-path",
        default="",
        help="Optional prebuilt Apify detail index JSON.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Report changes without writing to Neon.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    load_dotenv(".env")
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1

    client_id = os.getenv("CLIENT_ID", "austin-realty").strip()
    csv_index = build_zillow_csv_index(args.source_csv)
    apify_index = load_apify_index(args.apify_index_path)
    detail_index = load_apify_index(args.apify_detail_index_path)
    zpid_index = _build_zpid_index(apify_index)

    conn = psycopg2.connect(database_url)
    try:
        records = fetch_properties(conn, client_id)
        updated_rows: list[dict[str, object]] = []
        field_fills: dict[str, int] = {field: 0 for field in UPDATE_FIELDS}
        corrupt_price_before = sum(1 for record in records if is_corrupt_price(record.get("price", "")))
        corrupt_price_after = corrupt_price_before

        for record in records:
            normalized = normalize_property_record(record)
            merged, sources, filled_fields = merge_sources(
                normalized,
                csv_index=csv_index,
                apify_index=apify_index,
                detail_index=detail_index,
                zpid_index=zpid_index,
            )
            filled_fields = [field for field in filled_fields if field in field_fills]
            if not filled_fields:
                continue

            if not args.dry_run:
                update_property(conn, client_id, normalized["address"], merged)
            for field in filled_fields:
                field_fills[field] += 1
            updated_rows.append(
                {
                    "address": normalized.get("address", ""),
                    "sources": sources,
                    "filled_fields": filled_fields,
                    "price_before": normalized.get("price", ""),
                    "price_after": merged.get("price", ""),
                }
            )

        if not args.dry_run:
            conn.commit()
            refreshed = fetch_properties(conn, client_id)
            corrupt_price_after = sum(1 for record in refreshed if is_corrupt_price(record.get("price", "")))
        else:
            corrupt_price_after = corrupt_price_before - field_fills.get("price", 0)

        result = {
            "dry_run": args.dry_run,
            "client_id": client_id,
            "neon_rows": len(records),
            "csv_index_keys": len(csv_index),
            "apify_index_keys": len(apify_index),
            "detail_index_keys": len(detail_index),
            "zpid_index_keys": len(zpid_index),
            "rows_updated": len(updated_rows),
            "corrupt_prices_before": corrupt_price_before,
            "corrupt_prices_after": corrupt_price_after,
            "field_fills": field_fills,
            "sample_updates": updated_rows[:10],
        }
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(f"rows_updated={result['rows_updated']} dry_run={args.dry_run}")
            print(f"corrupt_prices {corrupt_price_before} -> {corrupt_price_after}")
            for field, count in sorted(field_fills.items(), key=lambda item: -item[1]):
                if count:
                    print(f"  {field}: +{count}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
