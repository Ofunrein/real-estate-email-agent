import base64
import email as email_lib
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests
from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import anthropic

from core.event_logger import (
    append_conversation_event,
    build_conversation_event,
    build_lead_memory_update,
    upsert_lead_memory,
)
from core.sheet_schema import PROPERTIES_HEADERS, PROPERTIES_TAB

load_dotenv()

# ── Logging setup ─────────────────────────────────────────────────────────────

LOG_FILE = "agent.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)


def _timed_request(method: str, url: str, label: str, **kwargs) -> requests.Response | None:
    """Wrapper for all outbound HTTP calls — logs URL, status, elapsed ms."""
    t0 = time.time()
    try:
        resp = requests.request(method, url, **kwargs)
        elapsed = int((time.time() - t0) * 1000)
        log.info("HTTP %s %s [%s] → %d (%dms)", method.upper(), label, url, resp.status_code, elapsed)
        if resp.status_code >= 400:
            log.warning("HTTP error body: %s", resp.text[:300])
        return resp
    except Exception as exc:
        elapsed = int((time.time() - t0) * 1000)
        log.error("HTTP %s %s [%s] → FAILED (%dms): %s", method.upper(), label, url, elapsed, exc)
        return None


# ── Config ────────────────────────────────────────────────────────────────────

CREDENTIALS_PATH = os.getenv("GMAIL_CREDENTIALS_PATH", "credentials.json")
TOKEN_PATH = os.getenv("GMAIL_TOKEN_PATH", "token.json")
SHEET_ID = os.getenv("GOOGLE_SHEET_ID", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
RENTCAST_API_KEY = os.getenv("RENTCAST_API_KEY", "")
CALENDLY_URL = os.getenv("CALENDLY_URL", "")
FILLOUT_VALUATION_URL = os.getenv("FILLOUT_VALUATION_URL", "")
APIFY_TOKEN = os.getenv("APIFY_TOKEN", "[REDACTED]")
APIFY_SOLD_COMPS_ACTOR_ID = os.getenv("APIFY_SOLD_COMPS_ACTOR_ID", "")
SOLD_COMPS_MAX_RESULTS = max(0, min(2, int(os.getenv("SOLD_COMPS_MAX_RESULTS", "2"))))
TEAM_NAME = os.getenv("TEAM_NAME", "Austin Realty")
TEAM_LEAD_EMAIL = os.getenv("TEAM_LEAD_EMAIL", "")
PROPERTY_MANAGER_EMAIL = os.getenv("PROPERTY_MANAGER_EMAIL", "")
HUBSPOT_API_KEY = os.getenv("HUBSPOT_ACCESS_TOKEN") or os.getenv("HUBSPOT_API_KEY", "")
FRED_API_KEY = os.getenv("FRED_API_KEY", "")
CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_FROM = os.getenv("TWILIO_FROM", "")
AGENT_PHONE = os.getenv("AGENT_PHONE", "")
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL_SECONDS", "60"))
ENABLE_SIMILAR_HOMES = os.getenv("ENABLE_SIMILAR_HOMES", "false").strip().lower() in {"1", "true", "yes", "on"}
ENABLE_EMAIL_AGENT = os.getenv("ENABLE_EMAIL_AGENT", "true").strip().lower() in {"1", "true", "yes", "on"}
SIMILAR_HOMES_MAX = max(0, min(6, int(os.getenv("SIMILAR_HOMES_MAX", "3"))))
SIMILAR_HOMES_PRICE_VARIANCE = max(0.05, min(1.0, float(os.getenv("SIMILAR_HOMES_PRICE_VARIANCE", "0.25"))))
STATE_FILE = "state.json"
GOOGLE_RETRY_ATTEMPTS = int(os.getenv("GOOGLE_RETRY_ATTEMPTS", "4"))
CLAUDE_RETRY_ATTEMPTS = int(os.getenv("CLAUDE_RETRY_ATTEMPTS", "5"))
RETRY_BASE_SECONDS = float(os.getenv("RETRY_BASE_SECONDS", "2"))
RETRY_MAX_SECONDS = float(os.getenv("RETRY_MAX_SECONDS", "60"))
TRANSIENT_HTTP_STATUS = {408, 429, 500, 502, 503, 504, 529}

FOLLOWUP_DAY3_HOURS = 72    # first follow-up
FOLLOWUP_DAY7_HOURS = 168   # last-touch before cold

# Claude models: cheap haiku for classification, sonnet for full responses
CLAUDE_CLASSIFY = "claude-haiku-4-5"
CLAUDE_RESPOND  = "claude-sonnet-4-6"

VALID_INTENTS = {
    "property_search",
    "property_details",
    "showing_request",
    "seller_lead",
    "buyer_lead",
    "renter_lead",
    "human_required",
    "spam",
}

ROLE_TO_INTENT = {
    "buyer": "buyer_lead",
    "first_time_buyer": "buyer_lead",
    "second_time_buyer": "buyer_lead",
    "seller": "seller_lead",
    "expired_listing_seller": "seller_lead",
    "renter": "renter_lead",
    "landlord": "renter_lead",
    "property_management_lead": "renter_lead",
    "investor": "buyer_lead",
    "open_house_lead": "buyer_lead",
    "mortgage_adjacent_lead": "human_required",
}

SENSITIVE_FLAGS = {
    "fair_housing",
    "mortgage_license",
    "legal",
    "contract_terms",
    "angry_or_complaint",
    "privacy",
    "broker_approval",
}

STOP_OUTREACH_PATTERNS = [
    r"\bunsubscribe\b",
    r"\bdo not contact\b",
    r"\bdon't contact\b",
    r"\bremove me\b",
    r"\bstop contacting\b",
    r"\bstop emailing\b",
]

CLEAR_NO_PATTERNS = [
    r"\bnot interested\b",
    r"\bno thanks\b",
    r"\bno thank you\b",
    r"\bstop asking\b",
    r"\bi only want to rent\b",
    r"\bonly looking to rent\b",
    r"\bi do not want to sell\b",
    r"\bi don't want to sell\b",
    r"\balready have a lender\b",
    r"\bjust browsing\b",
]

# ── Knowledge base (FAQ baked in — no file dependency) ────────────────────────

FAQ_CONTENT = """
Austin Realty — Agent Knowledge Base

Address: 4301 Westbank Drive, Suite 120, Austin, TX 78746
Hours: Mon–Fri 8am–7pm | Sat 9am–5pm | Sun 11am–4pm
Phone: (512) 555-0192 | Email: info@austinrealty.com

We are a full-service brokerage covering Austin, Round Rock, Cedar Park, Georgetown,
Pflugerville, Buda, Kyle, Lakeway and the surrounding Hill Country.

BUYING: Buyer representation is covered by seller's commission — free to buyers.
Pre-approval recommended. Close in 30–45 days (conventional) or 21–30 days (cash).

SELLING: Listing commission 2.5–3%. Includes photography, 3D tour, MLS, social media,
open houses, full negotiation. Free home valuation — reply with address or complete our
property appraisal form: """ + (FILLOUT_VALUATION_URL or "https://lumenosis.fillout.com/t/uVsRftdUNFus") + """

RENTALS: Property management 8–10% monthly. Tenant placement 50% first month's rent.

SHOWINGS: Free, no obligation. 2–4 hrs notice for occupied homes, same-day for vacant.
3D Matterport tours available for all listings. Book: """ + CALENDLY_URL + """

NEIGHBORHOODS (median prices): Zilker/South Congress $700–800K | East Austin $600K |
Hyde Park $550K | Circle C Ranch $650K | Mueller $700K | Round Rock/Cedar Park $400–550K |
Buda/Kyle $350–450K

MARKET: Balanced-to-buyer-friendly market. Median Austin metro price ~$485K.
Avg DOM 35–50 days. Well-priced homes in hot areas go under contract in <10 days.

FINANCING: Partners available for conventional (3–20% down), FHA (3.5%), VA (0%),
jumbo (10–20%). Min credit score: 580 FHA / 620 conventional.

INVESTORS: Off-market deals, STR properties, portfolio building. Ask about investor consultation.
NEW CONSTRUCTION: KB Home, David Weekley, Taylor Morrison, Toll Brothers.
"""

FAQ_CONTEXT = f"\n\nAgency Knowledge Base:\n{FAQ_CONTENT}"

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/spreadsheets",
]

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
_rentcast_cache: dict = {}
_apify_cache:   dict = {}
_rates_cache: dict = {}
_hubspot_disabled = False


class TransientServiceError(RuntimeError):
    """External service failed in a way that should be retried on a later poll."""


def _retry_delay(attempt: int) -> float:
    return min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * (2 ** (attempt - 1)))


def _google_error_status(exc: Exception) -> int | None:
    if isinstance(exc, HttpError) and getattr(exc, "resp", None):
        return getattr(exc.resp, "status", None)
    return None


def _is_transient_google_error(exc: Exception) -> bool:
    status = _google_error_status(exc)
    if status in TRANSIENT_HTTP_STATUS:
        return True
    return isinstance(exc, (OSError, TimeoutError))


def _google_execute(request, label: str):
    for attempt in range(1, GOOGLE_RETRY_ATTEMPTS + 1):
        try:
            return request.execute()
        except Exception as exc:
            if not _is_transient_google_error(exc):
                raise
            if attempt == GOOGLE_RETRY_ATTEMPTS:
                raise TransientServiceError(f"{label} failed after retries: {exc}") from exc
            delay = _retry_delay(attempt)
            status = _google_error_status(exc)
            status_msg = f" status={status}" if status else ""
            log.warning("%s transient Google error%s: %s; retry %d/%d in %.1fs",
                        label, status_msg, exc, attempt + 1, GOOGLE_RETRY_ATTEMPTS, delay)
            time.sleep(delay)


def _is_transient_claude_error(exc: Exception) -> bool:
    if isinstance(exc, (anthropic.APIConnectionError, anthropic.APITimeoutError, anthropic.RateLimitError)):
        return True
    if isinstance(exc, anthropic.APIStatusError):
        return getattr(exc, "status_code", None) in TRANSIENT_HTTP_STATUS
    return False

def get_mortgage_rates() -> dict:
    """Fetch current 30yr and 15yr fixed mortgage rates from FRED. Cached 24hrs."""
    now = time.time()
    if _rates_cache.get("ts") and now - _rates_cache["ts"] < 86400:
        log.info("FRED rates — cache hit (age %.0fmin)", (now - _rates_cache["ts"]) / 60)
        return _rates_cache["data"]
    rates = {}
    series = {"rate_30yr": "MORTGAGE30US", "rate_15yr": "MORTGAGE15US"}
    for key, series_id in series.items():
        try:
            params = {
                "series_id": series_id,
                "api_key": FRED_API_KEY or "abcdefghijklmnopqrstuvwxyz012345",
                "file_type": "json",
                "limit": 1,
                "sort_order": "desc"
            }
            r = _timed_request("GET", "https://api.stlouisfed.org/fred/series/observations",
                               f"FRED/{series_id}", params=params, timeout=5)
            if r and r.status_code == 200:
                obs = r.json().get("observations", [])
                if obs:
                    rates[key] = obs[0]["value"]
                    log.info("FRED %s = %s%%", series_id, obs[0]["value"])
        except Exception as exc:
            log.error("FRED %s error: %s", series_id, exc)
    _rates_cache["data"] = rates
    _rates_cache["ts"] = now
    return rates


_census_cache: dict = {}

def get_neighborhood_stats(zipcode: str) -> dict:
    """Fetch median household income and population for a ZIP from Census ACS."""
    if not zipcode or zipcode in _census_cache:
        if zipcode in _census_cache:
            log.info("Census ZIP %s — cache hit", zipcode)
        return _census_cache.get(zipcode, {})
    if not CENSUS_API_KEY:
        log.info("Census ZIP %s — skipped (no CENSUS_API_KEY)", zipcode)
        _census_cache[zipcode] = {}
        return {}
    try:
        params = {
            "get": "B19013_001E,B01003_001E",
            "for": f"zip code tabulation area:{zipcode}",
            "key": CENSUS_API_KEY
        }
        r = _timed_request("GET", "https://api.census.gov/data/2022/acs/acs5",
                           f"Census/ZIP:{zipcode}", params=params, timeout=5)
        if r and r.status_code == 200:
            content_type = r.headers.get("content-type", "")
            if "json" not in content_type.lower():
                log.warning("Census ZIP %s — non-JSON response; check CENSUS_API_KEY (%s)",
                            zipcode, r.text[:80].strip().replace("\n", " "))
                _census_cache[zipcode] = {}
                return {}
            data = r.json()
            if len(data) > 1:
                median_income = data[1][0]
                population = data[1][1]
                result = {
                    "median_income": f"${int(median_income):,}" if median_income and median_income != "-666666666" else None,
                    "population": f"{int(population):,}" if population else None
                }
                log.info("Census ZIP %s — income=%s pop=%s", zipcode, result.get("median_income"), result.get("population"))
                _census_cache[zipcode] = result
                return result
    except Exception as exc:
        log.error("Census ZIP %s error: %s", zipcode, exc)
    _census_cache[zipcode] = {}
    return {}


_sold_comps_cache: dict = {}
_SOLD_COMP_TERMS = [
    "good price", "good deal", "bad deal", "overpriced", "underpriced",
    "price fair", "fair price", "worth it", "market value", "appraised value",
    "comps", "comparable", "nearby sales", "sold nearby", "recent sales",
    "how does it compare", "compare to", "price compare", "value compare",
]


