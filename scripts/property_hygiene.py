import argparse
import csv
import json
import os
import re
import sys
import time
from datetime import datetime

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import APIFY_TOKEN, _timed_request, apify_zillow_lookup, get_gmail_service, rentcast_lookup
from core.property_hygiene import build_hygiene_report, normalize_address_key
from core.properties_repair import clean_cell, normalize_property_record, repair_property_rows
from core.sheet_schema import PROPERTIES_HEADERS, PROPERTIES_TAB
from core.sheets_store import batch_update_rows, ensure_workbook_schema, read_table, update_row, values_for_headers

DEFAULT_ZILLOW_CSV = "dataset_zillow-detail-scraper_2026-05-18_18-15-11-332.csv"
DEFAULT_APIFY_SEARCH_ACTOR = "truefetch~zillow-real-estate-listings"
DEFAULT_APIFY_DETAIL_ACTORS = (
    "maxcopell~zillow-detail-scraper",
    "kawsar~Affordable-Zillow-Details-Scraper",
)
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


def _index_match(record: dict[str, str], index: dict[str, dict[str, str]]) -> dict[str, str]:
    if not index:
        return {}
    for key in (normalize_address_key(record.get("address", "")), _unitless_address_key(record.get("address", ""))):
        match = index.get(key)
        if match:
            return match
    return {}


def _csv_match(record: dict[str, str], index: dict[str, dict[str, str]]) -> dict[str, str]:
    return _index_match(record, index)


def _location_parts(location: str) -> dict[str, str]:
    parts = [part.strip() for part in clean_cell(location).split(",") if part.strip()]
    zip_code = next((part for part in parts if re.fullmatch(r"78\d{3}", part)), "")
    state = next((part for part in parts if re.fullmatch(r"[A-Z]{2}", part)), "")
    return {"city": parts[0] if parts else "", "state": state, "zip": zip_code}


def _apify_search_record(item: dict) -> dict[str, str]:
    address_obj = item.get("address") if isinstance(item.get("address"), dict) else {}
    price = item.get("price") if isinstance(item.get("price"), dict) else {}
    rooms = item.get("rooms") if isinstance(item.get("rooms"), dict) else {}
    area = item.get("area") if isinstance(item.get("area"), dict) else {}
    dates = item.get("dates") if isinstance(item.get("dates"), dict) else {}
    location = _location_parts(_first(item.get("location"), item.get("title")))
    listing_id = clean_cell(item.get("listing_id", ""))
    listing_url = _first(item.get("source_url"), item.get("listing_url"), item.get("property_url"))
    if not listing_url and listing_id:
        slug = re.sub(r"[^a-zA-Z0-9-]+", "-", _first(item.get("address"), item.get("title"))).strip("-")
        listing_url = f"https://www.zillow.com/homedetails/{slug}/{listing_id}_zpid/"
    image_urls = item.get("image_urls") if isinstance(item.get("image_urls"), list) else []
    return {
        "address": _first(item.get("address"), item.get("title"), address_obj.get("streetAddress")),
        "city": _first(item.get("city"), address_obj.get("city"), location["city"]),
        "state": _first(item.get("state"), address_obj.get("state"), location["state"]),
        "zip": _first(item.get("zip"), item.get("zipcode"), address_obj.get("zipcode"), location["zip"]),
        "price": _digits(_first(price.get("market"), price.get("value"), item.get("price"))),
        "beds": _digits(_first(rooms.get("beds"), item.get("beds"), item.get("bedrooms"))),
        "baths": _digits(_first(rooms.get("baths"), item.get("baths"), item.get("bathrooms"))),
        "sqft": _digits(_first(area.get("floor"), area.get("floor_text"), item.get("sqft"), item.get("livingArea"))),
        "year_built": _digits(_first(item.get("year_built"), item.get("yearBuilt"))),
        "photo_url": _first(item.get("cover_image"), *(image_urls[:1])),
        "days_on_market": _digits(_first(dates.get("market_days"), item.get("daysOnZillow"))),
        "listing_url": listing_url,
        "property_type": clean_cell(item.get("property_type", "")).replace("_", " ").title(),
    }


def _fetch_apify_json(url: str) -> object:
    try:
        import requests

        response = requests.get(url, timeout=120)
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        raise RuntimeError(f"Apify read failed: {exc}") from exc


