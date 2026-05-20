# Enhanced Real Estate Email Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `agent.py` with live Apify/Zillow property lookup nationwide, Redfin comps, FRED mortgage rates, Census neighborhood data, HubSpot CRM sync, and agent routing via Google Sheet `Agent Email` column.

**Architecture:** Single `agent.py` file. All new capabilities are additive functions. Existing classify/reply/send loop is unchanged — new data sources slot into the existing `property_details` and lead handlers. HubSpot sync fires after every successful reply.

**Tech Stack:** Python 3.13, anthropic SDK, google-api-python-client, requests, python-dotenv, HubSpot Contacts API v3 (REST), FRED API (REST), Census ACS API (REST), Apify REST API.

---

## File Structure

- Modify: `~/Downloads/real_estate_email_agent/agent.py` — all changes go here
- Modify: `~/Downloads/real_estate_email_agent/.env` — add new config keys
- Modify: `~/Downloads/real_estate_email_agent/requirements.txt` — no new deps needed (all use requests)

---

### Task 1: Add new config keys to .env and agent.py

**Files:**
- Modify: `.env`
- Modify: `agent.py` lines 23-31

- [ ] **Step 1: Add keys to .env**

Open `~/Downloads/real_estate_email_agent/.env` and add these lines:

```
TEAM_NAME=Austin Realty
TEAM_LEAD_EMAIL=martin@lumenosis.com
PROPERTY_MANAGER_EMAIL=
HUBSPOT_API_KEY=
FRED_API_KEY=
CENSUS_API_KEY=
```

Note: FRED and Census API keys are free. Get them at:
- FRED: https://fred.stlouisfed.org/docs/api/api_key.html
- Census: https://api.census.gov/data/key_signup.html

- [ ] **Step 2: Add config vars to agent.py**

In `agent.py`, after the `APIFY_TOKEN` line, add:

```python
TEAM_NAME = os.getenv("TEAM_NAME", "Austin Realty")
TEAM_LEAD_EMAIL = os.getenv("TEAM_LEAD_EMAIL", "")
PROPERTY_MANAGER_EMAIL = os.getenv("PROPERTY_MANAGER_EMAIL", "")
HUBSPOT_API_KEY = os.getenv("HUBSPOT_API_KEY", "")
FRED_API_KEY = os.getenv("FRED_API_KEY", "")
CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")
```

- [ ] **Step 3: Verify agent starts**

```bash
cd ~/Downloads/real_estate_email_agent && python3 -c "import agent; print('config ok')"
```

Expected: `config ok`

- [ ] **Step 4: Commit**

```bash
cd ~/Downloads/real_estate_email_agent && git add .env agent.py && git commit -m "add new config keys for HubSpot, FRED, Census, team routing"
```

---

### Task 2: Add Agent Email column routing

**Files:**
- Modify: `agent.py` — update `get_listings()` and add `get_assigned_agent()`

- [ ] **Step 1: Update get_listings to read Agent Email column**

Replace the existing `get_listings` function:

```python
def get_listings(sheets) -> list[dict]:
    result = sheets.spreadsheets().values().get(
        spreadsheetId=SHEET_ID,
        range="properties_update!A:O"
    ).execute()
    rows = result.get("values", [])
    if not rows:
        return []
    headers = [h.lower().strip().replace(" ", "_") for h in rows[0]]
    listings = []
    for row in rows[1:]:
        padded = row + [""] * (len(headers) - len(row))
        listings.append(dict(zip(headers, padded)))
    return listings
```

- [ ] **Step 2: Add get_assigned_agent function**

After `get_listings`, add:

```python
def get_assigned_agent(listing: dict) -> tuple[str, str]:
    """Return (agent_email, agent_name) for a listing, falling back to team lead."""
    email = listing.get("agent_email", "").strip()
    name = listing.get("agent_name", "").strip()
    if not email:
        email = TEAM_LEAD_EMAIL
        name = TEAM_NAME
    return email, name
```

- [ ] **Step 3: Add notify_agent function**

