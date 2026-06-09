import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


class ChannelWebhookContractTests(unittest.TestCase):
    def test_dashboard_uses_olivia_for_website_agent(self):
        dashboard = read("components/AgentInboxClient.tsx")
        self.assertIn('label: "Website", agent: "Olivia", channel: "website_chat"', dashboard)
        self.assertNotIn('agent: "Nova"', dashboard)

    def test_channel_ingest_personality_names_are_stable(self):
        ingest = read("lib/channelIngest.ts")
        self.assertIn('agentName: "Theo"', ingest)
        self.assertIn('agentName: "Aria"', ingest)
        self.assertIn('agentName: "Olivia"', ingest)
        self.assertIn('channel: "sms"', ingest)
        self.assertIn('channel: "voice"', ingest)
        self.assertIn('channel: "website_chat"', ingest)

    def test_webhook_routes_do_not_send_customer_facing_replies_yet(self):
        sms_route = read("app/api/webhooks/theo-sms/route.ts")
        whatsapp_route = read("app/api/webhooks/theo-whatsapp/route.ts")
        self.assertIn("reply_sent: false", sms_route)
        self.assertIn("reply_sent: false", whatsapp_route)


if __name__ == "__main__":
    unittest.main()
