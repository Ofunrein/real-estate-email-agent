// Type declarations for the plain-JS bulk Zillow importer. The script itself stays .mjs so it can
// run directly under node with no build step, but tests import it through the TS project, where an
// untyped .mjs import degrades every downstream value to `any` and silently disables type checking
// on the assertions.

export type ZillowSearchSlice = {
  city: string;
  state: string;
  zip: string;
  location: string;
  listingType: string;
  listingLabel: string;
  propertyType: string;
  propertyTypeLabel: string;
};

export type ZillowPropertyRow = Record<string, string>;

export const PROPERTIES_TAB: string;
export const PROPERTIES_HEADERS: readonly string[];

export function buildSearchSlices(options?: {
  city?: string;
  state?: string;
  target?: number;
  limitPerQuery?: number;
  maxQueries?: number;
}): ZillowSearchSlice[];

export function buildActorPayload(slice: ZillowSearchSlice, limitPerQuery: number): Record<string, unknown>;

// Always returns a row: every header is filled, defaulting to "" when the Apify item lacks it.
export function normalizeApifyItem(item: Record<string, unknown>, slice?: Partial<ZillowSearchSlice>): ZillowPropertyRow;

export function normalizeAddressKey(address: string): string;

export function dedupeRows(
  rows: ZillowPropertyRow[],
  existingRows?: ZillowPropertyRow[],
): { unique: ZillowPropertyRow[]; duplicates: ZillowPropertyRow[] };

export function rowsFromExistingZillowCsv(csvPath: string): ZillowPropertyRow[];

export function runImport(rawArgs?: string[]): Promise<unknown>;