```python
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
        gmail.users().messages().send(userId="me", body={"raw": raw}).execute()
    except Exception as e:
        print(f"  Agent notification failed: {e}")
```

- [ ] **Step 4: Commit**

```bash
git add agent.py && git commit -m "add agent routing via Sheet Agent Email column"
```

---

### Task 3: Add FRED mortgage rates lookup

**Files:**
- Modify: `agent.py` — add `get_mortgage_rates()`

- [ ] **Step 1: Add get_mortgage_rates function**

After the `_apify_cache` declaration, add:

```python
_rates_cache: dict = {}

def get_mortgage_rates() -> dict:
    """Fetch current 30yr and 15yr fixed mortgage rates from FRED. Cached 24hrs."""
    import time
    now = time.time()
    if _rates_cache.get("ts") and now - _rates_cache["ts"] < 86400:
        return _rates_cache["data"]
    
    rates = {}
    series = {"rate_30yr": "MORTGAGE30US", "rate_15yr": "MORTGAGE15US"}
    
    for key, series_id in series.items():
        try:
            url = f"https://api.stlouisfed.org/fred/series/observations"
            params = {
                "series_id": series_id,
                "api_key": FRED_API_KEY or "abcdefghijklmnopqrstuvwxyz012345",
                "file_type": "json",
                "limit": 1,
                "sort_order": "desc"
            }
            r = requests.get(url, params=params, timeout=5)
            if r.status_code == 200:
                obs = r.json().get("observations", [])
                if obs:
                    rates[key] = obs[0]["value"]
        except Exception:
            pass
    
    _rates_cache["data"] = rates
    _rates_cache["ts"] = now
    return rates
```

- [ ] **Step 2: Verify function runs without error**

```bash
python3 -c "import agent; print(agent.get_mortgage_rates())"
```

Expected: `{'rate_30yr': '6.95', 'rate_15yr': '6.20'}` (or similar current rates, or `{}` if no API key yet)

- [ ] **Step 3: Commit**

```bash
git add agent.py && git commit -m "add FRED mortgage rate lookup with 24hr cache"
```

---

### Task 4: Add Census neighborhood demographics lookup

**Files:**
- Modify: `agent.py` — add `get_neighborhood_stats()`

- [ ] **Step 1: Add get_neighborhood_stats function**

```python
_census_cache: dict = {}

def get_neighborhood_stats(zipcode: str) -> dict:
    """Fetch median household income and population for a ZIP from Census ACS. Cached."""
    if not zipcode or zipcode in _census_cache:
        return _census_cache.get(zipcode, {})
    
    try:
        # ACS 5-year estimates, median household income (B19013_001E) and population (B01003_001E)
        url = "https://api.census.gov/data/2022/acs/acs5"
        params = {
            "get": "B19013_001E,B01003_001E",
            "for": f"zip code tabulation area:{zipcode}",
            "key": CENSUS_API_KEY or ""
        }
        r = requests.get(url, params=params, timeout=5)
        if r.status_code == 200:
            data = r.json()
            if len(data) > 1:
                median_income = data[1][0]
                population = data[1][1]
                result = {
                    "median_income": f"${int(median_income):,}" if median_income and median_income != "-666666666" else None,
                    "population": f"{int(population):,}" if population else None
                }
                _census_cache[zipcode] = result
                return result
    except Exception:
        pass
    
    _census_cache[zipcode] = {}
    return {}
```

- [ ] **Step 2: Verify function runs**

```bash
python3 -c "import agent; print(agent.get_neighborhood_stats('78704'))"
```

Expected: `{'median_income': '$72,000', 'population': '18,000'}` or similar (or `{}` without key)

- [ ] **Step 3: Commit**

```bash
git add agent.py && git commit -m "add Census ACS neighborhood demographics lookup"
```

---

### Task 5: Add Redfin comps via Apify

**Files:**
- Modify: `agent.py` — add `get_redfin_comps()`

- [ ] **Step 1: Add get_redfin_comps function**

