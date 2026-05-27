import unittest

from core.property_hygiene import build_hygiene_report, find_duplicate_groups, normalize_address_key, validate_property


class PropertyHygieneTests(unittest.TestCase):
    def test_validate_property_flags_bad_columns(self):
        issues = validate_property({
            "address": "12725 Bloomington Dr #129, Austin, Texas 78748",
            "zip": "12725",
            "photo_url": "not a url",
            "sqft": "large",
            "year_built": "soon",
        }, row_number=2)
        codes = {(issue["field"], issue["code"]) for issue in issues}

        self.assertIn(("zip", "mismatch"), codes)
        self.assertIn(("photo_url", "invalid_url"), codes)
        self.assertIn(("sqft", "invalid_number"), codes)
        self.assertIn(("year_built", "invalid_year"), codes)

    def test_duplicate_groups_normalize_common_suffixes(self):
        records = [
            {"address": "4309 Fairway Path"},
            {"address": "4309 Fairway Path, Round Rock, TX"},
            {"address": "4309 Fairway Path"},
            {"address": "1113 April Meadows Loop"},
        ]

        duplicates = find_duplicate_groups(records)

        self.assertEqual(len(duplicates), 1)
        self.assertEqual(len(duplicates[0]["rows"]), 3)

    def test_hygiene_report_counts_missing_and_duplicates(self):
        report = build_hygiene_report([
            {"address": "4309 Fairway Path", "zip": "", "sqft": "", "year_built": ""},
            {
                "address": "4309 Fairway Path",
                "zip": "78665",
                "sqft": "2702",
                "year_built": "2005",
                "photo_url": "https://example.com/photo.jpg",
                "listing_url": "https://example.com/listing",
            },
        ])

        self.assertEqual(report["row_count"], 2)
        self.assertEqual(report["missing_count"], 1)
        self.assertEqual(report["duplicate_group_count"], 1)

    def test_address_key_keeps_unit_markers(self):
        self.assertEqual(
            normalize_address_key("507 Sabine Street Apartment 509"),
            "507 sabine st apt 509",
        )


if __name__ == "__main__":
    unittest.main()
