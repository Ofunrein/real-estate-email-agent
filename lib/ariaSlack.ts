export type SlackCallPayload = {
  outcome: string;
  caller_name?: string;
  caller_phone: string;
  appointment_time?: string;
  timeline?: string;
  motivation?: string;
  objections_raised?: string[];
  tone?: string;
  notes?: string;
  property_address?: string;
  call_duration_seconds?: number;
  call_id?: string;
  channel?: string;
};

async function postSlack(channel: string, blocks: unknown[]): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN || "";
  if (!token) return;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, blocks }),
  }).catch(() => null);
}

export async function notifySlackOnBooking(payload: SlackCallPayload): Promise<void> {
  await postSlack(process.env.SLACK_HOTLEAD_CHANNEL || "#hot-leads", [
    { type: "header", text: { type: "plain_text", text: "Appointment booked" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Lead:*\n${payload.caller_name || "Unknown"} - ${payload.caller_phone}` },
        { type: "mrkdwn", text: `*When:*\n${payload.appointment_time || "TBD"}` },
        { type: "mrkdwn", text: `*Channel:*\n${payload.channel || "-"}` },
        { type: "mrkdwn", text: `*Timeline:*\n${payload.timeline || "-"}` },
        { type: "mrkdwn", text: `*Property:*\n${payload.property_address || "-"}` },
        { type: "mrkdwn", text: `*Tone:*\n${payload.tone || "-"}` },
      ],
    },
    ...(payload.notes ? [{ type: "section", text: { type: "mrkdwn", text: `*Notes:* ${payload.notes}` } }] : []),
  ]);
}

export async function notifySlackOnTransfer(payload: SlackCallPayload): Promise<void> {
  await postSlack(process.env.SLACK_HANDOFF_CHANNEL || "#agent-handoffs", [
    { type: "header", text: { type: "plain_text", text: "Agent handoff needed" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Lead:*\n${payload.caller_name || "Unknown"} - ${payload.caller_phone}` },
        { type: "mrkdwn", text: `*Channel:*\n${payload.channel || "-"}` },
        { type: "mrkdwn", text: `*Tone:*\n${payload.tone || "-"}` },
        { type: "mrkdwn", text: `*Timeline:*\n${payload.timeline || "-"}` },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: `*Context:* ${payload.notes || "None"}` } },
    {
      type: "context",
      elements: [{
        type: "plain_text",
        text: `Call ID: ${payload.call_id || "-"} - ${Math.round((payload.call_duration_seconds || 0) / 60)}min`,
      }],
    },
  ]);
}

export async function notifySlackOnHotLead(payload: SlackCallPayload): Promise<void> {
  await postSlack(process.env.SLACK_HOTLEAD_CHANNEL || "#hot-leads", [
    { type: "header", text: { type: "plain_text", text: "Hot lead detected" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Lead:*\n${payload.caller_name || "Unknown"} - ${payload.caller_phone}` },
        { type: "mrkdwn", text: `*Channel:*\n${payload.channel || "-"}` },
        { type: "mrkdwn", text: `*Timeline:*\n${payload.timeline || "-"}` },
        { type: "mrkdwn", text: `*Property:*\n${payload.property_address || "-"}` },
      ],
    },
    ...(payload.notes ? [{ type: "section", text: { type: "mrkdwn", text: `*Notes:* ${payload.notes}` } }] : []),
  ]);
}
