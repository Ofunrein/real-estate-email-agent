# Agent Inbox V1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the V1 shared Google Sheets memory layer and a read-only Agent Inbox that shows leads, conversation events, channel threads, and basic metrics for the existing Iris/email agent.

**Architecture:** Keep the current email agent working while extracting shared Sheets, lead matching, and event logging into focused `core/` modules. Use one client Google Sheet workbook with three tabs: `properties`, `lead_memory`, and `conversation_events`. Build `agent_inbox/` as a lightweight read-only HTTP app in this repo, backed by the same Sheets data.

**Tech Stack:** Python 3, Google Sheets API, existing Gmail OAuth, stdlib `http.server`, vanilla HTML/CSS/JS, `unittest`.

---

## Scope

This plan implements the foundation only:

- Programmatic creation/validation of required Google Sheet tabs and headers.
- Shared lead matching using normalized phone/email/name.
- Shared event logging to `conversation_events`.
- Iris/email writes lead memory and events.
- Agent Inbox read-only views for leads, events, email threads, and metrics.

This plan does not implement Theo SMS, WhatsApp, Aria/Vapi voice, or Olivia website chat. Those channels should be added after this foundation is working.

## File Structure

- Create `core/__init__.py`: marks shared core package.
- Create `core/sheet_schema.py`: tab names and required headers.
- Create `core/sheets_store.py`: idempotent tab/header setup and row helpers.
- Create `core/lead_matching.py`: normalize phone/email/name and find existing lead row.
- Create `core/event_logger.py`: upsert `lead_memory`, append `conversation_events`, build event rows.
- Create `agent_inbox/__init__.py`: marks Agent Inbox package.
- Create `agent_inbox/app.py`: read-only HTTP server and simple HTML UI.
- Create `scripts/setup_agent_inbox_sheets.py`: onboarding command to create/validate tabs.
- Modify `agent.py`: call shared event logging from the existing email flow.
- Modify `.env.example`: add feature flags and Agent Inbox port.
- Modify `README.md`: add setup and run commands.
- Create `tests/test_sheet_schema.py`: schema/header expectations.
- Create `tests/test_lead_matching.py`: matching behavior.
- Create `tests/test_event_logger.py`: row generation and upsert behavior.
- Create `tests/test_agent_inbox.py`: metrics/grouping helpers.

---

### Task 1: Add Sheet Schema Constants

**Files:**
- Create: `core/__init__.py`
- Create: `core/sheet_schema.py`
- Test: `tests/test_sheet_schema.py`

- [ ] **Step 1: Write the failing schema tests**

Create `tests/test_sheet_schema.py`:

```python
import unittest

from core.sheet_schema import CONVERSATION_EVENTS_HEADERS, LEAD_MEMORY_HEADERS, PROPERTIES_HEADERS, REQUIRED_TABS


class SheetSchemaTests(unittest.TestCase):
    def test_required_tabs_are_v1_tabs(self):
        self.assertEqual(REQUIRED_TABS, ["properties", "lead_memory", "conversation_events"])

    def test_lead_memory_has_matching_and_state_columns(self):
        for header in ["email", "phone", "full_name", "lead_source", "intent", "assigned_owner", "next_action", "summary"]:
            self.assertIn(header, LEAD_MEMORY_HEADERS)

    def test_conversation_events_has_thread_columns(self):
        for header in ["event_at", "channel", "direction", "thread_ref", "message_text", "summary", "recording_url"]:
            self.assertIn(header, CONVERSATION_EVENTS_HEADERS)

    def test_properties_keeps_current_columns(self):
        for header in ["address", "price", "beds", "baths", "photo_url", "sqft", "listing_url", "agent_email"]:
            self.assertIn(header, PROPERTIES_HEADERS)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python3 -m unittest tests.test_sheet_schema
```

Expected: fail because `core.sheet_schema` does not exist.

- [ ] **Step 3: Add the schema module**

Create `core/__init__.py` as an empty file.

Create `core/sheet_schema.py`:

