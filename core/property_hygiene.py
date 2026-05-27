from __future__ import annotations

import re
from collections import defaultdict

from core.properties_repair import clean_cell, extract_zip, is_zip, normalize_property_record
from core.sheet_schema import PROPERTIES_HEADERS


def _parse_number(value: str) -> float | None:
    text = re.sub(r"[^\d.]", "", str(value or ""))
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def normalize_address_key(address: str) -> str:
    street = (address or "").split(",", 1)[0].lower()
    replacements = {
        "street": "st",
        "road": "rd",
        "avenue": "ave",
        "drive": "dr",
        "lane": "ln",
        "circle": "cir",
        "trail": "trl",
        "boulevard": "blvd",
        "apartment": "apt",
        "unit": "unit",
    }
    for source, target in replacements.items():
        street = re.sub(rf"\b{source}\b", target, street)
    street = re.sub(r"[^a-z0-9#]+", " ", street)
    return re.sub(r"\s+", " ", street).strip()


def validate_property(record: dict[str, str], row_number: int | None = None) -> list[dict[str, str]]:
    raw_zip = clean_cell(record.get("zip", ""))
    raw_address = clean_cell(record.get("address", ""))
    property_row = normalize_property_record(record)
    issues = []

    def add(field: str, code: str, value: str, message: str) -> None:
        issues.append({
            "row": str(row_number or ""),
            "address": property_row.get("address", ""),
            "field": field,
            "code": code,
            "value": value,
            "message": message,
        })

    address = property_row.get("address", "")
    if not address:
        add("address", "missing", "", "Address is required.")

    address_zip = extract_zip(raw_address or address)
    zip_value = property_row.get("zip", "")
    if address_zip and raw_zip and raw_zip != address_zip:
        add("zip", "mismatch", raw_zip, f"ZIP should match address ZIP {address_zip}.")
    elif zip_value and not is_zip(zip_value):
        add("zip", "invalid", zip_value, "ZIP must be five digits.")

    for field in ("price", "beds", "baths", "days_on_market", "sqft"):
        value = property_row.get(field, "")
        if value and _parse_number(value) is None:
            add(field, "invalid_number", value, f"{field} must be numeric.")

    year = property_row.get("year_built", "")
    if year and not re.fullmatch(r"\d{4}", year):
        add("year_built", "invalid_year", year, "year_built must be four digits.")

    photo_url = property_row.get("photo_url", "")
    if photo_url and not photo_url.startswith(("http://", "https://")):
        add("photo_url", "invalid_url", photo_url, "photo_url must be a URL.")

    listing_url = property_row.get("listing_url", "")
    if listing_url and not listing_url.startswith(("http://", "https://")):
        add("listing_url", "invalid_url", listing_url, "listing_url must be a URL.")

    return issues


def missing_core_fields(record: dict[str, str]) -> list[str]:
    return [
        field for field in ("zip", "sqft", "year_built", "photo_url")
        if not clean_cell(record.get(field, ""))
    ]


def find_duplicate_groups(records: list[dict[str, str]]) -> list[dict[str, object]]:
    grouped = defaultdict(list)
    for index, record in enumerate(records, start=2):
        key = normalize_address_key(record.get("address", ""))
        if key:
            grouped[key].append({"row": index, "address": record.get("address", "")})
    return [
        {"key": key, "rows": rows}
        for key, rows in sorted(grouped.items())
        if len(rows) > 1
    ]


def build_hygiene_report(records: list[dict[str, str]]) -> dict[str, object]:
    issues = []
    missing_rows = []
    for index, record in enumerate(records, start=2):
        normalized = normalize_property_record(record)
        row_missing = missing_core_fields(normalized)
        if row_missing:
            missing_rows.append({
                "row": index,
                "address": normalized.get("address", ""),
                "missing": row_missing,
            })
        issues.extend(validate_property(normalized, index))

    duplicates = find_duplicate_groups(records)
    return {
        "row_count": len(records),
        "issue_count": len(issues),
        "missing_count": len(missing_rows),
        "duplicate_group_count": len(duplicates),
        "issues": issues,
        "missing_rows": missing_rows,
        "duplicates": duplicates,
        "headers": PROPERTIES_HEADERS,
    }
