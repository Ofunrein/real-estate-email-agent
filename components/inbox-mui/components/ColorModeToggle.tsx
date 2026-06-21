"use client";
import React from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { Moon, Sun } from 'lucide-react';
import { useColorMode } from '../theme/ColorModeContext';

export function ColorModeToggle() {
  const { mode, toggle } = useColorMode();
  const isDark = mode === 'dark';

  return (
    <Tooltip title="Toggle color mode">
      <IconButton
        onClick={toggle}
        size="small"
        aria-label="Toggle color mode"
        sx={{
          borderRadius: 1.5,
          border: '1px solid',
          borderColor: 'divider',
          width: 34,
          height: 34,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {isDark ? (
          <Sun size={16} color="#fbbf24" />
        ) : (
          <Moon size={16} color="#6366f1" />
        )}
      </IconButton>
    </Tooltip>
  );
}
