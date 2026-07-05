import { NextRequest, NextResponse } from 'next/server';

import { requireDashboardAuth, unauthorizedResponse } from '@/lib/authGuard';
import { releaseTakeover } from '@/lib/humanTakeover';
import { createRequestAudit } from '@/lib/requestAudit';

export async function POST(req: NextRequest) {
  const session = await requireDashboardAuth();
  if (!session) return unauthorizedResponse();
  const { threadId, threadRef, channel } = await req.json();
  const targetThread = String(threadRef || threadId || '').trim();
  const audit = createRequestAudit({
    headers: req.headers,
    route: '/api/takeover/handback',
    method: 'POST',
    provider: 'dashboard',
    threadRef: targetThread,
    channel,
  });
  await audit.write('received', 'received');

  if (!targetThread) {
    await audit.write('validate', 'failed', { statusCode: 400, errorMessage: 'threadId required' });
    return NextResponse.json({ error: 'threadId required' }, { status: 400 });
  }

  await releaseTakeover(targetThread, channel);
  await audit.write('handback', 'sent', { statusCode: 200, channel });

  return NextResponse.json({ ok: true });
}
