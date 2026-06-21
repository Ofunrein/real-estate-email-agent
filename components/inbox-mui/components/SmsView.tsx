"use client";
import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Card, Stack, Typography, Avatar } from '@mui/material';
import PersonIcon from '@mui/icons-material/PersonOutline';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter';
import {
  agentAvatar,
  type SmsMessage,
  type LeadCategoryId } from
'../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { useActivityEventTarget } from '../hooks/useActivityEventTarget';
import { usePersistedSelection } from '../hooks/usePersistedSelection';
import { useCategoryColors } from '../theme/CategoryColorContext';

export function SmsView() {
  const { smsThreads, leadCategories } = useInboxModel();
  const { colors } = useCategoryColors();
  const categoryValues = useMemo(
    () => ['all', ...leadCategories.map((c) => c.id)] as CategoryFilterValue[],
    [leadCategories]
  );
  const [category, setCategory] = usePersistedSelection<CategoryFilterValue>(
    'iris.inbox.sms.category',
    'all',
    categoryValues
  );
	  const counts = useMemo(() => {
    const base = Object.fromEntries(
      leadCategories.map((c) => [c.id, 0])
    ) as Record<LeadCategoryId, number>;
    smsThreads.forEach((t) => {
      base[t.category] += 1;
    });
    return base;
	  }, [leadCategories, smsThreads]);
  const categoryMeta = useMemo(
    () => Object.fromEntries(leadCategories.map((category) => [category.id, category])),
    [leadCategories]
  ) as Record<LeadCategoryId, (typeof leadCategories)[number]>;
  const visibleThreads = useMemo(
    () =>
    category === 'all' ?
    smsThreads :
    smsThreads.filter((t) => t.category === category),
    [category, smsThreads]
  );
  const visibleThreadIds = useMemo(
    () => visibleThreads.map((t) => t.id),
    [visibleThreads]
  );
  const [selectedId, setSelectedId] = usePersistedSelection(
    'iris.inbox.sms.thread',
    visibleThreadIds[0] ?? '',
    visibleThreadIds
  );
  const thread =
  visibleThreads.find((t) => t.id === selectedId) ??
  visibleThreads[0];
  const targetEventId = useActivityEventTarget('sms', thread?.id);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!targetEventId || scrolledTargetRef.current === targetEventId) return;
    const target = messageRefs.current.get(targetEventId);
    if (!target) return;
    scrolledTargetRef.current = targetEventId;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [targetEventId, thread?.id]);
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
	            meta: `${t.messageCount} messages`,
	            categoryLabel: categoryMeta[t.category]?.label,
	            categoryColor: colors[t.category]
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
              <SmsBubble
                key={m.id}
                message={m}
                contact={thread.contact}
                highlighted={m.eventId === targetEventId}
                registerTarget={(node) => {
                  if (node) messageRefs.current.set(m.eventId, node);
                  else messageRefs.current.delete(m.eventId);
                }} />
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
  contact,
  highlighted,
  registerTarget



}: {message: SmsMessage;contact: string;highlighted?: boolean;registerTarget?: (node: HTMLDivElement | null) => void;}) {
  const isIris = message.direction === 'iris';
  const cleanHtml =
    message.html && typeof window !== 'undefined'
      ? (() => {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const DOMPurify = require('dompurify');
          return DOMPurify.sanitize(message.html, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
          });
        })()
      : message.html;
  return (
    <Box
      ref={registerTarget}
      sx={{
        display: 'flex',
        flexDirection: isIris ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: 1,
        scrollMargin: '24px'
      }}>

      <Avatar
        src={isIris ? agentAvatar : undefined}
        alt={isIris ? 'Iris, AI agent' : undefined}
        sx={{
          width: 28,
          height: 28,
          flexShrink: 0,
          bgcolor: isIris ? 'primary.main' : 'action.selected',
          color: 'text.secondary'
        }}>
        {!isIris && <PersonIcon sx={{ fontSize: 16, color: '#64748b' }} aria-hidden />}
      </Avatar>

      <Box
        sx={{
          maxWidth: { xs: '80%', md: '66%' }
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
            sx={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'text.secondary'
            }}>

            {isIris ? 'Iris sent' : `${contact} received`}
          </Typography>
          <Typography
            sx={{
              fontSize: '10px',
              fontFamily: 'monospace',
              color: 'text.secondary'
            }}>
            {message.time}
          </Typography>
        </Stack>
        {(message.body || cleanHtml) &&
        <Box
          sx={{
            py: 1,
            px: 1.75,
            borderRadius: '16px',
            borderBottomRightRadius: isIris ? '4px' : '16px',
            borderBottomLeftRadius: isIris ? '16px' : '4px',
            bgcolor: isIris ? 'primary.main' : 'background.default',
            color: isIris ? '#fff' : 'text.secondary',
            border: highlighted ? '1px solid' : isIris ? 'none' : '1px solid',
            borderColor: highlighted ? 'primary.main' : 'divider',
            boxShadow: highlighted ? '0 0 0 3px rgba(99,102,241,0.18)' : 'none'
          }}>

          {cleanHtml ?
          <Box
            sx={{
              fontSize: '0.875rem',
              lineHeight: 1.5,
              color: isIris ? '#fff' : 'text.secondary',
              wordBreak: 'break-word',
              '& a': { color: isIris ? '#fff' : 'primary.main' },
              '& img': { maxWidth: '100%', borderRadius: 1, display: 'block', my: 0.75 },
              '& p': { m: 0, mb: 0.75 }
            }}
            dangerouslySetInnerHTML={{ __html: cleanHtml }} /> :
          <Typography
            variant="body2"
            sx={{
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>

            {message.body}
          </Typography>
          }
        </Box>
        }
        {!!message.media?.length &&
        <SmsMediaGallery
          media={message.media}
          isIris={isIris}
          hasText={Boolean(message.body || cleanHtml)} />
        }
      </Box>
    </Box>);

}

function SmsMediaGallery({
  media,
  isIris,
  hasText
}: {
  media: NonNullable<SmsMessage['media']>;
  isIris: boolean;
  hasText: boolean;
}) {
  const visible = media.slice(0, Math.min(media.length, 4));
  const count = media.length;
  const cardHeight = count === 1 ? 220 : 118;
  const cardWidth = count === 1 ? 288 : 176;
  const stackHeight = count === 1 ? 224 : count === 2 ? 182 : count === 3 ? 254 : 238;
  const offsets = [
    { top: 0, left: count >= 4 ? 48 : count === 1 ? 0 : 34, rotate: count >= 4 ? 0 : 0, z: 4 },
    { top: count >= 4 ? 10 : 78, left: count >= 4 ? 66 : 0, rotate: count >= 4 ? 7 : 0, z: count >= 4 ? 3 : 5 },
    { top: count >= 4 ? 20 : 150, left: count >= 4 ? 84 : 26, rotate: count >= 4 ? 13 : 0, z: count >= 4 ? 2 : 6 },
    { top: count >= 4 ? 30 : 170, left: count >= 4 ? 102 : 52, rotate: count >= 4 ? 19 : 0, z: 1 },
  ];
  return (
    <Box
      sx={{
        mt: hasText ? 0.75 : 0,
        width: count === 1 ? cardWidth : 240,
        height: stackHeight,
        position: 'relative',
        alignSelf: isIris ? 'flex-end' : 'flex-start'
      }}>
      {count > 4 &&
      <Typography
        variant="caption"
        sx={{
          position: 'absolute',
          top: -18,
          right: isIris ? 2 : 'auto',
          left: isIris ? 'auto' : 2,
          color: isIris ? 'primary.main' : 'text.secondary',
          fontWeight: 800,
          fontSize: 11
        }}>
        
        {count} Photos
      </Typography>
      }
      {visible.map((item, index) =>
      <Box
        key={`${item.url}-${index}`}
        sx={{
          position: 'absolute',
          top: offsets[index].top,
          left: offsets[index].left,
          width: cardWidth,
          height: cardHeight,
          borderRadius: 3.5,
          overflow: 'hidden',
          bgcolor: 'background.default',
          border: '1px solid',
          borderColor: isIris ? 'rgba(99,102,241,0.28)' : 'rgba(15,23,42,0.14)',
          boxShadow: '0 10px 28px rgba(15,23,42,0.22)',
          transform: `rotate(${offsets[index].rotate}deg)`,
          transformOrigin: 'center center',
          zIndex: offsets[index].z
        }}>
        <Box
          component="img"
          src={item.url}
          alt={item.alt}
          loading="lazy"
          sx={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }} />
      </Box>
      )}
    </Box>);
}
