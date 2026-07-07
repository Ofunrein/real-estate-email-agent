import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


class AriaVoiceContractTests(unittest.TestCase):
    def test_aria_identity_stable_across_layers(self):
        ingest = read("lib/channelIngest.ts")
        tools = read("lib/ariaTools.ts")
        self.assertIn("agentName: IRIS_AGENT_NAME", ingest)
        self.assertIn('channel: "voice"', ingest)
        self.assertIn("agentName: IRIS_AGENT_NAME", tools)
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

    def test_assistant_has_dynamism_features(self):
        assistant = read("lib/ariaAssistant.ts")
        self.assertIn("smartEndpointingEnabled: true", assistant)
        self.assertIn("analysisPlan:", assistant)
        self.assertIn("structuredDataSchema:", assistant)
        self.assertIn("successEvaluationRubric:", assistant)

    def test_no_phone_number_as_name_prohibition(self):
        assistant = read("lib/ariaAssistant.ts")
        self.assertIn("NEVER say", assistant)
        self.assertIn("unknown name", assistant)
        self.assertIn("read out any phone number", assistant)

    def test_qualify_sequence_in_prompt(self):
        assistant = read("lib/ariaAssistant.ts")
        self.assertIn("Full qualify sequence", assistant)
        self.assertIn("qualifyLead", assistant)

    def test_live_aria_server_tools_in_provision_not_assistant(self):
        assistant = read("lib/ariaAssistant.ts")
        provision = read("scripts/aria-provision.mjs")
        # These are server webhook tools — must be in provision, NOT as inline tool objects in ariaAssistant
        for tool in ("qualifyLead", "scheduleShowing", "syncToCrm", "cancelAppointment", "rescheduleAppointment"):
            # provision script must define them
            self.assertIn(f'name: "{tool}"', provision)
            # ariaAssistant must not define them as inline tool objects (type:"function" blocks)
            self.assertNotIn(f'name: "{tool}",', assistant)
        self.assertNotIn("serverUrl", assistant)
        self.assertIn("/api/webhooks/aria-voice", assistant)
        self.assertIn('serverMessages: ["end-of-call-report"]', assistant)
        self.assertIn("getCallerContext", assistant)
        self.assertIn("searchProperties", assistant)
        self.assertIn("lookupProperty", assistant)
        self.assertIn("sendPropertyDetailsSms", assistant)
        self.assertIn("checkAvailability", assistant)
        self.assertIn("bookConsultation", assistant)
        self.assertIn("sendBookingSmsConfirmation", assistant)

    def test_provision_has_all_server_tools(self):
        provision = read("scripts/aria-provision.mjs")
        server_tools = [
            "getCallerContext", "searchProperties", "lookupProperty",
            "sendPropertyDetailsSms", "checkAvailability", "bookConsultation",
            "qualifyLead", "scheduleShowing", "cancelAppointment",
            "rescheduleAppointment", "syncToCrm",
        ]
        for tool in server_tools:
            self.assertIn(f'name: "{tool}"', provision, f"Missing tool in provision: {tool}")
            # provision uses ariaToolUrl(publicUrl, secret, "toolName") — check the call pattern
            self.assertIn(f'ariaToolUrl(publicUrl, secret, "{tool}")', provision, f"Tool {tool} missing server URL call in provision")


    def test_luron_concierge_psychology_in_voice_prompt(self):
        assistant = read("lib/ariaAssistant.ts")
        self.assertIn("Luron-style concierge psychology", assistant)
        self.assertIn("Action empathy", assistant)
        self.assertIn("Confirmation ritual", assistant)

    def test_agent_name_comes_from_config_not_hardcoded(self):
        assistant = read("lib/ariaAssistant.ts")
        # Name must come from config, not hardcoded "Aria" literal
        self.assertIn("config.agentNames.voice", assistant)
        self.assertNotIn('"Aria"', assistant)

    def test_ghl_calendar_endpoints_match_official_spec(self):
        ghl = read("lib/crm/ghl.ts")
        self.assertIn("/contacts/upsert", ghl)
        self.assertIn("/contacts/search/duplicate", ghl)
        self.assertIn("/calendars/events/appointments", ghl)
        self.assertIn("/calendars/events/${encodeURIComponent(appointmentId)}", ghl)
        self.assertIn("/contacts/${encodeURIComponent(contactId)}/appointments", ghl)


if __name__ == "__main__":
    unittest.main()
