import csv
import tempfile
import unittest

from scripts.property_hygiene import _csv_match, build_zillow_csv_index


class PropertyHygieneScriptTests(unittest.TestCase):
    def test_zillow_csv_index_matches_unitless_addresses(self):
        with tempfile.NamedTemporaryFile("w", newline="", suffix=".csv") as handle:
            writer = csv.DictWriter(handle, fieldnames=[
                "streetAddress",
                "city",
                "state",
                "zipcode",
                "livingArea",
                "yearBuilt",
                "homeType",
            ])
            writer.writeheader()
            writer.writerow({
                "streetAddress": "2808 Skyway Cir APT 101",
                "city": "Austin",
                "state": "TX",
                "zipcode": "78704",
                "livingArea": "1000",
                "yearBuilt": "1968",
                "homeType": "CONDO",
            })
            handle.flush()

            index = build_zillow_csv_index(handle.name)
            match = _csv_match({"address": "2808 Skyway Cir Unit 101, Austin, Texas"}, index)

        self.assertEqual(match["zip"], "78704")
        self.assertEqual(match["sqft"], "1000")
        self.assertEqual(match["year_built"], "1968")
        self.assertEqual(match["property_type"], "Condo")


if __name__ == "__main__":
    unittest.main()
