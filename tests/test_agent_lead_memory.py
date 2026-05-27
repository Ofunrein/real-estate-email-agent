import unittest

import agent


def parsed_msg(body: str, sender: str = "Lead Person <lead@example.com>") -> dict:
    return {
        "id": f"msg-{abs(hash(body))}",
        "thread_id": "thread-1",
        "from": sender,
        "subject": "Property inquiry",
        "message_id_header": "<msg@example.com>",
        "references": "",
        "body": body,
    }


class LeadMemoryTests(unittest.TestCase):
    def setUp(self):
        self.original_claude = agent._claude

    def tearDown(self):
        agent._claude = self.original_claude

    def test_normalize_classification_maps_role_to_legacy_intent(self):
        result = agent.normalize_classification({
            "primary_lead_role": "second_time_buyer",
            "address": "123 Main St, Austin, TX",
            "opportunity_tags": ["sell_before_buy"],
            "lead_fields": {"timeline": "soon"},
        })

        self.assertEqual(result["intent"], "buyer_lead")
        self.assertEqual(result["addresses"], ["123 Main St, Austin, TX"])
        self.assertEqual(result["lead_fields"]["timeline"], "soon")
        self.assertEqual(result["confidence"], 0.75)

    def test_update_lead_memory_tracks_hidden_opportunity(self):
        state = {"lead_memory": {}}
        parsed = parsed_msg("We need to sell our current home before buying.")
        _, memory = agent.get_lead_memory(state, parsed)
        classification = agent.normalize_classification({
            "intent": "property_details",
            "primary_lead_role": "second_time_buyer",
            "opportunity_tags": ["sell_before_buy", "valuation_interest"],
            "lead_fields": {"current_property_status": "owns", "timeline": "60 days"},
            "confidence": 0.9,
        })

        agent.update_lead_memory(memory, classification, parsed, ["123 Main St"])

        self.assertEqual(memory["lead_role"], "second_time_buyer")
        self.assertTrue(memory["second_time_buyer"])
        self.assertTrue(memory["sell_before_buy"])
        self.assertEqual(memory["valuation_interest"], "possible")
        self.assertEqual(memory["current_property_status"], "owns")
        self.assertEqual(memory["lead_fields"]["timeline"], "60 days")

    def test_no_count_stops_conversion_push_after_three_clear_nos(self):
        state = {"lead_memory": {}}
        parsed = parsed_msg("No thanks")
        _, memory = agent.get_lead_memory(state, parsed)
        classification = agent.normalize_classification({"intent": "buyer_lead", "primary_lead_role": "buyer"})

        for i, body in enumerate(["No thanks", "not interested", "I do not want to sell"], start=1):
            parsed = parsed_msg(body)
            parsed["id"] = f"msg-no-{i}"
            agent.update_lead_memory(memory, classification, parsed, [])

        self.assertEqual(memory["no_count"], 3)
        self.assertEqual(memory["next_action"], "stop_conversion_push")
        self.assertEqual(agent.derive_next_question("buyer_lead", classification, memory), "")

    def test_stop_request_sets_do_not_contact(self):
        state = {"lead_memory": {}}
        parsed = parsed_msg("Please unsubscribe and remove me")
        _, memory = agent.get_lead_memory(state, parsed)
        classification = agent.normalize_classification({"intent": "buyer_lead", "primary_lead_role": "buyer"})

        _, is_stop = agent.update_lead_memory(memory, classification, parsed, [])

        self.assertTrue(is_stop)
        self.assertTrue(memory["do_not_contact"])
        self.assertTrue(agent.should_route_human(classification, memory))

    def test_compliance_flags_route_human(self):
        state = {"lead_memory": {}}
        parsed = parsed_msg("Is this a safe neighborhood for families?")
        _, memory = agent.get_lead_memory(state, parsed)
        classification = agent.normalize_classification({"intent": "property_details", "primary_lead_role": "buyer"})

        agent.update_lead_memory(memory, classification, parsed, ["123 Main St"])

        self.assertIn("fair_housing", memory["compliance_flags"])
        self.assertTrue(agent.should_route_human(classification, memory))

    def test_append_question_before_signature(self):
        html = "<p>Hello,</p><p>Details here.</p><p style=\"margin-top:20px;color:#555\">Best regards,<br>Austin Realty</p>"
        text = "Hello,\n\nDetails here.\n\nBest regards\nAustin Realty"

        new_html, new_text = agent.append_question_to_reply(html, text, "Are you buying your first place?")

        self.assertIn("<p>Are you buying your first place?</p>", new_html)
        self.assertLess(new_html.index("Are you buying"), new_html.index("Best regards"))
        self.assertIn("\n\nAre you buying your first place?\n\nBest regards", new_text)

    def test_find_similar_homes_prefers_same_city_and_price_band(self):
        source = {
            "address": "123 Main St",
            "city": "Austin",
            "zip": "78701",
            "price": "500000",
            "beds": "3",
            "baths": "2",
            "property_type": "Single-Family Home",
        }
        candidates = [
            {"address": "125 Main St", "city": "Austin", "zip": "78701", "price": "510000", "beds": "3", "baths": "2", "property_type": "Single-Family Home", "status": "Active"},
            {"address": "127 Main St", "city": "Austin", "zip": "78701", "price": "530000", "beds": "4", "baths": "2", "property_type": "Single-Family Home", "status": "Active"},
            {"address": "900 Other St", "city": "Dallas", "zip": "75001", "price": "505000", "beds": "3", "baths": "2", "property_type": "Single-Family Home", "status": "Active"},
            {"address": "129 Main St", "city": "Austin", "zip": "78701", "price": "900000", "beds": "3", "baths": "2", "property_type": "Single-Family Home", "status": "Active"},
        ]

        similar = agent.find_similar_homes(source, candidates, limit=3)

        self.assertEqual([home["address"] for home in similar], ["125 Main St", "127 Main St"])

    def test_generate_property_html_includes_similar_homes_block(self):
        agent._claude = lambda *args, **kwargs: "<p>Test reply.</p>"
        listing = {
            "address": "123 Main St",
            "city": "Austin",
            "state": "TX",
            "zip": "78701",
            "price": "500000",
            "beds": "3",
            "baths": "2",
            "sqft": "1800",
            "status": "Active",
            "listing_url": "https://example.com/123",
            "photo_url": "https://example.com/123.jpg",
        }
        similar = [
            {
                "address": "125 Main St",
                "city": "Austin",
                "state": "TX",
                "price": "510000",
                "beds": "3",
                "baths": "2",
                "status": "For sale",
                "listing_url": "https://example.com/125",
                "photo_url": "https://example.com/125.jpg",
            }
        ]

        html, text = agent.generate_property_html(listing, {}, "https://calendly.test", similar_homes=similar)

        self.assertIn("Similar homes", html)
        self.assertIn("125 Main St", html)
        self.assertIn("https://example.com/125", html)
        self.assertIn("Similar homes:", text)
        self.assertIn("125 Main St", text)


if __name__ == "__main__":
    unittest.main()
