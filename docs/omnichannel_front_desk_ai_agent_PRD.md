# PRD & Technical Scope: Omni-Channel Front Desk AI Agent
**Product:** Lumenosis Front Desk AI Agent  
**Channels:** Instagram DMs · Facebook Messenger · WhatsApp Business · SMS (Twilio) · Voice (Vapi)  
**Integration Path:** Composio SDK (White-Label OAuth) + Meta Graph API + ManyChat Coexistence  
**Date:** June 21, 2026  
**Status:** Draft v1.2

---

## Implementation Scope

The repo-aligned execution plan lives in [omnichannel_execution_plan.md](./omnichannel_execution_plan.md). Use that document for build order, channel ownership, Composio-vs-direct decisions, subagent workstreams, test gates, and deployment sequencing.

---

## 1. Product Overview

A white-label AI front desk agent that connects to a user's Instagram Business account, Facebook Page, SMS line, and phone number. It automatically reads incoming DMs and messages, qualifies leads (e.g. seller leads in real estate), and replies on behalf of the account owner — 24/7, without human intervention for routine conversations.

Users onboard in under 5 minutes by connecting their accounts via OAuth. The agent coexists with ManyChat, taking over only on configured keyword triggers (e.g. "sell", "price", "info") so existing ManyChat flows are not disrupted.

---

## 2. Target User

- Real estate agents, investors, and wholesalers
- Small business owners managing high DM volume
- Marketing agencies running the agent on behalf of clients

---

## 3. Core Features

### 3.1 Account Connection (Onboarding)
- User clicks "Connect Instagram" or "Connect Facebook Page"
- OAuth flow via **Composio SDK** — no manual token entry
- Composio stores the access token; the agent references it via toolkit calls
- Supports multi-account (one agent instance per connected Page/IG account)

### 3.2 Instagram DM Management
- **Read** incoming DMs via `GET /me/conversations` (Instagram Graph API)
- **Send** replies via `POST /{ig-user-id}/messages`
- **Webhook trigger** on `messages` object — fires the agent on every new DM
- Required scope: `instagram_manage_messages`, `instagram_basic`
- Limitation: 24-hour messaging window applies — agent can only reply to users who messaged first within the last 24 hours (same rule ManyChat follows)

### 3.3 Facebook Messenger Management
- **Read** messages via `GET /{page-id}/conversations`
- **Send** replies via `POST /me/messages`
- **Webhook trigger** on `messages` and `messaging_postbacks`
- Required scope: `pages_messaging`, `pages_read_engagement`, `pages_manage_metadata`
- Supports Message Tags for follow-ups outside the 24-hour window (e.g. `CONFIRMED_EVENT_UPDATE`)

### 3.4 Comment-to-DM Keyword Trigger
- Webhook listens on `feed` / `comments` for new post comments
- Agent checks comment text against configured keyword list (e.g. ["sell", "cash offer", "interested"])
- On match: immediately fires a DM to the commenter (the comment event opens the 24hr window)
- Required scope: `instagram_manage_comments`, `pages_read_engagement`
- This is the primary lead capture mechanism — same model as ManyChat

### 3.5 ManyChat Coexistence
- Keyword namespacing: user configures which keywords belong to the AI agent vs ManyChat
- When agent's keyword triggers, it optionally calls **ManyChat API** to pause that subscriber's ManyChat flows (via `POST /fb/subscriber/pause_automation`)
- When AI conversation ends or escalates, ManyChat automation is resumed
- Prevents double-replies and conflicting sequences

### 3.6 AI Lead Qualification Logic
- Incoming message → Claude classifies intent:
  - **Seller lead** → qualify (property address, timeline, condition, motivation)
  - **Buyer inquiry** → route to buyer funnel or human
  - **General question** → answer from knowledge base
  - **Spam/irrelevant** → ignore or polite deflect
- Conversation context stored per thread (in-memory or database)
- Escalation rule: if lead is hot (motivated seller), notify human via Slack/email

### 3.7 SMS Channel (Twilio)
- Inbound SMS via Twilio webhook → same AI qualification logic
- Outbound SMS replies via `twilio.messages.create()`
- Keyword opt-in: user texts a keyword to the agent's Twilio number to enter a flow
- Two-way conversation threading by phone number
- Required: Twilio Account SID, Auth Token, phone number (10DLC registered for A2P)

