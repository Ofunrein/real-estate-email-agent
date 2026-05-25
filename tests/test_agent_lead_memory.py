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


if __name__ == "__main__":
    unittest.main()
