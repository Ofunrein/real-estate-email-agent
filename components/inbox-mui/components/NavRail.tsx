"use client";
import React from 'react';
import {
  Box,
  Stack,
  Typography,
  ListItemButton,
  Avatar,
  Chip,
  Divider,
  useTheme } from
'@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import HomeOutlinedIcon from '@mui/icons-material/HomeWorkOutlined';
import DashboardIcon from '@mui/icons-material/DashboardOutlined';
import { calendarChannelMeta, contactsChannelMeta, importChannelMeta, opsChannelMeta, type ChannelId, type MessageChannelId } from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { displayForChannelConnection, useChannelConnectionStatus } from '../hooks/useChannelConnectionStatus';
interface NavRailProps {
  active: ChannelId;
  onSelect: (id: ChannelId) => void;
  inDrawer?: boolean;
}
export function NavRail({ active, onSelect, inDrawer = false }: NavRailProps) {
  const theme = useTheme();
  const { channels, channelAccounts } = useInboxModel();
  const { status: connectionStatus } = useChannelConnectionStatus(true);
  const ImportIcon = importChannelMeta.icon;
  const ContactsIcon = contactsChannelMeta.icon;
  const CalendarIcon = calendarChannelMeta.icon;
  const OpsIcon = opsChannelMeta.icon;
  const messageChannels = channels.filter((c) => c.id !== 'all');
  const connectedChannelCount = messageChannels.filter((c) => {
    const account = channelAccounts?.[c.id];
    const display = displayForChannelConnection(
      connectionStatus,
      c.id as MessageChannelId,
      account?.value || '',
      account?.status || ''
    );
    return display.ready;
  }).length;
  return (
    <Box
      component="nav"
      aria-label="Channels"
      sx={{
        width: 248,
        flexShrink: 0,
        bgcolor: 'background.paper',
        borderRight: inDrawer ? 'none' : '1px solid',
        borderColor: 'divider',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        p: 1.5,
        overflowY: 'auto'
      }}>

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{
          px: 1,
          py: 0.5,
          mb: 2
        }}>

        <Avatar
          variant="rounded"
          sx={{
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            width: 34,
            height: 34,
            borderRadius: 2.5
          }}>

          <HomeRoundedIcon fontSize="small" />
        </Avatar>
        <Box>
          <Typography
            variant="subtitle1"
            sx={{
              lineHeight: 1.15,
              fontWeight: 700,
              letterSpacing: '-0.01em'
            }}>

            Iris
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
            Agent Inbox
          </Typography>
        </Box>
      </Stack>

      <Stack
        spacing={0.25}
        component="ul"
        sx={{
          listStyle: 'none',
          p: 0,
          m: 0
        }}>

        <NavItem
          label="Overview"
          icon={<DashboardIcon fontSize="small" />}
          active={active === 'all'}
          onClick={() => onSelect('all')}
          accent={theme.iris.accent} />

        {messageChannels.map((c) => {
          const Icon = c.icon;
          const account = channelAccounts?.[c.id];
          const accountDisplay = displayForChannelConnection(
            connectionStatus,
            c.id as MessageChannelId,
            account?.value || '',
            account?.status || ''
          );
          const subtitle = accountDisplay.ready ? accountDisplay.value : undefined;
          return (
            <NavItem
              key={c.id}
              label={c.label}
              icon={<Icon fontSize="small" />}
              count={c.count}
              active={active === c.id}
              onClick={() => onSelect(c.id)}
              accent={c.accent}
              subtitle={subtitle} />);


        })}
        <NavItem
          label="Properties"
          icon={<HomeOutlinedIcon fontSize="small" />}
          active={active === 'properties'}
          onClick={() => onSelect('properties')}
          accent={theme.palette.text.secondary} />
        <NavItem
          label={contactsChannelMeta.label}
          icon={<ContactsIcon fontSize="small" />}
          active={active === 'contacts'}
          onClick={() => onSelect('contacts')}
          accent={contactsChannelMeta.accent} />
        <NavItem
          label={calendarChannelMeta.label}
          icon={<CalendarIcon fontSize="small" />}
          active={active === 'calendar'}
          onClick={() => onSelect('calendar')}
          accent={calendarChannelMeta.accent} />
        <NavItem
          label={importChannelMeta.label}
          icon={<ImportIcon fontSize="small" />}
          active={active === 'imports'}
          onClick={() => onSelect('imports')}
          accent={importChannelMeta.accent} />
        <NavItem
          label={opsChannelMeta.label}
          icon={<OpsIcon fontSize="small" />}
          active={active === 'ops'}
          onClick={() => onSelect('ops')}
          accent={opsChannelMeta.accent} />

      </Stack>

      <Divider
        sx={{
          my: 2
        }} />


      <Typography
        variant="overline"
        color="text.secondary"
        sx={{
          px: 1,
          mb: 1
        }}>

        Recent
      </Typography>
      <Stack
        spacing={1}
        sx={{
          px: 1
        }}>

        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center">

          <Typography variant="body2" color="text.secondary">
            Need review
          </Typography>
          <Chip label="9" size="small" color="warning" variant="outlined" />
        </Stack>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center">

          <Typography variant="body2" color="text.secondary">
            Leads total
          </Typography>
          <Chip label="4" size="small" variant="outlined" />
        </Stack>
      </Stack>

      <Box
        sx={{
          flexGrow: 1
        }} />


      {/* Iris status card — AI signal: amber avatar ring + green pulse dot. */}
      <Stack
        direction="row"
        spacing={1.25}
        alignItems="center"
        sx={{
          p: 1.1,
          borderRadius: 3,
          bgcolor: 'action.hover'
        }}>

        <Box sx={{ position: 'relative', width: 34, height: 34, flexShrink: 0 }}>
          <Avatar
            sx={{
              width: 34,
              height: 34,
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              fontWeight: 700,
              fontSize: 12,
              border: '2px solid',
              borderColor: theme.iris.accent
            }}>

            IR
          </Avatar>
          <Box
            sx={{
              position: 'absolute',
              bottom: -1,
              right: -1,
              width: 10,
              height: 10,
              borderRadius: '50%',
              bgcolor: theme.iris.success,
              border: '2px solid',
              borderColor: 'background.paper',
              '@keyframes irisPulse': {
                '0%': { boxShadow: `0 0 0 0 ${theme.iris.success}80` },
                '70%': { boxShadow: `0 0 0 6px ${theme.iris.success}00` },
                '100%': { boxShadow: `0 0 0 0 ${theme.iris.success}00` }
              },
              animation: 'irisPulse 1.8s infinite'
            }} />

        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
            Iris
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: theme.iris.success, fontWeight: 600, lineHeight: 1.2, display: 'block' }}>

            Active · {connectedChannelCount} channel{connectedChannelCount === 1 ? '' : 's'}
          </Typography>
        </Box>
      </Stack>
    </Box>);

}
interface NavItemProps {
  label: string;
  icon: React.ReactNode;
  count?: number;
  active: boolean;
  accent: string;
  onClick: () => void;
  subtitle?: string;
}
function NavItem({
  label,
  icon,
  count,
  active,
  accent,
  onClick,
  subtitle
}: NavItemProps) {
  return (
    <li>
      <ListItemButton
        onClick={onClick}
        selected={active}
        sx={{
          borderRadius: 2.5,
          py: 0.85,
          px: 1.25,
          '&.Mui-selected': {
            bgcolor: 'primary.main',
            '&:hover': {
              bgcolor: 'primary.main'
            }
          }
        }}>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: active ? 'primary.contrastText' : accent,
            opacity: active ? 1 : 0.9,
            mr: 1.5
          }}>

          {icon}
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: active ? 600 : 500,
              color: active ? 'primary.contrastText' : 'text.primary',
              lineHeight: subtitle ? 1.2 : undefined
            }}>

            {label}
          </Typography>
          {subtitle &&
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: active ? 'primary.contrastText' : 'text.disabled',
              opacity: active ? 0.75 : 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: 1.3
            }}>
            {subtitle}
          </Typography>
          }
        </Box>
        {count != null &&
        <Typography
          component="span"
          variant="caption"
          sx={{
            fontWeight: 700,
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            px: 0.85,
            py: 0.15,
            borderRadius: 999,
            bgcolor: active ? 'rgba(255,255,255,0.22)' : 'action.selected',
            color: active ? 'primary.contrastText' : 'text.secondary'
          }}>

            {count}
          </Typography>
        }
      </ListItemButton>
    </li>);

}