def should_fetch_sold_comps(intent: str, addresses: list[str], body: str,
                            listing: dict, zipcode: str) -> bool:
    """Hard gate paid sold-comps calls to explicit price/value questions."""
    if intent != "property_details":
        return False
    if len(addresses) != 1:
        return False
    if not APIFY_TOKEN or not APIFY_SOLD_COMPS_ACTOR_ID or SOLD_COMPS_MAX_RESULTS < 1:
        return False
    if not zipcode or not listing.get("price"):
        return False
    body_l = (body or "").lower()
    return any(term in body_l for term in _SOLD_COMP_TERMS)


def _comp_value(item: dict, *keys: str) -> str:
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def get_sold_comps(zipcode: str) -> list[dict]:
    """Fetch at most SOLD_COMPS_MAX_RESULTS recently sold Zillow comps."""
    if zipcode in _sold_comps_cache:
        log.info("Sold comps ZIP %s — cache hit", zipcode)
        return _sold_comps_cache[zipcode]
    if not APIFY_TOKEN or not APIFY_SOLD_COMPS_ACTOR_ID or SOLD_COMPS_MAX_RESULTS < 1:
        return []

    payload = {
        "search": zipcode,
        "mode": "SOLD",
        "maxItems": SOLD_COMPS_MAX_RESULTS,
        "scrapeDetails": False,
    }
    log.info("Sold comps — fetching ZIP %s max=%d", zipcode, SOLD_COMPS_MAX_RESULTS)
    try:
        r = _timed_request(
            "POST",
            f"https://api.apify.com/v2/acts/{APIFY_SOLD_COMPS_ACTOR_ID}/run-sync-get-dataset-items"
            f"?token={APIFY_TOKEN}&timeout=60&memory=512",
            f"Apify/{APIFY_SOLD_COMPS_ACTOR_ID}/sold/{zipcode}",
            json=payload,
            timeout=90,
        )
        if r and r.status_code in (200, 201):
            items = r.json()[:SOLD_COMPS_MAX_RESULTS]
            comps = []
            for item in items:
                comps.append({
                    "address": _comp_value(item, "address", "streetAddress", "formattedAddress"),
                    "price": _comp_value(item, "price", "soldPrice", "unformattedPrice"),
                    "beds": _comp_value(item, "beds", "bedrooms"),
                    "baths": _comp_value(item, "baths", "bathrooms"),
                    "sqft": _comp_value(item, "livingArea", "sqft", "area"),
                    "sold_date": _comp_value(item, "dateSold", "soldDate", "soldOn"),
                })
            if comps:
                cost = len(comps) * _APIFY_COST_PER_RESULT["crawlerbros/zillow-sold-comps"]
                _log_cost("apify", cost, f"crawlerbros/zillow-sold-comps x{len(comps)}")
            log.info("Sold comps — got %d result(s) for ZIP %s", len(comps), zipcode)
            _sold_comps_cache[zipcode] = comps
            return comps
    except Exception as exc:
        log.error("Sold comps error for ZIP %s: %s", zipcode, exc)
    _sold_comps_cache[zipcode] = []
    return []


def hubspot_upsert_contact(email: str, name: str, intent: str,
                            budget: str, timeline: str, area: str,
                            assigned_agent: str) -> str:
    """Create or update a HubSpot contact. Returns contact ID or empty string."""
    global _hubspot_disabled
    if _hubspot_disabled:
        log.info("HubSpot upsert — skipped (disabled after auth failure)")
        return ""
    if not HUBSPOT_API_KEY or not email:
        log.info("HubSpot upsert — skipped (no API key or email)")
        return ""
    parsed_name, parsed_email = email_lib.utils.parseaddr(email)
    if parsed_email:
        email = parsed_email.lower()
        if not name and parsed_name:
            name = parsed_name
    score = "cold"
    if timeline:
        t = timeline.lower()
        if any(w in t for w in ["now", "asap", "immediately", "30 days", "this month", "week"]):
            score = "hot"
        elif any(w in t for w in ["1 month", "2 month", "3 month", "soon", "quarter"]):
            score = "warm"
    # SMS alert to agent on hot lead
    if score == "hot" and AGENT_PHONE:
        sms_body = f"HOT LEAD — {intent} from {email}. Budget: {budget or '?'}, Timeline: {timeline or '?'}, Area: {area or '?'}. Check Gmail now."
        send_sms(AGENT_PHONE, sms_body)
    first, *rest = (name.strip().split(" ") if name else ["", ""])
    last = " ".join(rest) if rest else ""
    headers = {"Authorization": f"Bearer {HUBSPOT_API_KEY}", "Content-Type": "application/json"}
    properties = {
        "email": email, "firstname": first, "lastname": last,
        "hs_lead_status": score.upper(), "notes_last_contacted": intent,
    }
    if budget:
        properties["annualrevenue"] = re.sub(r"[^\d]", "", budget)
    log.info("HubSpot upsert — email=%s intent=%s score=%s assigned=%s", email, intent, score, assigned_agent)
    try:
        search_r = _timed_request(
            "POST", "https://api.hubapi.com/crm/v3/objects/contacts/search",
            "HubSpot/contacts/search",
            headers=headers,
            json={"filterGroups": [{"filters": [{"propertyName": "email", "operator": "EQ", "value": email}]}]},
            timeout=5
        )
        if search_r and search_r.status_code in (401, 403):
            _hubspot_disabled = True
            log.warning("HubSpot upsert — disabled for this run after auth failure; update HUBSPOT_API_KEY")
            return ""
        if search_r and search_r.status_code == 200:
            results = search_r.json().get("results", [])
            if results:
                contact_id = results[0]["id"]
                log.info("HubSpot — updating existing contact %s", contact_id)
                _timed_request("PATCH", f"https://api.hubapi.com/crm/v3/objects/contacts/{contact_id}",
                               f"HubSpot/contacts/{contact_id}/patch",
                               headers=headers, json={"properties": properties}, timeout=5)
                return contact_id
        create_r = _timed_request("POST", "https://api.hubapi.com/crm/v3/objects/contacts",
                                   "HubSpot/contacts/create",
                                   headers=headers, json={"properties": properties}, timeout=5)
        if create_r and create_r.status_code in (401, 403):
            _hubspot_disabled = True
            log.warning("HubSpot create — disabled for this run after auth failure; update HUBSPOT_API_KEY")
            return ""
        if create_r and create_r.status_code in (200, 201):
            contact_id = create_r.json().get("id", "")
            log.info("HubSpot — created contact %s for %s", contact_id, email)
            return contact_id
    except Exception as exc:
        log.error("HubSpot upsert error for %s: %s", email, exc)
    return ""


def hubspot_add_note(contact_id: str, note_body: str):
    """Add a note to a HubSpot contact."""
    if _hubspot_disabled or not HUBSPOT_API_KEY or not contact_id:
        return
    log.info("HubSpot note — adding to contact %s (%d chars)", contact_id, len(note_body))
    try:
        headers = {"Authorization": f"Bearer {HUBSPOT_API_KEY}", "Content-Type": "application/json"}
        note_r = _timed_request(
            "POST", "https://api.hubapi.com/crm/v3/objects/notes",
            f"HubSpot/notes/create",
            headers=headers,
            json={"properties": {"hs_note_body": note_body[:3000], "hs_timestamp": str(int(time.time() * 1000))}},
            timeout=5
        )
        if note_r and note_r.status_code in (200, 201):
            note_id = note_r.json().get("id", "")
            if note_id:
                _timed_request(
                    "PUT",
                    f"https://api.hubapi.com/crm/v3/objects/notes/{note_id}/associations/contacts/{contact_id}/note_to_contact",
                    f"HubSpot/notes/{note_id}/associate/{contact_id}",
                    headers=headers, timeout=5
                )
                log.info("HubSpot note %s associated to contact %s", note_id, contact_id)
    except Exception as exc:
        log.error("HubSpot note error for contact %s: %s", contact_id, exc)


# ── SMS (Twilio) ──────────────────────────────────────────────────────────────

def send_sms(to: str, body: str):
    if not TWILIO_SID or not TWILIO_TOKEN or not TWILIO_FROM or not to:
        log.info("SMS — skipped (Twilio not configured)")
        return
    log.info("SMS → %s: %s", to, body[:80])
    r = _timed_request(
        "POST",
        f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Messages.json",
        "Twilio/SMS",
        auth=(TWILIO_SID, TWILIO_TOKEN),
        data={"From": TWILIO_FROM, "To": to, "Body": body},
        timeout=10,
    )
    if r and r.status_code == 201:
        log.info("SMS delivered — sid=%s", r.json().get("sid", ""))
    elif r:
        log.error("SMS failed — status=%d body=%s", r.status_code, r.text[:200])


# ── Follow-up sequences ───────────────────────────────────────────────────────

FOLLOWUP_DAY3_PROMPT = """You are a real estate agent at Austin Realty sending a brief follow-up to a lead who hasn't replied in 3 days.
Lead type: {lead_type}. Known info: {known}.
Write 2 sentences max. Friendly, not pushy. No emojis, no em-dashes.
Reference something specific to their situation if known info is available.
Do NOT include a signature. Return plain text only."""

FOLLOWUP_DAY7_PROMPT = """You are a real estate agent at Austin Realty sending a final follow-up to a lead who hasn't replied in 7 days.
Lead type: {lead_type}. Known info: {known}.
Write 1-2 sentences. Keep the door open without being pushy. No emojis, no em-dashes.
Do NOT include a signature. Return plain text only."""

SIG_HTML = '<p style="margin-top:20px;color:#555">Best regards,<br><strong>Austin Realty</strong><br>(512) 555-0192</p>'
SIG_TEXT = "\n\nBest regards,\nAustin Realty\n(512) 555-0192"


def check_followups(gmail, state: dict, my_email: str):
    """Scan lead_state for threads needing a day-3 or day-7 follow-up."""
    now = time.time()
    for thread_id, lead in list(state.get("lead_state", {}).items()):
        last_ts = lead.get("last_contact_ts")
        if not last_ts:
            continue
        _, lead_addr = _sender_parts(lead.get("lead_email", ""))
        memory = state.get("lead_memory", {}).get(lead_addr) if lead_addr else None
        if memory and (memory.get("do_not_contact") or memory.get("no_count", 0) >= 3):
            lead["cold"] = True
            log.info("Follow-up skipped — lead stopped or no_count reached (%s)", lead_addr)
            continue
        hours_elapsed = (now - last_ts) / 3600
        fu1_sent = lead.get("followup1_sent", False)
        fu2_sent = lead.get("followup2_sent", False)
        cold = lead.get("cold", False)

        if cold:
            continue

        send_day = None
        if not fu1_sent and hours_elapsed >= FOLLOWUP_DAY3_HOURS:
            send_day = 3
        elif fu1_sent and not fu2_sent and hours_elapsed >= FOLLOWUP_DAY7_HOURS:
            send_day = 7

        if not send_day:
            continue

        to_email = lead.get("lead_email", "")
        subject = lead.get("subject", "Following up")
        lead_type = lead.get("intent", "lead").replace("_lead", "")
        collected = lead.get("collected", {})
        known = ", ".join(f"{k}={v}" for k, v in collected.items() if v)
        prompt = FOLLOWUP_DAY3_PROMPT if send_day == 3 else FOLLOWUP_DAY7_PROMPT

        log.info("Follow-up day-%d — thread=%s to=%s", send_day, thread_id, to_email)
        body_text = _claude(CLAUDE_RESPOND, prompt.format(lead_type=lead_type, known=known or "none"), "Write the follow-up.")
        body_html = "<p>" + body_text.replace("\n\n", "</p><p>").replace("\n", "<br>") + "</p>" + SIG_HTML
        body_text += SIG_TEXT

        fake_parsed = {
            "id": f"followup_{thread_id}_{send_day}",
            "thread_id": thread_id,
            "from": to_email,
            "subject": subject,
            "message_id_header": lead.get("last_message_id", ""),
            "references": lead.get("references", ""),
        }
        try:
            send_reply(gmail, fake_parsed, body_html, body_text)
            if send_day == 3:
                lead["followup1_sent"] = True
                lead["last_contact_ts"] = now
                log.info("Follow-up day-3 sent to %s", to_email)
            else:
                lead["followup2_sent"] = True
                lead["cold"] = True
                lead["last_contact_ts"] = now
                log.info("Follow-up day-7 sent to %s — marking cold", to_email)
        except Exception as exc:
            log.error("Follow-up send failed for %s: %s", to_email, exc)


# ── Live Zillow search (Apify) ────────────────────────────────────────────────

def apify_zillow_search(area: str, max_price: int = None, min_beds: int = None, limit: int = 8) -> list[dict]:
    """Search Zillow via truefetch/zillow-property-listing (location string, not URL — bypasses 403)."""
    if not APIFY_TOKEN:
        return []

    # Normalize location: "Round Rock" → "Round Rock, TX"
    location = area.strip()
    if not any(s in location for s in [", TX", ", Texas", "Texas"]):
        location = f"{location}, TX"

    # Fetch more than needed so we can filter client-side for beds/price
    fetch_count = max(20, limit * 3)
    log.info("Zillow search — area=%s beds=%s max_price=%s", area, min_beds, max_price)
    r = _timed_request(
        "POST",
        f"https://api.apify.com/v2/acts/truefetch~zillow-property-listing/run-sync-get-dataset-items"
        f"?token={APIFY_TOKEN}&timeout=120&memory=1024",
        f"Apify/zillow-property-listing/{location}",
        json={"location": location, "listing_type": "for_sale",
              "max_results": fetch_count, "property_type": ["houses", "townhomes", "condos/co_ops"]},
        timeout=150,
    )
    if not r or r.status_code not in (200, 201):
        return []

    items = r.json()
    if items:
        cost = 0.01 + len(items) * 0.00183
        _log_cost("apify", cost, f"truefetch/zillow-property-listing x{len(items)}")

    # Filter by beds and price client-side
    results = []
    for item in items:
        price = item.get("list_price") or 0
        beds = item.get("beds") or 0
        if max_price and price and price > max_price:
            continue
        if min_beds and beds and int(beds) < min_beds:
            continue
        results.append({
            "address": item.get("address", ""),
            "city": item.get("city", area),
            "state": item.get("state", "TX"),
            "zip": item.get("zip_code", ""),
            "price": str(price),
            "beds": str(beds),
            "baths": str(item.get("baths_full") or ""),
            "sqft": str(item.get("sqft") or ""),
            "status": "Active",
            "listing_url": item.get("property_url", ""),
            "photo_url": item.get("primary_photo", ""),
            "description": item.get("agent_broker", ""),
        })
        if len(results) >= limit:
            break

    log.info("Zillow search — %d/%d results matched criteria for %s", len(results), len(items), area)
    return results


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            s = json.load(f)
        s.setdefault("replied_ids", [])
        s.setdefault("lead_state", {})
        s.setdefault("lead_memory", {})
        return s
    ts = datetime.now(timezone.utc).isoformat()
    state = {"startup_ts": ts, "replied_ids": [], "lead_state": {}, "lead_memory": {}}
    save_state(state)
    print(f"Agent started. Monitoring new emails from {ts}")
    return state


