"use client";
import React from 'react';
import {
  Dialog, DialogContent, DialogTitle, Box, Stack, Typography,
  IconButton, Chip, Divider, Button,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PhoneIphoneIcon from '@mui/icons-material/PhoneIphone';
import EventAvailableIcon from '@mui/icons-material/EventAvailableOutlined';
import ImageNotSupportedIcon from '@mui/icons-material/ImageNotSupported';
import type { Property } from '../data/inboxData';

interface PropertyModalProps {
  property: Property | null;
  open: boolean;
  onClose: () => void;
}

export function PropertyModal({ property, open, onClose }: PropertyModalProps) {
  if (!property) return null;

  const details = [
    property.beds && `${property.beds} beds`,
    property.baths && `${property.baths} baths`,
    property.sqft && `${property.sqft} sqft`,
    property.year && `Built ${property.year}`,
    property.type,
  ].filter(Boolean);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { borderRadius: 3, overflow: 'hidden' } }}
    >
      {/* Hero image */}
      {property.photo ? (
        <Box
          component="img"
          src={property.photo}
          alt={property.address}
          sx={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <Box
          sx={{
            width: '100%', height: 180, bgcolor: 'action.selected',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1,
          }}
        >
          <ImageNotSupportedIcon sx={{ color: 'text.disabled', fontSize: 36 }} aria-hidden />
          <Typography variant="caption" color="text.disabled">No photo available</Typography>
        </Box>
      )}

      <DialogTitle sx={{ pb: 0.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h6" sx={{ lineHeight: 1.2 }}>{property.address}</Typography>
            <Typography variant="body2" color="text.secondary">{property.city}{property.zip ? `, ${property.zip}` : ''}</Typography>
          </Box>
          <IconButton onClick={onClose} size="small" aria-label="Close" sx={{ mt: -0.5, mr: -1 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent sx={{ pt: 1 }}>
        <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ mb: 1.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, color: 'primary.main' }}>
            {property.price}
          </Typography>
          {property.neighborhood && (
            <Chip size="small" label={property.neighborhood} sx={{ bgcolor: 'action.selected' }} />
          )}
        </Stack>

        {details.length > 0 && (
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
            {details.map((d) => (
              <Chip key={d} size="small" label={d} variant="outlined" />
            ))}
          </Stack>
        )}

        {/* Mobile preview placeholder */}
        <Box
          sx={{
            border: '1px solid', borderColor: 'divider', borderRadius: 2,
            p: 2, bgcolor: 'background.default', mb: 2,
            display: 'flex', alignItems: 'center', gap: 1.5,
          }}
        >
          <PhoneIphoneIcon sx={{ color: 'primary.main', fontSize: 28 }} aria-hidden />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Mobile preview</Typography>
            <Typography variant="caption" color="text.secondary">
              How this property appears in the AI's outbound messages.
            </Typography>
          </Box>
        </Box>

        {property.broker && (
          <>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="caption" color="text.secondary">Listed by {property.broker}</Typography>
          </>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" size="small" startIcon={<EventAvailableIcon />} disableElevation>
            Schedule a Showing
          </Button>
          <Button variant="outlined" size="small" onClick={onClose}>
            Close
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
