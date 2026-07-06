"use client";
import React from 'react';
import { Box, Stack, Typography, Chip, useTheme } from '@mui/material';
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
  const theme = useTheme();
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
          <Chip
            size="small"
            variant="outlined"
            label={count}
            sx={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              borderRadius: 999,
              bgcolor: 'background.paper'
            }} />
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
              borderRadius: 999,
              fontWeight: 600,
              bgcolor: agentActive ? theme.iris.successSoft : theme.iris.warningSoft,
              color: agentActive ? theme.iris.success : theme.iris.warning,
              '& .MuiChip-icon': {
                color: agentActive ? theme.iris.success : theme.iris.warning
              }
            }} />

        </Stack>
      </Stack>

      {reviewCount ?
      <Box
        sx={{
          mt: 1.5,
          p: 1.25,
          borderRadius: 3,
          bgcolor: theme.iris.warningSoft,
          border: '1px solid',
          borderColor: theme.palette.mode === 'dark' ? 'rgba(251,191,36,0.35)' : 'rgba(180,83,9,0.25)',
          display: 'flex',
          gap: 1,
          alignItems: 'center'
        }}>

          <FlagIcon
          fontSize="small"
          sx={{
            color: theme.iris.warning
          }} />

          <Box>
            <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: theme.iris.warning
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
