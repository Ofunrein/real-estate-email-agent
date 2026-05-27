from __future__ import annotations

from datetime import datetime, timezone

from core.lead_matching import find_lead_index
from core.sheet_schema import CONVERSATION_EVENTS_HEADERS, CONVERSATION_EVENTS_TAB, LEAD_MEMORY_HEADERS, LEAD_MEMORY_TAB
from core.sheets_store import append_row, read_table, update_row


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def join_values(values) -> str:
    if isinstance(values, list):
        return ", ".join(str(value) for value in values if value)
    return str(values or "")


def merge_lead_memory(existing: dict, incoming: dict) -> dict:
    merged = dict(existing)
    for key, value in incoming.items():
        if value not in (None, ""):
            merged[key] = value
    return merged


def build_lead_memory_update(
    *,
    email: str = "",
    phone: str = "",
    full_name: str = "",
    lead_source: str = "",
    source_detail: str = "",
    lead_role: str = "",
    intent: str = "",
    property_interest=None,
    budget: str = "",
    area: str = "",
    timeline: str = "",
    preferred_channel: str = "",
    sms_consent: str = "",
    call_consent: str = "",
    assigned_owner: str = "",
    handoff_status: str = "",
    handoff_reason: str = "",
    next_action: str = "",
    summary: str = "",
) -> dict:
    return {
        "email": email,
        "phone": phone,
        "full_name": full_name,
        "lead_source": lead_source,
        "source_detail": source_detail,
        "lead_role": lead_role,
        "intent": intent,
        "property_interest": join_values(property_interest),
        "budget": budget,
        "area": area,
        "timeline": timeline,
        "preferred_channel": preferred_channel,
        "sms_consent": sms_consent,
        "call_consent": call_consent,
        "last_channel": lead_source,
        "last_ai_touch_at": iso_now(),
        "assigned_owner": assigned_owner,
        "handoff_status": handoff_status,
        "handoff_reason": handoff_reason,
        "next_action": next_action,
        "summary": summary,
    }


def build_conversation_event(
    *,
    channel: str,
    direction: str,
    email: str = "",
    phone: str = "",
    full_name: str = "",
    source: str = "",
    thread_ref: str = "",
    agent_name: str = "",
    human_owner: str = "",
    event_type: str = "",
    message_text: str = "",
    summary: str = "",
    transcript_url: str = "",
    recording_url: str = "",
    ai_action: str = "",
    handoff_reason: str = "",
    status: str = "",
) -> dict:
    return {
        "event_at": iso_now(),
        "channel": channel,
        "direction": direction,
        "email": email,
        "phone": phone,
        "full_name": full_name,
        "source": source,
        "thread_ref": thread_ref,
        "agent_name": agent_name,
        "human_owner": human_owner,
        "event_type": event_type,
        "message_text": message_text,
        "summary": summary,
        "transcript_url": transcript_url,
        "recording_url": recording_url,
        "ai_action": ai_action,
        "handoff_reason": handoff_reason,
        "status": status,
    }


def upsert_lead_memory(sheets, spreadsheet_id: str, incoming: dict) -> dict:
    leads = read_table(sheets, spreadsheet_id, LEAD_MEMORY_TAB)
    index = find_lead_index(leads, incoming)
    if index is None:
        append_row(sheets, spreadsheet_id, LEAD_MEMORY_TAB, LEAD_MEMORY_HEADERS, incoming)
        return incoming
    merged = merge_lead_memory(leads[index], incoming)
    update_row(sheets, spreadsheet_id, LEAD_MEMORY_TAB, index + 2, LEAD_MEMORY_HEADERS, merged)
    return merged


def append_conversation_event(sheets, spreadsheet_id: str, event: dict) -> None:
    append_row(sheets, spreadsheet_id, CONVERSATION_EVENTS_TAB, CONVERSATION_EVENTS_HEADERS, event)
