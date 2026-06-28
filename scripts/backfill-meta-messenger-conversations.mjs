#!/usr/bin/env node

import { Pool } from "pg";

const graphVersion = (process.env.META_GRAPH_VERSION || "v20.0").trim().replace(/^\/+/, "");
const clientId = process.env.CLIENT_ID || "default";
const clientName = process.env.CLIENT_NAME || clientId;
const limit = Number(process.env.META_BACKFILL_LIMIT || process.argv.find((arg) => arg.startsWith("--limit="))?.split("=")[1] || "25");
const dryRun = process.argv.includes("--dry-run");

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
});

function cleanText(value) {
  return String(value ?? "").trim();
}

function attachmentType(value, url) {
  const source = `${cleanText(value.type)} ${cleanText(value.mime_type)} ${cleanText(value.content_type)} ${url}`.toLowerCase();
  if (source.includes("audio") || /\.(?:aac|m4a|mp3|mpeg|oga|ogg|opus|wav|webm)(?:$|[?#])/i.test(source)) return "audio";
  if (source.includes("video") || /\.(?:mp4|mov|webm)(?:$|[?#])/i.test(source)) return "video";
  if (source.includes("image") || /\.(?:avif|gif|jpeg|jpg|png|webp)(?:$|[?#])/i.test(source)) return "image";
  return "file";
}

function attachmentUrl(value) {
  const payload = value?.payload && typeof value.payload === "object" ? value.payload : {};
  return cleanText(value?.url || value?.file_url || value?.attachment_url || payload.url || payload.src || payload.link || "");
}

function mediaFromMessage(message) {
  const attachments = Array.isArray(message.attachments?.data) ? message.attachments.data : [];
  return attachments
    .map((attachment) => {
      const url = attachmentUrl(attachment);
      if (!url) return null;
      return {
        id: cleanText(attachment.id),
        url,
        type: attachmentType(attachment, url),
        filename: cleanText(attachment.name || attachment.title || attachment.filename) || undefined,
        contentType: cleanText(attachment.mime_type || attachment.content_type) || undefined,
        providerMetadata: { attachment_type: cleanText(attachment.type) },
      };
    })
    .filter(Boolean);
}

async function graphGet(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message || `Graph ${response.status}`);
  return payload;
}

async function messengerConnections(client) {
  const result = await client.query(
    `select selected_asset_id, selected_asset_name, page_access_token
       from channel_connections
      where client_id = $1
        and channel = 'messenger'
        and provider = 'meta_direct'
        and status = 'connected'
        and page_access_token <> ''
      order by updated_at desc`,
    [clientId],
  );
  return result.rows;
}

function otherParticipant(conversation, pageId) {
  const participants = Array.isArray(conversation.participants?.data) ? conversation.participants.data : [];
  return participants.find((participant) => cleanText(participant.id) !== pageId) || participants[0] || {};
}

async function insertMessage(client, input) {
  const dedupeKey = `messenger:${input.messageId}`;
  const dedupe = await client.query(
    `insert into event_dedupe (client_id, dedupe_key, channel, provider, provider_message_id, thread_ref, metadata)
     values ($1, $2, 'messenger', 'meta_social_backfill', $3, $4, $5::jsonb)
     on conflict (client_id, dedupe_key) do nothing
     returning id`,
    [clientId, dedupeKey, input.messageId, input.threadRef, JSON.stringify(input.providerMetadata)],
  );
  if ((dedupe.rowCount || 0) === 0) return "duplicate";
  if (dryRun) return "would_insert";

  await client.query(
    `insert into conversation_events (
       client_id, event_at, channel, direction, email, phone, full_name, source, thread_ref,
       agent_name, human_owner, event_type, message_text, summary, transcript_url, recording_url,
       ai_action, handoff_reason, status, call_duration_seconds, appointment_id, outcome_code,
       mailbox_email, gmail_thread_id, gmail_message_id, thread_status, provider_message_id,
       provider_thread_id, media_json, provider_metadata
     ) values (
       $1, $2, 'messenger', $3, '', $4, $5, 'meta_social_backfill', $6,
       $7, '', $8, $9, $10, '', '',
       '', '', $11, null, '', '',
       '', '', $12, '', $13,
       $6, $14::jsonb, $15::jsonb
     )`,
    [
      clientId,
      input.createdTime,
      input.direction,
      input.contactId,
      input.contactName,
      input.threadRef,
      input.direction === "inbound" ? "Iris" : "Owner",
      input.direction === "inbound" ? "messenger_inbound" : "messenger_backfilled_outbound",
      input.text,
      input.text ? `${input.direction === "inbound" ? "Inbound" : "Outbound"} Messenger: ${input.text}` : "Messenger attachment.",
      input.direction === "inbound" ? "received" : "sent",
      dedupeKey,
      input.messageId,
      JSON.stringify(input.media),
      JSON.stringify(input.providerMetadata),
    ],
  );
  return "inserted";
}

async function main() {
  const client = await pool.connect();
  const stats = { conversations: 0, messages: 0, inserted: 0, duplicate: 0, would_insert: 0, errors: [] };
  try {
    await client.query("begin");
    await client.query(
      `insert into clients (id, name) values ($1, $2)
       on conflict (id) do update set name = excluded.name, updated_at = now()`,
      [clientId, clientName],
    );
    const connections = await messengerConnections(client);
    for (const connection of connections) {
      const pageId = cleanText(connection.selected_asset_id);
      const token = cleanText(connection.page_access_token);
      const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(pageId)}/conversations?fields=id,updated_time,participants,messages.limit(25){id,created_time,from,to,message,attachments}&limit=${limit}`;
      const payload = await graphGet(url, token);
      for (const conversation of payload.data || []) {
        stats.conversations += 1;
        const contact = otherParticipant(conversation, pageId);
        const contactId = cleanText(contact.id || contact.email || conversation.id);
        const contactName = cleanText(contact.name) || "Messenger contact";
        const threadRef = `messenger:${contactId}`;
        const messages = Array.isArray(conversation.messages?.data) ? conversation.messages.data : [];
        for (const message of messages.reverse()) {
          const messageId = cleanText(message.id);
          if (!messageId) continue;
          const fromId = cleanText(message.from?.id);
          const media = mediaFromMessage(message);
          const text = cleanText(message.message) || (media.length ? "Attachment" : "");
          if (!text && !media.length) continue;
          stats.messages += 1;
          const status = await insertMessage(client, {
            messageId,
            createdTime: cleanText(message.created_time) || new Date().toISOString(),
            direction: fromId === pageId ? "outbound" : "inbound",
            contactId,
            contactName,
            threadRef,
            text,
            media,
            providerMetadata: {
              conversationId: conversation.id,
              from: message.from || {},
              to: message.to || {},
              pageId,
            },
          });
          stats[status] += 1;
        }
      }
    }
    if (dryRun) await client.query("rollback");
    else await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    stats.errors.push(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(JSON.stringify({ dryRun, ...stats }, null, 2));
}

main();
