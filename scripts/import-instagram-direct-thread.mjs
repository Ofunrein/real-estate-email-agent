#!/usr/bin/env node

import fs from "node:fs";
import { Pool } from "pg";

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const index = arg.indexOf("=");
      return [arg.slice(2, index), arg.slice(index + 1)];
    }),
);

const inputPath = args.get("input");
const recipientId = clean(args.get("recipient"));
const username = clean(args.get("username")).replace(/^@/, "");
const replace = process.argv.includes("--replace");
const clientId = process.env.CLIENT_ID || "default";
const clientName = process.env.CLIENT_NAME || clientId;

if (!inputPath) throw new Error("--input=/path/to/direct-thread.json is required");
if (!recipientId) throw new Error("--recipient=<instagram browser thread recipient id> is required");
if (!username) throw new Error("--username=<instagram handle> is required");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const viewerId = clean(payload.viewer_id || "72460256852");
const threadSummary = payload.thread_summary || {};
const threadRef = `instagram:${recipientId}`;
const providerThreadId = clean(threadSummary.thread_v2_id || payload.thread_id);
const contact = Array.isArray(threadSummary.users) ? threadSummary.users[0] || {} : {};
const contactPk = clean(contact.pk || contact.pk_id);
const contactName = `@${username}`;
const source = "instagram_direct_v2_browser_backfill";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

function clean(value) {
  return String(value ?? "").toWellFormed?.().trim() ?? String(value ?? "").trim();
}

function sanitizeJson(value) {
  if (typeof value === "string") return value.toWellFormed?.() ?? value;
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeJson);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, sanitizeJson(entry)]),
  );
}

function json(value) {
  return JSON.stringify(sanitizeJson(value));
}

function timestampToIso(timestamp) {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) return new Date().toISOString();
  return new Date(value / 1000).toISOString();
}

function firstCandidate(media) {
  return media?.image_versions2?.candidates?.[0] ||
    media?.image_versions2?.additional_candidates?.first_frame ||
    media?.carousel_media?.[0]?.image_versions2?.candidates?.[0] ||
    null;
}

function mediaOwner(media) {
  return clean(media?.user?.username || media?.caption?.user?.username);
}

function instagramPermalink(kind, media) {
  const code = clean(media?.code);
  if (!code) return "";
  if (kind === "story") return `https://www.instagram.com/stories/${mediaOwner(media) || "_"}/${code}/`;
  return `https://www.instagram.com/reel/${code}/`;
}

function mediaCaption(media) {
  return clean(media?.caption?.text).replace(/\s+/g, " ").slice(0, 220);
}

function mediaFromInstagramMedia(kind, media) {
  const thumb = firstCandidate(media);
  const owner = mediaOwner(media);
  const linkUrl = instagramPermalink(kind, media);
  const label = kind === "post"
    ? `Instagram post${owner ? `: @${owner}` : ""}`
    : kind === "story"
      ? `Instagram story${owner ? `: @${owner}` : ""}`
      : `Instagram reel${owner ? `: @${owner}` : ""}`;
  const result = [];
  if (thumb?.url) {
    result.push({
      id: clean(media?.id || media?.media_id || media?.pk || media?.fbid),
      url: thumb.url,
      type: "image/jpeg",
      alt: label,
      label,
      linkUrl: linkUrl || undefined,
      providerMetadata: {
        kind,
        ownerUsername: owner || undefined,
        targetUrl: linkUrl || undefined,
        code: clean(media?.code) || undefined,
        mediaId: clean(media?.id || media?.media_id || media?.pk || media?.fbid) || undefined,
        caption: mediaCaption(media) || undefined,
        likeCount: media?.like_count ?? undefined,
        commentCount: media?.comment_count ?? undefined,
      },
    });
  }
  return result;
}