def build_apify_search_index(
    *,
    since: str,
    run_limit: int = 200,
    actor: str = DEFAULT_APIFY_SEARCH_ACTOR,
    token: str = "",
) -> dict[str, dict[str, str]]:
    if not token:
        return {}
    since_ms = datetime.fromisoformat(since.replace("Z", "+00:00")).timestamp() * 1000
    runs_url = (
        f"https://api.apify.com/v2/acts/{actor}/runs"
        f"?token={token}&limit={run_limit}&desc=1"
    )
    runs_payload = _fetch_apify_json(runs_url)
    runs = [
        run for run in (runs_payload.get("data", {}) or {}).get("items", [])
        if run.get("status") == "SUCCEEDED"
        and run.get("defaultDatasetId")
        and datetime.fromisoformat(str(run.get("startedAt", "")).replace("Z", "+00:00")).timestamp() * 1000 >= since_ms
    ]
    index: dict[str, dict[str, str]] = {}
    for run in sorted(runs, key=lambda item: item.get("startedAt", "")):
        items_url = (
            f"https://api.apify.com/v2/datasets/{run['defaultDatasetId']}/items"
            f"?token={token}&clean=true"
        )
        items = _fetch_apify_json(items_url)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            record = _apify_search_record(item)
            address = record.get("address", "")
            if not address:
                continue
            for key in {normalize_address_key(address), _unitless_address_key(address)}:
                if not key:
                    continue
                existing = index.get(key)
                if not existing:
                    index[key] = record
                    continue
                merged = dict(existing)
                _apply_missing_values(merged, record)
                index[key] = merged
    return index


def _core_field_score(record: dict[str, str]) -> int:
    return sum(1 for field in CORE_HEALTH_FIELDS if clean_cell(record.get(field, "")))


def _tab_sheet_id(sheets, spreadsheet_id: str, tab_name: str) -> int | None:
    spreadsheet = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    for sheet in spreadsheet.get("sheets", []):
        props = sheet.get("properties", {})
        if props.get("title") == tab_name:
            return props.get("sheetId")
    return None


def dedupe_sheet(sheets, spreadsheet_id: str) -> dict:
    records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
    groups = {}
    for index, record in enumerate(records, start=2):
        key = normalize_address_key(record.get("address", ""))
        if not key:
            continue
        groups.setdefault(key, []).append((index, normalize_property_record(record)))

    removed = []
    for key, rows in groups.items():
        if len(rows) < 2:
            continue
        keeper = max(rows, key=lambda item: (_core_field_score(item[1]), -item[0]))
        for row_number, record in rows:
            if row_number == keeper[0]:
                continue
            removed.append({"row": row_number, "address": record.get("address", ""), "kept_row": keeper[0]})

    if not removed:
        return {"removed": [], "duplicate_groups": 0}

    sheet_id = _tab_sheet_id(sheets, spreadsheet_id, PROPERTIES_TAB)
    if sheet_id is None:
        raise RuntimeError(f"Could not resolve sheet id for tab {PROPERTIES_TAB}")

    requests = []
    for entry in sorted(removed, key=lambda item: item["row"], reverse=True):
        row_index = entry["row"] - 1
        requests.append({
            "deleteDimension": {
                "range": {
                    "sheetId": sheet_id,
                    "dimension": "ROWS",
                    "startIndex": row_index,
                    "endIndex": row_index + 1,
                },
            },
        })
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": requests},
    ).execute()
    return {"removed": removed, "duplicate_groups": len(removed)}


def _year_from_description(text: str) -> str:
    match = re.search(r"(?:built|year built|constructed)[^\d]{0,20}((?:19|20)\d{2})", text or "", re.I)
    return match.group(1) if match else ""


def build_apify_detail_index(
    *,
    token: str = "",
    run_limit: int = 100,
    actors: tuple[str, ...] = DEFAULT_APIFY_DETAIL_ACTORS,
) -> dict[str, dict[str, str]]:
    if not token:
        return {}
    index: dict[str, dict[str, str]] = {}
    for actor in actors:
        runs_url = f"https://api.apify.com/v2/acts/{actor}/runs?token={token}&limit={run_limit}&desc=1"
        runs_payload = _fetch_apify_json(runs_url)
        runs = [
            run for run in (runs_payload.get("data", {}) or {}).get("items", [])
            if run.get("status") == "SUCCEEDED" and run.get("defaultDatasetId")
        ]
        for run in sorted(runs, key=lambda item: item.get("startedAt", "")):
            items_url = (
                f"https://api.apify.com/v2/datasets/{run['defaultDatasetId']}/items"
                f"?token={token}&clean=true"
            )
            items = _fetch_apify_json(items_url)
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                record = _detail_record_from_item(item)
                address = _first(item.get("streetAddress"), item.get("address"))
                if not address:
                    continue
                for key in {normalize_address_key(address), _unitless_address_key(address)}:
                    if not key:
                        continue
                    existing = index.get(key)
                    if not existing:
                        index[key] = record
                        continue
                    merged = dict(existing)
                    _apply_missing_values(merged, record)
                    index[key] = merged
    return index


