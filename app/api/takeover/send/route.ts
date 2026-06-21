import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { threadId, channel, message } = await req.json();

  if (!threadId || !message) {
    return NextResponse.json({ error: 'threadId and message required' }, { status: 400 });
  }

  // TODO: send message via Twilio (sms) or Gmail API (email), write event to DB
  console.log('[takeover/send]', { threadId, channel, message });

  return NextResponse.json({ ok: true });
}
