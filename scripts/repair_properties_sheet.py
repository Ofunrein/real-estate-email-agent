import os
import sys
from datetime import datetime

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import get_gmail_service
from core.properties_repair import repair_property_rows
from core.sheet_schema import PROPERTIES_TAB
from core.sheets_store import ensure_workbook_schema, get_spreadsheet_tabs


def _unique_backup_tab(existing_tabs: set[str]) -> str:
    stamp = datetime.now().strftime("%Y_%m_%d_%H%M%S")
    base = f"{PROPERTIES_TAB}_backup_{stamp}"
    candidate = base
    suffix = 2
    while candidate in existing_tabs:
        candidate = f"{base}_{suffix}"
        suffix += 1
    return candidate


def _read_raw_values(sheets, spreadsheet_id: str, tab: str) -> list[list[str]]:
    result = sheets.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A:ZZ",
    ).execute()
    return result.get("values", [])


def _write_values(sheets, spreadsheet_id: str, tab: str, rows: list[list[str]]) -> None:
    sheets.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A:ZZ",
        body={},
    ).execute()
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A1",
        valueInputOption="RAW",
        body={"values": rows},
    ).execute()


def _create_backup(sheets, spreadsheet_id: str, rows: list[list[str]]) -> str:
    existing_tabs = get_spreadsheet_tabs(sheets, spreadsheet_id)
    backup_tab = _unique_backup_tab(existing_tabs)
    sheets.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={"requests": [{"addSheet": {"properties": {"title": backup_tab}}}]},
    ).execute()
    if rows:
        _write_values(sheets, spreadsheet_id, backup_tab, rows)
    return backup_tab


def main() -> int:
    load_dotenv()
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        print("GOOGLE_SHEET_ID is required")
        return 1

    _, sheets = get_gmail_service()
    ensure_workbook_schema(sheets, spreadsheet_id)
    raw_rows = _read_raw_values(sheets, spreadsheet_id, PROPERTIES_TAB)
    if not raw_rows:
        print(f"No rows found in {PROPERTIES_TAB}")
        return 1

    backup_tab = _create_backup(sheets, spreadsheet_id, raw_rows)
    repaired_rows, stats = repair_property_rows(raw_rows)
    _write_values(sheets, spreadsheet_id, PROPERTIES_TAB, repaired_rows)

    print(f"Backed up {PROPERTIES_TAB} to {backup_tab}")
    print(f"Rewrote {stats['rows']} property rows")
    print(f"Fixed {stats['shifted_rows']} shifted rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
