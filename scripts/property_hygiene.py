import argparse
import json
import os
import sys
import time

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import apify_zillow_lookup, get_gmail_service, rentcast_lookup
from core.property_hygiene import build_hygiene_report
from core.properties_repair import clean_cell, normalize_property_record, repair_property_rows
from core.sheet_schema import PROPERTIES_HEADERS, PROPERTIES_TAB
from core.sheets_store import ensure_workbook_schema, read_table, update_row, values_for_headers


def _first(*values) -> str:
    for value in values:
        text = clean_cell(value)
        if text:
            return text
    return ""


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


def enrich_missing(sheets, spreadsheet_id: str, *, limit: int = 25, sleep_seconds: float = 0.1) -> dict:
    records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
    updated = []
    unresolved = []

    for index, record in enumerate(records, start=2):
        normalized = normalize_property_record(record)
        missing = [
            field for field in ("zip", "sqft", "year_built", "photo_url", "listing_url")
            if not clean_cell(normalized.get(field, ""))
        ]
        if not missing:
            continue
        if len(updated) >= limit:
            unresolved.append({"row": index, "address": normalized.get("address", ""), "missing": missing})
            continue

        query = _query_for_record(normalized)
        apify = apify_zillow_lookup(query)
        rentcast = {} if apify.get("sqft") and apify.get("year_built") else rentcast_lookup(query)

        next_record = dict(normalized)
        next_record["zip"] = normalized.get("zip") or _first(apify.get("zip"), rentcast.get("zipCode"))
        next_record["sqft"] = normalized.get("sqft") or _first(
            apify.get("sqft"), rentcast.get("squareFootage"), rentcast.get("livingArea")
        )
        next_record["year_built"] = normalized.get("year_built") or _first(
            apify.get("year_built"), rentcast.get("yearBuilt")
        )
        next_record["photo_url"] = normalized.get("photo_url") or _first(
            apify.get("photo_url"), rentcast.get("photoUrl")
        )
        next_record["listing_url"] = normalized.get("listing_url") or _first(apify.get("listing_url"))

        if any(next_record[field] != normalized.get(field) for field in ("zip", "sqft", "year_built", "photo_url", "listing_url")):
            update_row(sheets, spreadsheet_id, PROPERTIES_TAB, index, PROPERTIES_HEADERS, next_record)
            updated.append({
                "row": index,
                "address": normalized.get("address", ""),
                "sqft": next_record["sqft"],
                "year_built": next_record["year_built"],
            })
            time.sleep(sleep_seconds)
        else:
            unresolved.append({"row": index, "address": normalized.get("address", ""), "missing": missing})

    return {"updated": updated, "unresolved": unresolved}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate, repair, and enrich the properties Google Sheet.")
    parser.add_argument("--repair", action="store_true", help="Repair shifted rows and canonicalize headers.")
    parser.add_argument("--enrich", action="store_true", help="Fill missing sqft/year_built from live property data.")
    parser.add_argument("--limit", type=int, default=25, help="Maximum rows to enrich in one run.")
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
        result["enrich"] = enrich_missing(sheets, spreadsheet_id, limit=args.limit)

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
