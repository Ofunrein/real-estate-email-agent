"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { makeInboxTheme } from "@/lib/muiTheme";

// Tracks the `.dark` class on <html> and feeds the matching MUI theme to
// the chart sub-tree. No CssBaseline — the app's globals.css owns the global
// shell; MUI components resolve palette from this ThemeProvider alone.
function useDarkMode(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains("dark"));
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export function MuiChartsProvider({ children }: { children: ReactNode }) {
  const dark = useDarkMode();
  const theme = makeInboxTheme(dark ? "dark" : "light");
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
