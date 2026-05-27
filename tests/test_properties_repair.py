import unittest

from core.properties_repair import repair_property_row, repair_property_rows
from core.sheet_schema import PROPERTIES_HEADERS


class PropertiesRepairTests(unittest.TestCase):
    def test_repair_shifted_row_inserts_zip_and_moves_columns(self):
        row = [
            "5005 Buchanan Draw Rd, Austin, Texas 78738",
            "650000",
            "4",
            "1",
            "Austin",
            "TX",
            "Quiet street with mature trees and new roof.",
            "Bee Cave / Lakeway",
            "Single-Family Home",
            "Other, Garage - Attached",
            "248",
            "https://example.com/photo.jpg",
            "2515",
            "2018",
        ]

        repaired, shifted = repair_property_row(PROPERTIES_HEADERS, row)

        self.assertTrue(shifted)
        self.assertEqual(repaired["zip"], "78738")
        self.assertEqual(repaired["description"], "Quiet street with mature trees and new roof.")
        self.assertEqual(repaired["neighborhood"], "Bee Cave / Lakeway")
        self.assertEqual(repaired["property_type"], "Single-Family Home")
        self.assertEqual(repaired["features"], "Other, Garage - Attached")
        self.assertEqual(repaired["days_on_market"], "248")
        self.assertEqual(repaired["photo_url"], "https://example.com/photo.jpg")
        self.assertEqual(repaired["sqft"], "2515")
        self.assertEqual(repaired["year_built"], "2018")

    def test_aligned_row_stays_aligned(self):
        row = [
            "5005 Buchanan Draw Rd, Austin, Texas 78738",
            "650000",
            "4",
            "1",
            "Austin",
            "TX",
            "78738",
            "Quiet street with mature trees and new roof.",
            "Bee Cave / Lakeway",
            "Single-Family Home",
            "Other, Garage - Attached",
            "248",
            "https://example.com/photo.jpg",
            "2515",
            "2018",
            "Active",
        ]

        repaired, shifted = repair_property_row(PROPERTIES_HEADERS, row)

        self.assertFalse(shifted)
        self.assertEqual(repaired["zip"], "78738")
        self.assertEqual(repaired["description"], "Quiet street with mature trees and new roof.")
        self.assertEqual(repaired["status"], "Active")

    def test_repair_rows_outputs_canonical_headers(self):
        rows, stats = repair_property_rows([
            PROPERTIES_HEADERS[:18],
            ["3700 Dacy Ln, Kyle, TX", "1405", "2", "1", "Kyle", "TX", "Kyle 2BR", "Kyle", "Apartment"],
        ])

        self.assertEqual(rows[0], PROPERTIES_HEADERS)
        self.assertEqual(stats["rows"], 1)
        self.assertEqual(stats["shifted_rows"], 1)

    def test_zip_extraction_prefers_address_zip_over_street_number(self):
        row = [
            "12725 Bloomington Dr #129, Austin, Texas 78748",
            "268000",
            "4",
            "3",
            "Austin",
            "TX",
            "12725",
            "Beautifully renovated with spacious backyard.",
        ]

        repaired, shifted = repair_property_row(PROPERTIES_HEADERS, row)

        self.assertFalse(shifted)
        self.assertEqual(repaired["zip"], "78748")


if __name__ == "__main__":
    unittest.main()
