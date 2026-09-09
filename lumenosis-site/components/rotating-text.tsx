"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

export function RotatingText({
  words,
  intervalMs = 2500,
  minWidth = "8ch",
  className,
}: {
  words: readonly string[];
  intervalMs?: number;
  minWidth?: string;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const [canAnimate, setCanAnimate] = useState(false);
  const reduce = useReducedMotion();
  const longestWord = useMemo(
    () => words.reduce((longest, word) => (word.length > longest.length ? word : longest), ""),
    [words],
  );
  const activeWord = words[index] ?? words[0] ?? "";

  useEffect(() => {
    setCanAnimate(true);
  }, []);

  useEffect(() => {
    if (reduce || words.length <= 1) return;
    const intervalId = window.setInterval(() => {
      setIndex((current) => (current === words.length - 1 ? 0 : current + 1));
    }, intervalMs);
    return () => window.clearInterval(intervalId);
  }, [words.length, intervalMs, reduce]);

  return (
    <span
      className={`relative inline-grid max-w-full justify-items-start align-baseline ${className ?? ""}`}
      style={{ minWidth, minHeight: "1.12em", maxWidth: "100%", lineHeight: 1.08 }}
      aria-live="polite"
      aria-atomic="true"
    >
      <span
        className="invisible col-start-1 row-start-1 max-w-full whitespace-nowrap font-semibold"
        aria-hidden="true"
      >
        {longestWord}
      </span>
      <AnimatePresence initial={false}>
        <motion.span
          key={activeWord}
          className="col-start-1 row-start-1 max-w-full whitespace-nowrap font-semibold will-change-[opacity,filter]"
          initial={canAnimate && !reduce ? { opacity: 0, filter: "blur(8px)" } : false}
          animate={canAnimate && !reduce ? { opacity: 1, filter: "blur(0px)" } : { opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, filter: "blur(8px)" }}
          transition={reduce ? { duration: 0 } : { duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          {activeWord}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