def _detail_record_from_item(item: dict) -> dict[str, str]:
    photos = item.get("responsivePhotos") or []
    photo_url = ""
    if isinstance(photos, list):
        for photo in photos:
            url = photo.get("url") if isinstance(photo, dict) else ""
            if url and "maps.googleapis" not in url:
                photo_url = url
                break
    return {
        "zip": _first(item.get("zipcode")),
        "sqft": _digits(_first(item.get("livingArea"), item.get("livingAreaValue"))),
        "year_built": _digits(item.get("yearBuilt")),
        "photo_url": _first(
            photo_url,
            item.get("imgSrc"),
            item.get("hiResImageLink"),
            item.get("desktopWebHdpImageLink"),
        ),
        "listing_url": _zillow_listing_url(_first(item.get("hdpUrl"), item.get("url"))),
    }


def _batch_detail_lookup(queries: list[str], *, batch_size: int = 20) -> dict[str, dict[str, str]]:
    if not queries or not APIFY_TOKEN:
        return {}
    index: dict[str, dict[str, str]] = {}
    for start in range(0, len(queries), batch_size):
        chunk = queries[start:start + batch_size]
        response = _timed_request(
            "POST",
            f"https://api.apify.com/v2/acts/ENK9p4RZHg0iVso52/run-sync-get-dataset-items"
            f"?token={APIFY_TOKEN}&timeout=180&memory=512",
            "Apify/batch-detail",
            json={"addresses": chunk},
            timeout=190,
        )
        if not response or response.status_code not in (200, 201):
            continue
        for item in response.json():
            if not isinstance(item, dict):
                continue
            address = _first(item.get("streetAddress"), item.get("address"))
            key = normalize_address_key(address)
            if not key:
                continue
            index[key] = _detail_record_from_item(item)
    return index


def _flush_batch_writes(
    sheets,
    spreadsheet_id: str,
    pending_writes: list[tuple[int, dict[str, str]]],
) -> None:
    for start in range(0, len(pending_writes), 50):
        chunk = pending_writes[start:start + 50]
        for attempt in range(5):
            try:
                batch_update_rows(sheets, spreadsheet_id, PROPERTIES_TAB, PROPERTIES_HEADERS, chunk)
                break
            except Exception as exc:
                if "429" not in str(exc) or attempt == 4:
                    raise
                time.sleep(15 * (attempt + 1))
        if start + 50 < len(pending_writes):
            time.sleep(61)


def _street_view_photo_url(address: str) -> str:
    key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    query = clean_cell(address)
    if not key or not query:
        return ""
    return (
        "https://maps.googleapis.com/maps/api/streetview"
        f"?location={query.replace(' ', '+')}&size=640x480&key={key}"
    )


def _rentcast_core_lookup(record: dict[str, str]) -> dict[str, str]:
    rentcast = rentcast_lookup(_query_for_record(record))
    photo_url = _first(rentcast.get("photoUrl"))
    if not photo_url:
        photo_url = _street_view_photo_url(_query_for_record(record))
    return {
        "zip": _first(rentcast.get("zipCode")),
        "sqft": _first(rentcast.get("squareFootage"), rentcast.get("livingArea")),
        "year_built": _digits(rentcast.get("yearBuilt")),
        "photo_url": photo_url,
    }


