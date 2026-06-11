import { databaseEnabled, loadAgentInboxDataFromDatabase } from "@/lib/database";
import { loadAgentInboxDataFromSheets, readSheet } from "@/lib/googleSheets";
import {
  CONVERSATION_EVENTS_TAB,
  LEAD_MEMORY_TAB,
  PROPERTIES_TAB,
  type SheetRow,
} from "@/lib/sheetSchema";

export async function loadAgentInboxData() {
  if (databaseEnabled()) {
    return loadAgentInboxDataFromDatabase();
  }
  const data = await loadAgentInboxDataFromSheets();
  return { ...data, voiceCalls: [] };
}

export async function readLeads(): Promise<SheetRow[]> {
  if (databaseEnabled()) {
    const { readLeadsFromDatabase } = await import("@/lib/database");
    return readLeadsFromDatabase();
  }
  return readSheet(LEAD_MEMORY_TAB);
}

export async function readEvents(): Promise<SheetRow[]> {
  if (databaseEnabled()) {
    const { readEventsFromDatabase } = await import("@/lib/database");
    return readEventsFromDatabase();
  }
  return readSheet(CONVERSATION_EVENTS_TAB);
}

export async function readProperties(): Promise<SheetRow[]> {
  if (databaseEnabled()) {
    const { readPropertiesFromDatabase } = await import("@/lib/database");
    return readPropertiesFromDatabase();
  }
  return readSheet(PROPERTIES_TAB);
}
