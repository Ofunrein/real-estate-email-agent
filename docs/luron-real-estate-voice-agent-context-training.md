# Luron AI Real Estate Voice Agent Context Training

Source video: https://www.youtube.com/watch?v=-ABD6xZUiHQ  
Channel: https://www.youtube.com/channel/UCbhujT0ntSx4ua__SIS5sYg  
Title: Real Estate - Luron AI Live Demo  
Pipeline: `yt-dlp` captions + video download, `ffprobe` metadata, `ffmpeg` audio extraction. Transcript below uses YouTube English captions from `yt-dlp`.

## Extracted transcript

Hello, thank you calling Luron realy. I'm your virtual assistant. How can I help you today? Hi, I saw rental listing in Brooklyn on your site and wanted check if it's still available. I'd happy check you. Do you happen listing number street name? I think it 2159. It is three-bedroom unit on second floor near Prospect Park. One moment, please. Yes, I found it. That unit still available. rent is $3,950 per month includes heat, water, kitchen appliances. Is price negotiable all? The listed rent is currently firm, but payment terms movein dates sometimes discussed directly agent viewing. Would you like schedule tour? Yes, I'd prefer Saturday morning if that's possible. Let me check. Saturday morning fully booked, but we do Saturday 400 p.m. Sunday 10:00 a.m. available. Which one works better? Let's go Saturday 4 p.m. Got it. I've booked you Saturday 4 p.m. You'll receive confirmation text shortly address agent's name. Would you like copy sent via email as well? Yes, please. My email is david.adam89@gmail.com. Details sent. Do you any other questions about apartment? Yes. Does include private parking space? Yes, comes with one reserved parking spot behind building. Perfect. Thanks, Laya. My pleasure, David. We hope viewing goes well. Feel free to reach out if anything comes up. Have great day. Thanks. Goodbye.

## What this exposes

This agent feels smarter mostly because it has a richer property context object available during the call. It can answer:

- Availability/status.
- Rent.
- Included utilities.
- Included appliances.
- Negotiability boundary.
- Calendar availability.
- Confirmation channel.
- Email confirmation.
- Parking.

Iris already has `lookupProperty`, `searchProperties`, `checkAvailability`, `bookConsultation`, and SMS confirmation. The gap is not only prompting. The gap is how much property context gets stored, retrieved, and spoken during the call.

## Iris rule added

Property context should beat generic qualification. If caller asks about a listing, Iris should answer the listing question first from tools, then ask the smallest next booking question.

The voice prompt now includes a property context capsule:

- Availability/status.
- Price or rent.
- Beds/baths.
- Sqft.
- Property type.
- Neighborhood.
- Included utilities/appliances.
- Parking.
- Days on market.
- Viewing availability.
- Agent handoff path.

Only facts returned by tools or caller context can be mentioned.

## Code changes

- `lib/ariaAssistant.ts`
  - Added property context capsule.
  - Added rule to answer listing context before generic qualification.

- `lib/ariaData.ts`
  - `speakProperty` now includes richer stored listing facts when present:
    - status
    - property type
    - features
    - description fallback
    - days on market
  - `speakSearchOption` now includes sqft and property type when present.

- `scripts/aria-provision.mjs`
  - Expanded `lookupProperty` tool description so Vapi knows to call it for utilities, appliances, parking, fees, pets, days on market, and listing details.

- `tests/test_aria_voice_contract.py`
  - Added guard for property context capsule.

- `tests/ts/ariaData.test.ts`
  - Added guard that richer property facts are spoken.

## Next needed product work

To truly match this behavior, we need a structured property context layer, not just prompt text.

Recommended next tickets:

1. Expand property schema
   - utilities_included
   - appliances_included
   - parking
   - pet_policy
   - deposit
   - fees
   - lease_terms
   - floor
   - unit_number
   - available_date
   - showing_instructions
   - negotiability_notes
   - listing_agent_name
   - listing_agent_phone

2. Import richer data
   - Zillow/Apify fields when available.
   - MLS or CRM listing notes when available.
   - Manual sheet columns for client-specific context.

3. Add property context builder
   - One normalized object for voice, SMS, email, and dashboard.
   - Redacts unsafe or missing facts.
   - Converts fields into short voice-safe sentences.

4. Add eval calls
   - Availability question.
   - Utilities question.
   - Parking question.
   - Negotiability question.
   - Tour scheduling when preferred slot unavailable.
   - Confirmation by SMS and email.
