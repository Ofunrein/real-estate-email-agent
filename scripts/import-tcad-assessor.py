#!/usr/bin/env python3
"""Import Travis County CAD (TCAD) appraisal roll into Neon — fill empty assessor fields only."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import zipfile
from typing import Any

import psycopg2
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.properties_repair import clean_cell, normalize_property_record
from core.property_hygiene import normalize_address_key
from core.sheet_schema import PROPERTIES_HEADERS

DEFAULT_ZIP = "data/tcad/tcad-2025-certified.zip"
DEFAULT_EXPORT_URL = (
    "https://traviscad.org/wp-content/largefiles/2025%20Certified%20Appraisal%20Export%20Supp%200_07202025.zip"
)
CERTIFIED_SUP = frozenset({"0", "000000000000"})
RESIDENTIAL_HINTS = (
    "RESIDENCE",
    "CONDO",
    "TOWNHOUSE",
    "TOWN HOME",
    "DUPLEX",
    "APARTMENT",
    "MANUFACTURED",
    "MOBILE",
)

TCAD_FIELDS = (
    "beds",
    "baths",
    "sqft",
    "year_built",
    "lot_acres",
    "lot_label",
    "city",
    "zip",
    "prop_id",
)
UPDATE_FIELDS = ("beds", "baths", "sqft", "year_built", "features")


def load_env() -> None:
    load_dotenv(".env")
    atlas = os.path.expanduser("~/Downloads/atlas/.env")
    if os.path.exists(atlas):
        load_dotenv(atlas, override=False)


def _unitless_address_key(address: str) -> str:
    key = normalize_address_key(address)
    key = re.sub(r"\b(?:apt|unit|#)\s*[a-z0-9-]+\b", "", key)
    return re.sub(r"\s+", " ", key).strip()


def _digits(value: str) -> str:
    text = re.sub(r"[^\d.]", "", str(value or ""))
    if not text:
        return ""
    if "." in text:
        head, tail = text.split(".", 1)
        tail = tail.rstrip("0")
        return f"{head}.{tail}" if tail else head
    return text


def _title_address(street_line: str, city: str, zip_code: str) -> str:
    city = clean_cell(city).title() if clean_cell(city) else "Austin"
    zip_code = zip_code[:5] if zip_code else ""
    street = " ".join(part.title() if part.isupper() else part for part in street_line.split())
    suffix = f", {city}, TX {zip_code}" if zip_code else f", {city}, TX"
    return f"{street}{suffix}"


def _normalize_unit_token(value: str) -> str:
    text = clean_cell(value).lower()
    text = re.sub(r"^(?:apt|unit|#)\s*", "", text)
    return text.strip()


def _canonical_unit_address(full_address: str) -> str:
    street = full_address.split(",", 1)[0]
    tail = full_address.split(",", 1)[1] if "," in full_address else ""
    unit_match = re.search(r"\b(?:apt|unit|#)\s*([a-z0-9-]+)\b", street, re.I)
    if not unit_match:
        return full_address
    unitless_street = re.sub(r"\b(?:apt|unit|#)\s*[a-z0-9-]+\b", "", street, flags=re.I)
    unitless_street = re.sub(r"\s+", " ", unitless_street).strip()
    canonical_street = f"{unitless_street} Unit {unit_match.group(1)}"
    return f"{canonical_street},{tail}" if tail else canonical_street


def _address_keys(full_address: str) -> set[str]:
    canonical = _canonical_unit_address(full_address)
    keys = {
        normalize_address_key(full_address),
        normalize_address_key(canonical),
        _unitless_address_key(full_address),
        _unitless_address_key(canonical),
    }
    return {key for key in keys if key}


def _parse_acreage(raw: str) -> str:
    digits = _digits(raw)
    if not digits:
        return ""
    try:
        acres = int(raw.strip()) / 10000.0
    except ValueError:
        return ""
    if acres <= 0:
        return ""
    return f"{acres:.4f}".rstrip("0").rstrip(".")


def _parse_prop_line(line: str) -> dict[str, str] | None:
    if len(line) < 4479:
        return None
    if line[12:17].strip() != "R":
        return None
    if line[22:34].strip() not in CERTIFIED_SUP:
        return None

    situs_num = line[4459:4474].strip()
    prefix = line[1039:1049].strip()
    street = line[1049:1099].strip()
    suffix = line[1099:1109].strip()
    city = line[1109:1139].strip()
    zip_code = line[1139:1149].strip()[:5]
    situs_unit = line[4474:4479].strip()

    if not street and not situs_num:
        return None

    parts = [situs_num, prefix, street.title() if street.isupper() else street, suffix]
    street_line = " ".join(part for part in parts if part)
    if situs_unit:
        street_line = f"{street_line} Unit {situs_unit.strip()}"

    full_address = _title_address(street_line, city, zip_code)
    return {
        "prop_id": line[0:12].strip(),
        "address": full_address,
        "city": clean_cell(city).title() or "Austin",
        "zip": zip_code,
        "lot_acres": _parse_acreage(line[1659:1675]),
        "lot_label": clean_cell(line[1745:1795]),
    }


def _parse_imp_det_line(line: str) -> dict[str, str] | None:
    if len(line) < 108:
        return None
    type_desc = line[50:75].strip().upper()
    if not any(hint in type_desc for hint in RESIDENTIAL_HINTS):
        return None
    area_raw = line[93:108].strip()
    try:
        area = int(area_raw) / 100.0
    except ValueError:
        area = 0.0
    year = line[85:89].strip()
    if year == "0000":
        year = ""
    return {
        "prop_id": line[0:12].strip(),
        "sqft": _digits(str(int(area))) if area > 0 else "",
        "year_built": year if re.fullmatch(r"\d{4}", year or "") else "",
        "area_value": area,
        "type_desc": type_desc,
    }


def _iter_zip_lines(zip_path: str, member: str):
    with zipfile.ZipFile(zip_path) as archive:
        with archive.open(member) as handle:
            for raw in handle:
                yield raw.decode("utf-8", errors="replace").rstrip("\r\n")


def _download_export(url: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
        return
    subprocess.run(["curl", "-fsSL", "-o", dest, url], check=True)


def build_tcad_index(zip_path: str) -> tuple[dict[str, dict[str, str]], dict[str, str]]:
    prop_by_id: dict[str, dict[str, str]] = {}
    address_index: dict[str, dict[str, str]] = {}

    for line in _iter_zip_lines(zip_path, "PROP.TXT"):
        parsed = _parse_prop_line(line)
        if not parsed:
            continue
        prop_id = parsed["prop_id"]
        if prop_id in prop_by_id:
            continue
        prop_by_id[prop_id] = parsed
        for key in _address_keys(parsed["address"]):
            if key not in address_index:
                address_index[key] = parsed

    best_detail: dict[str, dict[str, Any]] = {}
    for line in _iter_zip_lines(zip_path, "IMP_DET.TXT"):
        parsed = _parse_imp_det_line(line)
        if not parsed:
            continue
        prop_id = parsed["prop_id"]
        current = best_detail.get(prop_id)
        if current is None or parsed["area_value"] > current["area_value"]:
            best_detail[prop_id] = parsed

    for prop_id, detail in best_detail.items():
        prop = prop_by_id.get(prop_id)
        if not prop:
            continue
        if detail.get("sqft"):
            prop["sqft"] = detail["sqft"]
        if detail.get("year_built"):
            prop["year_built"] = detail["year_built"]

    for prop in prop_by_id.values():
        for key in _address_keys(prop["address"]):
            address_index[key] = prop

    return address_index, prop_by_id


def _tcad_match(record: dict[str, str], index: dict[str, dict[str, str]]) -> dict[str, str]:
    address = record.get("address", "")
    for key in _address_keys(address):
        match = index.get(key)
        if match:
            return match
    return {}


def _lot_feature_text(match: dict[str, str]) -> str:
    acres = clean_cell(match.get("lot_acres", ""))
    label = clean_cell(match.get("lot_label", ""))
    if acres:
        return f"Lot size: {acres} acres"
    if label:
        return f"Lot: {label}"
    return ""


def _apply_tcad_values(target: dict[str, str], match: dict[str, str]) -> list[str]:
    filled: list[str] = []
    for field in ("beds", "baths", "sqft", "year_built"):
        if clean_cell(target.get(field, "")):
            continue
        value = clean_cell(match.get(field, ""))
        if value:
            target[field] = value
            filled.append(field)

    lot_text = _lot_feature_text(match)
    if lot_text and not clean_cell(target.get("features", "")):
        target["features"] = lot_text
        filled.append("features")
    return filled


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


def field_fill_rates(rows: list[dict[str, str]], fields: tuple[str, ...]) -> dict[str, dict[str, int]]:
    total = len(rows)
    stats: dict[str, dict[str, int]] = {}
    for field in fields:
        filled = sum(1 for row in rows if clean_cell(row.get(field, "")))
        stats[field] = {"filled": filled, "total": total, "pct": round((filled / total) * 1000) / 10 if total else 0}
    return stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Import TCAD assessor roll into Neon (empty fields only).")
    parser.add_argument("--zip-path", default=DEFAULT_ZIP, help="Local TCAD certified export ZIP.")
    parser.add_argument("--download-url", default=DEFAULT_EXPORT_URL, help="TCAD certified export URL.")
    parser.add_argument("--download", action="store_true", help="Download ZIP if missing.")
    parser.add_argument("--dry-run", action="store_true", help="Report matches without writing Neon.")
    parser.add_argument("--json", action="store_true", help="Print JSON report.")
    args = parser.parse_args()

    load_env()
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        print("DATABASE_URL is required", file=sys.stderr)
        return 1

    zip_path = args.zip_path
    if args.download or not os.path.exists(zip_path):
        _download_export(args.download_url, zip_path)

    if not os.path.exists(zip_path):
        print(f"TCAD export not found: {zip_path}", file=sys.stderr)
        return 1

    print(f"Building TCAD index from {zip_path}...", file=sys.stderr)
    address_index, prop_by_id = build_tcad_index(zip_path)
    print(f"TCAD properties indexed: {len(prop_by_id)}", file=sys.stderr)

    client_id = os.getenv("CLIENT_ID", "austin-realty").strip()
    track_fields = ("beds", "baths", "sqft", "year_built", "description", "neighborhood", "features")

    conn = psycopg2.connect(database_url)
    try:
        records = fetch_properties(conn, client_id)
        before = field_fill_rates([normalize_property_record(row) for row in records], track_fields)

        matched = 0
        updated_rows: list[dict[str, object]] = []
        field_fills: dict[str, int] = {field: 0 for field in UPDATE_FIELDS}

        for record in records:
            normalized = normalize_property_record(record)
            match = _tcad_match(normalized, address_index)
            if not match:
                continue
            matched += 1
            merged = dict(normalized)
            filled_fields = _apply_tcad_values(merged, match)
            if not filled_fields:
                continue
            if not args.dry_run:
                update_property(conn, client_id, normalized["address"], merged)
            for field in filled_fields:
                field_fills[field] += 1
            updated_rows.append(
                {
                    "address": normalized.get("address", ""),
                    "tcad_prop_id": match.get("prop_id", ""),
                    "filled_fields": filled_fields,
                }
            )

        if not args.dry_run:
            conn.commit()
            records = fetch_properties(conn, client_id)

        after = field_fill_rates([normalize_property_record(row) for row in records], track_fields)
        result = {
            "source": {
                "name": "Travis Central Appraisal District (TCAD)",
                "url": args.download_url,
                "zip_path": zip_path,
                "tcad_properties": len(prop_by_id),
                "tcad_address_keys": len(address_index),
            },
            "dry_run": args.dry_run,
            "neon_rows": len(records),
            "rows_matched": matched,
            "rows_updated": len(updated_rows),
            "match_rate_pct": round((matched / len(records)) * 1000) / 10 if records else 0,
            "field_fills": field_fills,
            "fill_rates_before": before,
            "fill_rates_after": after,
            "sample_updates": updated_rows[:15],
            "notes": [
                "TCAD fixed-width export provides sqft, year_built, and lot acreage; bed/bath counts are not exported.",
                "Only empty Neon fields are filled; existing values are never overwritten.",
            ],
        }
        report_path = "reports/import-tcad-assessor.json"
        os.makedirs("reports", exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2)

        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print(json.dumps(result, indent=2))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
