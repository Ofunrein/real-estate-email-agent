from __future__ import annotations

from typing import Any

from core.sheet_schema import REQUIRED_TABS, TAB_HEADERS


def build_add_sheet_requests(existing_tabs: set[str]) -> list[dict[str, Any]]:
    return [
        {"addSheet": {"properties": {"title": tab}}}
        for tab in REQUIRED_TABS
        if tab not in existing_tabs
    ]


def missing_headers(current_headers: list[str], required_headers: list[str]) -> list[str]:
    current = {header.strip() for header in current_headers if header.strip()}
    return [header for header in required_headers if header not in current]


def row_to_dict(headers: list[str], row: list[str]) -> dict[str, str]:
    padded = row + [""] * max(0, len(headers) - len(row))
    return dict(zip(headers, padded))


def values_for_headers(headers: list[str], data: dict) -> list[str]:
    return [str(data.get(header, "") or "") for header in headers]


def get_spreadsheet_tabs(sheets, spreadsheet_id: str) -> set[str]:
    spreadsheet = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    return {
        sheet["properties"]["title"]
        for sheet in spreadsheet.get("sheets", [])
        if sheet.get("properties", {}).get("title")
    }


def ensure_workbook_schema(sheets, spreadsheet_id: str) -> None:
    existing_tabs = get_spreadsheet_tabs(sheets, spreadsheet_id)
    add_requests = build_add_sheet_requests(existing_tabs)
    if add_requests:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": add_requests},
        ).execute()

    for tab, headers in TAB_HEADERS.items():
        result = sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!1:1",
        ).execute()
        current_headers = result.get("values", [[]])[0] if result.get("values") else []
        if not current_headers:
            sheets.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f"{tab}!1:1",
                valueInputOption="RAW",
                body={"values": [headers]},
            ).execute()
            continue

        additions = missing_headers(current_headers, headers)
        if additions:
            merged = current_headers + additions
            sheets.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f"{tab}!1:1",
                valueInputOption="RAW",
                body={"values": [merged]},
            ).execute()


def read_table(sheets, spreadsheet_id: str, tab: str) -> list[dict[str, str]]:
    result = sheets.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A:ZZ",
    ).execute()
    rows = result.get("values", [])
    if not rows:
        return []
    headers = rows[0]
    return [row_to_dict(headers, row) for row in rows[1:]]


def append_row(sheets, spreadsheet_id: str, tab: str, headers: list[str], row: dict) -> None:
    sheets.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A:ZZ",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [values_for_headers(headers, row)]},
    ).execute()


def update_row(sheets, spreadsheet_id: str, tab: str, row_number: int, headers: list[str], row: dict) -> None:
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A{row_number}:ZZ{row_number}",
        valueInputOption="RAW",
        body={"values": [values_for_headers(headers, row)]},
    ).execute()
