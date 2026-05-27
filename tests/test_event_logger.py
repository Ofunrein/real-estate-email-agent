import unittest

from core.event_logger import build_conversation_event, build_lead_memory_update, merge_lead_memory


class EventLoggerTests(unittest.TestCase):
    def test_build_conversation_event_sets_channel_and_agent(self):
        event = build_conversation_event(
            channel="email",
            direction="outbound",
            email="lead@example.com",
            phone="",
            full_name="Lead Person",
            source="gmail",
            thread_ref="thread-1",
            agent_name="Iris",
            event_type="ai_reply",
            message_text="Hello",
            summary="AI replied",
            ai_action="reply_sent",
            status="sent",
        )
        self.assertEqual(event["channel"], "email")
        self.assertEqual(event["agent_name"], "Iris")
        self.assertEqual(event["event_type"], "ai_reply")
        self.assertTrue(event["event_at"])

    def test_merge_lead_memory_preserves_existing_when_new_value_empty(self):
        existing = {"email": "lead@example.com", "phone": "+15125550123", "area": "Austin"}
        incoming = {"email": "lead@example.com", "phone": "", "area": "Round Rock", "summary": "Updated"}
        merged = merge_lead_memory(existing, incoming)
        self.assertEqual(merged["phone"], "+15125550123")
        self.assertEqual(merged["area"], "Round Rock")
        self.assertEqual(merged["summary"], "Updated")

    def test_build_lead_memory_update_maps_context(self):
        update = build_lead_memory_update(
            email="lead@example.com",
            phone="+15125550123",
            full_name="Lead Person",
            lead_source="email",
            source_detail="Property inquiry",
            lead_role="buyer",
            intent="property_details",
            property_interest=["123 Main St"],
            assigned_owner="agent@example.com",
            next_action="reply_and_qualify",
            summary="Asked about 123 Main St",
        )
        self.assertEqual(update["property_interest"], "123 Main St")
        self.assertEqual(update["last_channel"], "email")


if __name__ == "__main__":
    unittest.main()