```python
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
    "next_action", "summary",
]

CONVERSATION_EVENTS_HEADERS = [
    "event_at", "channel", "direction", "email", "phone", "full_name", "source",
    "thread_ref", "agent_name", "human_owner", "event_type", "message_text",
    "summary", "transcript_url", "recording_url", "ai_action",
    "handoff_reason", "status",
]

TAB_HEADERS = {
    PROPERTIES_TAB: PROPERTIES_HEADERS,
    LEAD_MEMORY_TAB: LEAD_MEMORY_HEADERS,
    CONVERSATION_EVENTS_TAB: CONVERSATION_EVENTS_HEADERS,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
python3 -m unittest tests.test_sheet_schema
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add core/__init__.py core/sheet_schema.py tests/test_sheet_schema.py
git commit -m "Add Agent Inbox sheet schema"
```

---

### Task 2: Add Idempotent Google Sheet Setup

**Files:**
- Create: `core/sheets_store.py`
- Create: `scripts/setup_agent_inbox_sheets.py`
- Test: `tests/test_sheets_store.py`

- [ ] **Step 1: Write failing unit tests for request planning**

Create `tests/test_sheets_store.py`:

```python
import unittest

from core.sheets_store import build_add_sheet_requests, missing_headers, row_to_dict
from core.sheet_schema import LEAD_MEMORY_HEADERS


class SheetsStoreTests(unittest.TestCase):
    def test_build_add_sheet_requests_only_adds_missing_tabs(self):
        requests = build_add_sheet_requests(existing_tabs={"properties"})
        titles = [req["addSheet"]["properties"]["title"] for req in requests]
        self.assertEqual(titles, ["lead_memory", "conversation_events"])

    def test_missing_headers_returns_only_absent_headers(self):
        current = ["email", "phone"]
        self.assertEqual(missing_headers(current, ["email", "phone", "full_name"]), ["full_name"])

    def test_row_to_dict_pads_short_rows(self):
        row = ["lead@example.com", "+15125550123"]
        result = row_to_dict(LEAD_MEMORY_HEADERS, row)
        self.assertEqual(result["email"], "lead@example.com")
        self.assertEqual(result["phone"], "+15125550123")
        self.assertEqual(result["summary"], "")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python3 -m unittest tests.test_sheets_store
```

Expected: fail because `core.sheets_store` does not exist.

- [ ] **Step 3: Implement Sheets helpers**

Create `core/sheets_store.py`:

```python
from __future__ import annotations

from typing import Any

from core.sheet_schema import REQUIRED_TABS, TAB_HEADERS


def build_add_sheet_requests(existing_tabs: set[str]) -> list[dict[str, Any]]:
    return [
        {"addSheet": {"properties": {"title": tab}}}
        for tab in REQUIRED_TABS
        if tab not in existing_tabs
    ]


def missing_headers(current_headers: list[str], required_headers: list[str]) -> list[str]:
    current = {header.strip() for header in current_headers if header.strip()}
    return [header for header in required_headers if header not in current]


def row_to_dict(headers: list[str], row: list[str]) -> dict[str, str]:
    padded = row + [""] * max(0, len(headers) - len(row))
    return dict(zip(headers, padded))


def values_for_headers(headers: list[str], data: dict) -> list[str]:
    return [str(data.get(header, "") or "") for header in headers]


def get_spreadsheet_tabs(sheets, spreadsheet_id: str) -> set[str]:
    spreadsheet = sheets.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    return {
        sheet["properties"]["title"]
        for sheet in spreadsheet.get("sheets", [])
        if sheet.get("properties", {}).get("title")
    }


def ensure_workbook_schema(sheets, spreadsheet_id: str) -> None:
    existing_tabs = get_spreadsheet_tabs(sheets, spreadsheet_id)
    add_requests = build_add_sheet_requests(existing_tabs)
    if add_requests:
        sheets.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": add_requests},
        ).execute()

    for tab, headers in TAB_HEADERS.items():
        result = sheets.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{tab}!1:1",
        ).execute()
        current_headers = result.get("values", [[]])[0] if result.get("values") else []
        if not current_headers:
            sheets.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f"{tab}!1:1",
                valueInputOption="RAW",
                body={"values": [headers]},
            ).execute()
            continue

        additions = missing_headers(current_headers, headers)
        if additions:
            merged = current_headers + additions
            sheets.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f"{tab}!1:1",
                valueInputOption="RAW",
                body={"values": [merged]},
            ).execute()


def read_table(sheets, spreadsheet_id: str, tab: str) -> list[dict[str, str]]:
    result = sheets.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A:ZZ",
    ).execute()
    rows = result.get("values", [])
    if not rows:
        return []
    headers = rows[0]
    return [row_to_dict(headers, row) for row in rows[1:]]


def append_row(sheets, spreadsheet_id: str, tab: str, headers: list[str], row: dict) -> None:
    sheets.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A:ZZ",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": [values_for_headers(headers, row)]},
    ).execute()


def update_row(sheets, spreadsheet_id: str, tab: str, row_number: int, headers: list[str], row: dict) -> None:
    sheets.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"{tab}!A{row_number}:ZZ{row_number}",
        valueInputOption="RAW",
        body={"values": [values_for_headers(headers, row)]},
    ).execute()
```