```python
_comps_cache: dict = {}

def get_redfin_comps(address: str, zipcode: str) -> list[dict]:
    """Fetch recently sold comps near an address via Redfin Apify scraper."""
    key = f"{address}_{zipcode}"
    if key in _comps_cache:
        return _comps_cache[key]
    if not APIFY_TOKEN or not zipcode:
        return []
    
    try:
        # Use Redfin search scraper by ZIP, filter to recently sold
        r = requests.post(
            f"https://api.apify.com/v2/acts/maxcopell~redfin-scraper/run-sync-get-dataset-items"
            f"?token={APIFY_TOKEN}&timeout=30&memory=512",
            json={"searchUrl": f"https://www.redfin.com/zipcode/{zipcode}/filter/property-type=house,min-beds=1,status=sold"},
            timeout=45
        )
        if r.status_code == 200:
            items = r.json()[:5]  # top 5 comps
            comps = []
            for item in items:
                comps.append({
                    "address": item.get("address", ""),
                    "price": item.get("price", ""),
                    "beds": item.get("beds", ""),
                    "baths": item.get("baths", ""),
                    "sqft": item.get("sqft", ""),
                    "sold_date": item.get("soldDate", "")
                })
            _comps_cache[key] = comps
            return comps
    except Exception as e:
        print(f"  Redfin comps error: {e}")
    
    _comps_cache[key] = []
    return []
```

- [ ] **Step 2: Commit**

```bash
git add agent.py && git commit -m "add Redfin comps lookup via Apify"
```

---

### Task 6: Add HubSpot CRM sync

**Files:**
- Modify: `agent.py` — add `hubspot_upsert_contact()` and `hubspot_add_note()`

- [ ] **Step 1: Add HubSpot contact upsert**

```python
def hubspot_upsert_contact(email: str, name: str, intent: str,
                            budget: str, timeline: str, area: str,
                            assigned_agent: str) -> str:
    """Create or update a HubSpot contact. Returns contact ID or empty string."""
    if not HUBSPOT_API_KEY or not email:
        return ""
    
    # Determine lead score from timeline
    score = "cold"
    if timeline:
        t = timeline.lower()
        if any(w in t for w in ["now", "asap", "immediately", "30 days", "this month", "week"]):
            score = "hot"
        elif any(w in t for w in ["1 month", "2 month", "3 month", "soon", "quarter"]):
            score = "warm"
    
    first, *rest = (name.strip().split(" ") if name else ["", ""])
    last = " ".join(rest) if rest else ""
    
    headers = {
        "Authorization": f"Bearer {HUBSPOT_API_KEY}",
        "Content-Type": "application/json"
    }
    
    properties = {
        "email": email,
        "firstname": first,
        "lastname": last,
        "hs_lead_status": score.upper(),
        "notes_last_contacted": intent,
    }
    if budget:
        properties["annualrevenue"] = re.sub(r"[^\d]", "", budget)
    
    # Try update first, then create
    try:
        search_r = requests.post(
            "https://api.hubapi.com/crm/v3/objects/contacts/search",
            headers=headers,
            json={"filterGroups": [{"filters": [{"propertyName": "email", "operator": "EQ", "value": email}]}]},
            timeout=5
        )
        if search_r.status_code == 200:
            results = search_r.json().get("results", [])
            if results:
                contact_id = results[0]["id"]
                requests.patch(
                    f"https://api.hubapi.com/crm/v3/objects/contacts/{contact_id}",
                    headers=headers,
                    json={"properties": properties},
                    timeout=5
                )
                return contact_id
        
        create_r = requests.post(
            "https://api.hubapi.com/crm/v3/objects/contacts",
            headers=headers,
            json={"properties": properties},
            timeout=5
        )
        if create_r.status_code in (200, 201):
            return create_r.json().get("id", "")
    except Exception as e:
        print(f"  HubSpot sync error: {e}")
    
    return ""


def hubspot_add_note(contact_id: str, note_body: str):
    """Add a note to a HubSpot contact."""
    if not HUBSPOT_API_KEY or not contact_id:
        return
    try:
        headers = {
            "Authorization": f"Bearer {HUBSPOT_API_KEY}",
            "Content-Type": "application/json"
        }
        note_r = requests.post(
            "https://api.hubapi.com/crm/v3/objects/notes",
            headers=headers,
            json={"properties": {"hs_note_body": note_body[:3000], "hs_timestamp": str(int(time.time() * 1000))}},
            timeout=5
        )
        if note_r.status_code in (200, 201):
            note_id = note_r.json().get("id", "")
            if note_id:
                requests.put(
                    f"https://api.hubapi.com/crm/v3/objects/notes/{note_id}/associations/contacts/{contact_id}/note_to_contact",
                    headers=headers,
                    timeout=5
                )
    except Exception as e:
        print(f"  HubSpot note error: {e}")
```

