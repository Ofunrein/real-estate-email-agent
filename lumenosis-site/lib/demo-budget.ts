import "server-only";

import { demoPostgresEnabled, reservePostgresDemoGeneration } from "@/lib/demo-postgres";
import { sql } from "@/lib/turso";

export const DEMO_GENERATIONS_PER_HOUR = 12;
export const DEMO_GENERATIONS_PER_DAY = 100;

export async function reserveDemoGeneration(
  demoRoomId: string,
  token: string,
  _allowDraft = false,
) {
  if (demoPostgresEnabled()) {
    return reservePostgresDemoGeneration(token);
  }
  const rows = await sql(
    `INSERT INTO engagement_events (demo_room_id, event)
     SELECT ?, 'email_generation_started'
     WHERE (
       SELECT COUNT(*) FROM engagement_events
       WHERE demo_room_id = ? AND event = 'email_generation_started'
         AND created_at >= datetime('now', '-1 hour')
     ) < ?
     AND (
       SELECT COUNT(*) FROM engagement_events
       WHERE event = 'email_generation_started'
         AND created_at >= datetime('now', '-1 day')
     ) < ?
     RETURNING id`,
    [demoRoomId, demoRoomId, DEMO_GENERATIONS_PER_HOUR, DEMO_GENERATIONS_PER_DAY],
  );
  return rows.length === 1;
}
