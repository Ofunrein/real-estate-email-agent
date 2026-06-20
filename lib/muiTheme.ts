import { createTheme, type Theme } from "@mui/material/styles";

// MUI theme that mirrors the project's CSS-token design system
// (--s-* "Brokerage Terminal" tokens) so MUI chart cards match the
// surrounding hand-rolled CSS. Light + dark variants track the `.dark`
// class on <html>.
export function makeInboxTheme(mode: "light" | "dark"): Theme {
  const isDark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: { main: isDark ? "#8B7EFF" : "#7C6AF5" },
      secondary: { main: isDark ? "#FF8C5A" : "#F07A4A" },
      success: { main: isDark ? "#4ADE80" : "#22C55E" },
      warning: { main: isDark ? "#FBB948" : "#F59E0B" },
      error: { main: isDark ? "#F87171" : "#EF4444" },
      info: { main: isDark ? "#60A5FA" : "#3B82F6" },
      background: {
        default: isDark ? "#08080E" : "#F8F8FB",
        paper: isDark ? "#12121A" : "#FFFFFF",
      },
      text: {
        primary: isDark ? "#F4F4FF" : "#09091A",
        secondary: isDark ? "#C2C2DC" : "#2E2E48",
        disabled: isDark ? "#9090AE" : "#62627E",
      },
      divider: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)",
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      button: { textTransform: "none", fontWeight: 600 },
      h6: { fontWeight: 700, letterSpacing: "-0.01em" },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            backgroundColor: isDark ? "#12121A" : "#FFFFFF",
            border: `1px solid ${isDark ? "rgba(255,255,255,0.10)" : "#EBEBF0"}`,
            borderRadius: 12,
            boxShadow: isDark
              ? "0 1px 3px rgba(0,0,0,0.4)"
              : "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
          },
        },
      },
      MuiCardContent: { styleOverrides: { root: { padding: 20, "&:last-child": { paddingBottom: 20 } } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? "#1A1A26" : "#09091A",
            fontSize: 12,
            borderRadius: 6,
          },
        },
      },
    },
  });
}

export const inboxThemeLight = makeInboxTheme("light");
