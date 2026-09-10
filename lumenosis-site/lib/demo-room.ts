import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type DemoRoom, demoRooms } from "@/content/demo-rooms";
import { demoPostgresEnabled, postgresDemoRoomForToken } from "@/lib/demo-postgres";
import { demoImagesPassQa } from "@/lib/listing-image-qa";
import { sql, tursoConfigured } from "@/lib/turso";

function passedQa(room: DemoRoom) {
  return demoImagesPassQa(room.qa, room.listing.images);
}

function secret() {
  const value = process.env.DEMO_ROOM_SECRET;
  if (!value || value.length < 32)
    throw new Error("DEMO_ROOM_SECRET must be at least 32 characters");
  return value;
}

export function tokenForDemoRoom(slug: string) {
  return createHmac("sha256", secret()).update(`lumenosis-demo:${slug}`).digest("base64url");
}

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function demoRoomForToken(token: string, allowDraft = false) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  if (demoPostgresEnabled()) {
    const row = await postgresDemoRoomForToken(token);
    if (row) {
      const room = JSON.parse(String(row.config_json)) as DemoRoom;
      if (!passedQa(room)) return null;
      return {
        id: String(row.id),
        room,
        expired: Date.now() >= new Date(String(row.expires_at)).getTime(),
        source: "postgres" as const,
      };
    }
    // Transitional safety net: generation remained on Turso after the public reader
    // cut over to Postgres. Resolve target-only rooms from their actual store so newly
    // approved URLs do not 404 while ownership is reconciled.
  }

  if (tursoConfigured()) {
    const rows = await sql(
      "SELECT id, config_json, expires_at FROM demo_rooms WHERE token_hash = ? AND (status = 'approved' OR ? = 1) LIMIT 1",
      [tokenHash(token), allowDraft ? 1 : 0],
    );
    if (rows[0]) {
      const room = JSON.parse(String(rows[0].config_json)) as DemoRoom;
      if (!passedQa(room)) return null;
      return {
        id: String(rows[0].id),
        room,
        expired: Date.now() >= new Date(String(rows[0].expires_at)).getTime(),
        source: "turso" as const,
      };
    }
  }

  const supplied = Buffer.from(token);
  const room = demoRooms.find((candidate) => {
    const expected = Buffer.from(tokenForDemoRoom(candidate.slug));
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  });
  if (!room?.approved || !passedQa(room)) return null;
  return {
    id: room.slug,
    room,
    expired: Date.now() >= new Date(room.expiresAt).getTime(),
    source: "static" as const,
  };
}
