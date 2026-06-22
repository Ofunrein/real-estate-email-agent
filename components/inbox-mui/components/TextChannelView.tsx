"use client";
import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Card, Stack, Typography } from '@mui/material';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter';
import { SmsBubble } from './SmsView';
import {
  type ChannelId,
  type LeadCategoryId
} from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { clearActivityEventTarget, useActivityEventTarget } from '../hooks/useActivityEventTarget';
import { usePersistedSelection } from '../hooks/usePersistedSelection';
import { useCategoryColors } from '../theme/CategoryColorContext';

type TextChannelId = Extract<ChannelId, 'instagram' | 'messenger' | 'whatsapp' | 'website'>;

export function TextChannelView({ channel }: { channel: TextChannelId }) {
  const { textThreads, leadCategories, channelMeta, channelStats } = useInboxModel();
  const threads = textThreads[channel] || [];
  const meta = channelMeta[channel];
  const stats = channelStats[channel];
  const { colors } = useCategoryColors();
  const categoryValues = useMemo(
    () => ['all', ...leadCategories.map((c) => c.id)] as CategoryFilterValue[],
    [leadCategories]
  );
  const [category, setCategory] = usePersistedSelection<CategoryFilterValue>(
    `iris.inbox.${channel}.category`,
    'all',
    categoryValues
  );
  const counts = useMemo(() => {
    const base = Object.fromEntries(
      leadCategories.map((c) => [c.id, 0])
    ) as Record<LeadCategoryId, number>;
    threads.forEach((t) => {
      base[t.category] += 1;
    });
    return base;
  }, [leadCategories, threads]);
  const categoryMeta = useMemo(
    () => Object.fromEntries(leadCategories.map((category) => [category.id, category])),
    [leadCategories]
  ) as Record<LeadCategoryId, (typeof leadCategories)[number]>;
  const visibleThreads = useMemo(
    () =>
    category === 'all' ?
    threads :
    threads.filter((t) => t.category === category),
    [category, threads]
  );
  const visibleThreadIds = useMemo(
    () => visibleThreads.map((t) => t.id),
    [visibleThreads]
  );
  const [selectedId, setSelectedId] = usePersistedSelection(
    `iris.inbox.${channel}.thread`,
    visibleThreadIds[0] ?? '',
    visibleThreadIds
  );
  const thread =
  visibleThreads.find((t) => t.id === selectedId) ??
  visibleThreads[0];
  const targetEventId = useActivityEventTarget(channel, thread?.id);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (!targetEventId || scrolledTargetRef.current === targetEventId) return;
    const target = messageRefs.current.get(targetEventId);
    if (!target) return;
    scrolledTargetRef.current = targetEventId;
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      clearActivityEventTarget();
    });
  }, [targetEventId, thread?.id]);
  useEffect(() => {
    if (targetEventId || !scrollRef.current) return;
    const el = scrollRef.current;
    const scrollLatest = () => {
      el.scrollTop = el.scrollHeight;
    };
    requestAnimationFrame(() => {
      scrollLatest();
      requestAnimationFrame(scrollLatest);
    });
    const timeout = window.setTimeout(scrollLatest, 120);
    return () => window.clearTimeout(timeout);
  }, [targetEventId, thread?.id, thread?.messages.length]);
  const handleSelectThread = (id: string) => {
    clearActivityEventTarget();
    setSelectedId(id);
  };
  const disabledReason = channel === 'website' ? 'Website chat manual send is not wired yet.' : undefined;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0
      }}>

      <WorkspaceHeader
        title={`${meta.label} Threads`}
        subtitle="Read and operate the exact conversation as Iris handled it."
        count={`${stats?.events || 0} touches`} />

      <CategoryFilter
        value={category}
        onChange={setCategory}
        counts={counts}
        totalCount={threads.length} />

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
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
          onSelect={handleSelectThread} />

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
                {channel}:{thread.contact}
              </Typography>
            </Box>

            <Box
              ref={scrollRef}
              sx={{ flex: 1, overflowY: 'auto', p: 2 }}
              role="log"
              aria-label={`${meta.label} conversation`}>
              <Stack spacing={0.9}>
                {thread.messages.map((message) =>
                  <SmsBubble
                    key={message.id}
                    message={message}
                    contact={thread.contact}
                    highlighted={message.eventId === targetEventId}
                    registerTarget={(node) => {
                      if (node) messageRefs.current.set(message.eventId, node);
                      else messageRefs.current.delete(message.eventId);
                    }} />
                )}
              </Stack>
            </Box>

            <ReaderFooter
              threadId={thread.id}
              channel={channel}
              to={thread.contact}
              disabledReason={disabledReason}
            />
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
            No {meta.label.toLowerCase()} conversations yet.
          </Typography>
        </Card>
        }
      </Box>
    </Box>
  );
}
