PROPERTIES_TAB = "properties"
LEAD_MEMORY_TAB = "lead_memory"
CONVERSATION_EVENTS_TAB = "conversation_events"

REQUIRED_TABS = [PROPERTIES_TAB, LEAD_MEMORY_TAB, CONVERSATION_EVENTS_TAB]

PROPERTIES_HEADERS = [
    "address", "price", "beds", "baths", "city", "state", "zip", "description",
    "neighborhood", "property_type", "features", "days_on_market", "photo_url",
    "sqft", "year_built", "status", "listing_url", "agent_name", "agent_email",
]

LEAD_MEMORY_HEADERS = [
    "email", "phone", "full_name", "lead_source", "source_detail", "lead_role",
    "intent", "property_interest", "budget", "area", "timeline",
    "preferred_channel", "sms_consent", "call_consent", "last_channel",
    "last_ai_touch_at", "assigned_owner", "handoff_status", "handoff_reason",
    "next_action", "summary", "bedrooms", "bathrooms", "sell_before_buy",
    "lead_score", "appointment_count", "do_not_contact", "whatsapp_consent",
]

CONVERSATION_EVENTS_HEADERS = [
    "event_at", "channel", "direction", "email", "phone", "full_name", "source",
    "thread_ref", "agent_name", "human_owner", "event_type", "message_text",
    "summary", "transcript_url", "recording_url", "ai_action",
    "handoff_reason", "status", "call_duration_seconds", "appointment_id",
    "outcome_code",
]

TAB_HEADERS = {
    PROPERTIES_TAB: PROPERTIES_HEADERS,
    LEAD_MEMORY_TAB: LEAD_MEMORY_HEADERS,
    CONVERSATION_EVENTS_TAB: CONVERSATION_EVENTS_HEADERS,
}
