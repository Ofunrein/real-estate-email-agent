type Executor = (
  query: string,
  args: (string | number | null)[],
) => Promise<Record<string, string | number | null>[]>;

// One SQLite INSERT serializes the check and reservation across serverless instances.
export async function reserveTursoVoiceSession(demoRoomId: string, exec: Executor) {
  const rows = await exec(
    `INSERT INTO engagement_events (demo_room_id, event)
     SELECT ?, 'voice_session_started'
     WHERE (SELECT COUNT(*) FROM engagement_events
       WHERE demo_room_id = ? AND event = 'voice_session_started'
       AND created_at >= datetime('now', '-1 day')) < 10
     AND (SELECT COUNT(*) FROM engagement_events
       WHERE event = 'voice_session_started'
       AND created_at >= datetime('now', '-1 day')) < 100
     RETURNING id`,
    [demoRoomId, demoRoomId],
  );
  if (rows.length !== 1) return -1;
  const counts = await exec(
    `SELECT COUNT(*) AS used FROM engagement_events
     WHERE demo_room_id = ? AND event = 'voice_session_started'
     AND created_at >= datetime('now', '-1 day')`,
    [demoRoomId],
  );
  return Math.max(0, 10 - Number(counts[0]?.used ?? 10));
}
