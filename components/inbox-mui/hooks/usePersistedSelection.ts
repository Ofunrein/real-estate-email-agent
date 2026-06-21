"use client";

import { useEffect, useMemo, useState } from "react";

function isAllowed<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.includes(value as T);
}

export function usePersistedSelection<T extends string>(
  storageKey: string,
  fallback: T,
  allowedValues: readonly T[],
): [T, (value: T) => void, boolean] {
  const allowedKey = useMemo(() => allowedValues.join("\u001f"), [allowedValues]);
  const [value, setValue] = useState<T>(fallback);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      setReady(true);
      return;
    }
    const saved = window.localStorage.getItem(storageKey);
    if (saved && isAllowed(saved, allowedValues)) {
      setValue(saved);
    } else {
      setValue(fallback);
    }
    setReady(true);
  }, [storageKey, allowedKey, fallback, allowedValues]);

  useEffect(() => {
    if (!isAllowed(value, allowedValues)) {
      setValue(fallback);
    }
  }, [allowedKey, allowedValues, fallback, value]);

  useEffect(() => {
    if (typeof window === "undefined" || !isAllowed(value, allowedValues)) return;
    window.localStorage.setItem(storageKey, value);
  }, [allowedKey, allowedValues, storageKey, value]);

  return [value, setValue, ready];
}
