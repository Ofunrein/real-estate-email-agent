"use client";
import React from 'react';
import {
  Box,
  Stack,
  Typography,
  ListItemButton,
  Avatar,
  Chip,
  Divider } from
'@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import HomeOutlinedIcon from '@mui/icons-material/HomeWorkOutlined';
import DashboardIcon from '@mui/icons-material/DashboardOutlined';
import { calendarChannelMeta, contactsChannelMeta, importChannelMeta, type ChannelId, type MessageChannelId } from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { displayForChannelConnection, useChannelConnectionStatus } from '../hooks/useChannelConnectionStatus';
interface NavRailProps {
  active: ChannelId;
  onSelect: (id: ChannelId) => void;
  inDrawer?: boolean;
}
export function NavRail({ active, onSelect, inDrawer = false }: NavRailProps) {
  const { channels, channelAccounts } = useInboxModel();
  const { status: connectionStatus } = useChannelConnectionStatus(true);
  const ImportIcon = importChannelMeta.icon;
  const ContactsIcon = contactsChannelMeta.icon;
  const CalendarIcon = calendarChannelMeta.icon;
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
        p: 2,
        overflowY: 'auto'
      }}>
      
      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{
          px: 0.5,
          mb: 3
        }}>
        
        <Avatar
          variant="rounded"
          sx={{
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            width: 38,
            height: 38,
            borderRadius: 2
          }}>
          
          <HomeRoundedIcon fontSize="small" />
        </Avatar>
        <Box>
          <Typography
            variant="subtitle1"
            sx={{
              lineHeight: 1.1
            }}>
            
            Agent Inbox
          </Typography>
        </Box>
      </Stack>

      <Typography
        variant="overline"
        color="text.secondary"
        sx={{
          px: 1,
          mb: 0.5
        }}>
        
        Navigation
      </Typography>

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
          accent="#9B8FFF" />
        
        {channels.
        filter((c) => c.id !== 'all').
        map((c) => {
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
          accent="#94a3b8" />
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
          borderRadius: 2,
          py: 0.9,
          px: 1.25,
          '&.Mui-selected': {
            bgcolor: 'action.selected',
            '&:hover': {
              bgcolor: 'action.selected'
            }
          }
        }}>

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: active ? accent : 'text.secondary',
            mr: 1.5
          }}>

          {icon}
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: active ? 600 : 500,
              color: active ? 'text.primary' : 'text.secondary',
              lineHeight: subtitle ? 1.2 : undefined
            }}>

            {label}
          </Typography>
          {subtitle &&
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              color: 'text.disabled',
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
          variant="caption"
          color="text.secondary"
          sx={{
            fontWeight: 600
          }}>

            {count}
          </Typography>
        }
      </ListItemButton>
    </li>);

}