def save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)

# ── Gmail auth ────────────────────────────────────────────────────────────────

def get_gmail_service():
    creds = None
    if os.path.exists(TOKEN_PATH):
        creds = Credentials.from_authorized_user_file(TOKEN_PATH, GMAIL_SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_PATH, GMAIL_SCOPES)
            creds = flow.run_local_server(port=8080)
        with open(TOKEN_PATH, "w") as f:
            f.write(creds.to_json())
    return build("gmail", "v1", credentials=creds), build("sheets", "v4", credentials=creds)

# ── Gmail helpers ─────────────────────────────────────────────────────────────

def get_my_email(gmail) -> str:
    profile = _google_execute(gmail.users().getProfile(userId="me"), "Gmail profile")
    return profile["emailAddress"].lower()


def ts_to_epoch(iso_ts: str) -> int:
    dt = datetime.fromisoformat(iso_ts)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def get_new_messages(gmail, since_ts: str, my_email: str) -> list[dict]:
    epoch = ts_to_epoch(since_ts)
    query = f"after:{epoch} -from:{my_email}"
    result = _google_execute(gmail.users().messages().list(userId="me", q=query), "Gmail message list")
    messages = result.get("messages", [])
    full = []
    for m in messages:
        msg = _google_execute(
            gmail.users().messages().get(userId="me", id=m["id"], format="full"),
            f"Gmail message get {m['id']}",
        )
        full.append(msg)
    return full


def _payload_text_plain(payload: dict) -> str:
    if payload.get("mimeType") == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
    for part in payload.get("parts", []) or []:
        text = _payload_text_plain(part)
        if text:
            return text
    return ""


def parse_message(msg: dict) -> dict:
    headers = {h["name"].lower(): h["value"] for h in msg["payload"]["headers"]}
    body = _payload_text_plain(msg["payload"])
    return {
        "id": msg["id"],
        "thread_id": msg["threadId"],
        "from": headers.get("from", ""),
        "subject": headers.get("subject", ""),
        "message_id_header": headers.get("message-id", ""),
        "references": headers.get("references", ""),
        "body": body.strip(),
    }


def get_thread_context(gmail, thread_id: str, current_msg_id: str, limit: int = 4) -> str:
    """Return recent prior thread text so short replies can keep context."""
    if not thread_id:
        return ""
    try:
        thread = _google_execute(
            gmail.users().threads().get(userId="me", id=thread_id, format="full"),
            f"Gmail thread get {thread_id}",
        )
        snippets = []
        for msg in thread.get("messages", []):
            if msg.get("id") == current_msg_id:
                continue
            parsed = parse_message(msg)
            body = re.sub(r"\s+", " ", parsed.get("body", "")).strip()
            if body:
                snippets.append(f"From: {parsed.get('from', '')}\nSubject: {parsed.get('subject', '')}\nBody: {body[:700]}")
        return "\n\n---\n\n".join(snippets[-limit:])
    except Exception as exc:
        log.warning("Thread context unavailable for %s: %s", thread_id, exc)
        return ""


def send_reply(gmail, parsed: dict, html_body: str, text_body: str):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Re: " + parsed["subject"].lstrip("Re: ").lstrip("RE: ")
    msg["From"] = "me"
    msg["To"] = parsed["from"]
    msg["In-Reply-To"] = parsed["message_id_header"]
    refs = parsed["references"] + " " + parsed["message_id_header"] if parsed["references"] else parsed["message_id_header"]
    msg["References"] = refs.strip()
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    log.info("Gmail send — to=%s subject='%s'", parsed["from"], msg["Subject"])
    _google_execute(
        gmail.users().messages().send(
            userId="me",
            body={"raw": raw, "threadId": parsed["thread_id"]}
        ),
        f"Gmail send {parsed['id']}",
    )
    log.info("Gmail send — delivered")


_label_id_cache: dict = {}

def apply_labels(gmail, msg_id: str, label_names: list[str]):
    label_ids = []
    for name in label_names:
        if name not in _label_id_cache:
            existing = _google_execute(gmail.users().labels().list(userId="me"), "Gmail labels list").get("labels", [])
            existing_map = {l["name"]: l["id"] for l in existing}
            if name in existing_map:
                _label_id_cache[name] = existing_map[name]
            else:
                created = _google_execute(
                    gmail.users().labels().create(
                        userId="me",
                        body={"name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show"}
                    ),
                    f"Gmail label create {name}",
                )
                _label_id_cache[name] = created["id"]
                log.info("Gmail label created — '%s' (id=%s)", name, created["id"])
        label_ids.append(_label_id_cache[name])
    if label_ids:
        _google_execute(
            gmail.users().messages().modify(
                userId="me",
                id=msg_id,
                body={"addLabelIds": label_ids}
            ),
            f"Gmail label apply {msg_id}",
        )
        log.info("Gmail label applied — msg=%s labels=%s", msg_id, label_names)

# ── Google Sheets ─────────────────────────────────────────────────────────────

def _sheet_header_key(header: str) -> str:
    key = (header or "").lower().strip().replace(" ", "_")
    aliases = {
        "bath": "baths",
        "sq_ft": "sqft",
        "square_feet": "sqft",
        "year_built": "year_built",
    }
    return aliases.get(key, key)


def _get_sheet_headers(sheets) -> list[str]:
    result = _google_execute(
        sheets.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range=f"{PROPERTIES_TAB}!1:1"
        ),
        "Sheets headers get",
    )
    raw_headers = result.get("values", [[]])[0]
    return [_sheet_header_key(h) for h in raw_headers]


def get_listings(sheets) -> list[dict]:
    result = _google_execute(
        sheets.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range=f"{PROPERTIES_TAB}!A:ZZ"
        ),
        "Sheets listings get",
    )
    rows = result.get("values", [])
    if not rows:
        return []
    headers = [_sheet_header_key(h) for h in rows[0]]
    listings = []
    for row in rows[1:]:
        padded = row + [""] * (len(headers) - len(row))
        listings.append(dict(zip(headers, padded)))
    return listings


_ENRICH_PROMPT = """You are a real estate data assistant. Given partial property data, fill in ONLY the missing fields.
Return valid JSON with these keys (use empty string "" for anything you truly can't infer):
description, neighborhood, property_type, features

Rules:
- description: 1-2 factual sentences based on address/type/size/location. No marketing fluff.
- neighborhood: Austin-area neighborhood name based on address/zip (e.g. "South Austin", "Circle C Ranch")
- property_type: one of Single-Family Home, Condo, Townhouse, Multi-Family, Apartment
- features: comma-separated list of likely features (e.g. "Garage, Central Air, Backyard") based on type/beds/sqft
- Do NOT invent price, beds, baths, or sqft — those stay as-is
- Return raw JSON only, no code fences"""


def enrich_missing_fields(listing: dict) -> dict:
    """Use Haiku to fill in description/neighborhood/property_type/features if missing."""
    missing = [k for k in ("description", "neighborhood", "property_type", "features")
               if not listing.get(k)]
    if not missing:
        return listing

    context = (f"Address: {listing.get('address', '')}\n"
               f"City: {listing.get('city', '')}, {listing.get('state', '')} {listing.get('zip', '')}\n"
               f"Price: {listing.get('price', '')}\n"
               f"Beds: {listing.get('beds', '')} | Baths: {listing.get('baths', '')} | Sqft: {listing.get('sqft', '')}\n"
               f"Property type: {listing.get('property_type', '')}\n"
               f"Missing fields to fill: {', '.join(missing)}")

    # Lazy import to avoid circular — _claude defined later but called after module load
    try:
        raw = _claude(CLAUDE_CLASSIFY, _ENRICH_PROMPT, context)
        data = json.loads(raw)
        enriched = dict(listing)
        for key in missing:
            if data.get(key):
                enriched[key] = data[key]
        log.info("AI enrichment — filled: %s for %s", missing, listing.get("address", ""))
        return enriched
    except Exception as exc:
        log.warning("AI enrichment failed for %s: %s", listing.get("address", ""), exc)
        return listing


# Fallback order for local docs; live app appends by the sheet's header row.
_SHEET_COLUMNS = PROPERTIES_HEADERS


def _normalize_address_key(address: str) -> str:
    street = (address or "").split(",", 1)[0].lower()
    street = re.sub(r"\b(street|st)\b", "st", street)
    street = re.sub(r"\b(road|rd)\b", "rd", street)
    street = re.sub(r"\b(avenue|ave)\b", "ave", street)
    street = re.sub(r"\b(trail|trl)\b", "trl", street)
    street = re.sub(r"\b(drive|dr)\b", "dr", street)
    street = re.sub(r"\b(lane|ln)\b", "ln", street)
    street = re.sub(r"\b(court|ct)\b", "ct", street)
    street = re.sub(r"\b(place|pl)\b", "pl", street)
    street = re.sub(r"\b(path)\b", "path", street)
    street = re.sub(r"[^a-z0-9]+", " ", street)
    return re.sub(r"\s+", " ", street).strip()


def _addresses_match(left: str, right: str) -> bool:
    left_key = _normalize_address_key(left)
    right_key = _normalize_address_key(right)
    if not left_key or not right_key:
        return False
    return left_key == right_key or left_key in right_key or right_key in left_key


def _is_missing_value(value) -> bool:
    if value is None:
        return True
    text = str(value).strip().lower()
    return text in ("", "none", "null", "n/a", "na", "unknown", "-")


def _clean_value(value) -> str:
    return "" if _is_missing_value(value) else str(value).strip()


def _parse_int_like(value) -> int | None:
    text = re.sub(r"[^\d]", "", str(value or ""))
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def _parse_price(value) -> float | None:
    text = re.sub(r"[^\d.]", "", str(value or ""))
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def find_similar_homes(source_listing: dict, listings: list[dict], limit: int = None) -> list[dict]:
    limit = SIMILAR_HOMES_MAX if limit is None else max(0, limit)
    if limit < 1:
        return []

    source_address = source_listing.get("address", "")
    source_city = _clean_value(source_listing.get("city")).lower()
    source_zip = _clean_value(source_listing.get("zip"))
    source_price = _parse_price(source_listing.get("price"))
    source_beds = _parse_int_like(source_listing.get("beds"))
    source_baths = _parse_int_like(source_listing.get("baths"))
    source_type = _clean_value(source_listing.get("property_type")).lower()

    price_floor = None
    price_ceiling = None
    if source_price:
        price_floor = source_price * (1 - SIMILAR_HOMES_PRICE_VARIANCE)
        price_ceiling = source_price * (1 + SIMILAR_HOMES_PRICE_VARIANCE)

    ranked = []
    for candidate in listings:
        candidate_address = candidate.get("address", "")
        if not candidate_address or _addresses_match(source_address, candidate_address):
            continue

        status = _clean_value(candidate.get("status")).lower()
        if status and status not in {"active", "for sale"}:
            continue

        candidate_city = _clean_value(candidate.get("city")).lower()
        if source_city and candidate_city and source_city != candidate_city:
            continue

        candidate_price = _parse_price(candidate.get("price"))
        if source_price and candidate_price and (candidate_price < price_floor or candidate_price > price_ceiling):
            continue

        score = 0.0
        if source_city and candidate_city == source_city:
            score += 4
        if source_zip and _clean_value(candidate.get("zip")) == source_zip:
            score += 2

        candidate_beds = _parse_int_like(candidate.get("beds"))
        if source_beds is not None and candidate_beds is not None:
            diff = abs(candidate_beds - source_beds)
            if diff == 0:
                score += 3
            elif diff == 1:
                score += 1.5

        candidate_baths = _parse_int_like(candidate.get("baths"))
        if source_baths is not None and candidate_baths is not None:
            diff = abs(candidate_baths - source_baths)
            if diff == 0:
                score += 2
            elif diff == 1:
                score += 1

        candidate_type = _clean_value(candidate.get("property_type")).lower()
        if source_type and candidate_type and candidate_type == source_type:
            score += 1.5

        if source_price and candidate_price:
            score += max(0, 3 - abs(candidate_price - source_price) / max(source_price * 0.1, 1))

        if score <= 0:
            continue
        ranked.append((score, _listing_quality_score(candidate), candidate))

    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [item[2] for item in ranked[:limit]]