- [ ] **Step 2: Verify HubSpot functions load**

```bash
python3 -c "import agent; print('hubspot ok')"
```

Expected: `hubspot ok`

- [ ] **Step 3: Commit**

```bash
git add agent.py && git commit -m "add HubSpot CRM sync with contact upsert and note logging"
```

---

### Task 7: Wire all new data into property reply

**Files:**
- Modify: `agent.py` — update `generate_property_html()` and `PROPERTY_REPLY_PROMPT`

- [ ] **Step 1: Update PROPERTY_REPLY_PROMPT to include comps and rates**

Replace `PROPERTY_REPLY_PROMPT`:

```python
PROPERTY_REPLY_PROMPT = """You are a real estate agent at Austin Realty replying to a property inquiry.
Write 2-3 short conversational paragraphs about the property.

Hard rules:
- No emojis ever
- No em-dashes ever
- No bullet points or lists
- No bold headers or table formatting
- No markdown, no code fences
- No filler like "thrilled", "fantastic", "wonderful", "I'd love to"
- Only state facts you actually have, never invent details
- Keep it under 150 words total
- If comps are provided, mention 1-2 naturally in conversation
- If mortgage rates are provided, mention them naturally once
- Last sentence: offer to answer questions or set up a showing
- Return raw HTML paragraphs only, nothing else — no ```html wrapper""" + FAQ_CONTEXT
```

- [ ] **Step 2: Update generate_property_html to accept and pass comps/rates**

Replace the `generate_property_html` signature and property_summary block:

```python
def generate_property_html(listing: dict, rentcast: dict, calendly: str,
                            comps: list = None, rates: dict = None,
                            neighborhood: dict = None) -> tuple[str, str]:
    photo_url = listing.get("photo_url") or listing.get("photo url") or rentcast.get("photoUrl") or rentcast.get("photo_url") or ""
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
    beds = listing.get("beds", "")
    baths = listing.get("baths", "")
    sqft_raw = re.sub(r"[^\d]", "", listing.get("sqft", ""))
    try:
        sqft_fmt = f"{int(sqft_raw):,}" if sqft_raw else ""
    except ValueError:
        sqft_fmt = listing.get("sqft", "")
    status = listing.get("status", "")

    property_summary = f"Address: {full_address}\nPrice: {price_fmt}\nBeds: {beds} | Baths: {baths} | Sqft: {sqft_fmt}\nStatus: {status}"
    
    if rentcast:
        extras = {k: v for k, v in rentcast.items() if k not in ("photoUrl", "photo_url") and v}
        if extras:
            property_summary += "\n\nAdditional details:\n" + "\n".join(f"{k}: {v}" for k, v in list(extras.items())[:5])
    
    if comps:
        comp_lines = [f"- {c.get('address','')}: ${c.get('price','')}, {c.get('beds','')}bd/{c.get('baths','')}ba, sold {c.get('sold_date','')}" for c in comps[:3]]
        property_summary += "\n\nNearby sold comps:\n" + "\n".join(comp_lines)
    
    if rates:
        property_summary += f"\n\nCurrent mortgage rates: 30yr fixed {rates.get('rate_30yr','N/A')}%, 15yr fixed {rates.get('rate_15yr','N/A')}%"
    
    if neighborhood:
        if neighborhood.get("median_income"):
            property_summary += f"\n\nNeighborhood median income: {neighborhood['median_income']}"

    ai_body = _claude(CLAUDE_RESPOND, PROPERTY_REPLY_PROMPT, property_summary)
```

- [ ] **Step 3: Commit**

```bash
git add agent.py && git commit -m "wire comps, mortgage rates, neighborhood data into property reply"
```

---

### Task 8: Wire HubSpot sync and agent routing into process_message

**Files:**
- Modify: `agent.py` — update `process_message()`

- [ ] **Step 1: Update property_details handler to fetch comps/rates and route agent**

In `process_message`, find the `if intent == "property_details"` block and update it:

```python
    if intent == "property_details" and address:
        matches = search_listings_by_address(listings, address)
        listing = matches[0] if matches else {}

        if not listing:
            apify_data = apify_zillow_lookup(address)
            if apify_data:
                listing = apify_data
                rentcast_data = {}
            else:
                rentcast_data = rentcast_lookup(address)
                if rentcast_data:
                    listing = {
                        "address": rentcast_data.get("addressLine1", address),
                        "city": rentcast_data.get("city", ""),
                        "state": rentcast_data.get("state", ""),
                        "zip": rentcast_data.get("zipCode", ""),
                        "price": str(rentcast_data.get("price", "")),
                        "beds": str(rentcast_data.get("bedrooms", "")),
                        "baths": str(rentcast_data.get("bathrooms", "")),
                        "sqft": str(rentcast_data.get("squareFootage", "")),
                        "status": "Active",
                        "listing_url": "",
                        "photo_url": rentcast_data.get("photoUrl", ""),
                    }
                else:
                    text_body = f"I searched for {address} but couldn't find it in our current listings. I'll look into this and get back to you shortly."
                    html_body = f"<p>{text_body}</p>"
                    apply_labels(gmail, msg_id, ["NEEDS_HUMAN"])
                    state["replied_ids"].append(msg_id)
                    return
        else:
            rentcast_data = {}
            if not listing.get("photo_url"):
                apify_data = apify_zillow_lookup(address)
                if apify_data.get("photo_url"):
                    listing = dict(listing)
                    listing["photo_url"] = apify_data["photo_url"]

        # Enrich with comps, rates, neighborhood
        zip_code = re.search(r'\b(\d{5})\b', address)
        zipcode = zip_code.group(1) if zip_code else ""
        comps = get_redfin_comps(address, zipcode)
        rates = get_mortgage_rates()
        neighborhood = get_neighborhood_stats(zipcode)

        html_body, text_body = generate_property_html(listing, rentcast_data, CALENDLY_URL, comps, rates, neighborhood)

        # Route to assigned agent
        agent_email, agent_name = get_assigned_agent(listing)
        notify_agent(gmail, agent_email, agent_name, parsed["from"], parsed["subject"], intent,
                     f"Inquiry about {address}. Price: {listing.get('price','N/A')}")

        # HubSpot sync
        contact_id = hubspot_upsert_contact(
            email=parsed["from"], name="",
            intent=intent, budget="", timeline="", area=listing.get("city", ""),
            assigned_agent=agent_email
        )
        if contact_id:
            hubspot_add_note(contact_id, f"Inquiry about {address}\n\n{parsed['body'][:1000]}")
```

- [ ] **Step 2: Add HubSpot sync to lead intents**

In the `elif intent in ("buyer_lead", "seller_lead", "renter_lead")` block, after `state["lead_state"][thread_id] = existing`, add:

```python
        contact_id = hubspot_upsert_contact(
            email=parsed["from"],
            name="",
            intent=intent,
            budget=existing["collected"].get("budget", ""),
            timeline=existing["collected"].get("timeline", ""),
            area=existing["collected"].get("area", ""),
            assigned_agent=TEAM_LEAD_EMAIL
        )
        if contact_id:
            hubspot_add_note(contact_id, f"Lead type: {intent}\n\n{parsed['body'][:1000]}")
        notify_agent(gmail, TEAM_LEAD_EMAIL, TEAM_NAME, parsed["from"],
                     parsed["subject"], intent,
                     f"New {intent}: budget={existing['collected'].get('budget','?')}, timeline={existing['collected'].get('timeline','?')}, area={existing['collected'].get('area','?')}")
```

- [ ] **Step 3: Run agent to verify no import/startup errors**

```bash
cd ~/Downloads/real_estate_email_agent && python3 -c "import agent; print('all wired ok')"
```

Expected: `all wired ok`

- [ ] **Step 4: Commit**

```bash
git add agent.py && git commit -m "wire HubSpot sync and agent routing into process_message"
```

---

### Task 9: Update .env.example and requirements.txt

**Files:**
- Modify: `requirements.txt`
- Create: `.env.example`

- [ ] **Step 1: Verify requirements.txt has all needed packages**

All new data sources use `requests` which is already in requirements.txt. No new packages needed.

```bash
grep requests ~/Downloads/real_estate_email_agent/requirements.txt
```

Expected: `requests`

- [ ] **Step 2: Create .env.example for client onboarding**

Create `~/Downloads/real_estate_email_agent/.env.example`:

```
GMAIL_CREDENTIALS_PATH=credentials.json
GMAIL_TOKEN_PATH=token.json
GOOGLE_SHEET_ID=your_sheet_id_here
ANTHROPIC_API_KEY=sk-ant-...
APIFY_TOKEN=apify_api_...
RENTCAST_API_KEY=your_rentcast_key
CALENDLY_URL=https://calendly.com/your-link/30min
TEAM_NAME=Your Brokerage Name
TEAM_LEAD_EMAIL=lead@yourbrokerage.com
PROPERTY_MANAGER_EMAIL=pm@yourbrokerage.com
HUBSPOT_API_KEY=pat-na1-...
FRED_API_KEY=your_fred_key
CENSUS_API_KEY=your_census_key
POLL_INTERVAL_SECONDS=60
```

- [ ] **Step 3: Commit**

```bash
git add .env.example requirements.txt && git commit -m "add .env.example for client onboarding"
```

---

### Task 10: End-to-end smoke test

**Files:**
- No code changes — testing only

- [ ] **Step 1: Start the agent**

```bash
cd ~/Downloads/real_estate_email_agent && python3 agent.py
```

Expected output:
```
Agent started. Monitoring new emails from 2026-...
[HH:MM:SS] No new messages
```

- [ ] **Step 2: Send test email — property inquiry**

From a different Gmail account, send to the agent's inbox:
```
Subject: Question about a property
Body: Hi, I'm interested in 7808 Woodcroft Dr, Austin TX. Can you tell me more?
```

Expected within 60s:
- Reply arrives with property details, no emojis, no em-dashes
- Gmail label `AUTO_REPLIED` applied
- Console shows: `Intent: property_details | Address: 7808 Woodcroft Dr`

- [ ] **Step 3: Send test email — buyer lead**

```
Subject: Looking to buy
Body: Hi, I'm looking to buy a 3 bedroom home in South Austin under $500k. My timeline is about 3 months.
```

Expected:
- Reply asks for budget confirmation or pre-approval status
- Label `AUTO_REPLIED` applied
- Console shows: `Intent: buyer_lead`

- [ ] **Step 4: Send test email — unknown property (Apify fallback)**

```
Subject: Property question
Body: What can you tell me about 4309 Fairway Path, Round Rock TX?
```

Expected:
- Agent hits Apify, returns live Zillow data
- Reply has property details from Zillow
- Console shows: `Apify found: ...`

- [ ] **Step 5: Commit if all passing**

```bash
git add . && git commit -m "verified end-to-end: property lookup, lead routing, Apify fallback all working"
```
