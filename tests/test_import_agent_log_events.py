import tempfile
import textwrap
import unittest
from pathlib import Path

from scripts.import_agent_log_events import normalize_subject, parse_agent_log_events, sender_parts


class ImportAgentLogEventsTests(unittest.TestCase):
    def test_sender_parts_extracts_name_and_email(self):
        self.assertEqual(
            sender_parts("Lead Person <lead@example.com>"),
            ("Lead Person", "lead@example.com"),
        )

    def test_normalize_subject_groups_replies(self):
        self.assertEqual(normalize_subject("Re: Fwd: Hi"), "Hi")

    def test_parse_agent_log_events_builds_inbound_and_outbound(self):
        contents = textwrap.dedent(
            """\
            2026-05-24 22:43:46 [INFO] --- Processing message id=abc123 from=Lead Person <lead@example.com> subject='Re: Hi'
            2026-05-24 22:43:48 [INFO] Intent: property_search | Role: buyer | Tags: ['high_urgency'] | Tone: warm | No count: 0 | Addresses: none | Lead fields: {'timeline': 'immediate', 'budget': '$500,000', 'area': 'Austin', 'beds': '2', 'current_property_status': 'unknown', 'preferred_channel': 'email'}
            2026-05-24 22:44:18 [INFO] Reply sent — to=Lead Person <lead@example.com> intent=property_search labels=['AUTO_REPLIED']
            """
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "agent.log"
            path.write_text(contents)
            events = parse_agent_log_events(path)

        self.assertEqual(len(events), 2)
        self.assertEqual(events[0]["direction"], "inbound")
        self.assertEqual(events[1]["direction"], "outbound")
        self.assertEqual(events[0]["thread_ref"], "log:lead@example.com:hi")
        self.assertIn("property_search", events[0]["summary"])

    def test_parse_agent_log_events_skips_spam_by_default(self):
        contents = textwrap.dedent(
            """\
            2026-05-24 22:41:24 [INFO] --- Processing message id=spam1 from=Noise <noise@example.com> subject='Sale'
            2026-05-24 22:41:24 [INFO] Intent: spam | Role: unknown | Tags: [] | Tone: neutral | No count: 3 | Addresses: none | Lead fields: {'timeline': None, 'budget': None, 'area': None, 'beds': None, 'current_property_status': None, 'preferred_channel': None}
            2026-05-24 22:41:25 [INFO] Spam — labeled NEEDS_HUMAN, no reply sent
            """
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "agent.log"
            path.write_text(contents)
            events = parse_agent_log_events(path)

        self.assertEqual(events, [])


if __name__ == "__main__":
    unittest.main()