def render_similar_homes_section(similar_homes: list[dict]) -> tuple[str, str]:
    homes = [home for home in (similar_homes or []) if home][:SIMILAR_HOMES_MAX]
    if not homes:
        return "", ""

    card_cells = []
    plain_lines = ["", "Similar homes:"]
    for home in homes:
        address = _clean_value(home.get("address")) or ", ".join(
            part for part in [_clean_value(home.get("city")), _clean_value(home.get("state"))] if part
        )
        price_val = _parse_price(home.get("price"))
        price_fmt = f"${price_val:,.0f}" if price_val is not None else _clean_value(home.get("price"))
        beds = _clean_value(home.get("beds"))
        baths = _clean_value(home.get("baths"))
        listing_url = _clean_value(home.get("listing_url"))
        photo_url = _clean_value(home.get("photo_url") or home.get("photo url"))
        status = _clean_value(home.get("status")) or "For sale"
        facts = "  ".join(part for part in [f"{beds} bd" if beds else "", f"{baths} bth" if baths else ""] if part)
        photo_html = (
            f'<img src="{photo_url}" alt="" style="display:block;width:100%;height:86px;object-fit:cover;'
            f'border-radius:8px;margin-bottom:8px" />'
        ) if photo_url else ""
        price_html = f'<div style="font-size:16px;font-weight:700;color:#ffffff;margin:0 0 6px">{price_fmt}</div>' if price_fmt else ""
        facts_html = f'<div style="font-size:12px;color:#d6d6d6;line-height:1.4">{facts}</div>' if facts else ""
        status_html = (
            '<div style="font-size:12px;color:#8fdb95;margin:0 0 8px">'
            f'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3bb54a;'
            f'margin-right:6px;vertical-align:middle"></span>{status}</div>'
        )
        body_html = (
            f'{photo_html}{status_html}{price_html}{facts_html}'
            f'<div style="font-size:12px;color:#f0f0f0;line-height:1.4;margin-top:8px">{address}</div>'
        )
        if listing_url:
            body_html = f'<a href="{listing_url}" style="text-decoration:none;color:inherit">{body_html}</a>'
        card_cells.append(
            '<td valign="top" width="33.33%" style="padding-right:10px">'
            f'<div style="background:#2f3134;border-radius:10px;padding:10px;min-height:220px">{body_html}</div>'
            '</td>'
        )
        line = f"- {address}"
        if price_fmt:
            line += f" | {price_fmt}"
        if facts:
            line += f" | {facts}"
        if listing_url:
            line += f" | {listing_url}"
        plain_lines.append(line)

    while len(card_cells) < 3:
        card_cells.append('<td valign="top" width="33.33%" style="padding-right:10px"></td>')

    html = f"""
<div style="margin-top:24px;background:#1f2124;border:1px solid #3a3d42;border-radius:12px;padding:16px;color:#ffffff">
<h3 style="margin:0 0 14px;font-size:28px;line-height:1.1;color:#ffffff">Similar homes</h3>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
<tr>
{''.join(card_cells)}
</tr>
</table>
</div>"""
    return html, "\n".join(plain_lines)


def append_property_to_sheet(sheets, listing: dict):
    """Append a newly discovered property to the properties tab."""
    if not SHEET_ID:
        return
    addr = listing.get("address", "").strip()
    addr_key = _normalize_address_key(addr)
    if not addr_key:
        return
    try:
        existing = get_listings(sheets)
        for row in existing:
            if _addresses_match(addr, row.get("address", "")):
                log.info("Sheet append — skipped duplicate %s", addr)
                return
        headers = _get_sheet_headers(sheets) or _SHEET_COLUMNS
        row = [listing.get(col, "") or "" for col in headers]
        _google_execute(
            sheets.spreadsheets().values().append(
                spreadsheetId=SHEET_ID,
                range=f"{PROPERTIES_TAB}!A:ZZ",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": [row]}
            ),
            f"Sheets append {listing.get('address', '')}",
        )
        log.info("Sheet append — added %s to %s", listing.get("address", ""), PROPERTIES_TAB)
    except Exception as exc:
        log.error("Sheet append failed for %s: %s", listing.get("address", ""), exc)


def get_assigned_agent(listing: dict) -> tuple[str, str]:
    """Return (agent_email, agent_name) for a listing, falling back to team lead."""
    email = listing.get("agent_email", "").strip()
    name = listing.get("agent_name", "").strip()
    if not email:
        email = TEAM_LEAD_EMAIL
        name = TEAM_NAME
    return email, name


def notify_agent(gmail, agent_email: str, agent_name: str, lead_email: str,
                 subject: str, intent: str, summary: str):
    """Send a brief lead notification to the assigned agent."""
    if not agent_email or agent_email == get_my_email(gmail):
        return
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"New lead: {subject}"
    msg["From"] = "me"
    msg["To"] = agent_email
    body = f"Hi {agent_name},\n\nNew {intent} lead from {lead_email}.\n\n{summary}\n\nReply to them directly or check Gmail."
    msg.attach(MIMEText(body, "plain"))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        _google_execute(
            gmail.users().messages().send(userId="me", body={"raw": raw}),
            f"Gmail agent notification {lead_email}",
        )
        log.info("Agent notification sent — to=%s intent=%s lead=%s", agent_email, intent, lead_email)
    except Exception as exc:
        log.error("Agent notification failed to %s: %s", agent_email, exc)


def search_listings_by_address(listings: list[dict], query: str) -> list[dict]:
    q = (query or "").lower()
    matches = [l for l in listings
               if _addresses_match(query, l.get("address", ""))
               or (q and q in l.get("city", "").lower())]
    return sorted(matches, key=_listing_quality_score, reverse=True)


def _listing_quality_score(listing: dict) -> int:
    fields = ("beds", "baths", "price", "sqft", "year_built", "photo_url", "listing_url")
    return sum(1 for field in fields if not _is_missing_value(listing.get(field)))


def search_listings_by_criteria(listings: list[dict], beds: int = None, max_price: int = None, status: str = None) -> list[dict]:
    results = []
    for l in listings:
        if status and l.get("status", "").lower() != status.lower():
            continue
        try:
            if beds and int(l.get("beds", 0)) < beds:
                continue
        except ValueError:
            pass
        try:
            price_str = re.sub(r"[^\d.]", "", l.get("price", "0"))
            if max_price and price_str and float(price_str) > max_price:
                continue
        except ValueError:
            pass
        results.append(l)
    return results

# ── Zillow photo scraper ──────────────────────────────────────────────────────

_zillow_photo_cache: dict = {}

def zillow_get_photo(address: str) -> str:
    normalized = address.lower().strip()
    if normalized in _zillow_photo_cache:
        return _zillow_photo_cache[normalized]
    log.info("Zillow direct photo lookup — %s", address)
    try:
        search_url = "https://www.zillow.com/search/GetSearchPageState.htm"
        params = {
            "searchQueryState": json.dumps({
                "pagination": {},
                "isMapVisible": False,
                "mapBounds": {},
                "filterState": {"isForSaleByAgent": {"value": True}},
                "isListVisible": True,
                "mapZoom": 11,
                "customRegionId": None,
                "regionSelection": [{"regionId": None, "regionType": 6}],
                "usersSearchTerm": address,
            }),
            "wants": json.dumps({"cat1": ["listResults"]}),
            "requestId": 1,
        }
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Referer": "https://www.zillow.com/",
        }
        resp = _timed_request("GET", search_url, f"Zillow/photo/{address}",
                               params=params, headers=headers, timeout=10)
        if resp and resp.status_code == 200:
            data = resp.json()
            results = data.get("cat1", {}).get("searchResults", {}).get("listResults", [])
            if results:
                img = results[0].get("imgSrc", "")
                if img:
                    _zillow_photo_cache[normalized] = img
                    log.info("Zillow direct photo found for %s", address)
                    return img
    except Exception as exc:
        log.error("Zillow direct photo error for %s: %s", address, exc)
    _zillow_photo_cache[normalized] = ""
    return ""

# ── Apify Zillow lookup (for properties not in sheet) ─────────────────────────

_apify_cache: dict = {}

def apify_zillow_lookup(address: str) -> dict:
    """Look up any address on Zillow via Apify. Uses maxcopell/zillow-detail-scraper
    as primary ($0.003/result, 97.7% success) with kawsar as fallback ($0.002)."""
    normalized = address.lower().strip()
    if normalized in _apify_cache:
        log.info("Apify Zillow — cache hit for %s", address)
        return _apify_cache[normalized]
    if not APIFY_TOKEN:
        log.warning("Apify Zillow — skipped (no APIFY_TOKEN)")
        return {}

    def _run_actor(actor_id: str, actor_label: str, payload: dict) -> dict:
        r = _timed_request(
            "POST",
            f"https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items"
            f"?token={APIFY_TOKEN}&timeout=60&memory=512",
            f"Apify/{actor_label}",
            json=payload, timeout=90
        )
        if r and r.status_code in (200, 201):
            items = r.json()
            count = len(items)
            log.info("Apify %s — returned %d item(s) for %s", actor_label, count, address)
            if count:
                cost = count * _APIFY_COST_PER_RESULT.get(actor_label, 0.003)
                _log_cost("apify", cost, f"{actor_label} x{count}")
            return items[0] if items else {}
        return {}

    log.info("Apify Zillow lookup — %s", address)

    # Primary: maxcopell/zillow-detail-scraper — accepts addresses
    item = _run_actor("ENK9p4RZHg0iVso52", "maxcopell/zillow-detail-scraper", {"addresses": [address]})

    # Fallback: kawsar/Affordable-Zillow-Details-Scraper
    if not item:
        log.info("Apify primary returned nothing — trying kawsar fallback for %s", address)
        item = _run_actor("kawsar~Affordable-Zillow-Details-Scraper", "kawsar/affordable-zillow",
                          {"address": [address], "maxItems": 1, "requestTimeoutSecs": 25, "timeoutSecs": 55})

    if not item:
        log.warning("Apify Zillow — no results for %s", address)
        _apify_cache[normalized] = {}
        return {}

    # Normalise to the shape the rest of the agent expects
    photos = item.get("responsivePhotos", [])
    real_photos = [p["url"] for p in photos if p.get("url") and "maps.googleapis" not in p["url"]]
    sv_photos   = [p["url"] for p in photos if p.get("url") and "maps.googleapis" in p["url"]]
    # kawsar actor returns imgSrc as a flat string instead of responsivePhotos
    fallback_img = (item.get("imgSrc") or item.get("hiResImageLink") or
                    item.get("desktopWebHdpImageLink") or item.get("image") or
                    item.get("photo") or item.get("primaryPhoto") or "")
    photo_url = real_photos[0] if real_photos else (sv_photos[0] if sv_photos else (fallback_img or ""))
    if photo_url and "maps.googleapis" in photo_url:
        photo_url = photo_url.replace("size=400x300", "size=600x400")

    nb = item.get("nearbyNeighborhoods", [])
    neighborhood = nb[0]["name"] if nb else ""

    ht = item.get("homeType", "")
    type_map = {"SINGLE_FAMILY": "Single-Family Home", "CONDO": "Condo",
                "TOWNHOUSE": "Townhouse", "MULTI_FAMILY": "Multi-Family", "APARTMENT": "Apartment"}
    prop_type = type_map.get(ht, ht.replace("_", " ").title() if ht else "")

    result = {
        "address": item.get("streetAddress", address),
        "city": item.get("city", ""),
        "state": item.get("state", ""),
        "zip": item.get("zipcode", ""),
        "price": str(item.get("price") or ""),
        "beds": str(item.get("bedrooms") or ""),
        "baths": str(item.get("bathrooms") or ""),
        "sqft": str(item.get("livingArea") or item.get("livingAreaValue") or ""),
        "year_built": str(item.get("yearBuilt") or ""),
        "neighborhood": neighborhood,
        "property_type": prop_type,
        "days_on_market": str(item.get("daysOnZillow") or ""),
        "photo_url": photo_url,
        "description": item.get("description", ""),
        "status": item.get("homeStatus", "Active").replace("_", " ").title(),
        "listing_url": f"https://www.zillow.com{item.get('hdpUrl', '')}",
    }
    _apify_cache[normalized] = result
    log.info("Apify Zillow result — %s %s | %s | photo=%s", result['address'], result['city'],
             result['property_type'], "yes" if result['photo_url'] else "no")
    return result


# ── RentCast ──────────────────────────────────────────────────────────────────

def rentcast_lookup(address: str) -> dict:
    normalized = address.lower().strip()
    if normalized in _rentcast_cache:
        log.info("RentCast — cache hit for %s", address)
        return _rentcast_cache[normalized]
    if not RENTCAST_API_KEY:
        log.info("RentCast — skipped (no API key)")
        return {}
    log.info("RentCast lookup — %s", address)
    try:
        resp = _timed_request(
            "GET", "https://api.rentcast.io/v1/properties",
            f"RentCast/properties",
            params={"address": address, "limit": 1},
            headers={"X-Api-Key": RENTCAST_API_KEY},
            timeout=10,
        )
        if resp and resp.status_code == 200:
            data = resp.json()
            result = data[0] if isinstance(data, list) and data else {}
            log.info("RentCast — found %s for %s", "data" if result else "nothing", address)
            _rentcast_cache[normalized] = result
            return result
    except Exception as exc:
        log.error("RentCast error for %s: %s", address, exc)
    _rentcast_cache[normalized] = {}
    return {}

# ── Prompts & LLM ─────────────────────────────────────────────────────────────

