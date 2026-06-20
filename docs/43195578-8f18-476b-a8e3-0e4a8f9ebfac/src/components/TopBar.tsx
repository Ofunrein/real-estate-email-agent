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
  Divider } from
'@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import MenuIcon from '@mui/icons-material/Menu';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import LightModeIcon from '@mui/icons-material/WbSunnyOutlined';
import DarkModeIcon from '@mui/icons-material/NightlightRound';
import { channelMeta, channelAccounts, type ChannelId } from '../data/inboxData';
import { useColorMode } from '../theme/ColorModeContext';
interface TopBarProps {
  channel: ChannelId;
  onOpenNav?: () => void;
  onOpenContext?: () => void;
  onOpenSettings?: () => void;
  showNavToggle?: boolean;
  showContextToggle?: boolean;
}
export function TopBar({
  channel,
  onOpenNav,
  onOpenContext,
  onOpenSettings,
  showNavToggle = false,
  showContextToggle = false
}: TopBarProps) {
  const { mode, toggle } = useColorMode();
  const title =
  channel === 'all' ?
  'Overview' :
  channel === 'properties' ?
  'Properties' :
  channelMeta[channel].label;
  const account = channelAccounts[channel];
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
            label="Agent active"
            sx={{
              flexShrink: 0,
              display: {
                xs: 'none',
                sm: 'inline-flex'
              },
              bgcolor: 'action.selected',
              color: 'success.main',
              '& .MuiChip-icon': {
                color: 'success.main'
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
            textAlign: 'right',
            display: {
              xs: 'none',
              md: 'block'
            },
            minWidth: 0
          }}>
          
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700
            }}
            noWrap>
            
            {account.label}: {account.value}
          </Typography>
          <Typography
            variant="caption"
            color="success.main"
            sx={{
              fontWeight: 700,
              letterSpacing: '0.08em'
            }}>
            
            {account.status}
          </Typography>
        </Box>

        <Button
          variant="outlined"
          size="small"
          sx={{
            display: {
              xs: 'none',
              sm: 'inline-flex'
            }
          }}>
          
          Change
        </Button>

        <Button
          variant="text"
          size="small"
          onClick={onOpenSettings}
          aria-label="Open settings">
          
          Settings
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
            <LightModeIcon
              fontSize="small"
              sx={{
                color: 'warning.main'
              }} /> :


            <DarkModeIcon
              fontSize="small"
              sx={{
                color: 'primary.main'
              }} />

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
            color: 'success.main',
            display: {
              xs: 'none',
              sm: 'block'
            }
          }} />
        

        <Avatar
          sx={{
            width: 34,
            height: 34,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            fontWeight: 700,
            fontSize: 14
          }}>
          
          ML
        </Avatar>
      </Stack>
    </Box>);

}