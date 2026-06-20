import React, { useState } from 'react';
import { Box, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { NavRail } from '../components/NavRail';
import { TopBar } from '../components/TopBar';
import { ContextColumn } from '../components/ContextColumn';
import { OverviewView } from '../components/OverviewView';
import { EmailView } from '../components/EmailView';
import { SmsView } from '../components/SmsView';
import { VoiceView } from '../components/VoiceView';
import { EmptyChannelView } from '../components/EmptyChannelView';
import { PropertiesView } from '../components/PropertiesView';
import { SettingsDrawer } from '../components/SettingsDrawer';
import { type ChannelId } from '../data/inboxData';
import { useScreenInit } from '../useScreenInit.js';
export function InboxPage() {
  const screenInit = useScreenInit();
  const [channel, setChannel] = useState<ChannelId>(
    screenInit?.channel as ChannelId ?? 'all'
  );
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = useTheme();
  const isLgUp = useMediaQuery(theme.breakpoints.up('lg'));
  const showContextRail = channel !== 'properties';
  const handleSelect = (id: ChannelId) => {
    setChannel(id);
    setNavOpen(false);
  };
  return (
    <Box
      sx={{
        display: 'flex',
        width: '100%',
        height: {
          xs: 'auto',
          lg: '100vh'
        },
        minHeight: '100vh',
        bgcolor: 'background.default',
        overflow: {
          xs: 'visible',
          lg: 'hidden'
        }
      }}>
      
      {/* Persistent nav at lg+ */}
      {isLgUp ?
      <NavRail active={channel} onSelect={handleSelect} /> :

      <Drawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        variant="temporary"
        ModalProps={{
          keepMounted: true
        }}
        PaperProps={{
          sx: {
            width: 248,
            border: 'none'
          }
        }}>
        
          <NavRail active={channel} onSelect={handleSelect} inDrawer />
        </Drawer>
      }

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0
        }}>
        
        <TopBar
          channel={channel}
          showNavToggle={!isLgUp}
          onOpenNav={() => setNavOpen(true)}
          showContextToggle={!isLgUp && showContextRail}
          onOpenContext={() => setContextOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)} />
        

        <Box
          component="main"
          sx={{
            flex: 1,
            display: 'flex',
            gap: 2,
            p: {
              xs: 1.5,
              md: 3
            },
            minHeight: 0,
            overflow: {
              xs: 'visible',
              lg: 'hidden'
            }
          }}>
          
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0
            }}>
            
            <ChannelContent channel={channel} />
          </Box>

          {/* Inline context rail only at lg+ */}
          {showContextRail && isLgUp && <ContextColumn channel={channel} />}
        </Box>
      </Box>

      {/* Context drawer below lg */}
      {showContextRail && !isLgUp &&
      <Drawer
        anchor="right"
        open={contextOpen}
        onClose={() => setContextOpen(false)}
        variant="temporary"
        ModalProps={{
          keepMounted: true
        }}
        PaperProps={{
          sx: {
            width: {
              xs: '88%',
              sm: 360
            },
            maxWidth: 380,
            border: 'none'
          }
        }}>
        
          <ContextColumn channel={channel} inDrawer />
        </Drawer>
      }

      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)} />
      
    </Box>);

}
function ChannelContent({ channel }: {channel: ChannelId;}) {
  switch (channel) {
    case 'all':
      return <OverviewView />;
    case 'email':
      return <EmailView />;
    case 'sms':
      return <SmsView />;
    case 'voice':
      return <VoiceView />;
    case 'properties':
      return <PropertiesView />;
    default:
      return <EmptyChannelView channel={channel} />;
  }
}