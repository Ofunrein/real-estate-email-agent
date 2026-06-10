import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";

import {
  CONVERSATION_EVENTS_TAB,
  LEAD_MEMORY_TAB,
  PROPERTIES_HEADERS,
  PROPERTIES_TAB,
  type SheetRow,
} from "@/lib/sheetSchema";

type OAuthCredentials = {
  installed?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
  web?: {
    client_id?: string;
    client_secret?: string;
    redirect_uris?: string[];
  };
};

const CACHE_TTL_MS = 5_000;
let inboxCache: { loadedAt: number; data: { leads: SheetRow[]; events: SheetRow[]; properties: SheetRow[] } } | null = null;

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function credentialPaths() {
  const credentialsFile = process.env.GMAIL_CREDENTIALS_PATH || "credentials.json";
  const tokenFile = process.env.GMAIL_TOKEN_PATH || "token.json";
  return {
    credentialsPath: path.resolve(/* turbopackIgnore: true */ process.cwd(), credentialsFile),
    tokenPath: path.resolve(/* turbopackIgnore: true */ process.cwd(), tokenFile),
  };
}

export function spreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID || "";
  if (!id) {
    throw new Error("GOOGLE_SHEET_ID is required");
  }
  return id;
}

export async function sheetsClient(): Promise<sheets_v4.Sheets> {
  const { credentialsPath, tokenPath } = credentialPaths();
  const credentials = readJson<OAuthCredentials>(credentialsPath);
  const token = readJson<Record<string, string>>(tokenPath);
  const app = credentials.installed || credentials.web;
  if (!app?.client_id || !app.client_secret) {
    throw new Error("credentials.json is missing OAuth client data");
  }
  const auth = new google.auth.OAuth2(app.client_id, app.client_secret, app.redirect_uris?.[0]);
  auth.setCredentials(token);
  return google.sheets({ version: "v4", auth });
}

export function rowToObject(headers: string[], row: string[]): SheetRow {
  const padded = [...row, ...Array(Math.max(0, headers.length - row.length)).fill("")];
  return Object.fromEntries(headers.map((header, index) => [header, padded[index] || ""]));
}

export async function readSheet(tab: string): Promise<SheetRow[]> {
  if (inboxCache) {
    const cached = {
      [LEAD_MEMORY_TAB]: inboxCache.data.leads,
      [CONVERSATION_EVENTS_TAB]: inboxCache.data.events,
      [PROPERTIES_TAB]: inboxCache.data.properties,
    }[tab];
    if (cached && Date.now() - inboxCache.loadedAt < CACHE_TTL_MS) {
      return cached;
    }
  }

  const sheets = await sheetsClient();
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tab}!A:ZZ`,
  });
  const rows = (result.data.values || []) as string[][];
  if (!rows.length) {
    return [];
  }
  const headers = rows[0];
  return rows.slice(1).map((row) => rowToObject(headers, row));
}

export async function readSheets(tabs: string[]): Promise<Record<string, SheetRow[]>> {
  const sheets = await sheetsClient();
  const result = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId(),
    ranges: tabs.map((tab) => `${tab}!A:ZZ`),
  });
  const valueRanges = result.data.valueRanges || [];
  return Object.fromEntries(tabs.map((tab, index) => {
    const rows = (valueRanges[index]?.values || []) as string[][];
    if (!rows.length) {
      return [tab, []];
    }
    const headers = rows[0];
    return [tab, rows.slice(1).map((row) => rowToObject(headers, row))];
  }));
}

export async function loadAgentInboxDataFromSheets() {
  if (inboxCache && Date.now() - inboxCache.loadedAt < CACHE_TTL_MS) {
    return inboxCache.data;
  }
  const tables = await readSheets([LEAD_MEMORY_TAB, CONVERSATION_EVENTS_TAB, PROPERTIES_TAB]);
  const data = {
    leads: tables[LEAD_MEMORY_TAB] || [],
    events: tables[CONVERSATION_EVENTS_TAB] || [],
    properties: tables[PROPERTIES_TAB] || [],
  };
  inboxCache = { loadedAt: Date.now(), data };
  return data;
}

export async function appendPropertyToSheets(row: Partial<SheetRow>): Promise<boolean> {
  const address = String(row.address || "").trim();
  if (!address) return false;
  const existing = await readSheet(PROPERTIES_TAB);
  const exists = existing.some((property) => (property.address || "").trim().toLowerCase() === address.toLowerCase());
  if (exists) return false;
  const sheets = await sheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${PROPERTIES_TAB}!A:ZZ`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [PROPERTIES_HEADERS.map((header) => row[header] || "")],
    },
  });
  inboxCache = null;
  return true;
}
