# Luron AI Voice Agent Analysis for Iris

Source video: https://www.youtube.com/watch?v=Yzmc59GAPVQ  
Title: Travel & Hospitality - Luron AI Live Demo  
Pipeline: `yt-dlp` captions + video download, `ffprobe` metadata, `ffmpeg` audio extraction. Whisper CLI was attempted but local interpreter path is broken, so this artifact uses YouTube English captions.

## Extracted transcript

Hello and thank you for calling Luron Hotel New York. I'm your virtual assistant. How can I help you today? Hi there. I'm looking to book a room for two people this Saturday. Do you have availability? Let me check real quick. Yes, we do have availability for Saturday, May 4th. Both standard and city view rooms are open. Do you know what time you'll be checking in? We'll be arriving around 1:00 a.m. Our flight gets late. No worries at all. Our front desk is open 24/7 and I'll make a note for late check-in. Which room type would you prefer? Let's go with the city view room, please. Excellent choice. I'll reserve the city view room for Saturday night. The nightly rate is $345 and you can pay a check-in with a credit card or cash. Would you like me to send a confirmation via text? Yes, that would be great. Perfect. Your confirmation has been sent and it includes all the reservation details. Is there anything else I can assist you with? Nope, that's everything. Thank you so much. You're very welcome. Your reservation is all set. We look forward to welcoming you to New York.

## What works psychologically

- Immediate service frame: opens like front desk, not sales bot. Caller feels oriented in one sentence.
- Low-friction control: asks one small next question at a time, never dumps a form.
- Fast competence signal: checks availability before over-qualifying, proving usefulness early.
- Contextual empathy: late arrival gets reassurance plus operational action, not generic sympathy.
- Choice architecture: offers room type and confirmation channel as easy options.
- Certainty close: repeats reservation, price, payment path, and confirmation so caller leaves settled.
- Hospitality language: warm words tied to action, not empty praise.
- Micro-commitments: each answer advances booking by one low-risk step.
- Cognitive load reduction: simple sentences, short turns, no tool/process talk.
- Trust through boundaries: states 24/7 front desk, payment at check-in, confirmation text.

## Real estate translation for Iris

Iris should not mimic hotel details. She should copy the care pattern:

1. Answer first, then qualify.
2. Make caller feel handled before collecting every field.
3. Ask the smallest next useful question.
4. Convert concern into operational reassurance.
5. Confirm critical details before booking, texting, emailing, or transferring.
6. Close with a concrete next step and calm certainty.

Real estate equivalents:

- Availability check -> search listings, check calendar, or lookup property during the call.
- Late check-in reassurance -> "No problem, I can note evening availability and text options."
- Room preference -> neighborhood, beds, baths, budget, timeline, showing window.
- Reservation confirmation -> showing confirmation, valuation appointment, property links, human handoff.
- Front desk tone -> brokerage concierge tone.

## Vapi implementation guidance

Add these rules to Iris Vapi system prompt, not as brittle example dialogue:

- Concierge sequence: orient, answer, reassure, ask one next question, confirm, close.
- Use "action empathy": every empathy line must attach to an action Iris can take.
- Prefer concrete operational language over hype.
- For buyer calls, call `searchProperties` as soon as there is any usable criterion.
- For showing or valuation calls, confirm date, time, timezone, property/address, contact method.
- Always offer confirmation by text or email after booking or sending listings.
- End calls with a settled summary, not open-ended ramble.

## Iris sample tone

Buyer:
"Got it. I can check that now. For South Austin under $800k, are you thinking two bedrooms minimum, or should I include one-bed options too?"

Late or tight schedule:
"No problem. I can note evening availability and only send options that work after 6. What part of town should I hold to?"

Showing close:
"Perfect. I have Tuesday at 4:30 or Wednesday at 10:00. Which one works better? Once you pick, I will text the address and confirmation."

Seller:
"I can help with that. What is the property address? I will pull the basics first, then we can set a quick valuation call if it looks worth digging into."
