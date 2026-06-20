import { createTheme, type Theme } from '@mui/material/styles';

// High-contrast light + dark control-room palettes for the Agent Inbox.
// Tuned for maximum legibility (older users / accessibility): near-black text
// on white in light mode, near-white text on deep navy in dark mode.
export function makeIrisTheme(mode: 'light' | 'dark'): Theme {
  const isDark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: {
        main: '#6366f1',
        light: '#818cf8',
        dark: '#4f46e5',
        contrastText: '#ffffff'
      },
      secondary: { main: '#22d3ee' },
      success: { main: isDark ? '#4ade80' : '#047857' },
      warning: { main: isDark ? '#fbbf24' : '#b45309' },
      error: { main: isDark ? '#f87171' : '#b91c1c' },
      info: { main: '#38bdf8' },
      background: {
        default: isDark ? '#0b1120' : '#ffffff',
        paper: isDark ? '#0f172a' : '#ffffff'
      },
      text: {
        // Maximum contrast: black-ish on white, white-ish on navy.
        primary: isDark ? '#f8fafc' : '#0a0e1a',
        secondary: isDark ? '#e2e8f0' : '#1e293b'
      },
      divider: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(15,23,42,0.16)'
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
      h4: { fontWeight: 700, letterSpacing: '-0.02em' },
      h5: { fontWeight: 700, letterSpacing: '-0.02em' },
      h6: { fontWeight: 700, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { fontWeight: 600, textTransform: 'none' },
      overline: { fontWeight: 700, letterSpacing: '0.12em' }
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: isDark ? '#0b1120' : '#ffffff'
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: isDark ?
            '1px solid rgba(148,163,184,0.16)' :
            '1px solid rgba(15,23,42,0.12)',
            backgroundColor: isDark ? '#0f172a' : '#ffffff'
          }
        }
      },
      MuiButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: isDark ? '#1e293b' : '#0f172a',
            fontSize: 12,
            border: isDark ? '1px solid rgba(148,163,184,0.18)' : 'none'
          }
        }
      }
    }
  });
}

export const irisTheme = makeIrisTheme('light');