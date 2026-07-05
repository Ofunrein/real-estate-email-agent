const EM_DASH_RE = /\u2014/g;

export function removeEmDashes(text: string): string {
  return String(text || "").replace(EM_DASH_RE, " - ").replace(/[ \t]{2,}/g, " ");
}

export function removeEmDashesFromRecord<T extends Record<string, unknown>>(input: T, keys: Array<keyof T>): T {
  const output = { ...input };
  for (const key of keys) {
    if (typeof output[key] === "string") output[key] = removeEmDashes(output[key] as string) as T[typeof key];
  }
  return output;
}

export function containsEmDash(text: string): boolean {
  return EM_DASH_RE.test(text);
}
