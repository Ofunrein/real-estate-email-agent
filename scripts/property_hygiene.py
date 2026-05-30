import argparse
import csv
import json
import os
import re
import sys
import time

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import apify_zillow_lookup, get_gmail_service, rentcast_lookup
from core.property_hygiene import build_hygiene_report, normalize_address_key
from core.properties_repair import clean_cell, normalize_property_record, repair_property_rows
from core.sheet_schema import PROPERTIES_HEADERS, PROPERTIES_TAB
from core.sheets_store import ensure_workbook_schema, read_table, update_row, values_for_headers

DEFAULT_ZILLOW_CSV = "dataset_zillow-detail-scraper_2026-05-18_18-15-11-332.csv"
CORE_HEALTH_FIELDS = ("zip", "sqft", "year_built", "photo_url")


def _first(*values) -> str:
    for value in values:
        text = clean_cell(value)
        if text:
            return text
    return ""


def _digits(value: str) -> str:
    return re.sub(r"[^\d.]", "", str(value or ""))


def _unitless_address_key(address: str) -> str:
    key = normalize_address_key(address)
    key = re.sub(r"\b(?:apt|unit|#)\s*[a-z0-9-]+\b", "", key)
    return re.sub(r"\s+", " ", key).strip()


def _zillow_property_type(value: str) -> str:
    type_map = {
        "SINGLE_FAMILY": "Single-Family Home",
        "CONDO": "Condo",
        "TOWNHOUSE": "Townhouse",
        "MULTI_FAMILY": "Multi-Family",
        "APARTMENT": "Apartment",
        "MANUFACTURED": "Manufactured",
        "MobileManufactured": "Manufactured",
        "SingleFamily": "Single-Family Home",
    }
    text = clean_cell(value)
    return type_map.get(text, text.replace("_", " ").title() if text else "")


def _zillow_listing_url(value: str) -> str:
    text = clean_cell(value)
    if not text:
        return ""
    if text.startswith("http"):
        return text
    if text.startswith("/"):
        return f"https://www.zillow.com{text}"
    return ""


def _zillow_photo(row: dict[str, str]) -> str:
    candidates = [
        "desktopWebHdpImageLink",
        "imgSrc",
        "hiResImageLink",
        "primaryPhoto",
        "photo",
        "responsivePhotos/0/url",
        "photos/0/url",
    ]
    return _first(*(row.get(field, "") for field in candidates))


def _zillow_csv_record(row: dict[str, str]) -> dict[str, str]:
    return {
        "address": _first(row.get("streetAddress"), row.get("address/streetAddress"), row.get("abbreviatedAddress")),
        "city": _first(row.get("city"), row.get("address/city")),
        "state": _first(row.get("state"), row.get("address/state")),
        "zip": _first(row.get("zipcode"), row.get("address/zipcode"), row.get("adTargets/zip")),
        "price": _digits(_first(row.get("price"), row.get("adTargets/price"))),
        "beds": _digits(_first(row.get("bedrooms"), row.get("adTargets/bd"))),
        "baths": _digits(_first(row.get("bathrooms"), row.get("adTargets/ba"))),
        "sqft": _digits(_first(row.get("livingArea"), row.get("livingAreaValue"), row.get("resoFacts/livingArea"), row.get("adTargets/sqft"))),
        "year_built": _digits(_first(row.get("yearBuilt"), row.get("resoFacts/yearBuilt"), row.get("adTargets/yrblt"))),
        "neighborhood": _first(row.get("neighborhood"), row.get("address/neighborhood"), row.get("neighborhoodRegion/name")),
        "property_type": _zillow_property_type(_first(row.get("homeType"), row.get("resoFacts/homeType"))),
        "days_on_market": _digits(_first(row.get("daysOnZillow"), row.get("timeOnZillow"))),
        "photo_url": _zillow_photo(row),
        "description": clean_cell(row.get("description", "")),
        "status": clean_cell(row.get("homeStatus", "")).replace("_", " ").title(),
        "listing_url": _zillow_listing_url(_first(row.get("hdpUrl"), row.get("postingUrl"), row.get("bdpUrl"))),
        "agent_name": _first(row.get("attributionInfo/agentName"), row.get("postingContact/name")),
        "agent_email": clean_cell(row.get("attributionInfo/agentEmail", "")),
    }


def build_zillow_csv_index(csv_path: str) -> dict[str, dict[str, str]]:
    if not csv_path or not os.path.exists(csv_path):
        return {}

    index: dict[str, dict[str, str]] = {}
    with open(csv_path, newline="", encoding="utf-8-sig") as handle:
        for raw in csv.DictReader(handle):
            record = _zillow_csv_record(raw)
            address = record.get("address", "")
            if not address:
                continue
            for key in {normalize_address_key(address), _unitless_address_key(address)}:
                if key and key not in index:
                    index[key] = record
    return index


def _csv_match(record: dict[str, str], index: dict[str, dict[str, str]]) -> dict[str, str]:
    if not index:
        return {}
    for key in (normalize_address_key(record.get("address", "")), _unitless_address_key(record.get("address", ""))):
        match = index.get(key)
        if match:
            return match
    return {}


def _query_for_record(record: dict[str, str]) -> str:
    parts = [record.get("address", "")]
    city = record.get("city", "")
    state = record.get("state", "")
    zip_code = record.get("zip", "")
    query = ", ".join(part for part in parts if part)
    if city and city.lower() not in query.lower():
        query += f", {city}"
    if state and state.lower() not in query.lower():
        query += f", {state}"
    if zip_code and zip_code not in query:
        query += f" {zip_code}"
    return query


