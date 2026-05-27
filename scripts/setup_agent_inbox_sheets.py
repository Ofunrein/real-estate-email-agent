import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import get_gmail_service
from core.sheets_store import ensure_workbook_schema


def main() -> int:
    load_dotenv()
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        print("GOOGLE_SHEET_ID is required")
        return 1
    _, sheets = get_gmail_service()
    ensure_workbook_schema(sheets, spreadsheet_id)
    print("Agent Inbox workbook schema is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
