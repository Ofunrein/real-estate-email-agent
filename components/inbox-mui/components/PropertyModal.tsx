"use client";
import React from 'react';
import {
  Dialog, DialogContent, Box, Stack, Typography,
  IconButton, Chip, Divider, Button, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EventAvailableIcon from '@mui/icons-material/EventAvailableOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import ImageNotSupportedIcon from '@mui/icons-material/ImageNotSupported';
import type { Property } from '../data/inboxData';

interface PropertyModalProps {
  property: Property | null;
  open: boolean;
  onClose: () => void;
}

// Iris Design System.dc.html "07 — Property & listing cards" — larger hero,
// same badge/price/detail treatment as the inline card, plus a feature list
// when the underlying data has one.
export function PropertyModal({ property, open, onClose }: PropertyModalProps) {
  const theme = useTheme();
  const iris = theme.iris;
  const isDark = theme.palette.mode === 'dark';
  const elev = isDark
    ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 18px 50px rgba(0,0,0,0.4)'
    : '0 1px 1px rgba(15,23,42,0.04), 0 8px 18px rgba(15,23,42,0.08), 0 24px 60px rgba(15,23,42,0.06)';
  const cardHi = isDark ? 'inset 0 1px 0 rgba(255,255,255,0.06)' : 'inset 0 1px 0 rgba(255,255,255,0.9)';

  if (!property) return null;

  const isBlank = (v?: string) => !v || v === 'Blank';

  const details = [
    !isBlank(property.beds) && `${property.beds} bd`,
    !isBlank(property.baths) && `${property.baths} ba`,
    !isBlank(property.sqft) && `${property.sqft} sf`,
    !isBlank(property.type) && property.type,
  ].filter(Boolean).join(' · ');

  const features = [
    !isBlank(property.neighborhood) ? property.neighborhood : '',
    !isBlank(property.year) ? `Built ${property.year}` : '',
    !isBlank(property.type) ? property.type : '',
  ].filter(Boolean);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 4.5, overflow: 'hidden', boxShadow: `${cardHi}, ${elev}` } }}
    >
      {/* Hero image with gradient overlay + badges, matching the inline card language */}
      <Box sx={{ position: 'relative', height: 260, bgcolor: iris.surface2 }}>
        {property.photo ? (
          <>
            <Box
              component="img"
              src={property.photo}
              alt={property.address}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
            <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.34)' }} />
          </>
        ) : (
          <Box
            sx={{
              width: '100%', height: '100%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', flexDirection: 'column', gap: 1,
            }}
          >
            <ImageNotSupportedIcon sx={{ color: iris.textSubtle, fontSize: 36 }} aria-hidden />
            <Typography variant="caption" sx={{ color: iris.textSubtle }}>No photo available</Typography>
          </Box>
        )}

        {!isBlank(property.status) && (
          <Box
            component="span"
            sx={{
              position: 'absolute', top: 12, left: 12, px: 1.2, py: 0.4,
              fontSize: 11, fontWeight: 500, borderRadius: 999,
              bgcolor: iris.success, color: '#fff',
            }}
          >
            {property.status}
          </Box>
        )}

        <IconButton
          onClick={onClose}
          size="small"
          aria-label="Close"
          sx={{
            position: 'absolute', top: 10, right: 10,
            bgcolor: 'rgba(0,0,0,0.45)', color: '#fff',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>

        {property.photo && (
          <Box sx={{ position: 'absolute', bottom: 14, left: 16, color: '#fff' }}>
            <Typography sx={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
              {property.price}
            </Typography>
            <Typography sx={{ fontSize: 13, opacity: 0.85, mt: 0.25 }}>
              {property.address}
            </Typography>
          </Box>
        )}
      </Box>

      <DialogContent sx={{ pt: 2.5 }}>
        {!property.photo && (
          <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ mb: 1.5 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: 'text.primary' }}>
              {property.price}
            </Typography>
            <Typography variant="body2" color="text.secondary">{property.address}</Typography>
          </Stack>
        )}

        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          {property.city}{!isBlank(property.zip) ? `, ${property.zip}` : ''}
        </Typography>

        {details && (
          <Typography
            variant="body2"
            sx={{ fontFamily: 'var(--font-mono)', color: 'text.secondary', mb: 1.5 }}
          >
            {details}
          </Typography>
        )}

        {features.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            {features.map((f) => (
              <Chip
                key={f}
                size="small"
                label={f}
                sx={{
                  bgcolor: iris.accentSoft,
                  color: iris.accentInk,
                  border: '1px solid',
                  borderColor: iris.accentSoft,
                  fontWeight: 600,
                }}
              />
            ))}
          </Stack>
        )}

        {!isBlank(property.broker) && (
          <>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="caption" color="text.secondary">Listed by {property.broker}</Typography>
          </>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" size="small" startIcon={<EventAvailableIcon />} disableElevation>
            Schedule a showing
          </Button>
          <Button variant="outlined" size="small" startIcon={<SendOutlinedIcon />}>
            Send details
          </Button>
          <Button variant="text" size="small" onClick={onClose} sx={{ ml: 'auto' }}>
            Close
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