CLASSIFY_PROMPT = """You are an assistant for a real estate agency.
Classify the email below into one operational intent and one or more lead roles.
Focus on hidden opportunity capture, emotional state, and safe routing.

Operational intents:
- property_search: asking about available listings, general search
- property_details: asking about a specific property or address
- showing_request: wants to schedule a showing or tour
- seller_lead: wants to sell their property
- buyer_lead: wants to buy a property
- renter_lead: wants to rent a property
- human_required: complaint, legal, complex negotiation, unclear
- spam: irrelevant, promotional, or junk

Lead roles:
- buyer
- seller
- first_time_buyer
- second_time_buyer
- renter
- landlord
- investor
- expired_listing_seller
- open_house_lead
- property_management_lead
- mortgage_adjacent_lead
- unknown

Opportunity tags:
- valuation_interest
- mortgage_interest
- renter_purchase_potential
- sell_before_buy
- high_urgency
- stale_lead
- confused_lead
- angry_lead
- compliance_sensitive
- needs_human_trust

Compliance flags:
- fair_housing
- mortgage_license
- legal
- contract_terms
- angry_or_complaint
- privacy
- broker_approval

Reply ONLY with valid JSON:
{
  "intent": "<intent>",
  "message_intent": "<same as intent unless a more exact intent is needed>",
  "primary_lead_role": "<lead role>",
  "secondary_roles": ["<lead role>"],
  "opportunity_tags": ["<tag>"],
  "tone_state": "neutral|warm|skeptical|price_sensitive|overwhelmed|annoyed|confused|urgent|sensitive",
  "urgency": "low|medium|high|unknown",
  "compliance_flags": ["<flag>"],
  "confidence": 0.0,
  "address": "<first address string or null>",
  "addresses": ["<addr1>", "<addr2>"],
  "lead_fields": {
    "timeline": "<value or null>",
    "budget": "<dollar amount or null>",
    "area": "<city/neighborhood name or null>",
    "beds": "<number or null>",
    "current_property_status": "owns|rents|listed|expired|under_contract|sold|unknown|null",
    "preferred_channel": "email|phone|sms|unknown|null"
  },
  "next_best_question": "<one concise question or null>",
  "recommended_next_action": "reply_and_qualify|send_booking_link|route_human|nurture|stop|review",
  "human_handoff_reason": "<reason or null>"
}

If multiple addresses appear in the email, list ALL of them in "addresses".
If only one address, put it in both "address" and "addresses".
Ask only one next_best_question. If Fair Housing, legal, contract, broker approval,
or mortgage qualification/advice is involved, set intent to human_required and route_human."""

PROPERTY_REPLY_PROMPT = """You are a real estate agent at Austin Realty replying to a property inquiry.
Write 2-3 short conversational paragraphs about the property.

Hard rules:
- Start with "Hello," as the first line (no name needed)
- No emojis, no em-dashes, no bullet points, no bold headers, no markdown, no code fences
- No filler like "thrilled", "fantastic", "wonderful"
- Only state facts you actually have, never invent details
- Keep it under 130 words total
- If sold comps are provided, mention 1-2 naturally
- If mortgage rates are provided, mention them once naturally
- Do NOT include any URLs or links — buttons are added separately
- Last sentence: offer to answer questions or set up a showing
- Do NOT include any signature or sign-off — that is added automatically
- Return raw HTML paragraphs only, nothing else""" + FAQ_CONTEXT

SEARCH_REPLY_PROMPT = """You are a real estate agent at Austin Realty.
Write a plain-text reply listing matching properties. Max 60 words total.

Hard rules:
- Start with a brief friendly greeting
- No emojis, no em-dashes, no marketing language
- 1-2 sentences intro, then the list, done
- Do NOT include any sign-off or signature
- Return plain text only, no markdown""" + FAQ_CONTEXT

LEAD_QUALIFY_PROMPT = """You are a real estate agent assistant for Austin Realty qualifying a lead.
The lead is a {lead_type}. The following fields are still unknown: {missing_fields}.
Tone state: {tone_state}. Opportunity tags: {opportunity_tags}.
Preferred next question: {next_question}.
Write a 1-2 sentence plain-text reply that first acknowledges the lead's situation, then asks AT MOST 1 question.
If a preferred next question is provided, ask that question naturally.
Start with a brief friendly greeting. Do NOT use filler phrases, pressure, or fake personal claims.
Do NOT ask about fields already collected.
Do NOT include any sign-off or signature.
Return ONLY plain text.""" + FAQ_CONTEXT


# ── Cost tracking ─────────────────────────────────────────────────────────────

# Prices per 1M tokens (USD) — update if Anthropic changes pricing
_CLAUDE_PRICING = {
    "claude-haiku-4-5":  {"input": 0.80,  "output": 4.00},
    "claude-sonnet-4-6": {"input": 3.00,  "output": 15.00},
}
# Apify cost per result (USD)
_APIFY_COST_PER_RESULT = {
    "maxcopell/zillow-detail-scraper": 0.003,
    "kawsar/affordable-zillow":        0.002,
    "crawlerbros/zillow-sold-comps":    0.003,
}

_session_cost: dict = {"claude": 0.0, "apify": 0.0, "total": 0.0}


def _log_cost(service: str, amount: float, detail: str = ""):
    _session_cost[service] = _session_cost.get(service, 0.0) + amount
    _session_cost["total"] = _session_cost.get("total", 0.0) + amount
    log.info("COST $%.5f — %s%s | session total $%.4f",
             amount, service, f" ({detail})" if detail else "", _session_cost["total"])


def _claude(model: str, system: str, user: str, max_tokens: int = 512) -> str:
    """Single helper for all Claude calls."""
    # Guard: API rejects empty content blocks
    system = system.strip() or "You are a helpful real estate assistant."
    user = user.strip() or "Please respond."
    t0 = time.time()
    for attempt in range(1, CLAUDE_RETRY_ATTEMPTS + 1):
        try:
            msg = claude.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
            break
        except Exception as exc:
            if not _is_transient_claude_error(exc):
                raise
            if attempt == CLAUDE_RETRY_ATTEMPTS:
                raise TransientServiceError(f"Claude {model} failed after retries: {exc}") from exc
            delay = _retry_delay(attempt)
            status = getattr(exc, "status_code", None)
            status_msg = f" status={status}" if status else ""
            log.warning("Claude %s transient error%s: %s; retry %d/%d in %.1fs",
                        model, status_msg, exc, attempt + 1, CLAUDE_RETRY_ATTEMPTS, delay)
            time.sleep(delay)
    elapsed = int((time.time() - t0) * 1000)
    text = msg.content[0].text.strip()
    in_tok = msg.usage.input_tokens
    out_tok = msg.usage.output_tokens
    pricing = _CLAUDE_PRICING.get(model, {"input": 3.00, "output": 15.00})
    cost = (in_tok * pricing["input"] + out_tok * pricing["output"]) / 1_000_000
    log.info("Claude %s — %d in / %d out tokens (%dms)", model, in_tok, out_tok, elapsed)
    _log_cost("claude", cost, f"{model} {in_tok}in/{out_tok}out")
    text = re.sub(r'^```[a-z]*\n?', '', text)
    text = re.sub(r'\n?```$', '', text)
    return text.strip()


def _sender_parts(sender: str) -> tuple[str, str]:
    name, addr = email_lib.utils.parseaddr(sender or "")
    return name.strip(), addr.lower().strip()


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return [v for v in value if v not in (None, "")]
    if isinstance(value, str):
        return [value] if value.strip() else []
    return [value]


def _merge_unique(existing: list, incoming: list) -> list:
    result = list(existing or [])
    seen = {str(v).lower() for v in result}
    for value in incoming:
        if value in (None, ""):
            continue
        key = str(value).lower()
        if key not in seen:
            result.append(value)
            seen.add(key)
    return result


def _extract_json_dict(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group())
    return {}


def normalize_classification(classification: dict) -> dict:
    classification = classification if isinstance(classification, dict) else {}
    lead_fields = classification.get("lead_fields")
    if not isinstance(lead_fields, dict):
        lead_fields = {}
    for key in ("timeline", "budget", "area", "beds", "current_property_status", "preferred_channel"):
        lead_fields.setdefault(key, None)

    addresses = _as_list(classification.get("addresses"))
    address = classification.get("address")
    if address and address not in addresses:
        addresses.insert(0, address)
    address = addresses[0] if addresses else address

    intent = classification.get("intent") or classification.get("message_intent")
    primary_role = classification.get("primary_lead_role") or "unknown"
    if intent not in VALID_INTENTS:
        intent = ROLE_TO_INTENT.get(primary_role, "human_required")

    message_intent = classification.get("message_intent") or intent
    if message_intent not in VALID_INTENTS:
        message_intent = intent

    confidence = classification.get("confidence", 0.75)
    try:
        confidence = float(confidence)
    except (TypeError, ValueError):
        confidence = 0.75

    return {
        **classification,
        "intent": intent,
        "message_intent": message_intent,
        "primary_lead_role": primary_role,
        "secondary_roles": _as_list(classification.get("secondary_roles")),
        "opportunity_tags": _as_list(classification.get("opportunity_tags")),
        "tone_state": classification.get("tone_state") or "neutral",
        "urgency": classification.get("urgency") or "unknown",
        "compliance_flags": _as_list(classification.get("compliance_flags")),
        "confidence": confidence,
        "address": address,
        "addresses": addresses,
        "lead_fields": lead_fields,
        "next_best_question": classification.get("next_best_question"),
        "recommended_next_action": classification.get("recommended_next_action") or "reply_and_qualify",
        "human_handoff_reason": classification.get("human_handoff_reason"),
    }


def get_lead_memory(state: dict, parsed: dict) -> tuple[str, dict]:
    state.setdefault("lead_memory", {})
    name, addr = _sender_parts(parsed.get("from", ""))
    key = addr or f"thread:{parsed.get('thread_id', '')}"
    now = _iso_now()
    memory = state["lead_memory"].setdefault(key, {
        "created_at": now,
        "lead_source": "email",
        "source_detail": parsed.get("subject", ""),
        "lead_email": addr,
        "lead_name": name,
        "email_thread_ids": [],
        "property_interest": [],
        "lead_role": "unknown",
        "secondary_roles": [],
        "opportunity_tags": [],
        "first_time_buyer": None,
        "second_time_buyer": None,
        "sell_before_buy": None,
        "current_property_status": "unknown",
        "renter_purchase_potential": "unknown",
        "mortgage_interest": "none",
        "valuation_interest": "none",
        "preferred_channel": "email",
        "last_ai_touch_at": None,
        "last_inbound_at": now,
        "no_count": 0,
        "no_message_ids": [],
        "do_not_contact": False,
        "human_handoff_reason": "",
        "assigned_owner": "",
        "next_action": "",
        "lead_fields": {"timeline": None, "budget": None, "area": None, "beds": None},
        "tone_state": "neutral",
        "compliance_flags": [],
        "last_user_message": "",
    })
    if addr:
        memory["lead_email"] = addr
    if name and not memory.get("lead_name"):
        memory["lead_name"] = name
    memory["email_thread_ids"] = _merge_unique(memory.get("email_thread_ids", []), [parsed.get("thread_id", "")])
    memory["last_inbound_at"] = now
    memory["last_user_message"] = (parsed.get("body") or "")[:1000]
    if parsed.get("subject") and not memory.get("source_detail"):
        memory["source_detail"] = parsed["subject"]
    return key, memory


def detect_no_signal(body: str) -> tuple[bool, bool]:
    text = re.sub(r"\s+", " ", (body or "").lower()).strip()
    exact_stop = text in {"stop", "unsubscribe", "remove me"}
    stop = exact_stop or any(re.search(pattern, text) for pattern in STOP_OUTREACH_PATTERNS)
    exact_no = text in {"no", "no.", "no thanks", "no thank you", "nah", "not interested"}
    clear_no = exact_no or any(re.search(pattern, text) for pattern in CLEAR_NO_PATTERNS)
    return clear_no or stop, stop


def detect_compliance_flags(text: str) -> list[str]:
    text_l = re.sub(r"\s+", " ", (text or "").lower())
    flags = []
    if any(term in text_l for term in [
        "safe neighborhood", "good neighborhood for families", "families with kids",
        "people like me", "demographics", "ethnicity", "race", "religion",
        "mostly families", "mostly young", "crime rate",
    ]):
        flags.append("fair_housing")
    if any(term in text_l for term in [
        "do i qualify", "can i qualify", "will i qualify", "get approved",
        "approved for a loan", "what rate can i get", "which loan should",
        "should i choose fha", "nmls",
    ]):
        flags.append("mortgage_license")
    if any(term in text_l for term in [
        "legal advice", "attorney", "lawyer", "lawsuit", "sue", "break my lease",
        "evict", "eviction",
    ]):
        flags.append("legal")
    if any(term in text_l for term in [
        "waive inspection", "contract", "counteroffer", "commission", "buyer agreement",
        "listing agreement", "agency agreement", "representation agreement",
    ]):
        flags.append("contract_terms")
    if any(term in text_l for term in [
        "scam", "fraud", "bait and switch", "report you", "harassment",
        "stop spamming", "spam complaint",
    ]):
        flags.append("angry_or_complaint")
    if any(term in text_l for term in ["social security", "ssn", "bank account", "routing number"]):
        flags.append("privacy")
    return flags


