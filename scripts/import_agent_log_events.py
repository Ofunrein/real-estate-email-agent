from __future__ import annotations

import argparse
import ast
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from googleapiclient.errors import HttpError

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import get_gmail_service
from core.sheet_schema import CONVERSATION_EVENTS_HEADERS, CONVERSATION_EVENTS_TAB
from core.sheets_store import ensure_workbook_schema, read_table, values_for_headers


LOG_RE = re.compile(r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \[[A-Z]+\] (?P<msg>.*)$")
PROCESS_RE = re.compile(r"--- Processing message id=(?P<id>\S+) from=(?P<sender>.*?) subject='(?P<subject>.*)'$")
INTENT_RE = re.compile(
    r"Intent: (?P<intent>[^|]+) \| Role: (?P<role>[^|]+) \| Tags: (?P<tags>\[[^\]]*\]) "
    r"\| Tone: (?P<tone>[^|]+) \| No count: (?P<no_count>[^|]+) \| Addresses: (?P<addresses>.*?) "
    r"\| Lead fields: (?P<fields>\{.*\})$"
)
REPLY_RE = re.compile(r"Reply sent — to=(?P<to>.*?) intent=(?P<intent>\S+) labels=(?P<labels>\[.*\])$")
NO_REPLY_RE = re.compile(r"No reply generated — labeled NEEDS_HUMAN.*")
HUMAN_RE = re.compile(r"Human required — labeled NEEDS_HUMAN.*")
SPAM_RE = re.compile(r"Spam — labeled NEEDS_HUMAN.*")


def sender_parts(raw: str) -> tuple[str, str]:
    match = re.search(r"<([^>]+)>", raw or "")
    email = match.group(1).strip() if match else (raw or "").strip()
    name = (raw or "").split("<", 1)[0].strip().strip('"')
    return name, email


def normalize_subject(subject: str) -> str:
    value = (subject or "").strip()
    while True:
        next_value = re.sub(r"^(re|fw|fwd):\s*", "", value, flags=re.IGNORECASE).strip()
        if next_value == value:
            break
        value = next_value
    return value or "(no subject)"


def thread_ref_for(current: dict) -> str:
    _, email = sender_parts(current.get("sender", ""))
    subject = normalize_subject(current.get("subject", ""))
    return f"log:{email.lower()}:{subject.lower()}"


def safe_literal(value: str, fallback):
    try:
        return ast.literal_eval(value)
    except (SyntaxError, ValueError):
        return fallback


def compact_fields(fields: dict) -> str:
    parts = []
    for key in ("timeline", "budget", "area", "beds", "current_property_status", "preferred_channel"):
        value = fields.get(key)
        if value not in (None, ""):
            parts.append(f"{key}={value}")
    return "; ".join(parts)


def inbound_summary(current: dict) -> str:
    fields_text = compact_fields(current.get("lead_fields", {}))
    addresses = current.get("addresses", "")
    parts = [
        f"Intent: {current.get('intent', 'unknown')}",
        f"role: {current.get('role', 'unknown')}",
    ]
    if current.get("tags"):
        parts.append(f"tags: {', '.join(current['tags'])}")
    if addresses and addresses != "none":
        parts.append(f"properties: {addresses}")
    if fields_text:
        parts.append(fields_text)
    return " | ".join(parts)


def blank_event(current: dict, *, direction: str, event_type: str, message_text: str, summary: str, ai_action: str, status: str) -> dict:
    name, email = sender_parts(current.get("sender", ""))
    return {
        "event_at": current.get("event_at") or current.get("ts", ""),
        "channel": "email",
        "direction": direction,
        "email": email,
        "phone": "",
        "full_name": name,
        "source": "agent.log",
        "thread_ref": thread_ref_for(current),
        "agent_name": "Iris",
        "human_owner": "",
        "event_type": event_type,
        "message_text": message_text,
        "summary": summary,
        "transcript_url": "",
        "recording_url": "",
        "ai_action": ai_action,
        "handoff_reason": "Imported from historical log; full body was not recorded." if status == "needs_human" else "",
        "status": status,
    }


def build_inbound_event(current: dict, *, status: str = "processed", event_type: str = "email_received") -> dict:
    subject = current.get("subject", "")
    text = f"Subject: {subject}\n{inbound_summary(current)}"
    return blank_event(
        current,
        direction="inbound",
        event_type=event_type,
        message_text=text,
        summary=inbound_summary(current),
        ai_action="classify",
        status=status,
    )


def build_outbound_event(current: dict, *, status: str) -> dict:
    intent = current.get("intent", "unknown")
    return blank_event(
        current,
        direction="outbound",
        event_type="ai_reply",
        message_text=f"Iris sent an email reply for {intent}. Full historical reply text was not recorded in agent.log.",
        summary=f"Iris replied to {intent}",
        ai_action="reply_sent",
        status=status,
    )


def event_key(event: dict) -> tuple[str, str, str, str, str]:
    return (
        event.get("event_at", ""),
        event.get("thread_ref", ""),
        event.get("direction", ""),
        event.get("event_type", ""),
        event.get("summary", ""),
    )


def parse_agent_log_events(log_path: str | Path, include_spam: bool = False) -> list[dict]:
    events: list[dict] = []
    emitted: set[tuple[str, str, str, str, str]] = set()
    current: dict | None = None
    inbound_emitted_for: set[str] = set()

    def emit(event: dict) -> None:
        key = event_key(event)
        if key in emitted:
            return
        emitted.add(key)
        events.append(event)

    for line in Path(log_path).read_text(errors="ignore").splitlines():
        log_match = LOG_RE.match(line)
        if not log_match:
            continue
        ts = log_match.group("ts")
        msg = log_match.group("msg")

        process_match = PROCESS_RE.match(msg)
        if process_match:
            current = {
                "ts": ts,
                "event_at": ts,
                "msg_id": process_match.group("id"),
                "sender": process_match.group("sender"),
                "subject": process_match.group("subject"),
                "intent": "unknown",
                "role": "unknown",
                "tags": [],
                "addresses": "",
                "lead_fields": {},
            }
            continue

        if not current:
            continue

        intent_match = INTENT_RE.match(msg)
        if intent_match:
            current.update(
                {
                    "intent": intent_match.group("intent").strip(),
                    "role": intent_match.group("role").strip(),
                    "tags": safe_literal(intent_match.group("tags"), []),
                    "addresses": intent_match.group("addresses").strip(),
                    "lead_fields": safe_literal(intent_match.group("fields"), {}),
                }
            )
            continue

        if SPAM_RE.match(msg):
            if include_spam:
                emit(build_inbound_event(current, status="needs_human", event_type="spam_review"))
            current = None
            continue

        if HUMAN_RE.match(msg):
            if current.get("intent") != "spam" or include_spam:
                emit(build_inbound_event(current, status="needs_human", event_type="human_handoff"))
            current = None
            continue

        if NO_REPLY_RE.match(msg):
            if current.get("intent") != "spam" or include_spam:
                emit(build_inbound_event(current, status="needs_human", event_type="manual_review"))
            current = None
            continue

        reply_match = REPLY_RE.match(msg)
        if reply_match:
            if current.get("intent") == "spam" and not include_spam:
                current = None
                continue
            labels = safe_literal(reply_match.group("labels"), [])
            status = "needs_human" if "NEEDS_HUMAN" in labels else "sent"
            msg_id = current.get("msg_id", "")
            if msg_id not in inbound_emitted_for:
                emit(build_inbound_event(current, status="processed"))
                inbound_emitted_for.add(msg_id)
            emit(build_outbound_event(current, status=status))
            current = None

    return events


def import_events(events: list[dict], dry_run: bool = False) -> tuple[int, int]:
    load_dotenv()
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        raise RuntimeError("GOOGLE_SHEET_ID is required")
    _, sheets = get_gmail_service()
    ensure_workbook_schema(sheets, spreadsheet_id)
    existing = read_table(sheets, spreadsheet_id, CONVERSATION_EVENTS_TAB)
    existing_keys = {event_key(row) for row in existing}
    new_events = [event for event in events if event_key(event) not in existing_keys]
    if not dry_run:
        if new_events:
            for attempt in range(3):
                try:
                    sheets.spreadsheets().values().append(
                        spreadsheetId=spreadsheet_id,
                        range=f"{CONVERSATION_EVENTS_TAB}!A:ZZ",
                        valueInputOption="RAW",
                        insertDataOption="INSERT_ROWS",
                        body={"values": [values_for_headers(CONVERSATION_EVENTS_HEADERS, event) for event in new_events]},
                    ).execute()
                    break
                except HttpError as error:
                    if error.resp.status != 429 or attempt == 2:
                        raise
                    time.sleep(65)
    return len(new_events), len(existing)


def main() -> int:
    parser = argparse.ArgumentParser(description="Import historical Iris email conversation events from agent.log.")
    parser.add_argument("--log", default="agent.log", help="Path to agent.log")
    parser.add_argument("--dry-run", action="store_true", help="Parse and compare without writing to Google Sheets")
    parser.add_argument("--include-spam", action="store_true", help="Also import spam-classified messages")
    args = parser.parse_args()

    events = parse_agent_log_events(args.log, include_spam=args.include_spam)
    appended, existing = import_events(events, dry_run=args.dry_run)
    action = "Would append" if args.dry_run else "Appended"
    print(f"Parsed {len(events)} conversation events. {action} {appended}; existing rows {existing}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
