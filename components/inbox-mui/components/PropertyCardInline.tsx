"use client";
import React from 'react';
import { Box, Stack, Typography, Button, Link } from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailableOutlined';
import ImageOffIcon from '@mui/icons-material/ImageNotSupported';
import type { PropertyCard } from '../data/inboxData';

interface PropertyCardInlineProps {
  card: PropertyCard;
  showSchedule?: boolean;
  onOpenModal?: () => void;
}

export function PropertyCardInline({ card, showSchedule, onOpenModal }: PropertyCardInlineProps) {
  return (
    <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5, mt: 1.5 }}>
      <Box
        onClick={onOpenModal}
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
          bgcolor: 'background.default',
          cursor: onOpenModal ? 'pointer' : 'default',
          '&:hover': onOpenModal ? { borderColor: 'primary.main', bgcolor: 'action.hover' } : {},
          transition: 'border-color .2s, background-color .2s',
        }}
      >
        {/* 84×84 thumbnail */}
        {card.photo ? (
          <Box
            component="img"
            src={card.photo}
            alt={card.address}
            sx={{ width: 84, height: 84, objectFit: 'cover', flexShrink: 0, display: 'block' }}
          />
        ) : (
          <Box
            sx={{
              width: 84,
              height: 84,
              flexShrink: 0,
              bgcolor: 'action.selected',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.disabled',
            }}
          >
            <ImageOffIcon fontSize="small" aria-hidden />
          </Box>
        )}

        {/* Detail */}
        <Box sx={{ p: 1.5, minWidth: 0, flex: 1 }}>
          <Typography
            variant="body2"
            sx={{ fontWeight: 700, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {card.address}
          </Typography>
          {(card.beds || card.baths || card.sqft) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, noWrap: true }}>
              {[card.beds, card.baths, card.sqft].filter(Boolean).join(' · ')}
            </Typography>
          )}
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'primary.main', mt: 0.75 }}>
            {card.price}
          </Typography>
        </Box>
      </Box>

      {showSchedule && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<EventAvailableIcon />}
          sx={{ mt: 1 }}
        >
          Schedule a Showing
        </Button>
      )}
    </Box>
  );
}