def update_lead_memory(memory: dict, classification: dict, parsed: dict, addresses: list[str]) -> tuple[bool, bool]:
    lead_fields = classification.get("lead_fields", {})
    memory["lead_role"] = classification.get("primary_lead_role") or memory.get("lead_role", "unknown")
    memory["secondary_roles"] = _merge_unique(memory.get("secondary_roles", []), classification.get("secondary_roles", []))
    memory["opportunity_tags"] = _merge_unique(memory.get("opportunity_tags", []), classification.get("opportunity_tags", []))
    memory["property_interest"] = _merge_unique(memory.get("property_interest", []), addresses)
    memory["tone_state"] = classification.get("tone_state") or memory.get("tone_state", "neutral")
    memory["next_action"] = classification.get("recommended_next_action") or memory.get("next_action", "")

    memory.setdefault("lead_fields", {"timeline": None, "budget": None, "area": None, "beds": None})
    for key in ("timeline", "budget", "area", "beds"):
        if lead_fields.get(key):
            memory["lead_fields"][key] = lead_fields[key]

    current_status = lead_fields.get("current_property_status")
    if current_status and current_status not in ("null", "unknown"):
        memory["current_property_status"] = current_status
    preferred_channel = lead_fields.get("preferred_channel")
    if preferred_channel and preferred_channel not in ("null", "unknown"):
        memory["preferred_channel"] = preferred_channel

    roles = [memory.get("lead_role")] + memory.get("secondary_roles", [])
    tags = set(memory.get("opportunity_tags", []))
    memory["first_time_buyer"] = True if "first_time_buyer" in roles else memory.get("first_time_buyer")
    memory["second_time_buyer"] = True if "second_time_buyer" in roles else memory.get("second_time_buyer")
    memory["sell_before_buy"] = True if "sell_before_buy" in tags else memory.get("sell_before_buy")
    if "renter_purchase_potential" in tags:
        memory["renter_purchase_potential"] = "possible"
    if "mortgage_interest" in tags or memory.get("lead_role") == "mortgage_adjacent_lead":
        memory["mortgage_interest"] = "possible"
    if "valuation_interest" in tags:
        memory["valuation_interest"] = "possible"

    flags = _merge_unique(classification.get("compliance_flags", []), detect_compliance_flags(parsed.get("body", "")))
    memory["compliance_flags"] = _merge_unique(memory.get("compliance_flags", []), flags)

    is_no, is_stop = detect_no_signal(parsed.get("body", ""))
    if is_no and parsed.get("id") not in memory.get("no_message_ids", []):
        memory["no_count"] = int(memory.get("no_count") or 0) + 1
        memory["no_message_ids"] = _merge_unique(memory.get("no_message_ids", []), [parsed.get("id")])
    if is_stop:
        memory["do_not_contact"] = True
        memory["next_action"] = "stop"
        memory["human_handoff_reason"] = "opt_out_or_stop_request"
    if memory.get("no_count", 0) >= 3:
        memory["next_action"] = "stop_conversion_push"
    if classification.get("human_handoff_reason"):
        memory["human_handoff_reason"] = classification["human_handoff_reason"]
    return is_no, is_stop


def should_route_human(classification: dict, memory: dict) -> bool:
    flags = set(classification.get("compliance_flags", [])) | set(memory.get("compliance_flags", []))
    if flags & SENSITIVE_FLAGS:
        return True
    if classification.get("intent") == "human_required":
        return True
    if classification.get("recommended_next_action") in {"route_human", "review"}:
        return True
    if classification.get("human_handoff_reason"):
        return True
    if memory.get("do_not_contact"):
        return True
    if classification.get("confidence", 1.0) < 0.35:
        return True
    return False


def derive_next_question(intent: str, classification: dict, memory: dict) -> str:
    if memory.get("do_not_contact") or memory.get("no_count", 0) >= 3:
        return ""
    if set(memory.get("compliance_flags", [])) & SENSITIVE_FLAGS:
        return ""
    question = (classification.get("next_best_question") or "").strip()
    if question and question.lower() not in {"null", "none"}:
        return question
    current_status = memory.get("current_property_status") or "unknown"
    if intent in {"property_details", "property_search", "showing_request", "buyer_lead"} and current_status == "unknown":
        return "Are you buying your first place, or would you also need to sell a current home before buying?"
    if intent == "renter_lead" and memory.get("renter_purchase_potential") == "unknown":
        return "Are you only looking to rent right now, or would you consider buying if the numbers made sense?"
    if intent == "seller_lead" and not memory.get("lead_fields", {}).get("timeline"):
        return "Are you hoping to sell soon, or are you mainly looking for a current value estimate?"
    return ""


def append_question_to_reply(html_body: str, text_body: str, question: str) -> tuple[str, str]:
    question = (question or "").strip()
    if not question:
        return html_body, text_body
    question_html = f"<p>{question}</p>"
    if "Best regards" in html_body:
        html_body = html_body.replace("<p style=\"margin:20px 0 0;color:#555;line-height:1.45\">Best regards,", question_html + "\n<p style=\"margin:20px 0 0;color:#555;line-height:1.45\">Best regards,", 1)
        html_body = html_body.replace("<p style=\"margin-top:20px;color:#555\">Best regards,", question_html + "\n<p style=\"margin-top:20px;color:#555\">Best regards,", 1)
    else:
        html_body += question_html
    if "\n\nBest regards" in text_body:
        text_body = text_body.replace("\n\nBest regards", f"\n\n{question}\n\nBest regards", 1)
    else:
        text_body += f"\n\n{question}"
    return html_body, text_body


def build_handoff_summary(parsed: dict, classification: dict, memory: dict, intent: str) -> str:
    fields = memory.get("lead_fields", {})
    summary_lines = [
        f"Lead: {memory.get('lead_name') or 'Unknown'} <{memory.get('lead_email') or parsed.get('from', '')}>",
        f"Source: {memory.get('lead_source', 'email')} / {memory.get('source_detail') or parsed.get('subject', '')}",
        f"Intent: {intent}",
        f"Role: {memory.get('lead_role', 'unknown')}",
        f"Opportunity tags: {', '.join(memory.get('opportunity_tags', []) or ['none'])}",
        f"Property interest: {', '.join(memory.get('property_interest', []) or ['none'])}",
        f"Timeline: {fields.get('timeline') or 'unknown'} | Budget: {fields.get('budget') or 'unknown'} | Area: {fields.get('area') or 'unknown'}",
        f"Current property status: {memory.get('current_property_status', 'unknown')} | Sell before buy: {memory.get('sell_before_buy')}",
        f"Mortgage interest: {memory.get('mortgage_interest', 'none')} | Valuation interest: {memory.get('valuation_interest', 'none')}",
        f"Tone: {memory.get('tone_state', 'neutral')} | No count: {memory.get('no_count', 0)}",
        f"Compliance flags: {', '.join(memory.get('compliance_flags', []) or ['none'])}",
        f"Handoff reason: {memory.get('human_handoff_reason') or classification.get('human_handoff_reason') or classification.get('recommended_next_action') or 'lead update'}",
        f"Next action: {memory.get('next_action') or classification.get('recommended_next_action') or 'review'}",
        f"Last message: {(parsed.get('body') or '').strip()[:700]}",
    ]
    return "\n".join(summary_lines)


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
    name, email_addr = _sender_parts(parsed.get("from", ""))
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


def classify_email(parsed: dict, thread_context: str = "") -> dict:
    # Strip quoted reply lines (lines starting with >) to focus on the new message
    body_lines = parsed["body"].split("\n")
    new_lines = [l for l in body_lines if not l.strip().startswith(">") and not l.strip().startswith("On ")]
    clean_body = "\n".join(new_lines).strip() or parsed["body"]
    content = f"Current email subject: {parsed['subject']}\n\nCurrent email body:\n{clean_body}"
    if thread_context:
        content += (
            "\n\nRecent prior thread context for resolving short follow-ups. "
            "Use only if the current email depends on earlier messages:\n"
            f"{thread_context}"
        )
    raw = _claude(CLAUDE_CLASSIFY, CLASSIFY_PROMPT, content, max_tokens=700)
    parsed_json = _extract_json_dict(raw)
    if not parsed_json:
        parsed_json = {"intent": "human_required", "address": None, "lead_fields": {}}
    return normalize_classification(parsed_json)


def generate_property_html(listing: dict, rentcast: dict, calendly: str,
                           rates: dict = None, neighborhood: dict = None,
                           comps: list[dict] = None, similar_homes: list[dict] = None) -> tuple[str, str]:
    # Photo URL: sheet column "Photo URL" normalises to "photo_url"; also check Apify/RentCast variants
    photo_url = (listing.get("photo_url") or listing.get("photo url") or
                 rentcast.get("photoUrl") or rentcast.get("photo_url") or "")
    listing_url = listing.get("listing_url", "")
    address = listing.get("address", "")
    city = listing.get("city", "")
    state = listing.get("state", "")
    zip_code = listing.get("zip", "")
    full_address = address if address else f"{city}, {state} {zip_code}".strip(", ")
    price_raw = re.sub(r"[^\d.]", "", listing.get("price", "0"))
    try:
        price_fmt = f"${float(price_raw):,.0f}"
    except ValueError:
        price_fmt = listing.get("price", "")
    beds = _clean_value(listing.get("beds"))
    baths = _clean_value(listing.get("baths"))
    sqft_raw = re.sub(r"[^\d]", "", listing.get("sqft") or "")
    try:
        sqft_fmt = f"{int(sqft_raw):,}" if sqft_raw else ""
    except ValueError:
        sqft_fmt = listing.get("sqft", "")
    status = _clean_value(listing.get("status"))

    property_summary = f"Address: {full_address}\nPrice: {price_fmt}\n"
    facts = []
    if beds:
        facts.append(f"Beds: {beds}")
    if baths:
        facts.append(f"Baths: {baths}")
    if sqft_fmt:
        facts.append(f"Sqft: {sqft_fmt}")
    if facts:
        property_summary += " | ".join(facts) + "\n"
    if status:
        property_summary += f"Status: {status}\n"
    if listing_url:
        property_summary += f"Listing URL: {listing_url}"
    if rentcast:
        extras = {k: v for k, v in rentcast.items() if k not in ("photoUrl", "photo_url") and v}
        if extras:
            property_summary += "\n\nAdditional details:\n" + "\n".join(f"{k}: {v}" for k, v in list(extras.items())[:10])
    if comps:
        lines = []
        for comp in comps[:2]:
            comp_price_raw = re.sub(r"[^\d.]", "", comp.get("price", ""))
            try:
                comp_price = f"${float(comp_price_raw):,.0f}" if comp_price_raw else comp.get("price", "")
            except ValueError:
                comp_price = comp.get("price", "")
            details = []
            if comp.get("beds"):
                details.append(f"{comp['beds']}bd")
            if comp.get("baths"):
                details.append(f"{comp['baths']}ba")
            if comp.get("sqft"):
                details.append(f"{comp['sqft']} sqft")
            sold = f", sold {comp['sold_date']}" if comp.get("sold_date") else ""
            lines.append(f"- {comp.get('address', '')}: {comp_price}"
                         f"{' | ' + '/'.join(details) if details else ''}{sold}")
        if lines:
            property_summary += "\n\nRecently sold comps:\n" + "\n".join(lines)
    if rates:
        property_summary += f"\n\nCurrent mortgage rates: 30yr fixed {rates.get('rate_30yr','N/A')}%, 15yr fixed {rates.get('rate_15yr','N/A')}%"
    if neighborhood and neighborhood.get("median_income"):
        property_summary += f"\n\nNeighborhood median income: {neighborhood['median_income']}"

    ai_body = _claude(CLAUDE_RESPOND, PROPERTY_REPLY_PROMPT, property_summary)
    ai_body = re.sub(r'(?<!href=")(?<!src=")(https?://[^\s<>"]+)', r'<a href="\1">\1</a>', ai_body)
    ai_body = re.sub(r"<p(?![^>]*style=)", '<p style="margin:0 0 14px;line-height:1.55"', ai_body)

    hero_img = ""
    if photo_url:
        hero_img = f'<img src="{photo_url}" style="width:100%;max-width:520px;max-height:300px;object-fit:cover;border-radius:8px;margin-bottom:14px;display:block" alt="Property photo" />'

    view_btn = ""
    if listing_url:
        view_btn = f'<a href="{listing_url}" style="display:inline-block;padding:10px 20px;background:#1a6b3c;color:#fff;text-decoration:none;border-radius:6px;margin-right:12px;font-weight:bold">View Listing</a>'

    cal_btn = ""
    if calendly:
        cal_btn = f'<a href="{calendly}" style="display:inline-block;padding:10px 20px;background:#0066cc;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Schedule Showing</a>'

    details = []
    if beds: details.append(f"{beds} bed")
    if baths: details.append(f"{baths} bath")
    if sqft_fmt: details.append(f"{sqft_fmt} sqft")
    if status: details.append(f'<span style="color:#1a6b3c;font-weight:bold">{status}</span>')
    details_line = " &bull; ".join(details)

    sig = '<p style="margin:20px 0 0;color:#555;line-height:1.45">Best regards,<br><strong>Austin Realty</strong><br>(512) 555-0192</p>'
    similar_homes_html, similar_homes_text = render_similar_homes_section(similar_homes)

    html = f"""<div style="font-family:Arial,sans-serif;max-width:520px;color:#222;line-height:1.45">
{hero_img}
<h2 style="margin:0 0 12px;line-height:1.25">{full_address}</h2>
<p style="font-size:18px;font-weight:bold;margin:0 0 12px;line-height:1.35">{price_fmt}</p>
{"<p style='margin:0 0 18px;line-height:1.45'>" + details_line + "</p>" if details_line else ""}
<hr style="border:none;border-top:1px solid #eee;margin:20px 0" />
{ai_body}
{sig}
<div style="margin-top:22px">
{view_btn}{cal_btn}
</div>
{similar_homes_html}
</div>"""

    plain_detail = []
    if beds:
        plain_detail.append(f"{beds}bd")
    if baths:
        plain_detail.append(f"{baths}ba")
    if sqft_fmt:
        plain_detail.append(f"{sqft_fmt} sqft")
    if status:
        plain_detail.append(status)
    plain = f"{full_address}\n{price_fmt}"
    if plain_detail:
        plain += " | " + " | ".join(plain_detail)
    plain += "\n\n"
    if listing_url:
        plain += f"View listing: {listing_url}\n"
    if calendly:
        plain += f"Schedule a showing: {calendly}\n"
    plain += similar_homes_text
    plain += "\nBest regards,\nAustin Realty\n(512) 555-0192"
    return html, plain


