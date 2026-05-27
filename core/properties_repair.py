from __future__ import annotations

import re

from core.sheet_schema import PROPERTIES_HEADERS
from core.sheets_store import values_for_headers

PROPERTY_TYPES = {
    "single-family home",
    "condo",
    "townhouse",
    "multi-family",
    "apartment",
    "manufactured",
    "home type unknown",
}


def normalize_header(header: str) -> str:
    key = (header or "").strip().lower().replace(" ", "_")
    aliases = {
        "bath": "baths",
        "sq_ft": "sqft",
        "square_feet": "sqft",
        "photo": "photo_url",
        "photo_url": "photo_url",
        "listing": "listing_url",
    }
    return aliases.get(key, key)


def extract_zip(address: str) -> str:
    matches = re.findall(r"\b(\d{5})(?:-\d{4})?\b", address or "")
    return matches[-1] if matches else ""


def is_zip(value: str) -> bool:
    return bool(re.fullmatch(r"\d{5}", str(value or "").strip()))


def clean_cell(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"none", "null", "n/a", "na", "unknown"} else text


def _is_url(value: str) -> bool:
    return str(value or "").strip().lower().startswith(("http://", "https://"))


def _looks_like_shifted_row(row: list[str]) -> bool:
    if len(row) <= 6:
        return False
    zip_cell = clean_cell(row[6])
    if not zip_cell or is_zip(zip_cell):
        return False

    later = [clean_cell(value).lower() for value in row[7:14]]
    if any(value in PROPERTY_TYPES for value in later):
        return True
    if any(_is_url(value) for value in row[7:14]):
        return True
    if len(row) > 11 and _is_url(row[11]):
        return True
    return False


def _row_to_normalized_dict(headers: list[str], row: list[str]) -> dict[str, str]:
    padded = row + [""] * max(0, len(headers) - len(row))
    return {
        normalize_header(header): clean_cell(value)
        for header, value in zip(headers, padded)
        if normalize_header(header)
    }


def _repair_shifted_row(row: list[str]) -> dict[str, str]:
    padded = row + [""] * max(0, len(PROPERTIES_HEADERS) - len(row))
    repaired = {
        "address": clean_cell(padded[0]),
        "price": clean_cell(padded[1]),
        "beds": clean_cell(padded[2]),
        "baths": clean_cell(padded[3]),
        "city": clean_cell(padded[4]),
        "state": clean_cell(padded[5]),
        "zip": extract_zip(clean_cell(padded[0])),
        "description": clean_cell(padded[6]),
        "neighborhood": clean_cell(padded[7]),
        "property_type": clean_cell(padded[8]),
        "features": clean_cell(padded[9]),
        "days_on_market": clean_cell(padded[10]),
        "photo_url": clean_cell(padded[11]),
        "sqft": clean_cell(padded[12]),
        "year_built": clean_cell(padded[13]),
        "status": clean_cell(padded[14]),
        "listing_url": clean_cell(padded[15]),
        "agent_name": clean_cell(padded[16]),
        "agent_email": clean_cell(padded[17]),
    }
    return repaired


def _normalize_state(value: str) -> str:
    state = clean_cell(value)
    if state.lower() == "texas":
        return "TX"
    return state


def normalize_property_record(record: dict[str, str]) -> dict[str, str]:
    normalized = {header: clean_cell(record.get(header, "")) for header in PROPERTIES_HEADERS}
    address_zip = extract_zip(normalized["address"])
    if address_zip and normalized["zip"] != address_zip:
        normalized["zip"] = address_zip
    elif not is_zip(normalized["zip"]):
        normalized["zip"] = address_zip
    normalized["state"] = _normalize_state(normalized["state"])

    if not normalized["city"]:
        parts = [part.strip() for part in normalized["address"].split(",")]
        if len(parts) > 1:
            normalized["city"] = parts[1]

    if not _is_url(normalized["photo_url"]):
        for key, value in record.items():
            if key != "listing_url" and _is_url(value):
                normalized["photo_url"] = value
                break

    if normalized["listing_url"] and not _is_url(normalized["listing_url"]):
        normalized["listing_url"] = ""

    return normalized


def repair_property_row(headers: list[str], row: list[str]) -> tuple[dict[str, str], bool]:
    if _looks_like_shifted_row(row):
        return normalize_property_record(_repair_shifted_row(row)), True
    return normalize_property_record(_row_to_normalized_dict(headers, row)), False


def repair_property_rows(rows: list[list[str]]) -> tuple[list[list[str]], dict[str, int]]:
    if not rows:
        return [PROPERTIES_HEADERS], {"rows": 0, "shifted_rows": 0}

    headers = [normalize_header(header) for header in rows[0]]
    repaired_rows = [PROPERTIES_HEADERS]
    shifted_count = 0

    for row in rows[1:]:
        if not any(clean_cell(value) for value in row):
            continue
        repaired, shifted = repair_property_row(headers, row)
        shifted_count += 1 if shifted else 0
        repaired_rows.append(values_for_headers(PROPERTIES_HEADERS, repaired))

    return repaired_rows, {
        "rows": max(0, len(repaired_rows) - 1),
        "shifted_rows": shifted_count,
    }