def _read_raw_values(sheets, spreadsheet_id: str) -> list[list[str]]:
    result = sheets.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{PROPERTIES_TAB}!A:ZZ",
    ).execute()
    return result.get("values", [])


def _write_values(sheets, spreadsheet_id: str, rows: list[list[str]]) -> None:
    sheets.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=f"{PROPERTIES_TAB}!A:ZZ",
        body={},
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{PROPERTIES_TAB}!A1",
        valueInputOption="RAW",
        body={"values": rows},
    ).execute()


def repair_sheet(sheets, spreadsheet_id: str) -> dict:
    raw_rows = _read_raw_values(sheets, spreadsheet_id)
    repaired_rows, stats = repair_property_rows(raw_rows)
    _write_values(sheets, spreadsheet_id, repaired_rows)
    return stats


def _apply_missing_values(target: dict[str, str], source: dict[str, str]) -> bool:
    changed = False
    for field in PROPERTIES_HEADERS:
        if field == "address":
            continue
        if clean_cell(target.get(field, "")):
            continue
        value = clean_cell(source.get(field, ""))
        if value:
            target[field] = value
            changed = True
    return changed


def enrich_missing(
    sheets,
    spreadsheet_id: str,
    *,
    limit: int = 25,
    sleep_seconds: float = 0.1,
    source_csv: str = DEFAULT_ZILLOW_CSV,
    live_lookup: bool = False,
    mark_unresolved: bool = True,
) -> dict:
    records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
    csv_index = build_zillow_csv_index(source_csv)
    updated = []
    unresolved = []

    for index, record in enumerate(records, start=2):
        normalized = normalize_property_record(record)
        missing = [field for field in CORE_HEALTH_FIELDS if not clean_cell(normalized.get(field, ""))]
        if not missing:
            continue
        if len(updated) >= limit:
            unresolved.append({"row": index, "address": normalized.get("address", ""), "missing": missing})
            continue

        next_record = dict(normalized)
        sources = []
        csv_record = _csv_match(normalized, csv_index)
        if csv_record and _apply_missing_values(next_record, csv_record):
            sources.append("zillow_csv")

        remaining = [field for field in CORE_HEALTH_FIELDS if not clean_cell(next_record.get(field, ""))]
        if remaining and live_lookup:
            query = _query_for_record(next_record)
            apify = apify_zillow_lookup(query)
            rentcast = {} if apify.get("sqft") and apify.get("year_built") and apify.get("zip") else rentcast_lookup(query)
            live_source = {
                "zip": _first(apify.get("zip"), rentcast.get("zipCode")),
                "sqft": _first(apify.get("sqft"), rentcast.get("squareFootage"), rentcast.get("livingArea")),
                "year_built": _first(apify.get("year_built"), rentcast.get("yearBuilt")),
                "photo_url": _first(apify.get("photo_url"), rentcast.get("photoUrl")),
                "listing_url": _first(apify.get("listing_url")),
                "status": _first(apify.get("status")),
            }
            if _apply_missing_values(next_record, live_source):
                sources.append("live_lookup")

        remaining = [field for field in CORE_HEALTH_FIELDS if not clean_cell(next_record.get(field, ""))]
        if remaining and mark_unresolved and not clean_cell(next_record.get("status", "")):
            next_record["status"] = f"Needs review: missing {', '.join(remaining)}"

        if next_record != normalized:
            update_row(sheets, spreadsheet_id, PROPERTIES_TAB, index, PROPERTIES_HEADERS, next_record)
            updated.append({
                "row": index,
                "address": normalized.get("address", ""),
                "source": "+".join(sources) if sources else "review_note",
                "missing_before": missing,
                "missing_after": remaining,
            })
            time.sleep(sleep_seconds)
        else:
            unresolved.append({"row": index, "address": normalized.get("address", ""), "missing": remaining})

    return {"updated": updated, "unresolved": unresolved}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate, repair, and enrich the properties Google Sheet.")
    parser.add_argument("--repair", action="store_true", help="Repair shifted rows and canonicalize headers.")
    parser.add_argument("--enrich", action="store_true", help="Fill missing property health fields from local Zillow data and optional live lookup.")
    parser.add_argument("--limit", type=int, default=25, help="Maximum rows to enrich in one run.")
    parser.add_argument("--source-csv", default=DEFAULT_ZILLOW_CSV, help="Local Zillow CSV used before live lookups.")
    parser.add_argument("--live", action="store_true", help="Use live Apify/RentCast lookup for rows not found in the local CSV.")
    parser.add_argument("--no-mark-unresolved", action="store_true", help="Do not write Needs review status for unresolved rows.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    load_dotenv()
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        print("GOOGLE_SHEET_ID is required")
        return 1

    _, sheets = get_gmail_service()
    ensure_workbook_schema(sheets, spreadsheet_id)

    result = {}
    if args.repair:
        result["repair"] = repair_sheet(sheets, spreadsheet_id)
    if args.enrich:
        result["enrich"] = enrich_missing(
            sheets,
            spreadsheet_id,
            limit=args.limit,
            source_csv=args.source_csv,
            live_lookup=args.live,
            mark_unresolved=not args.no_mark_unresolved,
        )

    records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
    result["report"] = build_hygiene_report(records)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        report = result["report"]
        print(f"rows={report['row_count']}")
        print(f"issues={report['issue_count']}")
        print(f"missing_rows={report['missing_count']}")
        print(f"duplicate_groups={report['duplicate_group_count']}")
        if args.repair:
            print(f"repair={result['repair']}")
        if args.enrich:
            print(f"enriched={len(result['enrich']['updated'])}")
            print(f"unresolved={len(result['enrich']['unresolved'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
