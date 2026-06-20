import React, { useMemo, useState } from 'react';
import { Box, Card, Stack, Typography, Avatar, Chip } from '@mui/material';
import FlagIcon from '@mui/icons-material/OutlinedFlag';
import PersonIcon from '@mui/icons-material/PersonOutline';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { PropertyCardInline } from './PropertyCardInline';
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter';
import {
  emailThreads,
  leadCategories,
  agentAvatar,
  type EmailMessage,
  type LeadCategoryId } from
'../data/inboxData';
export function EmailView() {
  const [selectedId, setSelectedId] = useState(emailThreads[0].id);
  const [category, setCategory] = useState<CategoryFilterValue>('all');
  const counts = useMemo(() => {
    const base = Object.fromEntries(
      leadCategories.map((c) => [c.id, 0])
    ) as Record<LeadCategoryId, number>;
    emailThreads.forEach((t) => {
      base[t.category] += 1;
    });
    return base;
  }, []);
  const visibleThreads = useMemo(
    () =>
    category === 'all' ?
    emailThreads :
    emailThreads.filter((t) => t.category === category),
    [category]
  );
  const thread =
  visibleThreads.find((t) => t.id === selectedId) ??
  visibleThreads[0] ??
  emailThreads[0];
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}>
      
      <WorkspaceHeader
        title="Email Threads"
        subtitle="Read the exact conversation as the AI handled it."
        count="68 events"
        reviewCount={2} />
      

      <CategoryFilter
        value={category}
        onChange={setCategory}
        counts={counts}
        totalCount={emailThreads.length} />
      

      <Box
        sx={{
          display: 'flex',
          flexDirection: {
            xs: 'column',
            sm: 'row'
          },
          gap: 2,
          flex: 1,
          minHeight: 0
        }}>
        
        <ConversationList
          title="Conversations"
          items={visibleThreads.map((t) => ({
            id: t.id,
            title: t.contact,
            time: t.time,
            preview: t.preview,
            meta: `${t.messageCount} messages`,
            needsReview: t.needsReview
          }))}
          selectedId={thread?.id ?? ''}
          onSelect={setSelectedId} />
        

        {thread ?
        <Card
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0
          }}>
          
            <Box
            sx={{
              p: 1.75,
              borderBottom: '1px solid',
              borderColor: 'divider'
            }}>
            
              <Typography variant="subtitle1">{thread.contact}</Typography>
              <Typography variant="caption" color="text.secondary">
                {thread.contact}
              </Typography>
              {thread.needsReview &&
            <Box
              sx={{
                mt: 1,
                p: 1,
                borderRadius: 1.5,
                bgcolor: 'action.hover',
                display: 'flex',
                gap: 1,
                alignItems: 'center'
              }}>
              
                  <FlagIcon
                sx={{
                  fontSize: 15,
                  color: 'warning.main'
                }} />
              
                  <Typography variant="caption" color="text.secondary">
                    <Box
                  component="span"
                  sx={{
                    fontWeight: 600,
                    color: 'warning.main'
                  }}>
                  
                      Human review reason
                    </Box>{' '}
                    — {thread.reviewReason}
                  </Typography>
                </Box>
            }
            </Box>

            <Box
            sx={{
              flex: 1,
              overflowY: 'auto',
              p: 2
            }}
            role="log"
            aria-label="Email conversation">
            
              <Stack spacing={2}>
                {thread.messages.map((m) =>
              <EmailBubble
                key={m.id}
                message={m}
                senderName={thread.name} />

              )}
              </Stack>
            </Box>

            <ReaderFooter />
          </Card> :

        <EmptyThreadCard />
        }
      </Box>
    </Box>);

}
function EmptyThreadCard() {
  return (
    <Card
      sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 4,
        minHeight: 200
      }}>
      
      <Typography variant="body2" color="text.secondary">
        No conversations in this category.
      </Typography>
    </Card>);

}
function EmailBubble({
  message,
  senderName



}: {message: EmailMessage;senderName: string;}) {
  const isIris = message.direction === 'iris';
  const isOwner = message.direction === 'owner';
  const alignRight = isIris || isOwner;
  const headerLabel = isIris ?
  'Iris sent' :
  isOwner ?
  'Owner sent' :
  `${senderName} received`;
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: alignRight ? 'flex-end' : 'flex-start'
      }}>
      
      <Box
        sx={{
          maxWidth: {
            xs: '92%',
            sm: '78%'
          },
          minWidth: {
            xs: 0,
            sm: message.subject && !message.body ? 220 : 280
          }
        }}>
        
        <Box
          sx={{
            p: 1.75,
            borderRadius: 2.5,
            border: '1px solid',
            borderColor: isIris ? 'primary.main' : 'divider',
            bgcolor: isIris ?
            (t) =>
            t.palette.mode === 'dark' ?
            'rgba(99,102,241,0.14)' :
            'rgba(99,102,241,0.08)' :
            isOwner ?
            'action.selected' :
            'background.default'
          }}>
          
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            spacing={1}
            sx={{
              mb: message.body || message.subject ? 1 : 0
            }}>
            
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Avatar
                src={isIris ? agentAvatar : undefined}
                alt={isIris ? 'Arya, AI agent' : undefined}
                sx={{
                  width: 22,
                  height: 22,
                  bgcolor: isIris ? 'primary.main' : 'action.selected',
                  color: isIris ? 'primary.contrastText' : 'text.secondary'
                }}>
                
                {!isIris &&
                <PersonIcon
                  sx={{
                    fontSize: 14
                  }} />

                }
              </Avatar>
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 700,
                  color: isIris ? 'primary.main' : 'text.primary'
                }}>
                
                {headerLabel}
              </Typography>
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontFamily: 'monospace'
              }}>
              
              {message.time}
            </Typography>
          </Stack>

          {message.subject &&
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600
            }}>
            
              Subject: {message.subject}
            </Typography>
          }
          {message.body &&
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-line',
              lineHeight: 1.6,
              mt: message.subject ? 0.5 : 0
            }}>
            
              {message.body}
            </Typography>
          }
          {message.cards?.map((c, i) =>
          <PropertyCardInline
            key={i}
            card={c}
            showSchedule={
            message.showSchedule && i === message.cards!.length - 1
            } />

          )}
        </Box>

        {message.flag &&
        <Box
          sx={{
            mt: 0.75,
            p: 0.75,
            borderRadius: 1.5,
            bgcolor: 'action.hover',
            display: 'flex',
            gap: 0.75,
            alignItems: 'center'
          }}>
          
            <FlagIcon
            sx={{
              fontSize: 13,
              color: 'warning.main'
            }} />
          
            <Typography variant="caption" color="text.secondary">
              <Box
              component="span"
              sx={{
                fontWeight: 600,
                color: 'warning.main'
              }}>
              
                Flag
              </Box>{' '}
              — {message.flag}
            </Typography>
          </Box>
        }
      </Box>
    </Box>);

}