- [ ] **Step 4: Add setup command**

Create `scripts/setup_agent_inbox_sheets.py`:

```python
import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import get_gmail_service
from core.sheets_store import ensure_workbook_schema


def main() -> int:
    load_dotenv()
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        print("GOOGLE_SHEET_ID is required")
        return 1
    _, sheets = get_gmail_service()
    ensure_workbook_schema(sheets, spreadsheet_id)
    print("Agent Inbox workbook schema is ready")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Run tests**

Run:

```bash
python3 -m unittest tests.test_sheets_store
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add core/sheets_store.py scripts/setup_agent_inbox_sheets.py tests/test_sheets_store.py
git commit -m "Add Agent Inbox sheet setup"
```

---

### Task 3: Add Lead Matching

**Files:**
- Create: `core/lead_matching.py`
- Test: `tests/test_lead_matching.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_lead_matching.py`:

```python
import unittest

from core.lead_matching import find_lead_index, normalize_email, normalize_name, normalize_phone


class LeadMatchingTests(unittest.TestCase):
    def test_normalize_phone_keeps_us_digits(self):
        self.assertEqual(normalize_phone("(512) 555-0199"), "15125550199")

    def test_normalize_email_lowercases(self):
        self.assertEqual(normalize_email(" Lead@Example.COM "), "lead@example.com")

    def test_normalize_name_collapses_space(self):
        self.assertEqual(normalize_name("  Jane   Smith "), "jane smith")

    def test_find_lead_index_prefers_phone(self):
        leads = [
            {"email": "wrong@example.com", "phone": "+15125550123", "full_name": "Wrong Person"},
            {"email": "lead@example.com", "phone": "", "full_name": "Lead Person"},
        ]
        self.assertEqual(find_lead_index(leads, {"email": "lead@example.com", "phone": "(512) 555-0123"}), 0)

    def test_find_lead_index_uses_email_after_phone(self):
        leads = [{"email": "lead@example.com", "phone": "", "full_name": "Lead Person"}]
        self.assertEqual(find_lead_index(leads, {"email": "LEAD@example.com", "phone": ""}), 0)

    def test_find_lead_index_uses_name_as_weak_fallback(self):
        leads = [{"email": "", "phone": "", "full_name": "Lead Person"}]
        self.assertEqual(find_lead_index(leads, {"email": "", "phone": "", "full_name": "lead person"}), 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python3 -m unittest tests.test_lead_matching
```

Expected: fail because `core.lead_matching` does not exist.

- [ ] **Step 3: Implement matching**

Create `core/lead_matching.py`:

```python
import re


def normalize_email(value: str) -> str:
    return (value or "").strip().lower()


def normalize_phone(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 10:
        return "1" + digits
    return digits


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def find_lead_index(leads: list[dict], incoming: dict) -> int | None:
    incoming_phone = normalize_phone(incoming.get("phone", ""))
    incoming_email = normalize_email(incoming.get("email", ""))
    incoming_name = normalize_name(incoming.get("full_name", ""))

    if incoming_phone:
        for index, lead in enumerate(leads):
            if normalize_phone(lead.get("phone", "")) == incoming_phone:
                return index

    if incoming_email:
        for index, lead in enumerate(leads):
            if normalize_email(lead.get("email", "")) == incoming_email:
                return index

    if incoming_name:
        for index, lead in enumerate(leads):
            if normalize_name(lead.get("full_name", "")) == incoming_name:
                return index

    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
python3 -m unittest tests.test_lead_matching
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add core/lead_matching.py tests/test_lead_matching.py
git commit -m "Add shared lead matching"
```

---

### Task 4: Add Event Logger And Lead Memory Upsert

**Files:**
- Create: `core/event_logger.py`
- Test: `tests/test_event_logger.py`

- [ ] **Step 1: Write failing tests for pure row builders**

Create `tests/test_event_logger.py`:

```python
import unittest

from core.event_logger import build_conversation_event, build_lead_memory_update, merge_lead_memory


class EventLoggerTests(unittest.TestCase):
    def test_build_conversation_event_sets_channel_and_agent(self):
        event = build_conversation_event(
            channel="email",
            direction="outbound",
            email="lead@example.com",
            phone="",
            full_name="Lead Person",
            source="gmail",
            thread_ref="thread-1",
            agent_name="Iris",
            event_type="ai_reply",
            message_text="Hello",
            summary="AI replied",
            ai_action="reply_sent",
            status="sent",
        )
        self.assertEqual(event["channel"], "email")
        self.assertEqual(event["agent_name"], "Iris")
        self.assertEqual(event["event_type"], "ai_reply")
        self.assertTrue(event["event_at"])

    def test_merge_lead_memory_preserves_existing_when_new_value_empty(self):
        existing = {"email": "lead@example.com", "phone": "+15125550123", "area": "Austin"}
        incoming = {"email": "lead@example.com", "phone": "", "area": "Round Rock", "summary": "Updated"}
        merged = merge_lead_memory(existing, incoming)
        self.assertEqual(merged["phone"], "+15125550123")
        self.assertEqual(merged["area"], "Round Rock")
        self.assertEqual(merged["summary"], "Updated")

    def test_build_lead_memory_update_maps_context(self):
        update = build_lead_memory_update(
            email="lead@example.com",
            phone="+15125550123",
            full_name="Lead Person",
            lead_source="email",
            source_detail="Property inquiry",
            lead_role="buyer",
            intent="property_details",
            property_interest=["123 Main St"],
            assigned_owner="agent@example.com",
            next_action="reply_and_qualify",
            summary="Asked about 123 Main St",
        )
        self.assertEqual(update["property_interest"], "123 Main St")
        self.assertEqual(update["last_channel"], "email")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
python3 -m unittest tests.test_event_logger
```

Expected: fail because `core.event_logger` does not exist.

- [ ] **Step 3: Implement event logger pure helpers**

Create `core/event_logger.py`:

```python
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
```

- [ ] **Step 4: Run tests**

Run:

```bash
python3 -m unittest tests.test_event_logger
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add core/event_logger.py tests/test_event_logger.py
git commit -m "Add lead memory event logger"
```

---

### Task 5: Integrate Iris Email With Shared Memory

**Files:**
- Modify: `agent.py`
- Test: `tests/test_agent_lead_memory.py`

- [ ] **Step 1: Add tests for email row builders through existing state helpers**

Append to `tests/test_agent_lead_memory.py`:

```python
    def test_build_email_memory_update_from_lead_memory(self):
        parsed = parsed_msg("Can I see 123 Main St?")
        classification = agent.normalize_classification({
            "intent": "property_details",
            "primary_lead_role": "buyer",
            "address": "123 Main St",
            "lead_fields": {"area": "Austin", "budget": "$500,000"},
            "recommended_next_action": "reply_and_qualify",
        })
        memory = {
            "lead_email": "Lead Person <lead@example.com>",
            "lead_name": "Lead Person",
            "lead_role": "buyer",
            "property_interest": ["123 Main St"],
            "lead_fields": {"area": "Austin", "budget": "$500,000", "timeline": None},
            "assigned_owner": "agent@example.com",
            "next_action": "reply_and_qualify",
        }

        update = agent.build_email_lead_memory_update(parsed, classification, memory, "agent@example.com")

        self.assertEqual(update["email"], "lead@example.com")
        self.assertEqual(update["full_name"], "Lead Person")
        self.assertEqual(update["property_interest"], "123 Main St")
        self.assertEqual(update["assigned_owner"], "agent@example.com")

    def test_build_email_conversation_event_marks_iris(self):
        parsed = parsed_msg("Can I see 123 Main St?")
        event = agent.build_email_conversation_event(
            parsed=parsed,
            direction="outbound",
            event_type="ai_reply",
            message_text="Here are the details.",
            summary="Iris replied with listing details.",
            ai_action="reply_sent",
            status="sent",
        )

        self.assertEqual(event["channel"], "email")
        self.assertEqual(event["agent_name"], "Iris")
        self.assertEqual(event["thread_ref"], "thread-1")
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
python3 -m unittest tests.test_agent_lead_memory
```

Expected: fail because the `agent.build_email_*` functions do not exist.

- [ ] **Step 3: Add imports and helper functions to `agent.py`**

Add near other imports:

```python
from core.event_logger import (
    append_conversation_event,
    build_conversation_event,
    build_lead_memory_update,
    upsert_lead_memory,
)
```

Add after `build_handoff_summary`:

```python
def build_email_lead_memory_update(parsed: dict, classification: dict, memory: dict, assigned_owner: str = "") -> dict:
    _, email_addr = _sender_parts(parsed.get("from", ""))
    fields = memory.get("lead_fields", {})
    return build_lead_memory_update(
        email=email_addr,
        phone=memory.get("phone", ""),
        full_name=memory.get("lead_name", ""),
        lead_source="email",
        source_detail=parsed.get("subject", ""),
        lead_role=memory.get("lead_role", classification.get("primary_lead_role", "")),
        intent=classification.get("intent", ""),
        property_interest=memory.get("property_interest", []),
        budget=fields.get("budget") or "",
        area=fields.get("area") or "",
        timeline=fields.get("timeline") or "",
        preferred_channel=memory.get("preferred_channel", "email"),
        assigned_owner=assigned_owner or memory.get("assigned_owner", ""),
        handoff_status="needs_human" if classification.get("intent") == "human_required" else "",
        handoff_reason=memory.get("human_handoff_reason", ""),
        next_action=memory.get("next_action", ""),
        summary=build_handoff_summary(parsed, classification, memory, classification.get("intent", "")),
    )


def build_email_conversation_event(
    *,
    parsed: dict,
    direction: str,
    event_type: str,
    message_text: str,
    summary: str,
    ai_action: str,
    status: str,
    handoff_reason: str = "",
) -> dict:
    _, email_addr = _sender_parts(parsed.get("from", ""))
    name, _ = _sender_parts(parsed.get("from", ""))
    return build_conversation_event(
        channel="email",
        direction=direction,
        email=email_addr,
        full_name=name,
        source="gmail",
        thread_ref=parsed.get("thread_id", ""),
        agent_name="Iris",
        event_type=event_type,
        message_text=message_text,
        summary=summary,
        ai_action=ai_action,
        handoff_reason=handoff_reason,
        status=status,
    )
```

- [ ] **Step 4: Write shared memory rows during `process_message`**

Inside `process_message`, after `send_reply(...)` succeeds, add:

```python
        if SHEET_ID:
            owner = lead_memory.get("assigned_owner", TEAM_LEAD_EMAIL)
            upsert_lead_memory(
                sheets,
                SHEET_ID,
                build_email_lead_memory_update(parsed, classification, lead_memory, owner),
            )
            append_conversation_event(
                sheets,
                SHEET_ID,
                build_email_conversation_event(
                    parsed=parsed,
                    direction="outbound",
                    event_type="ai_reply",
                    message_text=text_body,
                    summary=f"Iris replied to {intent}",
                    ai_action="reply_sent",
                    status="sent",
                ),
            )
```

Inside the human-required branch before returning, add a similar event:

```python
        if SHEET_ID:
            upsert_lead_memory(
                sheets,
                SHEET_ID,
                build_email_lead_memory_update(parsed, classification, lead_memory, TEAM_LEAD_EMAIL),
            )
            append_conversation_event(
                sheets,
                SHEET_ID,
                build_email_conversation_event(
                    parsed=parsed,
                    direction="inbound",
                    event_type="human_handoff",
                    message_text=parsed.get("body", ""),
                    summary=handoff_summary,
                    ai_action="route_human",
                    handoff_reason=lead_memory.get("human_handoff_reason", ""),
                    status="needs_human",
                ),
            )
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
python3 -m unittest tests.test_agent_lead_memory tests.test_event_logger
```

Expected: pass.

- [ ] **Step 6: Run full tests and syntax check**

Run:

```bash
python3 -m py_compile agent.py
python3 -m unittest discover -s tests
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add agent.py tests/test_agent_lead_memory.py
git commit -m "Log Iris email activity to shared memory"
```

---

### Task 6: Build Read-Only Agent Inbox

**Files:**
- Create: `agent_inbox/__init__.py`
- Create: `agent_inbox/app.py`
- Test: `tests/test_agent_inbox.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Write failing tests for metrics and thread grouping**

Create `tests/test_agent_inbox.py`:

```python
import unittest

from agent_inbox.app import build_metrics, group_events_by_thread


class AgentInboxTests(unittest.TestCase):
    def test_build_metrics_counts_leads_and_channels(self):
        leads = [
            {"email": "a@example.com", "handoff_status": "needs_human"},
            {"email": "b@example.com", "handoff_status": ""},
        ]
        events = [
            {"channel": "email", "status": "sent"},
            {"channel": "voice", "status": "needs_human"},
            {"channel": "email", "status": "sent"},
        ]
        metrics = build_metrics(leads, events)
        self.assertEqual(metrics["lead_count"], 2)
        self.assertEqual(metrics["needs_human"], 2)
        self.assertEqual(metrics["channels"]["email"], 2)
        self.assertEqual(metrics["channels"]["voice"], 1)

    def test_group_events_by_thread(self):
        events = [
            {"thread_ref": "thread-1", "message_text": "First"},
            {"thread_ref": "thread-1", "message_text": "Second"},
            {"thread_ref": "", "message_text": "No thread"},
        ]
        grouped = group_events_by_thread(events)
        self.assertEqual(len(grouped["thread-1"]), 2)
        self.assertEqual(len(grouped["unknown"]), 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
python3 -m unittest tests.test_agent_inbox
```

Expected: fail because `agent_inbox.app` does not exist.

- [ ] **Step 3: Implement Agent Inbox app**

Create `agent_inbox/__init__.py` as an empty file.

Create `agent_inbox/app.py`:

```python
import json
import os
from collections import Counter, defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv

from agent import get_gmail_service
from core.sheet_schema import CONVERSATION_EVENTS_TAB, LEAD_MEMORY_TAB
from core.sheets_store import read_table


def group_events_by_thread(events: list[dict]) -> dict[str, list[dict]]:
    grouped = defaultdict(list)
    for event in events:
        grouped[event.get("thread_ref") or "unknown"].append(event)
    return dict(grouped)


def build_metrics(leads: list[dict], events: list[dict]) -> dict:
    channels = Counter(event.get("channel") or "unknown" for event in events)
    needs_human = sum(1 for lead in leads if lead.get("handoff_status") == "needs_human")
    needs_human += sum(1 for event in events if event.get("status") == "needs_human")
    return {
        "lead_count": len(leads),
        "event_count": len(events),
        "needs_human": needs_human,
        "channels": dict(channels),
    }


def load_inbox_data(sheets, spreadsheet_id: str) -> dict:
    leads = read_table(sheets, spreadsheet_id, LEAD_MEMORY_TAB)
    events = read_table(sheets, spreadsheet_id, CONVERSATION_EVENTS_TAB)
    return {
        "leads": leads,
        "events": events,
        "metrics": build_metrics(leads, events),
        "threads": group_events_by_thread(events),
    }


def render_index() -> str:
    return """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Inbox</title>
  <style>
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17201b; background: #f4f1eb; }
    .layout { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
    nav { background: #17201b; color: #f8f2e8; padding: 24px 16px; }
    nav h1 { font-size: 20px; margin: 0 0 24px; }
    nav button { width: 100%; text-align: left; border: 0; background: transparent; color: inherit; padding: 10px 12px; border-radius: 6px; font-size: 15px; cursor: pointer; }
    nav button.active { background: #d85c3a; color: white; }
    main { padding: 24px; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
    .card { background: white; border: 1px solid #ddd7cd; border-radius: 8px; padding: 14px; }
    .card strong { display: block; font-size: 28px; }
    .panel { background: white; border: 1px solid #ddd7cd; border-radius: 8px; overflow: hidden; }
    .row { display: grid; grid-template-columns: 170px 1fr 140px; gap: 12px; padding: 12px 14px; border-top: 1px solid #eee7dd; }
    .row:first-child { border-top: 0; }
    .thread { padding: 14px; border-top: 1px solid #eee7dd; }
    .message { background: #f8f6f1; border-radius: 8px; padding: 10px; margin-top: 8px; white-space: pre-wrap; }
    @media (max-width: 760px) { .layout { grid-template-columns: 1fr; } nav { position: sticky; top: 0; } .cards { grid-template-columns: 1fr 1fr; } .row { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="layout">
    <nav>
      <h1>Agent Inbox</h1>
      <button class="active" data-view="overview">Overview</button>
      <button data-view="leads">Leads</button>
      <button data-view="email">Email</button>
      <button data-view="events">Events</button>
      <button data-view="metrics">Metrics</button>
    </nav>
    <main id="app">Loading...</main>
  </div>
  <script>
    let data = null;
    let view = "overview";
    const app = document.getElementById("app");
    document.querySelectorAll("nav button").forEach(button => {
      button.addEventListener("click", () => {
        document.querySelectorAll("nav button").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        view = button.dataset.view;
        render();
      });
    });
    async function loadData() {
      const response = await fetch("/api/data");
      data = await response.json();
      render();
    }
    function card(label, value) {
      return `<div class="card"><span>${label}</span><strong>${value}</strong></div>`;
    }
    function overview() {
      const m = data.metrics;
      return `<div class="cards">${card("Leads", m.lead_count)}${card("Events", m.event_count)}${card("Needs human", m.needs_human)}${card("Email events", m.channels.email || 0)}</div>${eventsList(data.events.slice(-20).reverse())}`;
    }
    function leads() {
      return `<div class="panel">${data.leads.map(lead => `<div class="row"><strong>${lead.full_name || lead.email || lead.phone || "Unknown"}</strong><span>${lead.summary || lead.intent || ""}</span><span>${lead.next_action || ""}</span></div>`).join("") || "<div class='row'>No leads yet</div>"}</div>`;
    }
    function eventsList(events) {
      return `<div class="panel">${events.map(event => `<div class="row"><strong>${event.channel || "unknown"} / ${event.event_type || ""}</strong><span>${event.summary || event.message_text || ""}</span><span>${event.status || ""}</span></div>`).join("") || "<div class='row'>No events yet</div>"}</div>`;
    }
    function emailThreads() {
      const threads = Object.entries(data.threads).filter(([, events]) => events.some(event => event.channel === "email"));
      return `<div class="panel">${threads.map(([thread, events]) => `<div class="thread"><strong>${thread}</strong>${events.map(event => `<div class="message">${event.direction || ""} ${event.agent_name || ""}\\n${event.message_text || event.summary || ""}</div>`).join("")}</div>`).join("") || "<div class='row'>No email threads yet</div>"}</div>`;
    }
    function render() {
      if (!data) return;
      if (view === "overview") app.innerHTML = overview();
      if (view === "leads") app.innerHTML = leads();
      if (view === "email") app.innerHTML = emailThreads();
      if (view === "events") app.innerHTML = eventsList(data.events.slice().reverse());
      if (view === "metrics") app.innerHTML = `<pre>${JSON.stringify(data.metrics, null, 2)}</pre>`;
    }
    loadData();
    setInterval(loadData, 15000);
  </script>
</body>
</html>"""


class AgentInboxHandler(BaseHTTPRequestHandler):
    sheets = None
    spreadsheet_id = ""

    def _send(self, body: str, content_type: str = "text/html") -> None:
        encoded = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            data = load_inbox_data(self.sheets, self.spreadsheet_id)
            self._send(json.dumps(data), "application/json")
            return
        self._send(render_index())


def run(host: str = "127.0.0.1", port: int = 8787) -> None:
    load_dotenv()
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        raise RuntimeError("GOOGLE_SHEET_ID is required")
    _, sheets = get_gmail_service()
    AgentInboxHandler.sheets = sheets
    AgentInboxHandler.spreadsheet_id = spreadsheet_id
    server = ThreadingHTTPServer((host, port), AgentInboxHandler)
    print(f"Agent Inbox running at http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run(port=int(os.getenv("AGENT_INBOX_PORT", "8787")))
```

- [ ] **Step 4: Run tests**

Run:

```bash
python3 -m unittest tests.test_agent_inbox
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add agent_inbox/__init__.py agent_inbox/app.py tests/test_agent_inbox.py
git commit -m "Add read-only Agent Inbox"
```

---

### Task 7: Add Feature Flags And Docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add config to `.env.example`**

Add:

```bash
# ── Agent Inbox / channel flags ───────────────────────────────────────────────
ENABLE_EMAIL_AGENT=true
ENABLE_SMS_AGENT=false
ENABLE_WHATSAPP_AGENT=false
ENABLE_VOICE_AGENT=false
ENABLE_WEBSITE_CHAT_AGENT=false
ENABLE_AGENT_INBOX=true
AGENT_INBOX_PORT=8787
```

- [ ] **Step 2: Add README runbook**

Add an `Agent Inbox V1` section to `README.md`:

```markdown
## Agent Inbox V1

Agent Inbox is a read-only monitor for the shared Google Sheet workbook. It shows lead memory, conversation events, email threads, and basic metrics.

Prepare the workbook:

```bash
python3 scripts/setup_agent_inbox_sheets.py
```

Run the email agent:

```bash
python3 agent.py
```

Run Agent Inbox:

```bash
python3 -m agent_inbox.app
```

Open `http://127.0.0.1:8787`.

V1 uses three required tabs in the same Google Sheet workbook:

- `properties`
- `lead_memory`
- `conversation_events`
```

- [ ] **Step 3: Run docs check and tests**

Run:

```bash
git diff --check
python3 -m unittest discover -s tests
```

Expected: no whitespace errors and all tests pass.

- [ ] **Step 4: Commit**

```bash
git add .env.example README.md
git commit -m "Document Agent Inbox setup"
```

---

### Task 8: End-To-End Local Verification

**Files:**
- No new files.

- [ ] **Step 1: Run syntax checks**

Run:

```bash
python3 -m py_compile agent.py core/sheet_schema.py core/sheets_store.py core/lead_matching.py core/event_logger.py agent_inbox/app.py scripts/setup_agent_inbox_sheets.py
```

Expected: no output and exit code 0.

- [ ] **Step 2: Run all unit tests**

Run:

```bash
python3 -m unittest discover -s tests
```

Expected: all tests pass.

- [ ] **Step 3: Verify workbook setup against configured Sheet**

Run:

```bash
python3 scripts/setup_agent_inbox_sheets.py
```

Expected: prints `Agent Inbox workbook schema is ready`.

- [ ] **Step 4: Start Agent Inbox**

Run:

```bash
python3 -m agent_inbox.app
```

Expected: prints `Agent Inbox running at http://127.0.0.1:8787`.

- [ ] **Step 5: Open the local UI**

Open:

```text
http://127.0.0.1:8787
```

Expected:

- Overview loads.
- Leads view shows rows from `lead_memory` or an empty state.
- Email view shows grouped email threads from `conversation_events` or an empty state.
- Metrics view shows JSON counts.

- [ ] **Step 6: Commit any verification fixes**

If verification required edits:

```bash
git add <changed-files>
git commit -m "Verify Agent Inbox foundation"
```

If verification required no edits, do not create an empty commit.

---

## Self-Review

- Spec coverage: This plan covers workbook tabs, Sheets setup, shared memory, conversation events, Iris/email logging, read-only Agent Inbox, and basic metrics.
- Deferred spec areas: Theo SMS, WhatsApp, Aria voice, and Olivia website chat are intentionally separate follow-up plans after the foundation works.
- Placeholder scan: Every task names the concrete functions, files, and schema constants it uses.
- Type consistency: Lead rows and event rows use the exact header names from `core/sheet_schema.py`.
- Risk: The current `agent.py` remains large during this plan. The plan introduces `core/` first, then later work can move more email-specific code into `channels/email.py` and `personalities/iris.py`.
