import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


class AriaVoiceContractTests(unittest.TestCase):
    def test_aria_identity_stable_across_layers(self):
        ingest = read("lib/channelIngest.ts")
        tools = read("lib/ariaTools.ts")
        self.assertIn('agentName: "Aria"', ingest)
        self.assertIn('channel: "voice"', ingest)
        self.assertIn('agentName: "Aria"', tools)
        self.assertIn('channel: "voice"', tools)

    def test_voice_webhooks_enforce_secret(self):
        voice = read("app/api/webhooks/aria-voice/route.ts")
        tool = read("app/api/webhooks/aria-tools/[tool]/route.ts")
        self.assertIn("assertWebhookSecret(request)", voice)
        self.assertIn("assertWebhookSecret(request)", tool)

    def test_assistant_has_transfer_and_endcall(self):
        assistant = read("lib/ariaAssistant.ts")
        self.assertIn('type: "transferCall"', assistant)
        self.assertIn('type: "endCall"', assistant)
        self.assertIn("config.humanTransferNumber", assistant)

    def test_aria_server_tools_named(self):
        assistant = read("lib/ariaAssistant.ts")
        for tool in ("getCallerContext", "lookupProperty", "searchProperties", "qualifyLead", "scheduleShowing", "syncToCrm"):
            self.assertIn(tool, assistant)

    def test_ghl_calendar_endpoints_match_official_spec(self):
        ghl = read("lib/crm/ghl.ts")
        self.assertIn("/contacts/upsert", ghl)
        self.assertIn("/contacts/search/duplicate", ghl)
        self.assertIn("/calendars/events/appointments", ghl)
        self.assertIn("/calendars/events/${encodeURIComponent(appointmentId)}", ghl)
        self.assertIn("/contacts/${encodeURIComponent(contactId)}/appointments", ghl)


if __name__ == "__main__":
    unittest.main()
