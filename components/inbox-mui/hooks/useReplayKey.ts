"use client";

import { useEffect, useRef, useState } from "react";

export function useReplayKey(active: boolean) {
  const [playKey, setPlayKey] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) setPlayKey((key) => key + 1);
  }, [active]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setPlayKey((key) => key + 1);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, playKey };
}
