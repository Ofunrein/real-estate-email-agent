import { DatabaseSync } from "node:sqlite";
import { expect, test } from "@playwright/test";
import { reserveTursoVoiceSession } from "../lib/demo-voice-budget";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE engagement_events (
    id INTEGER PRIMARY KEY, demo_room_id TEXT, event TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  const exec = async (query: string, args: (string | number | null)[]) =>
    db.prepare(query).all(...args) as Record<string, string | number | null>[];
  return { db, exec };
}

test("Turso reserves exactly ten calls, returns remaining, and rejects the eleventh", async () => {
  const { db, exec } = database();
  try {
    for (let i = 9; i >= 0; i--) expect(await reserveTursoVoiceSession("room", exec)).toBe(i);
    expect(await reserveTursoVoiceSession("room", exec)).toBe(-1);
    expect(await reserveTursoVoiceSession("other", exec)).toBe(9);
  } finally { db.close(); }
});

test("expired reservations do not consume today's budget", async () => {
  const { db, exec } = database();
  try {
    for (let i = 0; i < 10; i++) db.prepare("INSERT INTO engagement_events(demo_room_id,event,created_at) VALUES ('room','voice_session_started',datetime('now','-2 days'))").run();
    expect(await reserveTursoVoiceSession("room", exec)).toBe(9);
  } finally { db.close(); }
});

test("global budget remains capped at one hundred reservations", async () => {
  const { db, exec } = database();
  try {
    for (let i = 0; i < 100; i++) db.prepare("INSERT INTO engagement_events(demo_room_id,event) VALUES (?, 'voice_session_started')").run(`room-${i}`);
    expect(await reserveTursoVoiceSession("new-room", exec)).toBe(-1);
  } finally { db.close(); }
});
