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
  ListItemText,
  useTheme } from
'@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import MenuIcon from '@mui/icons-material/Menu';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { signOut } from 'next-auth/react';
import {
  calendarChannelMeta,
  contactsChannelMeta,
  importChannelMeta,
  type ChannelId,
  type MessageChannelId
} from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { ColorModeToggle } from './ColorModeToggle';
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
  whatsapp: 'whatsapp',
};

function channelConnectHref(channel: ChannelId) {
  if (channel === 'instagram' || channel === 'messenger') {
    return `/api/channels/meta/connect?channel=${channel}&use_sdk=1`;
  }
  const connectSlug = composioConnectSlug[channel];
  return connectSlug ? `/api/settings/composio/connect/${connectSlug}` : undefined;
}

// Circular icon button matching the Iris mockup's header controls: card
// surface, soft layered shadow, hover lift with deeper shadow.
function HeaderIconButton({
  children,
  onClick,
  ariaLabel,
  borderColor,
  round = true
}: {
  children: React.ReactNode;
  onClick?: (event: React.MouseEvent<HTMLElement>) => void;
  ariaLabel: string;
  borderColor?: string;
  round?: boolean;
}) {
  const theme = useTheme();
  const isLight = theme.palette.mode === 'light';
  return (
    <IconButton
      onClick={onClick}
      aria-label={ariaLabel}
      sx={{
        position: 'relative',
        width: round ? 38 : 'auto',
        height: 38,
        px: round ? 0 : 0.5,
        borderRadius: round ? '50%' : 999,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: borderColor || 'divider',
        boxShadow: isLight
          ? 'inset 0 1px 0 rgba(255,255,255,.9), 0 1px 1px rgba(15,23,42,.04), 0 8px 18px rgba(15,23,42,.08), 0 24px 60px rgba(15,23,42,.06)'
          : 'inset 0 1px 0 rgba(255,255,255,.04), 0 18px 50px rgba(0,0,0,.4)',
        transition: 'transform 0.15s, box-shadow 0.15s',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: isLight
            ? 'inset 0 1px 0 rgba(255,255,255,.9), 0 2px 3px rgba(15,23,42,.05), 0 14px 28px rgba(15,23,42,.10), 0 34px 80px rgba(15,23,42,.08)'
            : 'inset 0 1px 0 rgba(255,255,255,.06), 0 0 0 1px rgba(196,154,82,.18), 0 22px 70px rgba(0,0,0,.5)'
        },
        '&:active': { transform: 'translateY(0)' }
      }}
    >
      {children}
    </IconButton>
  );
}

export function TopBar({
  channel,
  onOpenNav,
  onOpenContext,
  onOpenSettings,
  showNavToggle = false,
  showContextToggle = false
}: TopBarProps) {
  const theme = useTheme();
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
  const connectHref = channelConnectHref(channel);
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
        backgroundColor: 'background.paper',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: {
          xs: 'wrap',
          sm: 'nowrap'
        },
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
          minWidth: 0,
          flex: {
            xs: '1 1 100%',
            sm: '1 1 auto'
          }
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
        <Stack direction="row" spacing={1.5} alignItems="center" minWidth={0} flex={1}>
          <Typography variant="h5" noWrap sx={{ minWidth: 0 }}>
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
              display: {
                xs: 'none',
                sm: 'inline-flex'
              },
              borderRadius: 999,
              fontWeight: 600,
              bgcolor: agentReady ? theme.iris.successSoft : theme.iris.warningSoft,
              color: agentReady ? theme.iris.success : theme.iris.warning,
              '& .MuiChip-icon': {
                color: agentReady ? theme.iris.success : theme.iris.warning
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
        alignItems="center"
        sx={{
          width: {
            xs: '100%',
            sm: 'auto'
          },
          minWidth: 0,
          flexShrink: 0,
          justifyContent: {
            xs: 'space-between',
            sm: 'flex-end'
          }
        }}>

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
              sx={{
                display: 'block',
                fontWeight: 800,
                letterSpacing: '0.08em',
                lineHeight: 1.2,
                color: agentReady ? theme.iris.success : theme.iris.warning
              }}>

              {accountDisplay.status}
            </Typography>
          </Box>
        </Box>

        <Button
          variant="outlined"
          size="small"
          href={connectHref}
          onClick={connectHref ? undefined : onOpenSettings}
          sx={{
            display: {
              xs: 'inline-flex'
            },
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 32,
            minWidth: {
              xs: 72,
              sm: 0
            },
            px: {
              xs: 1.25,
              sm: 1.75
            },
            lineHeight: 1,
            borderRadius: 999,
            fontWeight: 700,
            flexShrink: 0
          }}>

          {agentReady ? 'Change' : 'Set up'}
        </Button>

        {/* Light / dark toggle */}
        <ColorModeToggle />

        {showContextToggle &&
        <Tooltip title="Open insights panel">
          <span>
            <HeaderIconButton onClick={onOpenContext} ariaLabel="Open insights panel">
              <InsightsIcon fontSize="small" sx={{ color: 'text.secondary' }} />
            </HeaderIconButton>
          </span>
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


        <Tooltip title="Open profile menu">
          <span>
            <HeaderIconButton
              onClick={(event) => setProfileAnchor(event.currentTarget)}
              ariaLabel="Open profile menu"
              borderColor={profileOpen ? 'primary.main' : undefined}
              round={false}
            >
              <Stack direction="row" alignItems="center" spacing={0.25}>
                <Avatar
                  sx={{
                    width: 24,
                    height: 24,
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    fontWeight: 700,
                    fontSize: 10
                  }}>

                  ML
                </Avatar>
                <KeyboardArrowDownIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
              </Stack>
            </HeaderIconButton>
          </span>
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
