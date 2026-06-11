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

    def test_apify_search_record_extracts_core_fields(self):
        from scripts.property_hygiene import _apify_search_record

        record = _apify_search_record({
            "title": "8913 Mount Bartlett Dr, Austin, TX 78759",
            "cover_image": "https://photos.zillowstatic.com/fp/example-p_e.jpg",
            "listing_id": "29363213",
            "rooms": {"beds": 3, "baths": 3},
            "area": {"floor": 2067},
            "city": "Austin",
            "state": "TX",
        })

        self.assertEqual(record["address"], "8913 Mount Bartlett Dr, Austin, TX 78759")
        self.assertEqual(record["sqft"], "2067")
        self.assertEqual(record["photo_url"], "https://photos.zillowstatic.com/fp/example-p_e.jpg")
        self.assertIn("_zpid/", record["listing_url"])

    def test_year_from_description_extracts_four_digit_year(self):
        from scripts.property_hygiene import _year_from_description

        self.assertEqual(_year_from_description("Charming home built in 1998 near downtown."), "1998")
        self.assertEqual(_year_from_description("No year here"), "")

    def test_detail_record_from_item_maps_year_built(self):
        from scripts.property_hygiene import _detail_record_from_item

        record = _detail_record_from_item({
            "streetAddress": "123 Main St",
            "zipcode": "78704",
            "livingArea": 1800,
            "yearBuilt": 2005,
            "imgSrc": "https://photos.zillowstatic.com/fp/example.jpg",
        })
        self.assertEqual(record["year_built"], "2005")
        self.assertEqual(record["sqft"], "1800")


if __name__ == "__main__":
    unittest.main()
