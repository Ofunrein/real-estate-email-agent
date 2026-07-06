"use client";
import React from 'react';
import { Box, Stack, Typography, Button, useTheme } from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailableOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import ImageOffIcon from '@mui/icons-material/ImageNotSupported';
import type { PropertyCard } from '../data/inboxData';

interface PropertyCardInlineProps {
  card: PropertyCard;
  showSchedule?: boolean;
  onOpenModal?: () => void;
  outbound?: boolean;
}

// Iris Dashboard.dc.html — inline property card shown inside a conversation:
// hero photo + gradient overlay, Available badge (top-left), match-score badge
// (top-right, only if data has one), price overlay (bottom-left), address +
// beds/baths/sqft in mono, then a CTA row.
export function PropertyCardInline({ card, showSchedule, onOpenModal, outbound }: PropertyCardInlineProps) {
  const theme = useTheme();
  const iris = theme.iris;
  const isDark = theme.palette.mode === 'dark';
  const elev = isDark
    ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 50px rgba(0,0,0,0.4)'
    : '0 1px 1px rgba(15,23,42,0.04), 0 8px 18px rgba(15,23,42,0.08), 0 24px 60px rgba(15,23,42,0.06)';
  const elevHover = isDark
    ? 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px rgba(196,154,82,0.18), 0 22px 70px rgba(0,0,0,0.5)'
    : '0 2px 3px rgba(15,23,42,0.05), 0 14px 28px rgba(15,23,42,0.10), 0 34px 80px rgba(15,23,42,0.08)';
  const cardHi = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 1px 0 rgba(255,255,255,0.9)';

  const details = [card.beds && `${card.beds} bd`, card.baths && `${card.baths} ba`, card.sqft && `${card.sqft} sf`]
    .filter(Boolean)
    .join(' · ');

  return (
    <Box sx={{ mt: 1.5, maxWidth: 280, width: '100%' }}>
      <Box
        sx={{
          borderRadius: 3.5,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: outbound ? 'rgba(255,255,255,0.25)' : iris.cardBorder,
          bgcolor: outbound ? 'rgba(255,255,255,0.12)' : iris.card,
          boxShadow: `${cardHi}, ${elev}`,
          transition: 'transform .2s cubic-bezier(.4,0,.2,1), box-shadow .2s',
          '&:hover': onOpenModal
            ? { transform: 'translateY(-2px)', boxShadow: `${cardHi}, ${elevHover}` }
            : undefined,
        }}
      >
        {/* Hero photo with gradient overlay + badges */}
        <Box
          onClick={onOpenModal}
          sx={{
            position: 'relative',
            height: 130,
            bgcolor: iris.surface2,
            cursor: onOpenModal ? 'pointer' : 'default',
          }}
        >
          {card.photo ? (
            <Box
              component="img"
              src={card.photo}
              alt={card.address}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <Box
              sx={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: iris.textSubtle,
              }}
            >
              <ImageOffIcon fontSize="small" aria-hidden />
            </Box>
          )}
          {card.photo && (
            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.28)' }} />
          )}
          <Box
            component="span"
            sx={{
              position: 'absolute',
              top: 9,
              left: 9,
              px: 1.1,
              py: 0.3,
              fontSize: 10,
              fontWeight: 500,
              borderRadius: 999,
              bgcolor: iris.success,
              color: '#fff',
            }}
          >
            Available
          </Box>
          <Box
            component="span"
            sx={{
              position: 'absolute',
              bottom: 9,
              left: 11,
              color: '#fff',
              fontSize: 17,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              textShadow: '0 1px 3px rgba(0,0,0,0.4)',
            }}
          >
            {card.price}
          </Box>
        </Box>

        {/* Detail */}
        <Box sx={{ p: 1.6 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: outbound ? '#fff' : 'text.primary',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.address}
          </Typography>
          {details && (
            <Typography
              variant="caption"
              noWrap
              sx={{
                display: 'block',
                mt: 0.4,
                fontFamily: 'var(--font-mono)',
                color: outbound ? 'rgba(255,255,255,0.75)' : iris.textSubtle,
              }}
            >
              {details}
            </Typography>
          )}

          {/* CTA row */}
          <Stack direction="row" spacing={0.75} sx={{ mt: 1.4 }}>
            <Button
              size="small"
              variant="text"
              startIcon={<VisibilityOutlinedIcon sx={{ fontSize: 15 }} />}
              onClick={onOpenModal}
              sx={{ flex: 1, minWidth: 0, fontSize: 12, px: 1 }}
            >
              View
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<SendOutlinedIcon sx={{ fontSize: 14 }} />}
              sx={{ flex: 1, minWidth: 0, fontSize: 12, px: 1 }}
            >
              Send
            </Button>
          </Stack>
          {showSchedule && (
            <Button
              size="small"
              variant="contained"
              disableElevation
              startIcon={<EventAvailableIcon sx={{ fontSize: 15 }} />}
              sx={{ mt: 0.75, width: '100%', fontSize: 12 }}
            >
              Schedule a showing
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