def generate_search_reply(listings: list[dict], calendly: str,
                           area: str = "", beds: int = None, max_price: int = None) -> tuple[str, str]:
    sig_html = '<p style="margin-top:20px;color:#555">Best regards,<br><strong>Austin Realty</strong><br>(512) 555-0192</p>'
    sig_text = "\n\nBest regards,\nAustin Realty\n(512) 555-0192"

    if not listings:
        criteria = []
        if beds: criteria.append(f"{beds}-bedroom")
        if max_price: criteria.append(f"under ${max_price:,}")
        if area: criteria.append(f"in {area}")
        criteria_str = " ".join(criteria) or "matching your criteria"
        text = (f"Hello,\n\nI looked through our listings and checked live Zillow inventory "
                f"for {criteria_str} — nothing available right now, but inventory changes daily. "
                f"I'll reach out as soon as something comes up. Feel free to reply to adjust your search.")
        return f"<p>Hello,</p><p>{text.split(chr(10)*2)[1]}</p>{sig_html}", text + sig_text

    # Build property cards (photo + key details per listing)
    criteria_parts = []
    if beds: criteria_parts.append(f"{beds}+ bed")
    if max_price: criteria_parts.append(f"under ${max_price:,}")
    if area: criteria_parts.append(f"in {area}")
    criteria_str = ", ".join(criteria_parts)
    intro = f"Here are {len(listings[:6])} listings{(' ' + criteria_str) if criteria_str else ''} that match your search."

    cards_html = ""
    plain_lines = [f"Hello,\n\n{intro}\n"]
    for l in listings[:6]:
        price_raw = re.sub(r"[^\d.]", "", l.get("price", "0"))
        try:
            price_fmt = f"${float(price_raw):,.0f}"
        except ValueError:
            price_fmt = l.get("price", "")
        addr = l.get("address", "")
        city = l.get("city", "")
        state_val = l.get("state", "")
        full_addr = addr if addr else f"{city}, {state_val}".strip(", ")
        beds_val = l.get("beds") or l.get("bedrooms") or ""
        baths_val = l.get("baths") or l.get("bathrooms") or ""
        sqft_raw = re.sub(r"[^\d]", "", l.get("sqft") or "")
        sqft_fmt = f"{int(sqft_raw):,}" if sqft_raw.isdigit() else ""
        listing_url = l.get("listing_url", "")
        desc = (l.get("description", "") or "")[:100]

        photo = l.get("photo_url", "") or l.get("photo url", "")

        details = []
        if beds_val: details.append(f"{beds_val} bed")
        if baths_val: details.append(f"{baths_val} bath")
        if sqft_fmt: details.append(f"{sqft_fmt} sqft")
        details_str = " &bull; ".join(details)

        photo_html = f'<img src="{photo}" style="width:100%;border-radius:6px;margin-bottom:8px;display:block" alt="" />' if photo else ""
        view_link = f' &nbsp;<a href="{listing_url}" style="color:#0066cc;font-size:13px">View</a>' if listing_url else ""

        cards_html += f"""<div style="border:1px solid #e0e0e0;border-radius:8px;padding:14px;margin-bottom:14px">
{photo_html}<h3 style="margin:0 0 2px;font-size:15px">{full_addr}</h3>
<p style="font-weight:bold;margin:0 0 4px">{price_fmt}{view_link}</p>
{"<p style='margin:0 0 4px;color:#555;font-size:13px'>" + details_str + "</p>" if details_str else ""}
{"<p style='margin:0;font-size:13px;color:#444'>" + desc + ("..." if len(l.get("description","")) > 100 else "") + "</p>" if desc else ""}
</div>"""
        plain_lines.append(f"{full_addr} — {price_fmt} | {beds_val}bd/{baths_val}ba{' | ' + sqft_fmt + ' sqft' if sqft_fmt else ''}")
        if listing_url:
            plain_lines.append(f"  {listing_url}")

    cal_btn = ""
    if calendly:
        cal_btn = f'<p><a href="{calendly}" style="display:inline-block;padding:10px 24px;background:#0066cc;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Schedule a Showing</a></p>'
        plain_lines.append(f"\nSchedule a showing: {calendly}")

    html = f"""<div style="font-family:Arial,sans-serif;max-width:620px;color:#222">
<p>Hello,</p><p>{intro}</p>
{cards_html}{cal_btn}{sig_html}
</div>"""
    plain = "\n".join(plain_lines) + sig_text
    return html, plain


def generate_lead_reply(lead_type: str, existing: dict,
                        classification: dict = None,
                        memory: dict = None,
                        next_question: str = "") -> tuple[str, str]:
    classification = classification or {}
    memory = memory or {}
    missing = [k for k, v in existing.items() if not v]
    text = _claude(
        CLAUDE_RESPOND,
        LEAD_QUALIFY_PROMPT.format(
            lead_type=lead_type,
            missing_fields=", ".join(missing[:2]),
            tone_state=memory.get("tone_state") or classification.get("tone_state") or "neutral",
            opportunity_tags=", ".join(memory.get("opportunity_tags", []) or classification.get("opportunity_tags", []) or ["none"]),
            next_question=next_question or "none",
        ),
        "Write the reply."
    )
    text = re.sub(r'\n*Best regards[\s\S]*$', '', text, flags=re.IGNORECASE).strip()
    sig_html = '<p style="margin-top:20px;color:#555">Best regards,<br><strong>Austin Realty</strong><br>(512) 555-0192</p>'
    html = "<p>" + text.replace("\n\n", "</p><p>").replace("\n", "<br>") + "</p>" + sig_html
    text += "\n\nBest regards,\nAustin Realty\n(512) 555-0192"
    return html, text


def generate_closeout_reply() -> tuple[str, str]:
    text = ("Hello,\n\nNo problem. I will stop asking about that. "
            "If anything changes, you can reply here and we will pick it back up.\n\n"
            "Best regards,\nAustin Realty\n(512) 555-0192")
    html = ("<p>Hello,</p>"
            "<p>No problem. I will stop asking about that. If anything changes, "
            "you can reply here and we will pick it back up.</p>"
            "<p style=\"margin-top:20px;color:#555\">Best regards,<br>"
            "<strong>Austin Realty</strong><br>(512) 555-0192</p>")
    return html, text


def generate_multi_property_html(listings_data: list[dict], calendly: str) -> tuple[str, str]:
    """Reply for inquiries about multiple properties. One compact card per property."""
    sig = '<p style="margin-top:20px;color:#555">Best regards,<br><strong>Austin Realty</strong><br>(512) 555-0192</p>'

    cards_html = ""
    plain_lines = ["Hello,\n\nHere are the details on the properties you asked about:\n"]

    for item in listings_data:
        listing = item["listing"]
        address = listing.get("address", "")
        city = listing.get("city", "")
        state_val = listing.get("state", "")
        full_addr = address if address else f"{city}, {state_val}".strip(", ")

        price_raw = re.sub(r"[^\d.]", "", listing.get("price", "0"))
        try:
            price_fmt = f"${float(price_raw):,.0f}"
        except ValueError:
            price_fmt = listing.get("price", "")

        beds = listing.get("beds") or ""
        baths = listing.get("baths") or ""
        sqft_raw = re.sub(r"[^\d]", "", listing.get("sqft") or "")
        sqft_fmt = f"{int(sqft_raw):,}" if sqft_raw.isdigit() else listing.get("sqft", "")
        status = listing.get("status", "")
        desc = listing.get("description", "")[:120] if listing.get("description") else ""
        listing_url = listing.get("listing_url", "")

        photo_url = listing.get("photo_url") or listing.get("photo url") or ""

        details = []
        if beds: details.append(f"{beds} bed")
        if baths: details.append(f"{baths} bath")
        if sqft_fmt: details.append(f"{sqft_fmt} sqft")
        if status: details.append(f'<span style="color:#1a6b3c;font-weight:bold">{status}</span>')
        details_line = " &bull; ".join(details)

        photo_html = f'<img src="{photo_url}" style="width:100%;border-radius:6px;margin-bottom:8px;display:block" alt="" />' if photo_url else ""
        view_link = f' <a href="{listing_url}" style="color:#0066cc;font-size:13px">View listing</a>' if listing_url else ""

        cards_html += f"""<div style="border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:16px">
{photo_html}
<h3 style="margin:0 0 4px">{full_addr}</h3>
<p style="font-weight:bold;margin:0 0 4px">{price_fmt}{view_link}</p>
{"<p style='margin:0 0 6px;color:#555'>" + details_line + "</p>" if details_line else ""}
{"<p style='margin:0;font-size:14px;color:#444'>" + desc + ("..." if len(listing.get("description","")) > 120 else "") + "</p>" if desc else ""}
</div>"""

        plain_lines.append(f"{full_addr} — {price_fmt} | {beds}bd/{baths}ba{' | ' + sqft_fmt + ' sqft' if sqft_fmt else ''} | {status}")
        if listing_url:
            plain_lines.append(f"  {listing_url}")

    cal_btn = ""
    if calendly:
        cal_btn = f'<p><a href="{calendly}" style="display:inline-block;padding:10px 24px;background:#0066cc;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Schedule a Showing</a></p>'
        plain_lines.append(f"\nTo schedule a showing: {calendly}")

    html = f"""<div style="font-family:Arial,sans-serif;max-width:620px;color:#222">
<p>Hello,</p>
<p>Here are the details on the {len(listings_data)} properties you asked about.</p>
{cards_html}
{cal_btn}
{sig}
</div>"""

    plain_lines.append("\nBest regards,\nAustin Realty\n(512) 555-0192")
    return html, "\n".join(plain_lines)


def generate_showing_reply(calendly: str, address: str = "") -> tuple[str, str]:
    """Showing request — just return Calendly link, no auto-calendar."""
    addr_str = f" for {address}" if address else ""
    text = (f"Hello,\n\nHappy to set up a showing{addr_str}. "
            f"You can book a time directly here:\n\n{calendly}\n\n"
            f"If none of those slots work, just reply and we'll find something.\n\n"
            f"Best regards,\nAustin Realty\n(512) 555-0192")
    html = (f'<p>Hello,</p>'
            f'<p>Happy to set up a showing{addr_str}. You can book a time directly here:</p>'
            f'<p><a href="{calendly}" style="display:inline-block;padding:10px 24px;background:#0066cc;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Schedule a Showing</a></p>'
            f'<p>If none of those slots work, just reply and we\'ll find something.</p>'
            f'<p style="margin-top:20px;color:#555">Best regards,<br><strong>Austin Realty</strong><br>(512) 555-0192</p>')
    return html, text

# ── Main processing ───────────────────────────────────────────────────────────

