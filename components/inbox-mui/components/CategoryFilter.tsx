"use client";
import React from 'react';
import { Box, Chip } from '@mui/material';
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
        color="#6366f1"
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
            fontWeight: selected ? 700 : 600,
            color: selected ? '#fff' : color
          }}>
          
            {label}
          </Box>
          <Box
          component="span"
          sx={{
            fontSize: 11,
            fontWeight: 700,
            px: 0.65,
            borderRadius: 999,
            bgcolor: selected ?
            'rgba(255,255,255,0.25)' :
            withAlpha(color, 0.18),
            color: selected ? '#fff' : color,
            lineHeight: 1.6
          }}>
          
            {count}
          </Box>
        </Box>
      }
      sx={{
        flexShrink: 0,
        height: 32,
        borderRadius: 2,
        border: '1px solid',
        // Always color-coded: tinted bg + colored border, even when unselected.
        borderColor: selected ? color : withAlpha(color, 0.5),
        bgcolor: selected ? withAlpha(color, 0.85) : withAlpha(color, 0.1),
        '& .MuiChip-label': {
          px: 1.25
        },
        '&:hover': {
          bgcolor: selected ? withAlpha(color, 0.95) : withAlpha(color, 0.2),
          borderColor: color
        }
      }} />);


}