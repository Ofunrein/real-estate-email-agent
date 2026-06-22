"use client";
import React from 'react';
import {
  Box,
  Stack,
  Typography,
  Chip,
  Button,
  Avatar,
  IconButton,
  Tooltip,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText } from
'@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import MenuIcon from '@mui/icons-material/Menu';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { signOut } from 'next-auth/react';
import { Moon, Sun } from 'lucide-react';
import {
  calendarChannelMeta,
  contactsChannelMeta,
  importChannelMeta,
  type ChannelId,
  type MessageChannelId
} from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { useColorMode } from '../theme/ColorModeContext';
import { displayForChannelConnection, useChannelConnectionStatus } from '../hooks/useChannelConnectionStatus';
interface TopBarProps {
  channel: ChannelId;
  onOpenNav?: () => void;
  onOpenContext?: () => void;
  onOpenSettings?: () => void;
  showNavToggle?: boolean;
  showContextToggle?: boolean;
}

const composioConnectSlug: Partial<Record<ChannelId, string>> = {
  instagram: 'instagram',
  messenger: 'facebook',
  whatsapp: 'whatsapp',
};

export function TopBar({
  channel,
  onOpenNav,
  onOpenContext,
  onOpenSettings,
  showNavToggle = false,
  showContextToggle = false
}: TopBarProps) {
  const { mode, toggle } = useColorMode();
  const { channelMeta, channelAccounts } = useInboxModel();
  const { status: connectionStatus } = useChannelConnectionStatus(true);
  const [profileAnchor, setProfileAnchor] = React.useState<HTMLElement | null>(null);
  const profileOpen = Boolean(profileAnchor);
  const title =
  channel === 'all' ?
  'Overview' :
  channel === 'properties' ?
  'Properties' :
  channel === 'calendar' ?
  calendarChannelMeta.label :
  channel === 'contacts' ?
  contactsChannelMeta.label :
  channel === 'imports' ?
  importChannelMeta.label :
  (channelMeta[channel as MessageChannelId]?.label ?? channel);
  const account = channelAccounts[channel];
  const accountDisplay = displayForChannelConnection(
    connectionStatus,
    channel,
    account?.value || '',
    account?.status || ''
  );
  const agentReady = accountDisplay.ready;
  const connectSlug = composioConnectSlug[channel];
  const accountMeta =
  channel === 'all' || channel === 'properties' || channel === 'imports' || channel === 'calendar' || channel === 'contacts' ?
  undefined :
  channelMeta[channel as MessageChannelId];
  const AccountIcon = accountMeta?.icon;
  return (
    <Box
      component="header"
      sx={{
        px: {
          xs: 1.5,
          md: 3
        },
        py: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: {
          xs: 1,
          md: 2
        }
      }}>
      
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          minWidth: 0
        }}>
        
        {showNavToggle &&
        <IconButton
          onClick={onOpenNav}
          aria-label="Open navigation menu"
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            flexShrink: 0
          }}>
          
            <MenuIcon fontSize="small" />
          </IconButton>
        }
        <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0}>
          <Typography variant="h5" noWrap>
            {title}
          </Typography>
          <Chip
            size="small"
            icon={
            <CircleIcon
              sx={{
                fontSize: '10px !important'
              }} />

            }
            label={agentReady ? 'Agent active' : 'Setup needed'}
            sx={{
              flexShrink: 0,
              display: 'inline-flex',
              bgcolor: 'action.selected',
              color: agentReady ? 'success.main' : 'warning.main',
              '& .MuiChip-icon': {
                color: agentReady ? 'success.main' : 'warning.main'
              }
            }} />
          
        </Stack>
      </Box>

      <Stack
        direction="row"
        spacing={{
          xs: 0.75,
          md: 1.5
        }}
        alignItems="center">
        
        {/* Connected account headline */}
        <Box
          sx={{
            display: {
              xs: 'none',
              sm: 'grid'
            },
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            columnGap: 0.75,
            alignItems: 'center',
            minWidth: 0,
            maxWidth: { sm: 220, md: 320 }
          }}>
          {accountDisplay.avatarUrl ?
          <Avatar
            src={accountDisplay.avatarUrl}
            alt={accountDisplay.value}
            sx={{
              width: 24,
              height: 24,
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'action.hover'
            }} /> :
          AccountIcon &&
          <Box
            sx={{
              width: 24,
              height: 24,
              borderRadius: 1,
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'action.hover',
              color: 'text.primary',
              border: '1px solid',
              borderColor: 'divider'
            }}>
            
              <AccountIcon sx={{ fontSize: 15 }} aria-hidden />
            </Box>
          }
          <Box sx={{ minWidth: 0, textAlign: 'right' }}>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 700,
                color: 'text.primary',
                lineHeight: 1.15
              }}
          noWrap>
              
              {accountDisplay.value}
            </Typography>
            <Typography
              variant="caption"
              color={agentReady ? 'success.main' : 'warning.main'}
              sx={{
                display: 'block',
                fontWeight: 800,
                letterSpacing: '0.08em',
                lineHeight: 1.2
              }}>
              
              {accountDisplay.status}
            </Typography>
          </Box>
        </Box>

        <Button
          variant="outlined"
          size="small"
          href={connectSlug ? `/api/settings/composio/connect/${connectSlug}` : undefined}
          onClick={connectSlug ? undefined : onOpenSettings}
          sx={{
            display: {
              xs: 'none',
              sm: 'inline-flex'
            },
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 32,
            px: 1.75,
            lineHeight: 1,
            borderRadius: 999,
            fontWeight: 700
          }}>
          
          {agentReady ? 'Change' : 'Set up'}
        </Button>

        {/* Light / dark toggle: sun in dark mode, moon in light mode */}
        <Tooltip
          title={
          mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
          }>
          
          <IconButton
            onClick={toggle}
            aria-label={
            mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
            }
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2
            }}>
            
            {mode === 'dark' ?
            <Sun size={16} color="#fbbf24" /> :
            <Moon size={16} color="#6366f1" />
            }
          </IconButton>
        </Tooltip>

        {showContextToggle &&
        <Tooltip title="Open insights panel">
            <IconButton
            onClick={onOpenContext}
            aria-label="Open insights panel"
            sx={{
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 2
            }}>
            
              <InsightsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        }

        <Divider
          orientation="vertical"
          flexItem
          sx={{
            my: 0.5,
            display: {
              xs: 'none',
              sm: 'block'
            }
          }} />
        

        <CircleIcon
          sx={{
            fontSize: 10,
            color: agentReady ? 'success.main' : 'warning.main',
            display: {
              xs: 'none',
              sm: 'block'
            }
          }} />
        

        <Tooltip title="Open profile menu">
          <IconButton
            onClick={(event) => setProfileAnchor(event.currentTarget)}
            aria-label="Open profile menu"
            aria-controls={profileOpen ? 'profile-menu' : undefined}
            aria-haspopup="menu"
            aria-expanded={profileOpen ? 'true' : undefined}
            sx={{
              border: '1px solid',
              borderColor: profileOpen ? 'primary.main' : 'divider',
              borderRadius: 999,
              p: 0.25,
              gap: 0.25
            }}>
            <Avatar
              sx={{
                width: 30,
                height: 30,
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontWeight: 700,
                fontSize: 13
              }}>
              
              ML
            </Avatar>
            <KeyboardArrowDownIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.25 }} />
          </IconButton>
        </Tooltip>
        <Menu
          id="profile-menu"
          anchorEl={profileAnchor}
          open={profileOpen}
          onClose={() => setProfileAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{
            paper: {
              sx: {
                mt: 1,
                minWidth: 188,
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: 4
              }
            }
          }}>
          <MenuItem
            onClick={() => {
              setProfileAnchor(null);
              onOpenSettings?.();
            }}>
            <ListItemIcon>
              <SettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Settings" />
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              setProfileAnchor(null);
              void signOut({ callbackUrl: '/login' });
            }}>
            <ListItemIcon>
              <LogoutIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText primary="Log out" />
          </MenuItem>
        </Menu>
      </Stack>
    </Box>);

}