def _live_core_lookup(record: dict[str, str]) -> dict[str, str]:
    query = _query_for_record(record)
    rentcast = rentcast_lookup(query)
    live_source = {
        "zip": _first(rentcast.get("zipCode")),
        "sqft": _first(rentcast.get("squareFootage"), rentcast.get("livingArea")),
        "year_built": _digits(rentcast.get("yearBuilt")),
        "photo_url": _first(rentcast.get("photoUrl")),
    }
    remaining = [field for field in CORE_HEALTH_FIELDS if not clean_cell(live_source.get(field, ""))]
    if remaining:
        apify = apify_zillow_lookup(query)
        live_source = {
            "zip": _first(live_source.get("zip"), apify.get("zip")),
            "sqft": _first(live_source.get("sqft"), apify.get("sqft")),
            "year_built": _first(live_source.get("year_built"), apify.get("year_built")),
            "photo_url": _first(live_source.get("photo_url"), apify.get("photo_url")),
            "listing_url": _first(apify.get("listing_url")),
            "status": _first(apify.get("status")),
        }
    return live_source


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
    sleep_seconds: float = 0.05,
    source_csv: str = DEFAULT_ZILLOW_CSV,
    apify_index: dict[str, dict[str, str]] | None = None,
    detail_index: dict[str, dict[str, str]] | None = None,
    live_lookup: bool = False,
    mark_unresolved: bool = True,
) -> dict:
    records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
    csv_index = build_zillow_csv_index(source_csv)
    apify_index = apify_index or {}
    detail_index = detail_index or {}
    updated = []
    unresolved = []
    processed = 0
    pending_writes: list[tuple[int, dict[str, str]]] = []
    detail_queue: list[tuple[int, dict[str, str], list[str]]] = []

    for index, record in enumerate(records, start=2):
        normalized = normalize_property_record(record)
        missing = [field for field in CORE_HEALTH_FIELDS if not clean_cell(normalized.get(field, ""))]
        if not missing:
            continue
        if processed >= limit:
            unresolved.append({"row": index, "address": normalized.get("address", ""), "missing": missing})
            continue

        next_record = dict(normalized)
        sources = []
        csv_record = _csv_match(normalized, csv_index)
        if csv_record and _apply_missing_values(next_record, csv_record):
            sources.append("zillow_csv")

        apify_record = _index_match(normalized, apify_index)
        if apify_record and _apply_missing_values(next_record, apify_record):
            sources.append("apify_search")

        detail_record = _index_match(normalized, detail_index)
        if detail_record and _apply_missing_values(next_record, detail_record):
            sources.append("apify_detail")

        if "year_built" in missing and not clean_cell(next_record.get("year_built", "")):
            year_hint = _year_from_description(normalized.get("description", ""))
            if year_hint:
                next_record["year_built"] = year_hint
                sources.append("description_year")

        remaining = [field for field in CORE_HEALTH_FIELDS if not clean_cell(next_record.get(field, ""))]
        if remaining and live_lookup:
            detail_queue.append((index, next_record, list(remaining)))
            processed += 1
            continue

        remaining = [field for field in CORE_HEALTH_FIELDS if not clean_cell(next_record.get(field, ""))]
        if remaining and mark_unresolved and not clean_cell(next_record.get("status", "")):
            next_record["status"] = f"Needs review: missing {', '.join(remaining)}"

        processed += 1
        if next_record != normalized:
            pending_writes.append((index, next_record))
            updated.append({
                "row": index,
                "address": normalized.get("address", ""),
                "source": "+".join(sources) if sources else "review_note",
                "missing_before": missing,
                "missing_after": remaining,
            })
        else:
            unresolved.append({"row": index, "address": normalized.get("address", ""), "missing": remaining})

    if detail_queue:
        detail_index = _batch_detail_lookup([_query_for_record(record) for _, record, _ in detail_queue])
        for index, next_record, missing in detail_queue:
            detail = _index_match(next_record, detail_index)
            sources = []
            if detail and _apply_missing_values(next_record, detail):
                sources.append("batch_detail")
            if "year_built" in missing and not clean_cell(next_record.get("year_built", "")):
                year_hint = _year_from_description(next_record.get("description", ""))
                if year_hint:
                    next_record["year_built"] = year_hint
                    sources.append("description_year")
            remaining = [field for field in CORE_HEALTH_FIELDS if not clean_cell(next_record.get(field, ""))]
            if remaining:
                live_source = _rentcast_core_lookup(next_record)
                if _apply_missing_values(next_record, live_source):
                    sources.append("rentcast")
            if not clean_cell(next_record.get("photo_url", "")):
                street_view = _street_view_photo_url(_query_for_record(next_record))
                if street_view:
                    next_record["photo_url"] = street_view
                    sources.append("street_view")
            remaining = [field for field in CORE_HEALTH_FIELDS if not clean_cell(next_record.get(field, ""))]
            if remaining and mark_unresolved and not clean_cell(next_record.get("status", "")):
                next_record["status"] = f"Needs review: missing {', '.join(remaining)}"
            normalized = normalize_property_record(records[index - 2])
            if next_record != normalized:
                pending_writes.append((index, next_record))
                updated.append({
                    "row": index,
                    "address": normalized.get("address", ""),
                    "source": "+".join(sources) if sources else "live_lookup",
                    "missing_before": missing,
                    "missing_after": remaining,
                })
            else:
                unresolved.append({"row": index, "address": normalized.get("address", ""), "missing": remaining})

    _flush_batch_writes(sheets, spreadsheet_id, pending_writes)
    return {"updated": updated, "unresolved": unresolved, "processed": processed}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate, repair, and enrich the properties Google Sheet.")
    parser.add_argument("--repair", action="store_true", help="Repair shifted rows and canonicalize headers.")
    parser.add_argument("--dedupe", action="store_true", help="Remove duplicate property rows, keeping the most complete row.")
    parser.add_argument("--enrich", action="store_true", help="Fill missing property health fields from local Zillow data and optional live lookup.")
    parser.add_argument("--limit", type=int, default=25, help="Maximum rows to enrich in one run.")
    parser.add_argument("--all", action="store_true", help="Enrich every row missing core fields in one run.")
    parser.add_argument("--source-csv", default=DEFAULT_ZILLOW_CSV, help="Local Zillow CSV used before live lookups.")
    parser.add_argument("--apify-runs-since", default="", help="Recover Apify search actor rows since ISO timestamp for sqft/photo backfill.")
    parser.add_argument("--apify-index-path", default="", help="Load a prebuilt Apify search index JSON instead of fetching runs live.")
    parser.add_argument("--apify-run-limit", type=int, default=200, help="Maximum Apify runs to scan for --apify-runs-since.")
    parser.add_argument("--apify-detail-index", action="store_true", help="Index prior Zillow detail-scraper runs for year_built backfill.")
    parser.add_argument("--live", action="store_true", help="Use live RentCast/Apify lookup for rows not found in local sources.")
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
    if args.dedupe:
        result["dedupe"] = dedupe_sheet(sheets, spreadsheet_id)

    records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
    enrich_limit = len(records) + 1 if args.all else args.limit
    apify_index = {}
    detail_index = {}
    if args.enrich:
        if args.apify_index_path:
            with open(args.apify_index_path, encoding="utf-8") as handle:
                payload = json.load(handle)
            apify_index = payload.get("index", payload)
            result["apify_index_keys"] = len(apify_index)
        elif args.apify_runs_since:
            apify_index = build_apify_search_index(
                since=args.apify_runs_since,
                run_limit=args.apify_run_limit,
                token=os.getenv("APIFY_TOKEN", "").strip(),
            )
            result["apify_index_keys"] = len(apify_index)
        if args.apify_detail_index:
            detail_index = build_apify_detail_index(token=os.getenv("APIFY_TOKEN", "").strip())
            result["apify_detail_index_keys"] = len(detail_index)

    if args.enrich:
        result["enrich"] = enrich_missing(
            sheets,
            spreadsheet_id,
            limit=enrich_limit,
            source_csv=args.source_csv,
            apify_index=apify_index,
            detail_index=detail_index,
            live_lookup=args.live,
            mark_unresolved=not args.no_mark_unresolved,
        )

    records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
    result["report"] = build_hygiene_report(records)
    total = result["report"]["row_count"]
    missing = result["report"]["missing_count"]
    result["health_score"] = round(((total - missing) / total) * 100) if total else 100

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        report = result["report"]
        print(f"rows={report['row_count']}")
        print(f"issues={report['issue_count']}")
        print(f"missing_rows={report['missing_count']}")
        print(f"duplicate_groups={report['duplicate_group_count']}")
        print(f"health_score={result['health_score']}")
        if args.repair:
            print(f"repair={result['repair']}")
        if args.dedupe:
            print(f"dedupe={result['dedupe']}")
        if args.enrich:
            print(f"enriched={len(result['enrich']['updated'])}")
            print(f"unresolved={len(result['enrich']['unresolved'])}")
            print(f"processed={result['enrich']['processed']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
