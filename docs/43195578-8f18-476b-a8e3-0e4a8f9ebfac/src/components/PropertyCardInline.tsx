import React from 'react';
import { Box, Stack, Typography, Button, Link } from '@mui/material';
import ImageNotSupportedIcon from '@mui/icons-material/ImageNotSupported';
import EventAvailableIcon from '@mui/icons-material/EventAvailableOutlined';
import type { PropertyCard } from '../data/inboxData';
interface PropertyCardInlineProps {
  card: PropertyCard;
  showSchedule?: boolean;
}
export function PropertyCardInline({
  card,
  showSchedule
}: PropertyCardInlineProps) {
  return (
    <Box
      sx={{
        borderTop: '1px solid',
        borderColor: 'divider',
        pt: 1.5,
        mt: 1.5
      }}>
      
      {card.photo ?
      <Box
        component="img"
        src={card.photo}
        alt={card.address}
        sx={{
          width: '100%',
          maxHeight: 200,
          objectFit: 'cover',
          borderRadius: 2,
          display: 'block',
          mb: 1
        }} /> :


      <Box
        sx={{
          width: '100%',
          height: 120,
          borderRadius: 2,
          mb: 1,
          bgcolor: 'action.hover',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
          gap: 0.5
        }}>
        
          <ImageNotSupportedIcon fontSize="small" />
          <Typography variant="caption">Photo unavailable</Typography>
        </Box>
      }
      <Typography variant="subtitle2">{card.address}</Typography>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{
          mt: 0.25
        }}>
        
        <Typography
          variant="body2"
          sx={{
            fontWeight: 700
          }}>
          
          {card.price}
        </Typography>
        <Link
          href="#"
          underline="hover"
          variant="body2"
          onClick={(e) => e.preventDefault()}>
          
          View
        </Link>
      </Stack>
      {(card.beds || card.baths || card.sqft) &&
      <Typography variant="caption" color="text.secondary">
          {[card.beds, card.baths, card.sqft].filter(Boolean).join(' • ')}
        </Typography>
      }
      {card.broker &&
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: 'block'
        }}>
        
          {card.broker}
        </Typography>
      }
      {card.blurb &&
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{
          display: 'block',
          mt: 0.5
        }}>
        
          {card.blurb}
        </Typography>
      }
      {showSchedule &&
      <Button
        size="small"
        variant="outlined"
        startIcon={<EventAvailableIcon />}
        sx={{
          mt: 1
        }}>
        
          Schedule a Showing
        </Button>
      }
    </Box>);

}