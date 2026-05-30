from __future__ import annotations

import argparse
import base64
import email.utils
import os
import re
import sys
from collections import defaultdict, deque

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from agent import get_gmail_service
from core.sheet_schema import CONVERSATION_EVENTS_HEADERS, CONVERSATION_EVENTS_TAB
from core.sheets_store import ensure_workbook_schema, read_table, update_row


PLACEHOLDER = "Full historical reply text was not recorded in agent.log."
MAX_SHEET_CELL_CHARS = 48000


def normalize_subject(subject: str) -> str:
    value = (subject or "").strip()
    while True:
        next_value = re.sub(r"^(re|fw|fwd):\s*", "", value, flags=re.IGNORECASE).strip()
        if next_value == value:
            break
        value = next_value
    return value.lower() or "(no subject)"


def thread_subject_key(thread_ref: str) -> str:
    if not thread_ref.startswith("log:"):
        return normalize_subject(thread_ref)
    parts = thread_ref.split(":", 2)
    if len(parts) < 3:
        return ""
    return normalize_subject(parts[2])


def decode_body(data: str) -> str:
    if not data:
        return ""
    return base64.urlsafe_b64decode(data.encode("utf-8")).decode("utf-8", errors="ignore")


def payload_part(payload: dict, mime_type: str) -> str:
    if payload.get("mimeType") == mime_type:
        text = decode_body(payload.get("body", {}).get("data", ""))
        if text:
            return text
    for part in payload.get("parts", []) or []:
        text = payload_part(part, mime_type)
        if text:
            return text
    return ""


def header_map(message: dict) -> dict[str, str]:
    headers = message.get("payload", {}).get("headers", [])
    return {header.get("name", "").lower(): header.get("value", "") for header in headers}


def parsed_email_addresses(value: str) -> list[str]:
    return [email.lower() for _, email in email.utils.getaddresses([value or ""]) if email]


def parsed_date(value: str) -> str:
    try:
        parsed = email.utils.parsedate_to_datetime(value) if value else None
    except (TypeError, ValueError, IndexError):
        parsed = None
    if not parsed:
        return ""
    return parsed.isoformat()


def sent_message_record(message: dict) -> dict:
    headers = header_map(message)
    html_body = payload_part(message.get("payload", {}), "text/html").strip()
    plain_body = payload_part(message.get("payload", {}), "text/plain").strip()
    return {
        "id": message.get("id", ""),
        "thread_id": message.get("threadId", ""),
        "date": parsed_date(headers.get("date", "")),
        "subject": headers.get("subject", ""),
        "subject_key": normalize_subject(headers.get("subject", "")),
        "to": parsed_email_addresses(headers.get("to", "")),
        "body": (html_body or plain_body)[:MAX_SHEET_CELL_CHARS],
        "body_type": "html" if html_body else "plain",
    }


def list_sent_messages(gmail, query: str, limit: int) -> list[dict]:
    messages: list[dict] = []
    page_token = None
    while len(messages) < limit:
        request = gmail.users().messages().list(
            userId="me",
            q=query,
            maxResults=min(100, limit - len(messages)),
            pageToken=page_token,
        )
        result = request.execute()
        for item in result.get("messages", []):
            full = gmail.users().messages().get(userId="me", id=item["id"], format="full").execute()
            record = sent_message_record(full)
            if record["body"]:
                messages.append(record)
        page_token = result.get("nextPageToken")
        if not page_token:
            break
    return messages


def eligible_event(row: dict) -> bool:
    return (
        (row.get("direction") or "").lower() == "outbound"
        and (row.get("event_type") or "").lower() == "ai_reply"
        and PLACEHOLDER in (row.get("message_text") or "")
        and bool(row.get("email"))
        and bool(row.get("thread_ref"))
    )


def match_backfills(events: list[dict], sent_messages: list[dict]) -> list[tuple[int, dict, dict]]:
    sent_by_key: dict[tuple[str, str], deque[dict]] = defaultdict(deque)
    for message in sorted(sent_messages, key=lambda item: item.get("date") or ""):
        for recipient in message["to"]:
            sent_by_key[(recipient, message["subject_key"])].append(message)

    matches: list[tuple[int, dict, dict]] = []
    for index, event in sorted(enumerate(events), key=lambda item: item[1].get("event_at") or ""):
        key = ((event.get("email") or "").lower(), thread_subject_key(event.get("thread_ref", "")))
        if not eligible_event(event) or not key[1]:
            continue
        candidates = sent_by_key.get(key)
        if not candidates:
            continue
        matches.append((index, event, candidates.popleft()))
    return matches


def backfill_events(events: list[dict], matches: list[tuple[int, dict, dict]]) -> list[tuple[int, dict]]:
    updates: list[tuple[int, dict]] = []
    for index, event, message in matches:
        updated = dict(event)
        updated["source"] = "gmail_sent"
        updated["thread_ref"] = message["thread_id"] or event.get("thread_ref", "")
        updated["message_text"] = message["body"]
        updated["summary"] = event.get("summary") or "Iris sent an email reply"
        updated["status"] = event.get("status") or "sent"
        updates.append((index, updated))
    return updates


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill historical sent email bodies into conversation_events.")
    parser.add_argument("--query", default="in:sent after:2026/5/17 before:2026/5/31", help="Gmail search query")
    parser.add_argument("--limit", type=int, default=200, help="Maximum sent messages to scan")
    parser.add_argument("--dry-run", action="store_true", help="Print counts without updating Google Sheets")
    args = parser.parse_args()

    load_dotenv()
    spreadsheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not spreadsheet_id:
        print("GOOGLE_SHEET_ID is required")
        return 1

    gmail, sheets = get_gmail_service()
    ensure_workbook_schema(sheets, spreadsheet_id)
    events = read_table(sheets, spreadsheet_id, CONVERSATION_EVENTS_TAB)
    sent_messages = list_sent_messages(gmail, args.query, args.limit)
    matches = match_backfills(events, sent_messages)
    updates = backfill_events(events, matches)

    if not args.dry_run:
        for index, row in updates:
            update_row(sheets, spreadsheet_id, CONVERSATION_EVENTS_TAB, index + 2, CONVERSATION_EVENTS_HEADERS, row)

    eligible_count = sum(1 for event in events if eligible_event(event))
    html_count = sum(1 for _, _, message in matches if message["body_type"] == "html")
    print(
        f"Scanned {len(sent_messages)} sent messages; "
        f"{eligible_count} placeholder outbound events; "
        f"{len(updates)} matched; "
        f"{html_count} html bodies; "
        f"{'no changes made' if args.dry_run else 'updated Google Sheets'}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
