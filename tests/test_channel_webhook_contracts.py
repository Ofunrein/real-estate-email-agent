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
        self.assertIn("enrichTheoData", sms_route)
        self.assertIn("sendTheoSms", sms_route)
        self.assertIn("sendTheoHandoffAlert", sms_route)
        self.assertIn("recordTheoOutbound", sms_route)
        self.assertIn("findPropertiesByAddressesFromDatabase", sms_route)
        self.assertIn("extractTheoListedPropertyAddresses", sms_route)
        self.assertIn("referencesPriorProperties", sms_route)
        self.assertIn('"reply_sent"', sms_route)
        self.assertIn("handoff_alert_sent", sms_route)
        self.assertIn("[Theo SMS]", sms_route)
        self.assertIn("logTheoMetrics", sms_route)
        self.assertIn("webhook complete", sms_route)
        self.assertIn("sessionCost", sms_route)
        self.assertIn("elapsedMs", sms_route)
        self.assertIn("reply.mediaUrls", sms_route)
        self.assertIn("smsMessageWithMediaLog", sms_route)
        self.assertIn("extractTheoPropertySearchQuery", sms_route)
        self.assertIn("mediaCount", sms_route)

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
        self.assertIn("selectTheoMediaUrls", theo_agent)
        self.assertIn("ENABLE_SMS_IMAGES", theo_agent)
        self.assertIn("SMS_IMAGE_MODE", theo_agent)
        self.assertIn("SMS_MAX_IMAGES", theo_agent)
        self.assertIn('classification.intent === "human_required"', theo_agent)
        self.assertIn("asksForSafePropertyFact", theo_agent)
        self.assertIn("canShareSafeFactsDuringHandoff", theo_agent)
        self.assertIn("asksForAlternativeProperties", theo_agent)
        self.assertIn("latestMessageHasSensitiveTopic", theo_agent)
        self.assertIn('recommendedNextAction: "reply_and_qualify"', theo_agent)
        self.assertIn("cleanSmsReply", theo_agent)
        self.assertIn(".replace(/\\n(?=\\d+\\.\\s)/g, \"\\n\\n\")", theo_agent)
        self.assertIn(".replace(/\\n{3,}/g, \"\\n\\n\")", theo_agent)
        self.assertIn("LINK_SMS_LIMIT = 1200", theo_agent)
        self.assertIn("wantsPropertyLinks", theo_agent)
        self.assertIn("formatTheoPropertyLinks", theo_agent)
        self.assertIn("property_links_reply_ready", theo_agent)

    def test_theo_llm_gets_iris_level_context(self):
        theo_llm = read("lib/theoLlm.ts")
        self.assertIn("AGENCY_KNOWLEDGE_CONTEXT", theo_llm)
        self.assertIn("No emojis.", theo_llm)
        self.assertIn("Live enrichment context", theo_llm)
        self.assertIn("still answer simple safe facts", theo_llm)
        self.assertIn("Answer the safe factual part first", theo_llm)
        self.assertIn("list up to the requested number", theo_llm)
        self.assertIn("put a blank line before each numbered listing", theo_llm)
        self.assertIn("Do not say links are not loaded when listing_url is present", theo_llm)
        self.assertIn("cleanSmsReply", theo_llm)
        self.assertIn("Do not use human_required only because prior messages had service friction", theo_llm)
        for property_field in [
            "description",
            "neighborhood",
            "property_type",
            "features",
            "days_on_market",
            "photo_url_available",
            "agent_name",
            "agent_email",
            "listing_url",
        ]:
            self.assertIn(property_field, theo_llm)
        for lead_field in [
            "lead_source",
            "source_detail",
            "budget",
            "area",
            "timeline",
            "handoff_status",
            "handoff_reason",
        ]:
            self.assertIn(lead_field, theo_llm)
        for classifier_signal in [
            "opportunityTags",
            "toneState",
            "urgency",
            "complianceFlags",
            "nextBestQuestion",
            "recommendedNextAction",
        ]:
            self.assertIn(classifier_signal, theo_llm)

    def test_theo_data_enrichment_matches_email_agent_sources(self):
        theo_data = read("lib/theoData.ts")
        for source in [
            "RENTCAST_API_KEY",
            "APIFY_TOKEN",
            "APIFY_SOLD_COMPS_ACTOR_ID",
            "FRED_API_KEY",
            "CENSUS_API_KEY",
        ]:
            self.assertIn(source, theo_data)
        self.assertIn("fetchRentCast", theo_data)
        self.assertIn("fetchApifyZillow", theo_data)
        self.assertIn("fetchMortgageRates", theo_data)
        self.assertIn("fetchCensusZip", theo_data)
        self.assertIn("fetchSoldComps", theo_data)
        self.assertIn("THEO_ENRICHMENT_TIMEOUT_MS", theo_data)
        self.assertIn("THEO_APIFY_TIMEOUT_SECONDS", theo_data)
        self.assertIn("theo_enrichment_budget", theo_data)
        self.assertIn("metrics", theo_data)
        self.assertIn("extractTheoAddress", theo_data)
        self.assertIn("extractTheoPropertySearchQuery", theo_data)
        self.assertIn("extractTheoListedPropertyAddresses", theo_data)

    def test_theo_claude_calls_report_costs(self):
        theo_llm = read("lib/theoLlm.ts")
        telemetry = read("lib/theoTelemetry.ts")
        self.assertIn("input_tokens", theo_llm)
        self.assertIn("output_tokens", theo_llm)
        self.assertIn("claudeCostUsd", theo_llm)
        self.assertIn("claude-haiku-4-5", telemetry)
        self.assertIn("claude-sonnet-4-6", telemetry)
        self.assertIn("theoSessionCost", telemetry)

    def test_twilio_sender_uses_env_only(self):
        twilio_sender = read("lib/twilioSms.ts")
        self.assertIn("TWILIO_ACCOUNT_SID", twilio_sender)
        self.assertIn("TWILIO_AUTH_TOKEN", twilio_sender)
        self.assertIn("TWILIO_FROM", twilio_sender)
        self.assertIn("TWILIO_MESSAGING_SERVICE_SID", twilio_sender)
        self.assertIn("MessagingServiceSid", twilio_sender)
        self.assertIn("AGENT_PHONE", twilio_sender)
        self.assertIn("ENABLE_SMS_AGENT", twilio_sender)
        self.assertIn("sendTheoHandoffAlert", twilio_sender)
        self.assertIn("MediaUrl", twilio_sender)
        self.assertIn("mediaUrls", twilio_sender)
        self.assertIn("mediaCount", twilio_sender)
        self.assertIn("smsMessageWithMediaLog", twilio_sender)
        self.assertIn("MMS image:", twilio_sender)
        self.assertIn("https://api.twilio.com/2010-04-01/Accounts/", twilio_sender)
        self.assertNotIn("AC4758", twilio_sender)
        self.assertNotIn("c0e300", twilio_sender)

    def test_website_form_sms_requires_opt_in(self):
        website_route = read("app/api/webhooks/olivia-website/route.ts")
        self.assertIn("smsOptIn", website_route)
        self.assertIn("enrichTheoData", website_route)
        self.assertIn("sendTheoSms", website_route)
        self.assertIn("reply.mediaUrls", website_route)
        self.assertIn("smsMessageWithMediaLog", website_route)
        self.assertIn("extractTheoPropertySearchQuery", website_route)
        self.assertIn("sms_reply_sent", website_route)
        self.assertIn("phone && hasSmsConsent", website_route)

    def test_theo_local_test_command_exists(self):
        package_json = read("package.json")
        script = read("scripts/test-theo-sms.mjs")
        self.assertIn('"theo:test"', package_json)
        self.assertIn("/api/webhooks/theo-sms", script)
        self.assertIn("SM_TEST_", script)


if __name__ == "__main__":
    unittest.main()
