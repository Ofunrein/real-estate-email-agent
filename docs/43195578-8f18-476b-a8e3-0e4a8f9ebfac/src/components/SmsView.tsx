import React, { useMemo, useState } from 'react';
import { Box, Card, Stack, Typography } from '@mui/material';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter';
import {
  smsThreads,
  leadCategories,
  type SmsMessage,
  type LeadCategoryId } from
'../data/inboxData';
export function SmsView() {
  const [selectedId, setSelectedId] = useState(smsThreads[0].id);
  const [category, setCategory] = useState<CategoryFilterValue>('all');
  const counts = useMemo(() => {
    const base = Object.fromEntries(
      leadCategories.map((c) => [c.id, 0])
    ) as Record<LeadCategoryId, number>;
    smsThreads.forEach((t) => {
      base[t.category] += 1;
    });
    return base;
  }, []);
  const visibleThreads = useMemo(
    () =>
    category === 'all' ?
    smsThreads :
    smsThreads.filter((t) => t.category === category),
    [category]
  );
  const thread =
  visibleThreads.find((t) => t.id === selectedId) ??
  visibleThreads[0] ??
  smsThreads[0];
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}>
      
      <WorkspaceHeader
        title="SMS Threads"
        subtitle="Read the exact conversation as the AI handled it."
        count="51 events" />
      

      <CategoryFilter
        value={category}
        onChange={setCategory}
        counts={counts}
        totalCount={smsThreads.length} />
      

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
            meta: `${t.messageCount} messages`
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
                sms:{thread.contact}
              </Typography>
            </Box>

            <Box
            sx={{
              flex: 1,
              overflowY: 'auto',
              p: 2
            }}
            role="log"
            aria-label="SMS conversation">
            
              <Stack spacing={1.25}>
                {thread.messages.map((m) =>
              <SmsBubble key={m.id} message={m} contact={thread.contact} />
              )}
              </Stack>
            </Box>

            <ReaderFooter />
          </Card> :

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
          </Card>
        }
      </Box>
    </Box>);

}
function SmsBubble({
  message,
  contact



}: {message: SmsMessage;contact: string;}) {
  const isIris = message.direction === 'iris';
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isIris ? 'flex-end' : 'flex-start'
      }}>
      
      <Box
        sx={{
          maxWidth: '74%'
        }}>
        
        <Stack
          direction="row"
          spacing={1}
          justifyContent={isIris ? 'flex-end' : 'flex-start'}
          alignItems="center"
          sx={{
            mb: 0.25
          }}>
          
          <Typography
            variant="caption"
            sx={{
              fontWeight: 700,
              color: isIris ? 'primary.main' : 'text.primary'
            }}>
            
            {isIris ? 'Iris sent' : `${contact} received`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {message.time}
          </Typography>
        </Stack>
        <Box
          sx={{
            p: 1.25,
            px: 1.5,
            borderRadius: 2.5,
            borderTopRightRadius: isIris ? 4 : 20,
            borderTopLeftRadius: isIris ? 20 : 4,
            bgcolor: isIris ?
            (t) =>
            t.palette.mode === 'dark' ?
            'rgba(99,102,241,0.16)' :
            'rgba(99,102,241,0.1)' :
            'action.selected',
            border: '1px solid',
            borderColor: isIris ? 'primary.main' : 'divider'
          }}>
          
          <Typography
            variant="body2"
            sx={{
              lineHeight: 1.5,
              wordBreak: 'break-word'
            }}>
            
            {message.body}
          </Typography>
        </Box>
      </Box>
    </Box>);

}