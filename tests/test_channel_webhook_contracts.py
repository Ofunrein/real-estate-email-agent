import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


class ChannelWebhookContractTests(unittest.TestCase):
    def test_dashboard_uses_unified_iris_agent(self):
        app = read("components/inbox-mui/InboxApp.tsx")
        data = read("components/inbox-mui/data/inboxData.ts")
        self.assertIn("InboxDataProvider", app)
        self.assertIn("website", data)
        self.assertNotIn('agent: "Theo"', data)
        self.assertNotIn('agent: "Olivia"', data)
        for asset in ["iris.png", "theo.png", "aria.png", "olivia.png", "theo-rcs-logo.jpg"]:
            self.assertTrue((ROOT / "public" / "images" / "agents" / asset).exists(), asset)

    def test_dashboard_auto_refreshes_and_shows_event_times(self):
        dashboard = read("components/inbox-mui/InboxApp.tsx")
        page = read("app/page.tsx")
        self.assertIn("DASHBOARD_REFRESH_MS = 5000", dashboard)
        self.assertIn("InboxApp", page)
        self.assertIn("setInterval(refresh, DASHBOARD_REFRESH_MS)", dashboard)
        self.assertIn("useState<AgentInboxData>(data)", dashboard)
        self.assertIn("CACHE_TTL_MS = 5_000", read("lib/googleSheets.ts"))

    def test_property_dashboard_has_sorting_and_compact_subtitles(self):
        view = read("components/inbox-mui/components/PropertiesView.tsx")
        self.assertIn('aria-label="Search properties"', view)
        self.assertIn("filtered", view)
        self.assertIn("sort", view.lower())
        self.assertIn("PropertyModal", view)

    def test_channel_threads_use_searchable_selected_inbox(self):
        conversation_list = read("components/inbox-mui/components/ConversationList.tsx")
        text_view = read("components/inbox-mui/components/TextChannelView.tsx")
        email_view = read("components/inbox-mui/components/EmailView.tsx")
        self.assertIn("search", conversation_list.lower())
        self.assertIn("selected", conversation_list.lower())
        self.assertIn("ConversationList", text_view)
        self.assertIn("ConversationList", email_view)

    def test_channel_ingest_personality_names_are_stable(self):
        ingest = read("lib/channelIngest.ts")
        self.assertIn("agentName: IRIS_AGENT_NAME", ingest)
        self.assertNotIn('agentName: "Theo"', ingest)
        self.assertNotIn('agentName: "Olivia"', ingest)
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
        self.assertIn("recentInboundAddresses", sms_route)
        self.assertIn("requestedAddressRows", sms_route)
        self.assertIn("referencedInboundAddressRows", sms_route)
        self.assertIn("upsertPropertyToDatabase", sms_route)
        self.assertIn("appendPropertyToSheets", sms_route)
        self.assertIn("property cache processed", sms_route)
        self.assertIn('"reply_sent"', sms_route)
        self.assertIn("handoff_alert_sent", sms_route)
        self.assertIn("[Theo SMS]", sms_route)
        self.assertIn("logTheoMetrics", sms_route)
        self.assertIn("webhook complete", sms_route)
        self.assertIn("sessionCost", sms_route)
        self.assertIn("elapsedMs", sms_route)
        self.assertIn("THEO_REPLY_DEBOUNCE_MS", sms_route)
        self.assertIn("theoReplyDebounceMs", sms_route)
        self.assertIn("hasNewerInboundForThreadInDatabase", sms_route)
        self.assertIn("reply_deferred_to_newer_inbound", sms_route)
        self.assertIn("combinedInboundMessage", sms_route)
        self.assertIn("messageForReply", sms_route)
        self.assertIn("combinedMessages", sms_route)
        self.assertIn("reply.mediaUrls", sms_route)
        self.assertIn("smsMessageWithMediaLog", sms_route)
        self.assertIn("extractTheoPropertySearchQuery", sms_route)
        self.assertIn("extractTheoPropertySearchIntent", sms_route)
        self.assertIn("wantsRelatedProperties", sms_route)
        self.assertIn("referencePropertyRows", sms_route)
        self.assertIn("relatedRequest", sms_route)
        self.assertIn("recentSearchContext", sms_route)
        self.assertIn("mediaCount", sms_route)
        database = read("lib/database.ts")
        self.assertIn("from conversation_events ce, current_event", database)
        self.assertIn("ce.created_at > current_event.created_at", database)

    def test_whatsapp_route_uses_meta_cloud_api_and_theo_reply_engine(self):
        whatsapp_route = read("app/api/webhooks/theo-whatsapp/route.ts")
        meta_sender = read("lib/metaWhatsapp.ts")
        channel_ingest = read("lib/channelIngest.ts")
        env_example = read(".env.example")
        readme = read("README.md")
        self.assertIn("WHATSAPP_WEBHOOK_VERIFY_TOKEN", whatsapp_route)
        self.assertIn("extractMetaWhatsAppMessages", whatsapp_route)
        self.assertIn("generateTheoReply", whatsapp_route)
        self.assertIn('source: "whatsapp"', whatsapp_route)
        self.assertIn("sendMetaWhatsApp", whatsapp_route)
        self.assertIn("whatsAppMessageWithMediaLog", whatsapp_route)
        self.assertIn("recordTheoWhatsAppOutbound", whatsapp_route)
        self.assertIn("ENABLE_WHATSAPP_AGENT", meta_sender)
        self.assertIn("WHATSAPP_PHONE_NUMBER_ID", meta_sender)
        self.assertIn("WHATSAPP_ACCESS_TOKEN", meta_sender)
        self.assertIn("META_APP_SECRET", meta_sender)
        self.assertIn('type: "image"', meta_sender)
        self.assertIn("https://graph.facebook.com/", meta_sender)
        self.assertIn("metaWhatsAppIngestInput", channel_ingest)
        self.assertIn('source: "meta_whatsapp"', channel_ingest)
        self.assertIn("ENABLE_WHATSAPP_IMAGES", env_example)
        self.assertIn("WHATSAPP_MAX_IMAGES", env_example)
        self.assertIn("/api/webhooks/theo-whatsapp", readme)

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
        self.assertIn("asksForPropertyOptions", theo_agent)
        self.assertIn("formatTheoPropertyOptions", theo_agent)
        self.assertIn("property_options_reply_ready", theo_agent)
        self.assertIn("property_options_handoff_reply_ready", theo_agent)
        self.assertIn("I can do both", theo_agent)
        self.assertIn("latestMessageHasSensitiveTopic", theo_agent)
        self.assertIn('recommendedNextAction: "reply_and_qualify"', theo_agent)
        self.assertIn("cleanSmsReply", theo_agent)
        self.assertIn(".replace(/\\n(?=\\d+\\.\\s)/g, \"\\n\\n\")", theo_agent)
        self.assertIn(".replace(/\\n{3,}/g, \"\\n\\n\")", theo_agent)
        self.assertIn("LINK_SMS_LIMIT = 1200", theo_agent)
        self.assertIn("wantsPropertyLinks", theo_agent)
        self.assertIn("FILLOUT_VALUATION_URL", theo_agent)
        self.assertIn("CALENDLY_URL", theo_agent)
        self.assertIn("valuationUrl", theo_agent)
        self.assertIn("isSellerValuationContext", theo_agent)
        self.assertIn("formatTheoSellerValuationReply", theo_agent)
        self.assertIn("seller_valuation_link_reply_ready", theo_agent)
        self.assertIn("For the home you need to sell, start the free valuation here:", theo_agent)
        self.assertIn("formatTheoPropertyLinks", theo_agent)
        self.assertIn("property_links_reply_ready", theo_agent)
        self.assertIn("formatTheoPropertyPhotos", theo_agent)
        self.assertIn("formatTheoPhotoLinkFallback", theo_agent)
        self.assertIn("property_photo_link_fallback_ready", theo_agent)
        self.assertIn("property_photos_handoff_reply_ready", theo_agent)
        self.assertIn("property_photo_link_handoff_fallback_ready", theo_agent)
        self.assertIn('if (/maps\\.googleapis\\.com/i.test(url)) return "";', theo_agent)
        self.assertIn('if (/\\.(jpe?g|png|gif|webp)(\\?|$)/i.test(url)) return url;', theo_agent)
        self.assertIn("property_photos_reply_ready", theo_agent)
        self.assertIn("WHATSAPP_MAX_IMAGES", theo_agent)
        self.assertIn("SMS_MAX_IMAGES", theo_agent)
        self.assertIn("CENTRAL_TEXAS_CITIES", theo_agent)
        self.assertIn("SERVICE_AREA_CITIES", theo_agent)
        self.assertIn("outside our main Austin-area coverage", theo_agent)

    def test_theo_llm_gets_iris_level_context(self):
        theo_llm = read("lib/theoLlm.ts")
        self.assertIn("AGENCY_KNOWLEDGE_CONTEXT", theo_llm)
        self.assertIn("No emojis.", theo_llm)
        self.assertIn("Live enrichment context", theo_llm)
        self.assertIn("still answer simple safe facts", theo_llm)
        self.assertIn("Answer the safe factual part first", theo_llm)
        self.assertIn("list up to the requested number", theo_llm)
        self.assertIn("neighboring homes", theo_llm)
        self.assertIn("same-spec properties", theo_llm)
        self.assertIn("Qualification mile markers", theo_llm)
        self.assertIn("preferred channel, timeline, area, price range, bedroom/bathroom fit", theo_llm)
        self.assertIn("Human-assisted monitoring is backup", theo_llm)
        self.assertIn("greater Austin / Central Texas metro", theo_llm)
        self.assertIn("put a blank line before each numbered listing", theo_llm)
        self.assertIn("Do not say links are not loaded when listing_url is present", theo_llm)
        self.assertIn("do both: provide the safe property facts/options", theo_llm)
        self.assertIn("use short blocks separated by a blank line", theo_llm)
        self.assertIn("Do not say an agent has to pull matches unless no property rows are provided", theo_llm)
        self.assertIn("cleanSmsReply", theo_llm)
        self.assertIn("sentenceEnd", theo_llm)
        self.assertIn("Do not use human_required only because prior messages had service friction", theo_llm)
        self.assertIn("Never send maps.googleapis.com", theo_llm)
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

    def test_channel_ingest_extracts_preferred_channel(self):
        channel_ingest = read("lib/channelIngest.ts")
        self.assertIn("inferPreferredChannelFromText", channel_ingest)
        self.assertIn("Email is best", read("tests/ts/channelIngest.test.ts"))
        self.assertIn("preferredChannel", channel_ingest)

    def test_theo_data_enrichment_matches_email_agent_sources(self):
        theo_data = read("lib/theoData.ts")
        public_data = read("lib/publicPropertyData.ts")
        for source in ["APIFY_TOKEN", "APIFY_SOLD_COMPS_ACTOR_ID"]:
            self.assertIn(source, theo_data)
        for source in ["FRED_API_KEY", "CENSUS_API_KEY"]:
            self.assertIn(source, public_data)
        self.assertIn("fetchApifyZillow", theo_data)
        self.assertIn("googleStreetViewProperty", theo_data)
        self.assertIn("timeoutFallbackData", theo_data)
        self.assertIn("cachedPhotoReady", theo_data)
        self.assertIn("wantsPropertyImage", theo_data)
        self.assertIn("GOOGLE_MAPS_API_KEY", theo_data)
        self.assertIn("Google Street View fallback", theo_data)
        self.assertIn("isGoogleStreetViewUrl", theo_data)
        self.assertIn("hasGenericNeighborhood", theo_data)
        self.assertIn("shouldReplacePropertyValue", theo_data)
        self.assertIn('key === "photo_url" && isGoogleStreetViewUrl(current) && !isGoogleStreetViewUrl(incoming)', theo_data)
        self.assertIn('key === "neighborhood" && hasGenericNeighborhood(current) && truthy(incoming)', theo_data)
        self.assertIn("photos\\.zillowstatic\\.com", theo_data)
        self.assertIn("zillowListingUrl", theo_data)
        self.assertIn("!isGoogleStreetViewUrl(first.photo_url)", theo_data)
        self.assertIn("fetchPublicPropertyContext", theo_data)
        self.assertIn("fetchCensusZipStats", public_data)
        self.assertIn("fetchSoldComps", theo_data)
        self.assertIn("THEO_ENRICHMENT_TIMEOUT_MS", theo_data)
        self.assertIn('Number(process.env.THEO_ENRICHMENT_TIMEOUT_MS || "14000")', theo_data)
        self.assertIn('Number(process.env.THEO_APIFY_TIMEOUT_SECONDS || "12")', theo_data)
        self.assertIn("THEO_APIFY_TIMEOUT_SECONDS", theo_data)
        self.assertIn("theo_enrichment_budget", theo_data)
        self.assertIn("metrics", theo_data)
        self.assertIn("extractTheoAddress", theo_data)
        self.assertIn("extractTheoAddresses", theo_data)
        self.assertIn("extractTheoPropertySearchQuery", theo_data)
        self.assertIn("extractTheoPropertySearchIntent", theo_data)
        self.assertIn("TheoPropertySearchIntent", theo_data)
        self.assertIn("findPropertySearchArea", theo_data)
        self.assertIn("something close", theo_data)
        self.assertIn("layout", theo_data)
        self.assertIn("CENTRAL_TEXAS_SEARCH_AREAS", theo_data)
        self.assertIn("extractTheoListedPropertyAddresses", theo_data)

    def test_central_texas_service_area_is_shared(self):
        service_areas = read("lib/serviceAreas.ts")
        database = read("lib/database.ts")
        theo_agent = read("lib/theoAgent.ts")
        theo_data = read("lib/theoData.ts")
        agency = read("lib/agencyKnowledge.ts")
        for city in [
            '"round rock"',
            '"pflugerville"',
            '"georgetown"',
            '"san marcos"',
            '"new braunfels"',
            '"bastrop"',
            '"manor"',
            '"elgin"',
            '"liberty hill"',
            '"dripping springs"',
            '"wimberley"',
            '"salado"',
            '"belton"',
            '"temple"',
            '"killeen"',
            '"waco"',
        ]:
            self.assertIn(city, service_areas)
        for neighborhood in [
            '"south austin"',
            '"south congress"',
            '"bouldin creek"',
            '"travis heights"',
            '"hyde park"',
            '"mueller"',
            '"tarrytown"',
            '"the domain"',
            '"four points"',
            '"shady hollow"',
        ]:
            self.assertIn(neighborhood, service_areas)
        self.assertIn("CENTRAL_TEXAS_CITIES", database)
        self.assertIn("CENTRAL_TEXAS_ALIASES", database)
        self.assertIn("CENTRAL_TEXAS_CITIES", theo_agent)
        self.assertIn("CENTRAL_TEXAS_SEARCH_AREAS", theo_data)
        self.assertIn("centralTexasServiceAreaText", agency)

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
        media_proxy = read("lib/mediaProxy.ts")
        self.assertIn("TWILIO_ACCOUNT_SID", twilio_sender)
        self.assertIn("TWILIO_AUTH_TOKEN", twilio_sender)
        self.assertIn("TWILIO_FROM", twilio_sender)
        self.assertIn("TWILIO_FROM is required for SMS replies", twilio_sender)
        self.assertIn("function smsRecipientAddress", twilio_sender)
        self.assertIn("From: fromNumber", twilio_sender)
        self.assertNotIn("MessagingServiceSid", twilio_sender)
        self.assertNotIn("isRcsAddress", twilio_sender)
        self.assertIn("mediaProxyUrl", twilio_sender)
        self.assertIn("return mediaProxyPath(url)", media_proxy)
        self.assertIn("AGENT_PHONE", twilio_sender)
        self.assertIn("ENABLE_SMS_AGENT", twilio_sender)
        self.assertIn("sendTheoHandoffAlert", twilio_sender)
        self.assertIn("MediaUrl", twilio_sender)
        self.assertIn("mediaUrls", twilio_sender)
        self.assertIn("mediaCount", twilio_sender)
        self.assertIn('Number(process.env.SMS_MAX_IMAGES || "3")', twilio_sender)
        self.assertIn("smsMessageWithMediaLog", twilio_sender)
        self.assertIn('return "MMS image"', twilio_sender)
        self.assertIn("https://api.twilio.com/2010-04-01/Accounts/", twilio_sender)
        self.assertNotIn("AC4758", twilio_sender)
        self.assertNotIn("c0e300", twilio_sender)

    def test_live_property_lookup_can_cache_to_database_and_sheets(self):
        database = read("lib/database.ts")
        sheets = read("lib/googleSheets.ts")
        sync_script = read("scripts/sync-sheets-to-db.mjs")
        self.assertIn("upsertPropertyToDatabase", database)
        self.assertIn("propertyAddressStem", database)
        self.assertIn("regexp_replace(address", database)
        self.assertIn("PropertySearchCriteria", database)
        self.assertIn("hasNewerInboundForThreadInDatabase", database)
        self.assertIn("current_event", database)
        self.assertIn("GREATER_AUSTIN_CITIES", database)
        self.assertIn("CENTRAL_TEXAS_CITIES", database)
        self.assertIn("AREA_ALIASES", database)
        self.assertIn("CENTRAL_TEXAS_ALIASES", database)
        self.assertIn("scorePropertyCandidate", database)
        self.assertIn("source = 'sheets'", database)
        self.assertIn('upsertPropertyToDatabase(property, "live_lookup")', read("app/api/webhooks/theo-sms/route.ts"))
        self.assertIn("appendPropertyToSheets", sheets)
        self.assertIn("PROPERTIES_HEADERS.map", sheets)
        self.assertIn("INSERT_ROWS", sheets)
        self.assertNotIn("delete from conversation_events", sync_script.lower())
        self.assertIn("select id", sync_script)
        self.assertIn("duplicate.rowCount", sync_script)

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

    def test_theo_twilio_configurator_sets_service_and_phone_sms_webhooks(self):
        script = read("scripts/configure-theo-twilio.mjs")
        self.assertIn("TWILIO_MESSAGING_SERVICE_SID", script)
        self.assertIn("UseInboundWebhookOnNumber", script)
        self.assertIn("IncomingPhoneNumbers.json?PhoneNumber", script)
        self.assertIn("SmsUrl", script)
        self.assertIn("voice_url_preserved", script)

    def test_media_proxy_allows_only_known_image_hosts(self):
        route = read("app/api/media/proxy/route.ts")
        self.assertIn("ALLOWED_IMAGE_HOSTS", route)
        self.assertIn("photos.zillowstatic.com", route)
        self.assertIn("lh3.googleusercontent.com", route)
        self.assertIn("maps.googleapis.com", route)
        self.assertIn("Unsupported image URL", route)
        self.assertIn('contentType.toLowerCase().startsWith("image/")', route)
        self.assertIn("Cache-Control", route)

    def test_email_html_rewrites_external_images_through_media_proxy(self):
        media_proxy = read("lib/mediaProxy.ts")
        email_view = read("components/inbox-mui/components/EmailView.tsx")
        self.assertIn("rewriteEmailHtmlForInbox", media_proxy)
        self.assertIn("mediaProxyPath", media_proxy)
        self.assertIn("photos.zillowstatic.com", media_proxy)
        self.assertIn("serve directly", media_proxy)
        self.assertIn("sanitizeEmailHtml", media_proxy)
        self.assertIn("email", email_view.lower())


if __name__ == "__main__":
    unittest.main()
