import unittest

from agent_inbox.app import build_metrics, group_events_by_thread


class AgentInboxTests(unittest.TestCase):
    def test_build_metrics_counts_leads_and_channels(self):
        leads = [
            {"email": "a@example.com", "handoff_status": "needs_human"},
            {"email": "b@example.com", "handoff_status": ""},
        ]
        events = [
            {"channel": "email", "status": "sent"},
            {"channel": "voice", "status": "needs_human"},
            {"channel": "email", "status": "sent"},
        ]
        metrics = build_metrics(leads, events)
        self.assertEqual(metrics["lead_count"], 2)
        self.assertEqual(metrics["needs_human"], 2)
        self.assertEqual(metrics["channels"]["email"], 2)
        self.assertEqual(metrics["channels"]["voice"], 1)

    def test_group_events_by_thread(self):
        events = [
            {"thread_ref": "thread-1", "message_text": "First"},
            {"thread_ref": "thread-1", "message_text": "Second"},
            {"thread_ref": "", "message_text": "No thread"},
        ]
        grouped = group_events_by_thread(events)
        self.assertEqual(len(grouped["thread-1"]), 2)
        self.assertEqual(len(grouped["unknown"]), 1)


if __name__ == "__main__":
    unittest.main()