def process_message(gmail, sheets, state: dict, msg: dict, my_email: str):
    parsed = parse_message(msg)
    msg_id = parsed["id"]
    thread_id = parsed["thread_id"]

    if msg_id in state["replied_ids"]:
        return

    sender = parsed["from"].lower()
    if my_email in sender:
        return

    log.info("--- Processing message id=%s from=%s subject='%s'", msg_id, parsed["from"], parsed["subject"])

    thread_context = get_thread_context(gmail, thread_id, msg_id)
    classification = classify_email(parsed, thread_context)
    intent = classification.get("intent", "human_required")
    address = classification.get("address")
    addresses = classification.get("addresses", [])
    if not addresses and address:
        addresses = [address]
    lead_fields = classification.get("lead_fields", {})
    lead_key, lead_memory = get_lead_memory(state, parsed)
    update_lead_memory(lead_memory, classification, parsed, addresses)
    next_question = derive_next_question(intent, classification, lead_memory)
    handoff_summary = build_handoff_summary(parsed, classification, lead_memory, intent)

    log.info("Intent: %s | Role: %s | Tags: %s | Tone: %s | No count: %s | Addresses: %s | Lead fields: %s",
             intent,
             lead_memory.get("lead_role", "unknown"),
             lead_memory.get("opportunity_tags", []),
             lead_memory.get("tone_state", "neutral"),
             lead_memory.get("no_count", 0),
             addresses or "none",
             lead_fields)

    if intent == "spam":
        apply_labels(gmail, msg_id, ["NEEDS_HUMAN"])
        log.info("Spam — labeled NEEDS_HUMAN, no reply sent")
        state["replied_ids"].append(msg_id)
        return

    if should_route_human(classification, lead_memory):
        apply_labels(gmail, msg_id, ["NEEDS_HUMAN"])
        contact_id = hubspot_upsert_contact(
            email=parsed["from"], name="", intent=intent,
            budget=lead_memory.get("lead_fields", {}).get("budget", ""),
            timeline=lead_memory.get("lead_fields", {}).get("timeline", ""),
            area=lead_memory.get("lead_fields", {}).get("area", ""),
            assigned_agent=TEAM_LEAD_EMAIL,
        )
        if contact_id:
            hubspot_add_note(contact_id, handoff_summary)
        notify_agent(gmail, TEAM_LEAD_EMAIL, TEAM_NAME, parsed["from"],
                     parsed["subject"], intent, handoff_summary)
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
        log.info("Human required — labeled NEEDS_HUMAN, no reply sent")
        state["replied_ids"].append(msg_id)
        return

    listings = get_listings(sheets)
    html_body = ""
    text_body = ""
    labels = ["AUTO_REPLIED"]

    if intent == "property_details" and addresses:
        if len(addresses) > 1:
            # ── Multi-property inquiry ────────────────────────────────────────────
            log.info("Multi-property inquiry: %d addresses", len(addresses))
            listings_data = []
            for addr in addresses[:10]:
                matches = search_listings_by_address(listings, addr)
                if matches:
                    listing = dict(matches[0])
                    log.info("  Sheet hit: %s", addr)
                else:
                    apify_data = apify_zillow_lookup(addr)
                    if apify_data:
                        listing = enrich_missing_fields(apify_data)
                        append_property_to_sheet(sheets, listing)
                    else:
                        listing = {"address": addr}
                    log.info("  Apify %s: %s", addr, "hit" if apify_data else "miss")
                listings_data.append({"address": addr, "listing": listing})

            html_body, text_body = generate_multi_property_html(listings_data, CALENDLY_URL)
            html_body, text_body = append_question_to_reply(html_body, text_body, next_question)

            contact_id = hubspot_upsert_contact(
                email=parsed["from"], name="", intent=intent, budget="", timeline="",
                area="Austin", assigned_agent=TEAM_LEAD_EMAIL
            )
            if contact_id:
                hubspot_add_note(contact_id, handoff_summary)
            notify_agent(gmail, TEAM_LEAD_EMAIL, TEAM_NAME, parsed["from"], parsed["subject"], intent,
                         handoff_summary)

        else:
            # ── Single property ───────────────────────────────────────────────────
            addr = addresses[0]
            matches = search_listings_by_address(listings, addr)
            listing = matches[0] if matches else {}

            if not listing:
                apify_data = apify_zillow_lookup(addr)
                if apify_data:
                    listing = enrich_missing_fields(apify_data)
                    append_property_to_sheet(sheets, listing)
                    rentcast_data = {}
                else:
                    rentcast_data = rentcast_lookup(addr)
                    if rentcast_data:
                        listing = {
                            "address": rentcast_data.get("addressLine1", addr),
                            "city": rentcast_data.get("city", ""),
                            "state": rentcast_data.get("state", ""),
                            "zip": rentcast_data.get("zipCode", ""),
                            "price": str(rentcast_data.get("price") or ""),
                            "beds": str(rentcast_data.get("bedrooms") or ""),
                            "baths": str(rentcast_data.get("bathrooms") or ""),
                            "sqft": str(rentcast_data.get("squareFootage") or ""),
                            "status": "Active",
                            "listing_url": "",
                            "photo_url": rentcast_data.get("photoUrl", ""),
                        }
                        listing = enrich_missing_fields(listing)
                        append_property_to_sheet(sheets, listing)
                    else:
                        text_body = f"Hello,\n\nI searched for {addr} but couldn't locate it in our current listings. Let me look into this and get back to you shortly.\n\nBest regards,\nAustin Realty\n(512) 555-0192"
                        html_body = f"<p>Hello,</p><p>I searched for {addr} but couldn't locate it in our current listings. Let me look into this and get back to you shortly.</p><p style='margin-top:20px;color:#555'>Best regards,<br><strong>Austin Realty</strong><br>(512) 555-0192</p>"
                        apply_labels(gmail, msg_id, ["NEEDS_HUMAN"])
                        state["replied_ids"].append(msg_id)
                        return
            else:
                rentcast_data = {}
                photo = listing.get("photo_url") or listing.get("photo url") or ""
                if not photo:
                    apify_data = apify_zillow_lookup(addr)
                    if apify_data.get("photo_url"):
                        listing = dict(listing)
                        listing["photo_url"] = apify_data["photo_url"]

            zip_code_match = re.search(r'\b(\d{5})\b', addr)
            zipcode = zip_code_match.group(1) if zip_code_match else listing.get("zip", "")
            comps = []
            if should_fetch_sold_comps(intent, addresses, parsed["body"], listing, zipcode):
                comps = get_sold_comps(zipcode)
            else:
                log.info("Sold comps — skipped (trigger gate not met)")
            rates = get_mortgage_rates()
            neighborhood = get_neighborhood_stats(zipcode)
            similar_homes = find_similar_homes(listing, listings) if ENABLE_SIMILAR_HOMES else []

            html_body, text_body = generate_property_html(listing, rentcast_data, CALENDLY_URL,
                                                          rates, neighborhood, comps, similar_homes)
            html_body, text_body = append_question_to_reply(html_body, text_body, next_question)

            agent_email, agent_name = get_assigned_agent(listing)
            lead_memory["assigned_owner"] = agent_email
            notify_agent(gmail, agent_email, agent_name, parsed["from"], parsed["subject"], intent,
                         build_handoff_summary(parsed, classification, lead_memory, intent))
            contact_id = hubspot_upsert_contact(
                email=parsed["from"], name="", intent=intent, budget="", timeline="",
                area=listing.get("city", ""), assigned_agent=agent_email
            )
            if contact_id:
                hubspot_add_note(contact_id, build_handoff_summary(parsed, classification, lead_memory, intent))

    elif intent == "property_search":
        beds = None
        max_price = None
        # Extract beds from lead_fields (now classified)
        if lead_fields.get("beds"):
            try:
                beds = int(re.sub(r"[^\d]", "", str(lead_fields["beds"])))
            except ValueError:
                pass
        # Extract budget
        if lead_fields.get("budget"):
            raw = str(lead_fields["budget"]).lower().strip()
            # Handle shorthand: $500k → 500000, $1.2m → 1200000
            multiplier = 1
            if raw.endswith("k"):
                multiplier = 1000
                raw = raw[:-1]
            elif raw.endswith("m"):
                multiplier = 1_000_000
                raw = raw[:-1]
            price_str = re.sub(r"[^\d.]", "", raw)
            if price_str:
                max_price = int(float(price_str) * multiplier)
        # Area: use classifier result, fallback to regex scan of email body
        area_search = (lead_fields.get("area") or "").strip()
        if not area_search:
            body_lower = parsed["body"].lower() + " " + parsed["subject"].lower()
            for city in ["round rock", "cedar park", "pflugerville", "georgetown", "lakeway",
                         "buda", "kyle", "leander", "manor", "bastrop", "dripping springs"]:
                if city in body_lower:
                    area_search = city.title()
                    break
        if not area_search:
            area_search = "Austin"

        log.info("property_search — beds=%s max_price=%s area=%s", beds, max_price, area_search)

        # 1. Search sheet first
        matches = search_listings_by_criteria(listings, beds=beds, max_price=max_price, status="Active")
        # Filter by area if specified and not Austin (avoid over-filtering)
        if area_search.lower() != "austin" and matches:
            area_matches = [l for l in matches if area_search.lower() in l.get("city", "").lower()
                            or area_search.lower() in l.get("address", "").lower()]
            if area_matches:
                matches = area_matches

        log.info("property_search — sheet returned %d results", len(matches))

        # 2. Supplement with live Zillow when sheet has fewer than 3 matches
        if len(matches) < 3:
            log.info("property_search — hitting Zillow for %s", area_search)
            zillow_results = apify_zillow_search(area_search, max_price=max_price, min_beds=beds)
            seen = {l.get("address", "").lower() for l in matches}
            new_from_zillow = []
            for r in zillow_results:
                if r.get("address", "").lower() not in seen:
                    enriched = enrich_missing_fields(r)
                    matches.append(enriched)
                    new_from_zillow.append(enriched)
                    seen.add(r.get("address", "").lower())
            # Append new Zillow results to sheet for future cache hits
            for prop in new_from_zillow:
                append_property_to_sheet(sheets, prop)
            log.info("property_search — %d from Zillow appended to sheet, total=%d",
                     len(new_from_zillow), len(matches))

        html_body, text_body = generate_search_reply(matches, CALENDLY_URL, area_search, beds, max_price)
        html_body, text_body = append_question_to_reply(html_body, text_body, next_question)

    elif intent == "showing_request":
        html_body, text_body = generate_showing_reply(CALENDLY_URL, address or "")
        html_body, text_body = append_question_to_reply(html_body, text_body, next_question)

    elif intent in ("buyer_lead", "seller_lead", "renter_lead"):

        existing = state["lead_state"].get(thread_id, {
            "intent": intent,
            "collected": {"timeline": None, "budget": None, "area": None},
            "lead_email": parsed["from"],
            "subject": parsed["subject"],
            "last_message_id": parsed["message_id_header"],
            "references": parsed["references"],
            "last_contact_ts": time.time(),
            "followup1_sent": False,
            "followup2_sent": False,
            "cold": False,
        })
        # Update tracking fields on every reply
        existing["lead_email"] = parsed["from"]
        existing["subject"] = parsed["subject"]
        existing["last_message_id"] = parsed["message_id_header"]
        existing["references"] = parsed["references"]
        existing["last_contact_ts"] = time.time()
        existing.setdefault("followup1_sent", False)
        existing.setdefault("followup2_sent", False)
        existing.setdefault("cold", False)

        for k, v in lead_fields.items():
            if v and k in existing["collected"]:
                existing["collected"][k] = v
        state["lead_state"][thread_id] = existing

        contact_id = hubspot_upsert_contact(
            email=parsed["from"], name="", intent=intent,
            budget=existing["collected"].get("budget", ""),
            timeline=existing["collected"].get("timeline", ""),
            area=existing["collected"].get("area", ""),
            assigned_agent=TEAM_LEAD_EMAIL
        )
        if contact_id:
            hubspot_add_note(contact_id, handoff_summary)
        notify_agent(gmail, TEAM_LEAD_EMAIL, TEAM_NAME, parsed["from"],
                     parsed["subject"], intent,
                     build_handoff_summary(parsed, classification, lead_memory, intent))

        missing = [k for k, v in existing["collected"].items() if not v]
        if lead_memory.get("no_count", 0) >= 3:
            html_body, text_body = generate_closeout_reply()
            existing["cold"] = True
            labels.append("NEEDS_HUMAN")
        elif missing:
            html_body, text_body = generate_lead_reply(
                intent.replace("_lead", ""),
                existing["collected"],
                classification,
                lead_memory,
                next_question,
            )
            if intent == "seller_lead" and FILLOUT_VALUATION_URL:
                val_html = f'<p style="margin-top:16px"><a href="{FILLOUT_VALUATION_URL}" style="display:inline-block;padding:10px 20px;background:#1a6b3c;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Get Free Home Valuation</a></p>'
                html_body = html_body + val_html
                text_body = text_body + f"\n\nGet your free home valuation here: {FILLOUT_VALUATION_URL}"
        else:
            text_body = "Thank you for providing those details. One of our agents will be in touch with you shortly.\n\nBest regards,\nAustin Realty\n(512) 555-0192"
            html_body = "<p>Thank you for providing those details. One of our agents will be in touch with you shortly.</p><p style='margin-top:20px;color:#555'>Best regards,<br><strong>Austin Realty</strong><br>(512) 555-0192</p>"
            labels.append("NEEDS_HUMAN")

    if html_body:
        send_reply(gmail, parsed, html_body, text_body)
        lead_memory["last_ai_touch_at"] = _iso_now()
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
                    direction="inbound",
                    event_type="email_received",
                    message_text=parsed.get("body", ""),
                    summary=handoff_summary,
                    ai_action="classify",
                    status="processed",
                ),
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
        if msg_id not in state["replied_ids"]:
            state["replied_ids"].append(msg_id)
        apply_labels(gmail, msg_id, labels)
        log.info("Reply sent — to=%s intent=%s labels=%s", parsed["from"], intent, labels)
    else:
        if SHEET_ID:
            append_conversation_event(
                sheets,
                SHEET_ID,
                build_email_conversation_event(
                    parsed=parsed,
                    direction="inbound",
                    event_type="manual_review",
                    message_text=parsed.get("body", ""),
                    summary=handoff_summary,
                    ai_action="route_human",
                    handoff_reason=lead_memory.get("human_handoff_reason", ""),
                    status="needs_human",
                ),
            )
        apply_labels(gmail, msg_id, ["NEEDS_HUMAN"])
        log.warning("No reply generated — labeled NEEDS_HUMAN for manual review (from=%s subject='%s')",
                    parsed["from"], parsed["subject"])

    log.info("--- Message done — claude=$%.5f apify=$%.5f session_total=$%.4f",
             _session_cost.get("claude", 0), _session_cost.get("apify", 0), _session_cost.get("total", 0))
    if msg_id not in state["replied_ids"]:
        state["replied_ids"].append(msg_id)

# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    if not ENABLE_EMAIL_AGENT:
        log.info("Iris email agent disabled by ENABLE_EMAIL_AGENT=false")
        return

    state = load_state()
    gmail, sheets = get_gmail_service()
    my_email = get_my_email(gmail)
    log.info("=== Agent started — authenticated as %s ===", my_email)
    log.info("Watching for new emails since: %s", state["startup_ts"])
    log.info("Poll interval: %ds | Log file: %s", POLL_INTERVAL, LOG_FILE)

    while True:
        try:
            messages = get_new_messages(gmail, state["startup_ts"], my_email)
            new_msgs = [m for m in messages if m["id"] not in state["replied_ids"]]
            if new_msgs:
                log.info("[poll] Found %d new message(s)", len(new_msgs))
                for msg in new_msgs:
                    try:
                        process_message(gmail, sheets, state, msg, my_email)
                    except TransientServiceError as exc:
                        log.warning("Transient processing error for message %s; leaving unprocessed for retry: %s",
                                    msg["id"], exc)
                    except Exception as exc:
                        log.error("Error processing message %s: %s", msg["id"], exc, exc_info=True)
                    save_state(state)
            else:
                log.debug("[poll] No new messages")
                print(f"[{datetime.now().strftime('%H:%M:%S')}] No new messages", end="\r")
            # Follow-up check every poll cycle
            try:
                check_followups(gmail, state, my_email)
                save_state(state)
            except TransientServiceError as exc:
                log.warning("Transient follow-up error; will retry next poll: %s", exc)
            except Exception as exc:
                log.error("Follow-up check error: %s", exc, exc_info=True)
        except TransientServiceError as exc:
            log.warning("Transient poll error; will retry next poll: %s", exc)
        except Exception as exc:
            log.error("Poll error: %s", exc, exc_info=True)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