### 3.8 WhatsApp Business Channel
- **Composio WhatsApp toolkit** handles the connection — no direct Meta Business API setup needed
- **Read** incoming messages, **send** text and media replies, manage templates
- Same AI qualification logic as IG/Messenger — seller keyword → qualify → CRM
- **Webhook trigger** on incoming WhatsApp messages to your Business number
- Required: WhatsApp Business account (via Meta Business Manager or Twilio WhatsApp sandbox)
- **Two paths:**
  - **Composio-native** (`WHATSAPP_SEND_MESSAGE` etc.) — fastest to connect, uses Composio's managed auth
  - **Twilio WhatsApp API** — if user already has a Twilio number, add WhatsApp capability directly
- Limitation: WhatsApp Business only (not personal accounts); 24-hour session window same as Meta

### 3.10 Voice Cloning (ElevenLabs + Fish Audio)

Users can clone their own voice so the AI agent speaks in their voice on calls (Vapi outbound) and can generate voice replies sent as audio messages across all channels.

#### Why Voice Cloning?
- Brand consistency: leads hear YOUR voice even when the AI is responding
- Higher response rates on voice DMs vs. plain text
- "Send voice" reply — AI generates a short audio message in the user's cloned voice and sends it as a DM/MMS

#### Recommended SDKs (pick one or offer both as user options)

| Service | Clone Sample Needed | API Cost | Quality | SDK |
|---|---|---|---|---|
| **Fish Audio** ⭐ Best value | **10 seconds** | $15/million chars (~$0.000015/char) | Excellent — sub-300ms streaming, 13 languages | Python + TypeScript SDK |
| **ElevenLabs** ⭐ Best quality | 1–3 minutes (PVC) / instant (quick) | From $22/mo (Creator) — includes 100k credits | Highest quality, most natural | Python + TypeScript SDK |
| **PlayHT** | 30+ seconds | $31.20/mo (Creator) | Solid, 140+ languages | REST API |
| **Resemble AI** | 20 seconds | $0.006/second generated | Advanced control, SOC 2, watermarking | Python + REST |

**Recommended stack:**
- **Fish Audio** as default — cheapest per-call, 10-second sample, fast clone, no monthly commitment on pay-as-you-go
- **ElevenLabs Creator ($22/mo)** as the premium tier option for users who want hyper-realistic professional voice cloning (PVC — longer training sample, dramatically more natural output)

#### Implementation: Voice Clone Onboarding for Your Users

```typescript
// Fish Audio — clone a user's voice from a 10-second recording
import FishAudio from 'fish-audio-sdk';

const client = new FishAudio({ apiKey: process.env.FISH_AUDIO_API_KEY });

// Step 1: User records 10s of clean audio (use the Voice Recorder UI below)
// Step 2: Upload and create the voice model
const model = await client.models.create({
  title: `${user.name} - Cloned Voice`,
  voices: [{ audio: audioBuffer, text: transcribedText }],  // reference audio + text
});

// Step 3: Store model.id in user profile
// Step 4: Generate speech in their voice
const audioStream = await client.tts({
  model_id: model._id,
  text: "Hi, this is a reply from my AI assistant...",
  format: 'mp3',
  streaming: true,       // sub-300ms first byte
});
```

```typescript
// ElevenLabs — Professional Voice Clone (Creator plan+)
import ElevenLabs from "elevenlabs";

const elevenlabs = new ElevenLabs({ apiKey: process.env.ELEVENLABS_API_KEY });

// Instant clone (any plan): 1-minute sample
const voice = await elevenlabs.voices.ivc.create({
  name: `${user.name} Voice`,
  files: [audioFile],         // the user's recorded sample
});

// Generate TTS in their voice
const audio = await elevenlabs.textToSpeech.convert(voice.voice_id, {
  text: "Thanks for reaching out! I'd love to hear more about your property.",
  model_id: "eleven_turbo_v2_5",
});
```

#### Voice Reply — Sending Audio Across Channels

| Channel | How to Send Voice Message | Format |
|---|---|---|
| **Instagram DMs** | `INSTAGRAM_SEND_AUDIO_MESSAGE` via Composio or Graph API audio attachment | MP3 / AAC |
| **Facebook Messenger** | `POST /me/messages` with `attachment.type: "audio"` | MP3 |
| **WhatsApp** | WhatsApp natively supports voice notes — send via Twilio WA / Composio WA audio endpoint | OGG/Opus or MP4 |
| **SMS (Twilio MMS)** | `twilio.messages.create({ mediaUrl: [audioUrl] })` | MP3 link (hosted) |
| **Email** | Attach MP3 file or embed audio player | MP3 |

