import { NextRequest, NextResponse } from "next/server";

import { requireCommandCenterViewer, unauthorizedResponse } from "@/lib/authGuard";
import { commandCenterRange, type CommandCenterWindow } from "@/lib/commandCenter";
import { authorizeCommandCenterScope } from "@/lib/commandCenterAuth";
import { readCommandCenterSnapshot } from "@/lib/commandCenterStore";
import { captureServerException } from "@/lib/posthogServer";

export const dynamic = "force-dynamic";

const WINDOWS = new Set<CommandCenterWindow>(["24h", "7d", "30d"]);
const TENANT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  const viewer = await requireCommandCenterViewer();
  if (!viewer) return unauthorizedResponse();

  const requestedWindow = request.nextUrl.searchParams.get("window") || "7d";
  if (!WINDOWS.has(requestedWindow as CommandCenterWindow)) {
    return NextResponse.json({ error: "Invalid window" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const requestedTenant = String(request.nextUrl.searchParams.get("tenantId") || "").trim();
  if (requestedTenant && !TENANT_ID.test(requestedTenant)) {
    return NextResponse.json({ error: "Invalid tenant" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const scope = authorizeCommandCenterScope(viewer, requestedTenant);
  if (!scope.ok) {
    return NextResponse.json({ error: scope.error }, { status: scope.status, headers: PRIVATE_HEADERS });
  }

  try {
    const range = commandCenterRange(requestedWindow as CommandCenterWindow);
    const snapshot = await readCommandCenterSnapshot({ ...scope, range });
    const traceId = String(request.nextUrl.searchParams.get("trace") || "").trim().slice(0, 120);
    const selectedTrace = traceId
      ? snapshot.traces.find((trace) => trace.correlationId === traceId) || null
      : null;
    return NextResponse.json({
      viewer: {
        role: viewer.role,
        workspaceId: viewer.workspaceId,
        workspaceName: viewer.workspaceName,
      },
      range,
      ...snapshot,
      selectedTrace,
    }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    await captureServerException(error, {
      component: "command-center-api",
      runtime: "server",
      error_code: "command_center_read_failed",
    });
    return NextResponse.json(
      { error: "Command-center data is temporarily unavailable." },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
