"use client";
import React from 'react';
import { IconButton, Tooltip, useTheme } from '@mui/material';
import { Moon, Sun } from 'lucide-react';
import { useColorMode } from '../theme/ColorModeContext';

export function ColorModeToggle() {
  const { mode, toggle } = useColorMode();
  const theme = useTheme();
  const isDark = mode === 'dark';
  const isLight = !isDark;

  return (
    <Tooltip title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <IconButton
        onClick={toggle}
        size="small"
        aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        sx={{
          width: 38,
          height: 38,
          borderRadius: '50%',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          boxShadow: isLight
            ? 'inset 0 1px 0 rgba(255,255,255,.9), 0 1px 1px rgba(15,23,42,.04), 0 8px 18px rgba(15,23,42,.08), 0 24px 60px rgba(15,23,42,.06)'
            : 'inset 0 1px 0 rgba(255,255,255,.04), 0 18px 50px rgba(0,0,0,.4)',
          transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
          '&:hover': {
            transform: 'translateY(-1px)',
            borderColor: 'iris.accent',
            boxShadow: isLight
              ? 'inset 0 1px 0 rgba(255,255,255,.9), 0 2px 3px rgba(15,23,42,.05), 0 14px 28px rgba(15,23,42,.10), 0 34px 80px rgba(15,23,42,.08)'
              : 'inset 0 1px 0 rgba(255,255,255,.06), 0 0 0 1px rgba(196,154,82,.18), 0 22px 70px rgba(0,0,0,.5)'
          },
          '&:active': { transform: 'translateY(0) scale(.95)' }
        }}
      >
        {isDark ? (
          <Sun size={17} strokeWidth={2} color={theme.iris.accent} />
        ) : (
          <Moon size={16} strokeWidth={1.8} color={theme.iris.accentInk} />
        )}
      </IconButton>
    </Tooltip>
  );
}
