"use client";
import React from 'react';
import { Box, Stack, Typography, Chip, Button } from '@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import FlagIcon from '@mui/icons-material/OutlinedFlag';
interface WorkspaceHeaderProps {
  title: string;
  subtitle: string;
  count: string;
  reviewCount?: number;
  agentActive?: boolean;
  agentLabel?: string;
}
export function WorkspaceHeader({
  title,
  subtitle,
  count,
  reviewCount,
  agentActive = true,
  agentLabel
}: WorkspaceHeaderProps) {
  return (
    <Box
      sx={{
        mb: 2
      }}>
      
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        flexWrap="wrap"
        gap={1}>
        
        <Box>
          <Typography variant="h6">{title}</Typography>
          <Typography variant="caption" color="text.secondary">
            {subtitle}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" variant="outlined" label={count} />
          <Chip
            size="small"
            icon={
            <CircleIcon
              sx={{
                fontSize: '9px !important'
              }} />

            }
            label={agentLabel || (agentActive ? "Agent active" : "Setup needed")}
            sx={{
              bgcolor: 'action.selected',
              color: agentActive ? 'success.main' : 'warning.main',
              '& .MuiChip-icon': {
                color: agentActive ? 'success.main' : 'warning.main'
              }
            }} />
          
        </Stack>
      </Stack>

      {reviewCount ?
      <Box
        sx={{
          mt: 1.5,
          p: 1.25,
          borderRadius: 2,
          bgcolor: 'action.hover',
          border: '1px solid',
          borderColor: 'divider',
          display: 'flex',
          gap: 1,
          alignItems: 'center'
        }}>
        
          <FlagIcon
          fontSize="small"
          sx={{
            color: 'warning.main'
          }} />
        
          <Box>
            <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: 'warning.main'
            }}>
            
              {reviewCount} threads need human review
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Open the flagged thread before the AI continues beyond the handoff
              message.
            </Typography>
          </Box>
        </Box> :
      null}
    </Box>);

}
