import unittest

from core.sheets_store import build_add_sheet_requests, missing_headers, row_to_dict
from core.sheet_schema import LEAD_MEMORY_HEADERS


class SheetsStoreTests(unittest.TestCase):
    def test_build_add_sheet_requests_only_adds_missing_tabs(self):
        requests = build_add_sheet_requests(existing_tabs={"properties"})
        titles = [req["addSheet"]["properties"]["title"] for req in requests]
        self.assertEqual(titles, ["lead_memory", "conversation_events"])

    def test_missing_headers_returns_only_absent_headers(self):
        current = ["email", "phone"]
        self.assertEqual(missing_headers(current, ["email", "phone", "full_name"]), ["full_name"])

    def test_row_to_dict_pads_short_rows(self):
        row = ["lead@example.com", "+15125550123"]
        result = row_to_dict(LEAD_MEMORY_HEADERS, row)
        self.assertEqual(result["email"], "lead@example.com")
        self.assertEqual(result["phone"], "+15125550123")
        self.assertEqual(result["summary"], "")


if __name__ == "__main__":
    unittest.main()