function directMedia(item) {
  if (item.item_type === "clip") {
    const media = item.clip?.clip || item.clip?.media || item.clip;
    return mediaFromInstagramMedia("reel", media);
  }
  if (item.item_type === "media_share") {
    const media = item.direct_media_share?.media || item.media_share;
    const mediaType = Number(media?.media_type || 0);
    return mediaFromInstagramMedia(mediaType === 2 ? "reel" : "post", media);
  }
  if (item.item_type === "story_share") {
    const media = item.story_share?.media;
    return mediaFromInstagramMedia("story", media);
  }
  if (item.item_type === "profile") {
    const profile = item.profile || {};
    const handle = clean(profile.username);
    const label = `Instagram profile${handle ? `: @${handle}` : ""}`;
    if (!profile.profile_pic_url) return [];
    return [{
      id: clean(profile.pk || profile.pk_id || profile.id),
      url: profile.profile_pic_url,
      type: "image/jpeg",
      alt: label,
      label,
      linkUrl: handle ? `https://www.instagram.com/${handle}/` : undefined,
      providerMetadata: {
        kind: "profile",
        ownerUsername: handle || undefined,
        targetUrl: handle ? `https://www.instagram.com/${handle}/` : undefined,
      },
    }];
  }
  if (item.item_type === "voice_media") {
    const audio = item.voice_media?.media?.audio || {};
    const audioUrl = clean(audio.audio_src || audio.fallback?.audio_src);
    if (!audioUrl) return [];
    return [{
      id: clean(item.voice_media?.media?.id || item.item_id),
      url: audioUrl,
      type: "audio/mp4",
      filename: "Voice note.mp4",
      label: "Voice note",
      providerMetadata: {
        kind: "voice_note",
        durationMs: audio.duration ?? undefined,
        waveform: Array.isArray(audio.waveform_data) ? audio.waveform_data : undefined,
      },
    }];
  }
  return [];
}

function itemText(item, media) {
  if (item.item_type === "text") return clean(item.text);
  if (item.item_type === "link") return clean(item.link?.text || item.link?.link_context?.link_url || "Link");
  if (item.item_type === "placeholder") return clean(item.placeholder?.title || item.placeholder?.message || "Message unavailable");
  const label = clean(media[0]?.label);
  const link = clean(media[0]?.linkUrl || media[0]?.providerMetadata?.targetUrl);
  if (label && link) return `${label}\n${link}`;
  if (label) return label;
  return "";
}

function itemSummary(item, text, media) {
  if (text) return text.slice(0, 240);
  if (media.length) return clean(media[0].label || media[0].alt || "Instagram attachment");
  return clean(item.item_type || "Instagram message");
}

function eventType(item) {
  if (item.item_type === "text") return "instagram_inbound";
  if (item.item_type === "voice_media") return "instagram_voice_note";
  if (["clip", "media_share", "story_share", "profile"].includes(item.item_type)) return "instagram_media_share";
  if (item.item_type === "link") return "instagram_link";
  return "instagram_message";
}

function rowForItem(item) {
  const media = directMedia(item);
  const text = itemText(item, media);
  const direction = clean(item.user_id) === viewerId ? "outbound" : "inbound";
  const owner = media[0]?.providerMetadata?.ownerUsername;
  const sendTargetId = contactPk || recipientId;
  return {
    dedupeKey: `instagram:direct_v2:${providerThreadId}:${item.item_id}`,
    itemId: clean(item.item_id),
    eventAt: timestampToIso(item.timestamp),
    direction,
    agentName: direction === "inbound" ? "Iris" : "Owner",
    eventType: eventType(item),
    text,
    summary: itemSummary(item, text, media),
    status: direction === "inbound" ? "received" : "sent",
    media,
    providerMetadata: {
      source,
      itemId: clean(item.item_id),
      messageId: clean(item.message_id),
      itemType: clean(item.item_type),
      threadKey: recipientId,
      browserRecipientId: recipientId,
      senderId: sendTargetId,
      contactId: sendTargetId,
      instagramUserId: sendTargetId,
      senderUsername: username,
      contactPk: contactPk || undefined,
      contactInstagramFbid: clean(contact.fbid) || undefined,
      threadId: providerThreadId,
      directThreadId: clean(threadSummary.thread_id) || undefined,
      itemUserId: clean(item.user_id),
      mediaOwnerUsername: owner || undefined,
      isSentByViewer: Boolean(item.is_sent_by_viewer),
    },
  };
}