---

### 3.11 Voice Recording + Speech-to-Text UI

A voice input widget that lets users (or the agent's end-users) record a message, see live waveform visualization, then stop and review the transcription before sending — exactly like ChatGPT's voice input.

#### UI Components

```
┌────────────────────────────────────────────────────┐
│  🎙️  [~~live waveform waves~~]  [⏹ Stop]  [✕]     │  ← Recording state
└────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────┐
│  📝  "Hi I wanted to ask about selling my house..." │
│            [Re-record]    [➤ Send]                  │  ← Review state
└────────────────────────────────────────────────────┘
```

#### Recommended React Libraries

| Library | What it gives you | Install |
|---|---|---|
| **react-voice-visualizer** | Full hook + canvas waveform + controls | `npm i react-voice-visualizer` |
| **react-audio-voice-recorder** | Simple `useAudioRecorder` hook, headless | `npm i react-audio-voice-recorder` |
| **wavesurfer.js** | Real-time waveform + playback visualization | `npm i wavesurfer.js` |

**Recommended:** `react-voice-visualizer` — drop-in waveform + MediaRecorder + hook, handles all browser quirks.

#### Implementation

```tsx
// VoiceInputWidget.tsx
import { useVoiceVisualizer, VoiceVisualizer } from "react-voice-visualizer";

export function VoiceInputWidget({ onSend }: { onSend: (text: string, audioBlob: Blob) => void }) {
  const recorderControls = useVoiceVisualizer();
  const { recordedBlob, isRecording, stopRecording, startRecording } = recorderControls;
  const [transcript, setTranscript] = useState<string | null>(null);

  // When recording stops → transcribe via Whisper/Deepgram
  useEffect(() => {
    if (!recordedBlob) return;
    transcribeAudio(recordedBlob).then(setTranscript);
  }, [recordedBlob]);

  async function transcribeAudio(blob: Blob): Promise<string> {
    const formData = new FormData();
    formData.append("file", blob, "recording.webm");
    formData.append("model", "whisper-1");
    const res = await fetch("/api/transcribe", { method: "POST", body: formData });
    const data = await res.json();
    return data.text;
  }

  return (
    <div className="voice-input">
      {isRecording && (
        <>
          <VoiceVisualizer controls={recorderControls} height={48} width={320}
            barColor="#6366f1" backgroundColor="transparent" />
          <button onClick={stopRecording}>⏹ Stop</button>
        </>
      )}
      {!isRecording && !transcript && (
        <button onClick={startRecording}>🎙️ Record</button>
      )}
      {transcript && (
        <div className="review">
          <p>{transcript}</p>
          <button onClick={() => { setTranscript(null); startRecording(); }}>Re-record</button>
          <button onClick={() => onSend(transcript, recordedBlob!)}>➤ Send</button>
        </div>
      )}
    </div>
  );
}
```

#### Transcription Options (STT)

| Service | Accuracy | Cost | Latency |
|---|---|---|---|
| **OpenAI Whisper API** | Excellent | $0.006/min | ~1–3s |
| **Deepgram Nova-3** | Excellent | $0.0043/min | <500ms streaming |
| **AssemblyAI** | Very good | $0.005/min | ~1s |
| **Groq Whisper** | Good | $0.01/hour | Very fast |

**Recommended:** Deepgram Nova-3 if you want live streaming transcription (words appear as user speaks). Whisper if batch-after-stop is fine.

#### Where This Widget Lives

- **Agent Dashboard** — user dictates replies to leads instead of typing
- **Lead capture landing pages** — "Record a voice message about your property"
- **Email compose screen** — voice-to-text fills the email body (same waveform UX)
- **Any channel reply box** — replaces keyboard input on mobile (where voice is easier)

#### "Clone Mode" Toggle (Voice Cloning + STT combined)

Add a toggle in the send widget: **"Reply with my voice"**

```
┌────────────────────────────────────────────────────────┐
│  📝  "Thanks for reaching out, are you looking to sell?"│
│  [🎙️ Reply with my voice]  [Send as text]              │
└────────────────────────────────────────────────────────┘
     ↓ if voice toggled:
  1. Generate TTS using Fish Audio / ElevenLabs in user's cloned voice
  2. Upload MP3 to CDN
  3. Send as audio attachment on IG/Messenger/WA or MMS link on SMS
```

---

### 3.12 iMessage Relay (Build Options)

Apple does not expose a public iMessage API. The options below are the only working paths.

#### How iMessage Relay Works (Under the Hood)
iMessage is built on Apple's **APNs (Apple Push Notification Service)** — an end-to-end encrypted proprietary protocol. Messages are routed through Apple's servers to the destination Apple ID or phone number. There is no webhook, no REST API, no OAuth — Apple controls the pipe entirely.

Every relay approach works by **putting a Mac in the middle**:

```
Sender → APNs (Apple servers) → Mac running Messages.app → chat.db (SQLite)
                                         ↓
                               Relay server reads chat.db
                               (BlueBubbles / AirMessage / AppleScript)
                                         ↓
                               REST API / WebSocket → Your AI Agent
                                         ↓
                               AppleScript → Messages.app → Sends reply
                                         ↓
                               APNs → Recipient as blue bubble
```

The "relay" is just a bridge app running on a Mac 24/7 that reads/writes to Messages.app on your behalf.

#### Option 1: BlueBubbles (Free, Open Source — Requires Mac)
- Install [BlueBubbles Server](https://bluebubbles.app) on a Mac mini/Mac server
- Sign into your Apple ID → BlueBubbles reads `~/Library/Messages/chat.db`
- Exposes a **REST API** (send, read, search messages) + **WebSocket webhooks** (fires on every new message)
- Your AI agent subscribes to the webhook → receives message → processes → calls REST API to reply
- Cost: Free. Mac mini M2 runs ~$5–10/mo on a cloud VM service like MacStadium or Hetzner Mac

```js
// BlueBubbles — receive webhook
app.post('/webhook', (req, res) => {
  const { type, data } = req.body;
  if (type === 'new-message' && !data.isFromMe) {
    const reply = await aiAgent.process(data.text);
    await fetch(`${BB_SERVER}/api/v1/message/text`, {
      method: 'POST',
      body: JSON.stringify({ chatGuid: data.chatGuid, message: reply }),
      headers: { 'db-guid': BB_PASSWORD }
    });
  }
});
```

#### Option 2: Claw Messenger (No Mac Required — $5–25/mo)
- Managed API service — they run the Mac relay infrastructure for you
- Uses **Linq Partner API** (Apple-approved business gateway) under the hood
- You get a dedicated phone number that receives iMessages as blue bubbles
- Connect via WebSocket or REST API — no Mac, no Apple ID, deploys to any VPS/Docker/cloud
- Integrates with OpenClaw, LangChain, n8n, custom Node agents

```bash
# Install for OpenClaw
openclaw plugins install @emotion-machine/claw-messenger
# Add API key to openclaw.json, restart gateway — iMessage live
```

#### Option 3: Apple Messages for Business (Official — Hard)
- The **only** Apple-sanctioned path to blue-bubble iMessage for businesses
- Requires months of Apple review: live human support, AI disclosure, UI compliance, messaging provider sign-off
- Poke (by Interaction Co.) is the first and only third-party AI agent Apple approved (June 2026)
- Once approved, users chat with your business as a verified iMessage contact (blue bubbles, native UI)

#### Build Recommendation for Lumenosis
| Path | Cost | Time to ship | iMessage? | Scalable? |
|---|---|---|---|---|
| **BlueBubbles** (Mac VPS) | ~$10/mo infra | 1–2 days setup | ✅ Blue bubble | ✅ (1 Apple ID per Mac) |
| **Claw Messenger** | $5–25/mo per number | 5 min setup | ✅ Blue bubble | ✅ Multi-tenant |
| **Apple Messages for Business** | Free (if approved) | Months | ✅ Native | ✅ Enterprise |
| **Twilio SMS (Folk model)** | ~$1/mo per number | Already built | ❌ Green bubble | ✅ |

**Recommended for your stack:** Start with **Claw Messenger** for zero Mac ops overhead — plug in the API key, get a number, wire it into your existing webhook router. If scale demands it, self-host BlueBubbles on a Mac mini VPS later.

---

### 3.9 Voice Channel (Vapi) ⚡ Already Built
- Inbound calls → Vapi answers with AI voice agent
- Real-time STT (Deepgram) → Claude reasoning → ElevenLabs/Vapi TTS
- Call flow: greeting → qualify (motivated seller?) → schedule callback or transfer
- Outbound calls: agent dials leads and delivers scripted opener
- Webhook on call end → transcript + summary stored in CRM (GoHighLevel/HubSpot)
- **Note:** Vapi integration is already live in the Lumenosis stack — this channel requires wiring into the unified webhook router, not a fresh build

---

## 4. Technical Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     USER ONBOARDING                               │
│  White-labeled Composio OAuth → stores IG/FB/WA/Twilio tokens    │
│  (your brand: logo, domain, your own OAuth app)                   │
└────────────────────────┬─────────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│                      WEBHOOK ROUTER                               │
│  Meta Webhooks (IG + FB) · Composio WA · Twilio SMS · Vapi       │
└──────┬──────────────┬──────────────┬──────────────┬──────────────┘
       │              │              │              │
  IG DMs        FB Messenger    WhatsApp       SMS / Voice
       │              │              │              │
┌──────▼──────────────▼──────────────▼──────────────▼──────────────┐
│                    AI AGENT CORE (Claude)                          │
│  1. Classify intent                                                │
│  2. Check keyword trigger (seller lead?)                           │
│  3. Qualify lead via conversation                                  │
│  4. Generate reply                                                 │
│  5. Log to CRM (GoHighLevel / HubSpot)                            │
└──────┬──────────────┬──────────────┬──────────────┬──────────────┘
       │              │              │              │
  Send IG DM    Send FB Msg    Send WA Msg    Send SMS / Call
  (Composio)    (Composio)    (Composio/     (Twilio / Vapi⚡)
                               Twilio WA)
```

---

## 5. SDK & Integration Stack

| Layer | Tool | Purpose |
|---|---|---|
| Account connection | **Composio SDK** (white-labeled) | OAuth for IG, FB, WhatsApp, Gmail, etc. — your brand, not Composio's |
| AI reasoning brain | **Anthropic Claude SDK** (`@anthropic-ai/sdk`) | Intent classification, reply generation, safety routing, and memory-aware next steps |
| Streaming UI | **Vercel AI SDK** (`ai`) | Dashboard with streaming responses |
| Instagram/Messenger | **Meta Graph API** (via Composio) | Read/send DMs, listen to webhooks |
| WhatsApp | **Composio WhatsApp toolkit** OR **Twilio WhatsApp API** | Two-way WhatsApp Business messaging |
| SMS | **Twilio Node SDK** (`twilio`) | Two-way SMS conversations |
| Voice | **Vapi SDK** ⚡ Already built | Inbound/outbound AI phone calls |
| Voice cloning (budget) | **Fish Audio SDK** (`fish-audio-sdk`) | 10s sample → cloned voice; $15/million chars; sub-300ms streaming |
| Voice cloning (premium) | **ElevenLabs SDK** (`elevenlabs`) | Professional Voice Cloning (PVC); hyper-realistic; $22/mo Creator+ |
| Voice synthesis (calls) | **ElevenLabs / Fish Audio** | Branded cloned voice for Vapi outbound calls |
| STT / Transcription | **Deepgram SDK** (`@deepgram/sdk`) | Live streaming speech-to-text for voice recording UI |
| Voice recording UI | **react-voice-visualizer** | Live waveform canvas, MediaRecorder, stop/send controls |
| ManyChat | **ManyChat API** (REST) | Pause/resume subscriber flows |
| CRM | **GoHighLevel API** / **HubSpot SDK** | Log leads, trigger pipelines |
| Notifications | **Slack SDK** | Alert human on hot leads |
| Orchestration | **LangGraph** (optional) | Multi-step agent flows |

---

## 6. Meta API Scopes Required

### Instagram
| Scope | Required for |
|---|---|
| `instagram_basic` | Account access |
| `instagram_manage_messages` | Read + send DMs |
| `instagram_manage_comments` | Comment keyword triggers |
| `instagram_content_publish` | (Optional) post content |

### Facebook Page / Messenger
| Scope | Required for |
|---|---|
| `pages_messaging` | Send/receive Messenger messages |
| `pages_read_engagement` | Read comments for keyword triggers |
| `pages_manage_metadata` | Subscribe to page webhooks |
| `pages_read_user_content` | Read post comments |

**App Review:** Both `instagram_manage_messages` and `pages_messaging` require Meta App Review before going live with external users. Development/testing mode works on your own accounts without review.

---

## 7. White-Label Authentication (Composio)

When you ship this as a product your clients use, they must not see "Composio" branding during the OAuth flow. Composio supports full white-labeling at three levels:

### Level 1 — Connect Link Branding (Quick)
- Go to **Composio Project Settings → Auth Screen**
- Upload your logo and set your app title
- All OAuth connect pages now show **your brand**, not Composio's
- One logo per project — use separate projects if you need per-client branding

### Level 2 — Bring Your Own OAuth App (Production)
- By default, OAuth consent screens say "Composio wants to access your account"
- For production: create your own Meta App (Facebook Developer), Google Cloud project, etc.
- Supply your `client_id` and `client_secret` to Composio's custom auth config
- Users now see **"[Your App Name] wants to access your account"** — fully white-labeled
- Removes the "Secured by Composio" badge entirely

### Level 3 — Custom Redirect URI (Domain White-Label)
- Proxy the OAuth redirect through your own domain (e.g. `https://app.lumenosis.com/auth/callback`)
- Composio's domain never appears in the URL bar during the auth flow

```javascript
// Composio SDK — white-labeled connection initiation
const connection = await composio.connectedAccounts.initiate({
  integrationId: "instagram",
  entityId: user.id,
  redirectUri: "https://app.lumenosis.com/auth/callback",  // your domain
  // authConfig: "your-custom-oauth-app-id"  // Level 2: your own Meta App
});
```

**Recommended for SaaS / agency deployments:** Level 2 + Level 3 combined. Your clients see only your brand end-to-end.

---

## 8. Composio SDK Onboarding Flow (for your end users)

```javascript
import { Composio } from "@composio/core";

const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });

// 1. Create a connected account for the user
const connection = await composio.connectedAccounts.initiate({
  integrationId: "instagram",    // or "facebook"
  entityId: user.id,             // your user's ID in your system
  redirectUri: "https://yourapp.com/callback"
});

// 2. Redirect user to OAuth URL
res.redirect(connection.redirectUrl);
// → User logs into Instagram, grants permissions, gets redirected back

// 3. On callback — connection is now active
// 4. Call tools on behalf of that user
const result = await composio.tools.execute("INSTAGRAM_SEND_TEXT_MESSAGE", {
  entityId: user.id,
  params: { userId: recipientId, message: "Hi! Thanks for reaching out." }
});
```

This is the entire onboarding flow — user clicks, approves, done. No manual token handling.

---

## 9. ManyChat Coexistence Technical Spec

### Keyword Namespace Split
```
ManyChat keywords:   INFO, GUIDE, JOIN, FREE
AI Agent keywords:   SELL, CASH, OFFER, PRICE, INTERESTED, MOTIVATED
```

### Flow on AI Agent Keyword Trigger
1. User comments "SELL" on your post
2. Meta webhook fires → AI Agent receives event
3. AI Agent calls ManyChat API: `PATCH /subscriber/pause_automation` (pauses ManyChat for this subscriber)
4. AI Agent sends initial DM: "Hey! Saw your comment — are you looking to sell your property?"
5. Conversation proceeds through AI qualification
6. On conversation end OR escalation: `PATCH /subscriber/resume_automation`

### ManyChat API Endpoints Used
- `GET /subscriber/by_user_ref` — look up subscriber
- `PATCH /subscriber/pause_automation` — pause their flows
- `PATCH /subscriber/resume_automation` — resume their flows
- `POST /sending/send_content` — optionally send ManyChat template messages

---

## 10. Webhook Setup

### Meta Webhooks (Instagram + Messenger)
```
Webhook URL:    https://yourapp.com/webhooks/meta
Verify Token:   [set in Meta App Dashboard]
Subscribe to:   messages, messaging_postbacks, feed (for comments)
```

### Twilio SMS Webhook
```
Webhook URL:    https://yourapp.com/webhooks/twilio/sms
Method:         POST
Trigger:        Incoming SMS to your Twilio number
```

### Vapi Webhook
```
Server URL:     https://yourapp.com/webhooks/vapi
Events:         call-started, call-ended, transcript, tool-calls
```

### WhatsApp Webhook (Composio-native)
```
# Composio handles the webhook subscription automatically when you
# call connectedAccounts.initiate() for WhatsApp.
# For Twilio WhatsApp:
Webhook URL:    https://yourapp.com/webhooks/twilio/whatsapp
Method:         POST
Trigger:        Incoming WhatsApp message to your Twilio WA number
```

---

## 11. CRM Integration

On qualified lead detected:
1. Create contact in **GoHighLevel** with name, phone, channel source
2. Add to pipeline stage: "New Seller Lead"
3. Tag: `ig-dm` / `messenger` / `sms` / `voice`
4. Trigger automated follow-up sequence (email + SMS drip)
5. Notify assigned agent via Slack

---

## 12. Key Constraints & Limitations

| Constraint | Detail |
|---|---|
| 24-hour messaging window | Meta enforces this on all DM sends. Agent can only reply within 24hrs of the user's last message. Comment-to-DM trigger bypasses this at the moment of the comment. |
| Meta App Review | `instagram_manage_messages` and `pages_messaging` require formal App Review to use with external users. Dev mode works for testing on your own accounts. |
| iMessage (direct) | No public API — not buildable for third parties. |
| iMessage (workaround) | **Folk model:** give users a Twilio number that appears as a text thread in iMessage (SMS/green bubble). **Poke model:** apply to Apple Messages for Business — months-long Apple approval required. |
| WhatsApp | Business accounts only (not personal). 24-hour session window. |
| Twilio 10DLC | SMS to US numbers requires 10DLC brand/campaign registration (~2–4 weeks). |
| Vapi pricing | Per-minute billing. Budget for ~$0.05–$0.12/min depending on voice model. |
| ManyChat API | Available on Pro plan and above. |

---

## 13. Build Phases

### Phase 1 — Core DM Agent (Weeks 1–3)
- [ ] Set up Meta App (Instagram + Messenger webhooks)
- [ ] Integrate Composio SDK for user OAuth onboarding
- [ ] Build webhook router (Node.js / Next.js API routes)
- [ ] Connect Claude as the reasoning brain for intent classification + reply generation
- [ ] Test on own IG Business + Facebook Page accounts
- [ ] Deploy to production + submit Meta App Review

### Phase 2 — ManyChat Coexistence (Week 4)
- [ ] Build keyword namespace configuration UI
- [ ] Implement ManyChat pause/resume API calls
- [ ] Test coexistence on live accounts

### Phase 3 — WhatsApp + SMS + Voice (Weeks 5–6)
- [ ] Connect WhatsApp Business via Composio WhatsApp toolkit (or Twilio WA)
- [ ] Integrate Twilio for inbound/outbound SMS
- [ ] Wire existing Vapi integration into unified webhook router (already built — just routing)
- [ ] Unified conversation logging across all channels

### Phase 3.5 — Voice Cloning + STT Widget (Week 6, parallel with Phase 3)
- [ ] Integrate Fish Audio SDK — user records 10s sample → model created → ID stored
- [ ] Integrate ElevenLabs as premium tier option (Creator plan onboarding)
- [ ] Build `VoiceInputWidget` React component with live waveform (react-voice-visualizer)
- [ ] Wire Deepgram STT for live transcription on stop
- [ ] Add "Reply with my voice" toggle to all channel reply boxes
- [ ] Enable audio message sending on IG, Messenger, WhatsApp, and Twilio MMS

### Phase 4 — CRM + Dashboard (Weeks 7–8)
- [ ] GoHighLevel / HubSpot lead logging
- [ ] Agent dashboard: connected accounts, conversation history, lead stats
- [ ] Slack escalation alerts
- [ ] White-label branding for client deployment

---

## 14. Exit Criteria

The agent is "done" when:
1. A new user can connect their Instagram Business account + Facebook Page in under 5 minutes via OAuth
2. The agent automatically replies to DMs on both channels within 30 seconds of receipt
3. Keyword comment triggers fire a DM correctly (tested end-to-end)
4. ManyChat flows pause/resume without conflict
5. Qualified leads appear in GoHighLevel pipeline automatically
6. WhatsApp Business channel is live and routing through the same AI logic
7. White-label auth is active — users see your brand throughout the OAuth flow, zero Composio references
8. SMS and Voice (Vapi — already built) are wired into the unified router and logging to CRM
9. Voice cloning is live — user can record a 10s sample and have their cloned voice used on calls and audio DMs
10. Voice recording widget is deployed on all reply interfaces — waveform, stop, transcribe, send flow works end-to-end across IG, Messenger, WhatsApp, SMS (MMS), and email compose

---

*Drafted by Lumenosis Command · June 21, 2026 · v1.3: Added iMessage relay options (BlueBubbles, Claw Messenger, Apple Messages for Business) with full technical architecture, code samples, and build recommendation*
