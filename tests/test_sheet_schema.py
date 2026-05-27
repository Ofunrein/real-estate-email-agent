import unittest

from core.sheet_schema import CONVERSATION_EVENTS_HEADERS, LEAD_MEMORY_HEADERS, PROPERTIES_HEADERS, REQUIRED_TABS


class SheetSchemaTests(unittest.TestCase):
    def test_required_tabs_are_v1_tabs(self):
        self.assertEqual(REQUIRED_TABS, ["properties", "lead_memory", "conversation_events"])

    def test_lead_memory_has_matching_and_state_columns(self):
        for header in ["email", "phone", "full_name", "lead_source", "intent", "assigned_owner", "next_action", "summary"]:
            self.assertIn(header, LEAD_MEMORY_HEADERS)

    def test_conversation_events_has_thread_columns(self):
        for header in ["event_at", "channel", "direction", "thread_ref", "message_text", "summary", "recording_url"]:
            self.assertIn(header, CONVERSATION_EVENTS_HEADERS)

    def test_properties_keeps_current_columns(self):
        for header in ["address", "price", "beds", "baths", "photo_url", "sqft", "listing_url", "agent_email"]:
            self.assertIn(header, PROPERTIES_HEADERS)


if __name__ == "__main__":
    unittest.main()