async function main() {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const rows = items
    .map(rowForItem)
    .filter((row) => row.itemId && (row.text || row.media.length));

  const client = await pool.connect();
  const stats = { threadRef, recipientId, username, inputItems: items.length, rows: rows.length, inserted: 0, replaced: 0, media: 0 };
  try {
    await client.query("begin");
    await client.query(
      `insert into clients (id, name) values ($1, $2)
       on conflict (id) do update set name = excluded.name, updated_at = now()`,
      [clientId, clientName],
    );

    if (replace) {
      const deleted = await client.query(
        `delete from conversation_events
          where client_id = $1
            and channel = 'instagram'
            and (
              thread_ref = $2
              or phone = $3
              or provider_thread_id = $4
              or (full_name in ($5, $6) and source in ('composio', $7))
            )`,
        [clientId, threadRef, recipientId, providerThreadId, contactName, username, source],
      );
      stats.replaced = deleted.rowCount || 0;
      await client.query(
        `delete from event_dedupe
          where client_id = $1
            and channel = 'instagram'
            and (thread_ref = $2 or provider_message_id = any($3::text[]) or dedupe_key like $4)`,
        [clientId, threadRef, rows.map((row) => row.itemId), `instagram:direct_v2:${providerThreadId}:%`],
      );
    }

    for (const row of rows.sort((a, b) => new Date(a.eventAt).getTime() - new Date(b.eventAt).getTime())) {
      await client.query(
        `insert into event_dedupe (client_id, dedupe_key, channel, provider, provider_message_id, thread_ref, metadata)
         values ($1, $2, 'instagram', $3, $4, $5, $6::jsonb)
         on conflict (client_id, dedupe_key) do update
           set last_seen_at = now(),
               thread_ref = excluded.thread_ref,
               metadata = event_dedupe.metadata || excluded.metadata`,
        [clientId, row.dedupeKey, source, row.itemId, threadRef, json(row.providerMetadata)],
      );
      await client.query(
        `insert into conversation_events (
           client_id, event_at, channel, direction, email, phone, full_name, source, thread_ref,
           agent_name, human_owner, event_type, message_text, summary, transcript_url, recording_url,
           ai_action, handoff_reason, status, call_duration_seconds, appointment_id, outcome_code,
           mailbox_email, gmail_thread_id, gmail_message_id, thread_status, provider_message_id,
           provider_thread_id, media_json, provider_metadata
         ) values (
           $1, $2, 'instagram', $3, '', $4, $5, $6, $7,
           $8, '', $9, $10, $11, '', '',
           '', '', $12, null, '', '',
           '', '', $13, 'browser_backfill_verified_recipient', $14,
           $15, $16::jsonb, $17::jsonb
         )`,
        [
          clientId,
          row.eventAt,
          row.direction,
          recipientId,
          contactName,
          source,
          threadRef,
          row.agentName,
          row.eventType,
          row.text,
          row.summary,
          row.status,
          row.dedupeKey,
          row.itemId,
          providerThreadId,
          json(row.media),
          json(row.providerMetadata),
        ],
      );
      stats.inserted += 1;
      if (row.media.length) stats.media += 1;
    }

    await client.query(
      `insert into lead_memory (
         client_id, email, phone, full_name, lead_source, source_detail, preferred_channel,
         last_channel, last_ai_touch_at, summary
       ) values ($1, '', $2, $3, 'instagram', $4, 'instagram', 'instagram', $5, $6)
       on conflict (client_id, email, phone, full_name) do update
         set lead_source = excluded.lead_source,
             source_detail = excluded.source_detail,
             preferred_channel = excluded.preferred_channel,
             last_channel = excluded.last_channel,
             last_ai_touch_at = excluded.last_ai_touch_at,
             summary = excluded.summary,
             updated_at = now()`,
      [
        clientId,
        recipientId,
        contactName,
        `instagram:${username}`,
        rows.at(-1)?.eventAt || new Date().toISOString(),
        `${contactName} Instagram Direct thread imported from authenticated browser source.`,
      ],
    );

    await client.query("commit");
    console.log(JSON.stringify(stats, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
