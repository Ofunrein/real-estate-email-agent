#!/usr/bin/env python3
"""Run checkpointed property enrichment until health score stops improving."""
from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import get_gmail_service
from core.sheet_schema import PROPERTIES_TAB
from core.sheets_store import read_table
from scripts.property_hygiene import backfill_zip_median_core_fields, build_hygiene_report, enrich_missing


def health_score(report: dict) -> int:
    total = report["row_count"]
    missing = report["missing_count"]
    return round(((total - missing) / total) * 100) if total else 100


def main() -> int:
    load_dotenv(".env")
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        print("GOOGLE_SHEET_ID is required")
        return 1

    _, sheets = get_gmail_service()
    pass_num = 0
    while True:
        pass_num += 1
        records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
        before_report = build_hygiene_report(records)
        before_missing = before_report["missing_count"]
        if before_missing == 0:
            print(f"pass={pass_num} health=100 missing=0")
            return 0

        print(
            f"pass={pass_num} start missing={before_missing} health={health_score(before_report)}",
            flush=True,
        )
        result = enrich_missing(
            sheets,
            spreadsheet_id,
            limit=len(records) + 1,
            live_lookup=True,
            mark_unresolved=False,
        )
        records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
        after_report = build_hygiene_report(records)
        after_missing = after_report["missing_count"]
        print(
            f"pass={pass_num} updated={len(result['updated'])} "
            f"missing={before_missing}->{after_missing} health={health_score(after_report)}",
            flush=True,
        )
        if after_missing >= before_missing:
            print(f"STALL remaining_missing={after_missing}", flush=True)
            backfill = backfill_zip_median_core_fields(sheets, spreadsheet_id)
            records = read_table(sheets, spreadsheet_id, PROPERTIES_TAB)
            report = build_hygiene_report(records)
            after_missing = report["missing_count"]
            print(
                f"backfill updated={len(backfill['updated'])} missing={after_missing} "
                f"health={health_score(report)}",
                flush=True,
            )
            if after_missing == 0:
                return 0
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
