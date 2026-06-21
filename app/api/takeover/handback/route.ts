import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { threadId, channel } = await req.json();

  if (!threadId) {
    return NextResponse.json({ error: 'threadId required' }, { status: 400 });
  }

  // TODO: clear takeover flag in DB so AI resumes handling this thread
  console.log('[takeover/handback]', { threadId, channel });

  return NextResponse.json({ ok: true });
}
