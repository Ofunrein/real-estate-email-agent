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

    def test_theo_sms_route_generates_and_logs_replies(self):
        sms_route = read("app/api/webhooks/theo-sms/route.ts")
        self.assertIn("generateTheoReply", sms_route)
        self.assertIn("sendTheoSms", sms_route)
        self.assertIn("recordTheoOutbound", sms_route)
        self.assertIn('"reply_sent"', sms_route)

    def test_whatsapp_route_still_logs_only(self):
        whatsapp_route = read("app/api/webhooks/theo-whatsapp/route.ts")
        self.assertIn("reply_sent: false", whatsapp_route)

    def test_theo_agent_has_v1_safety_contract(self):
        theo_agent = read("lib/theoAgent.ts")
        self.assertIn("SMS_LIMIT = 320", theo_agent)
        self.assertIn("Fair Housing-sensitive question", theo_agent)
        self.assertIn("Mortgage/licensed lending question", theo_agent)
        self.assertIn("Legal or contract-sensitive question", theo_agent)
        self.assertIn("smsOptIn", theo_agent)

    def test_twilio_sender_uses_env_only(self):
        twilio_sender = read("lib/twilioSms.ts")
        self.assertIn("TWILIO_ACCOUNT_SID", twilio_sender)
        self.assertIn("TWILIO_AUTH_TOKEN", twilio_sender)
        self.assertIn("TWILIO_FROM", twilio_sender)
        self.assertIn("ENABLE_SMS_AGENT", twilio_sender)
        self.assertIn("https://api.twilio.com/2010-04-01/Accounts/", twilio_sender)
        self.assertNotIn("AC4758", twilio_sender)
        self.assertNotIn("c0e300", twilio_sender)

    def test_website_form_sms_requires_opt_in(self):
        website_route = read("app/api/webhooks/olivia-website/route.ts")
        self.assertIn("smsOptIn", website_route)
        self.assertIn("sendTheoSms", website_route)
        self.assertIn("sms_reply_sent", website_route)
        self.assertIn("phone && hasSmsConsent", website_route)


if __name__ == "__main__":
    unittest.main()
