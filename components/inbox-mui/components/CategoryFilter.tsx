"use client";
import React from 'react';
import { Box, Chip, useTheme } from '@mui/material';
import { type LeadCategoryId } from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { useCategoryColors } from '../theme/CategoryColorContext';
export type CategoryFilterValue = LeadCategoryId | 'all';
interface CategoryFilterProps {
  value: CategoryFilterValue;
  onChange: (value: CategoryFilterValue) => void;
  counts: Record<LeadCategoryId, number>;
  totalCount: number;
}
// Convert a hex color to an rgba string with the given alpha.
function withAlpha(hex: string, alpha: number): string {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.
    split('').
    map((c) => c + c).
    join('');
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
export function CategoryFilter({
  value,
  onChange,
  counts,
  totalCount
}: CategoryFilterProps) {
  const { leadCategories } = useInboxModel();
  const { colors } = useCategoryColors();
  const theme = useTheme();
  return (
    <Box
      role="tablist"
      aria-label="Filter conversations by category"
      sx={{
        display: 'flex',
        gap: 1,
        overflowX: 'auto',
        pb: 1.5,
        pt: 0.5,
        scrollbarWidth: 'thin',
        '&::-webkit-scrollbar': {
          height: 6
        },
        '&::-webkit-scrollbar-thumb': {
          borderRadius: 999,
          bgcolor: 'divider'
        }
      }}>

      <FilterChip
        label="All"
        count={totalCount}
        color={theme.iris.accentInk}
        selected={value === 'all'}
        onClick={() => onChange('all')} />

      {leadCategories.map((cat) =>
      <FilterChip
        key={cat.id}
        label={cat.label}
        count={counts[cat.id] ?? 0}
        color={colors[cat.id]}
        selected={value === cat.id}
        onClick={() => onChange(cat.id)} />

      )}
    </Box>);

}
function FilterChip({
  label,
  count,
  color,
  selected,
  onClick
}: {label: string;count: number;color: string;selected: boolean;onClick: () => void;}) {
  return (
    <Chip
      role="tab"
      aria-selected={selected}
      clickable
      onClick={onClick}
      label={
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75
        }}>

          <Box
          component="span"
          sx={{
            fontWeight: selected ? 600 : 500,
            color: selected ? 'primary.contrastText' : 'text.secondary'
          }}>

            {label}
          </Box>
          <Box
          component="span"
          sx={{
            fontSize: 10,
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            px: 0.7,
            borderRadius: 999,
            bgcolor: selected ?
            'rgba(255,255,255,0.22)' :
            withAlpha(color, 0.16),
            color: selected ? 'primary.contrastText' : color,
            lineHeight: 1.6
          }}>

            {count}
          </Box>
        </Box>
      }
      sx={{
        flexShrink: 0,
        height: 30,
        borderRadius: 999,
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'primary.main' : 'background.default',
        transition: 'background-color .15s, border-color .15s',
        '& .MuiChip-label': {
          px: 1.4
        },
        '&:hover': {
          bgcolor: selected ? 'primary.main' : 'action.hover',
          borderColor: selected ? 'primary.main' : 'divider'
        }
      }} />);


}
