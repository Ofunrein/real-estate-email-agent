import unittest

from scripts.backfill_gmail_sent_events import backfill_events, match_backfills, normalize_subject, thread_subject_key


class BackfillGmailSentEventsTests(unittest.TestCase):
    def test_thread_subject_key_uses_log_thread_subject(self):
        self.assertEqual(thread_subject_key("log:lead@example.com:re: Hello"), "hello")

    def test_normalize_subject_strips_reply_prefixes(self):
        self.assertEqual(normalize_subject("Re: Fwd: Property Info"), "property info")

    def test_match_backfills_pairs_placeholder_events_to_sent_messages(self):
        events = [
            {
                "event_at": "2026-05-24 22:44:18",
                "direction": "outbound",
                "event_type": "ai_reply",
                "email": "lead@example.com",
                "thread_ref": "log:lead@example.com:hi",
                "message_text": "Iris sent an email reply. Full historical reply text was not recorded in agent.log.",
                "summary": "Iris replied",
            }
        ]
        sent_messages = [
            {
                "id": "gmail-1",
                "thread_id": "thread-1",
                "date": "2026-05-24T22:44:20+00:00",
                "subject_key": "hi",
                "to": ["lead@example.com"],
                "body": "<p>Full reply</p>",
                "body_type": "html",
            }
        ]

        matches = match_backfills(events, sent_messages)
        updates = backfill_events(events, matches)

        self.assertEqual(len(matches), 1)
        self.assertEqual(updates[0][1]["source"], "gmail_sent")
        self.assertEqual(updates[0][1]["thread_ref"], "thread-1")
        self.assertEqual(updates[0][1]["message_text"], "<p>Full reply</p>")


if __name__ == "__main__":
    unittest.main()
