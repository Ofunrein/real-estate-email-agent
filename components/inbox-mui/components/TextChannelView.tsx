"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Card, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter';
import { SmsBubble } from './SmsView';
import {
  type ChannelId,
  type LeadCategoryId,
  type SmsMessage
} from '../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { useInboxData } from '../InboxDataContext';
import { clearActivityEventTarget, useActivityEventTarget } from '../hooks/useActivityEventTarget';
import { usePersistedSelection } from '../hooks/usePersistedSelection';
import { displayForChannelConnection, useChannelConnectionStatus } from '../hooks/useChannelConnectionStatus';
import { useCategoryColors } from '../theme/CategoryColorContext';

type TextChannelId = Extract<ChannelId, 'instagram' | 'messenger' | 'whatsapp' | 'website'>;

export function TextChannelView({ channel }: { channel: TextChannelId }) {
  const { textThreads, leadCategories, channelMeta, channelStats, channelAccounts } = useInboxModel();
  const { onDataRefresh } = useInboxData();
  const { status: connectionStatus } = useChannelConnectionStatus(true);
  const threads = textThreads[channel] || [];
  const meta = channelMeta[channel];
  const stats = channelStats[channel];
  const account = channelAccounts[channel];
  const accountDisplay = displayForChannelConnection(connectionStatus, channel, account.value, account.status);
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
  const [seenOverrides, setSeenOverrides] = useState<Record<string, string>>({});
  const [markingSeenId, setMarkingSeenId] = useState<string | null>(null);
  const [seenError, setSeenError] = useState<string | null>(null);
  const [reactionOverrides, setReactionOverrides] = useState<Record<string, NonNullable<SmsMessage['reactions']>>>({});
  const [reactingMessageId, setReactingMessageId] = useState<string | null>(null);
  const [reactionError, setReactionError] = useState<string | null>(null);
  const [resolvedReviewIds, setResolvedReviewIds] = useState<Record<string, true>>({});
  const [resolvingReviewId, setResolvingReviewId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const thread =
  visibleThreads.find((t) => t.id === selectedId) ??
  visibleThreads[0];
  const threadSeenAt = thread ? seenOverrides[thread.id] || thread.lastSeenAt || '' : '';
  const threadUnreadCount = thread && seenOverrides[thread.id] ? 0 : thread?.unreadCount || 0;
  const threadNeedsReview = Boolean(thread && thread.category === 'needs-human' && !resolvedReviewIds[thread.id]);
  const targetEventId = useActivityEventTarget(channel, thread?.id);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const footerBaseHeightRef = useRef(0);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledTargetRef = useRef<string | null>(null);
  const [footerLift, setFooterLift] = useState(0);
  const scrollLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 899.95px)').matches) {
      cardRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    }
  }, []);
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
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scrollLatest)
      : null;
    requestAnimationFrame(() => {
      scrollLatest();
      requestAnimationFrame(scrollLatest);
    });
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    const timeout = window.setTimeout(scrollLatest, 120);
    const lateTimeout = window.setTimeout(scrollLatest, 700);
    const mediaTimeout = window.setTimeout(scrollLatest, 2200);
    const finalTimeout = window.setTimeout(() => {
      scrollLatest();
      observer?.disconnect();
    }, 3200);
    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(lateTimeout);
      window.clearTimeout(mediaTimeout);
      window.clearTimeout(finalTimeout);
      observer?.disconnect();
    };
  }, [scrollLatest, targetEventId, thread?.id, thread?.messages.length]);
  useEffect(() => {
    footerBaseHeightRef.current = 0;
    setFooterLift(0);
  }, [thread?.id]);
  useEffect(() => {
    const node = footerRef.current;
    if (!node || targetEventId) return;
    const syncFooterSpace = () => {
      const nextHeight = Math.ceil(node.getBoundingClientRect().height);
      if (!nextHeight) return;
      if (!footerBaseHeightRef.current || nextHeight < footerBaseHeightRef.current) {
        footerBaseHeightRef.current = nextHeight;
      }
      setFooterLift(Math.max(0, nextHeight - footerBaseHeightRef.current));
      requestAnimationFrame(scrollLatest);
    };
    syncFooterSpace();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(syncFooterSpace)
      : null;
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [scrollLatest, targetEventId, thread?.id]);
  const handleSelectThread = (id: string) => {
    clearActivityEventTarget();
    setSelectedId(id);
  };
  const handleMarkSeen = async () => {
    if (!thread || markingSeenId) return;
    setSeenError(null);
    setMarkingSeenId(thread.id);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/seen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, seenEventAt: thread.lastInboundAt || '' }),
      });
      const payload = await res.json().catch(() => ({})) as { state?: { seenAt?: string }; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Unable to mark seen.');
      setSeenOverrides((current) => ({
        ...current,
        [thread.id]: payload.state?.seenAt || new Date().toISOString(),
      }));
    } catch (error) {
      setSeenError(error instanceof Error ? error.message : 'Unable to mark seen.');
    } finally {
      setMarkingSeenId(null);
    }
  };
  const handleReactMessage = async (messageId: string, providerMessageId: string, reaction: string) => {
    if (!thread?.replyTo || reactingMessageId) return;
    setReactionError(null);
    setReactingMessageId(messageId);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          to: thread.replyTo,
          messageId: providerMessageId,
          reaction,
          action: 'react',
        }),
      });
      const payload = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Unable to send reaction.');
      setReactionOverrides((current) => ({
        ...current,
        [messageId]: [{ emoji: reaction, by: 'owner', action: 'react' }],
      }));
    } catch (error) {
      setReactionError(error instanceof Error ? error.message : 'Unable to send reaction.');
    } finally {
      setReactingMessageId(null);
    }
  };
  const handleResumeAi = async () => {
    if (!thread || resolvingReviewId) return;
    setReviewError(null);
    setResolvingReviewId(thread.id);
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/review/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, resolution: 'resume_ai', releaseTakeover: true }),
      });
      const payload = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) throw new Error(payload.error || 'Unable to resume AI.');
      setResolvedReviewIds((current) => ({ ...current, [thread.id]: true }));
      if (category === 'needs-human') setCategory('all');
      await onDataRefresh?.();
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Unable to resume AI.');
    } finally {
      setResolvingReviewId(null);
    }
  };
  const missingRecipient = thread && ['instagram', 'messenger'].includes(channel) && !thread.replyTo;
  const canSendReaction = Boolean(
    thread?.replyTo
    && ['instagram', 'messenger'].includes(channel)
    && /^\d{6,}$/.test(thread.replyTo.replace(/^@/, '')),
  );
  const disabledReason = channel === 'website'
    ? 'Website chat manual send is not wired yet.'
    : missingRecipient
      ? 'Messages are synced, but Meta has not provided the webhook recipient id needed to reply from the dashboard.'
      : undefined;
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
        count={`${stats?.events || 0} touches`}
        agentActive={accountDisplay.ready}
        agentLabel={accountDisplay.ready ? 'Agent active' : 'Setup needed'} />

      <CategoryFilter
        value={category}
        onChange={setCategory}
        counts={counts}
        totalCount={threads.length} />

      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
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
            categoryColor: colors[t.category],
            fallbackUsed: t.fallbackUsed,
            unreadCount: seenOverrides[t.id] ? 0 : t.unreadCount,
            seen: seenOverrides[t.id] ? true : t.seen
          }))}
          selectedId={thread?.id ?? ''}
          onSelect={handleSelectThread} />

        {thread ?
        <Card
          ref={cardRef}
          sx={{
            flex: { xs: '0 0 auto', md: 1 },
            height: { xs: 'calc(100vh - 96px)', md: 'auto' },
            maxHeight: { xs: 'calc(100vh - 96px)', md: 'none' },
            minHeight: { xs: 360, md: 0 },
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            minWidth: 0,
            scrollMarginTop: { xs: 72, sm: 0 }
          }}>

            <Box
              sx={{
                p: 1.75,
                borderBottom: '1px solid',
                borderColor: 'divider'
              }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="subtitle1" noWrap>{thread.contact}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {threadUnreadCount ? `${threadUnreadCount} unread` : threadSeenAt ? 'Seen in dashboard' : 'Not marked seen'}
                  </Typography>
                  {seenError &&
                  <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                    {seenError}
                  </Typography>
                  }
                  {reactionError &&
                  <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                    {reactionError}
                  </Typography>
                  }
                  {reviewError &&
                  <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                    {reviewError}
                  </Typography>
                  }
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                  {threadNeedsReview &&
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={resolvingReviewId === thread.id}
                    onClick={handleResumeAi}
                    startIcon={resolvingReviewId === thread.id ? <CircularProgress size={14} color="inherit" /> : undefined}>
                    Resume AI
                  </Button>
                  }
                  <Tooltip title={threadUnreadCount ? 'Mark seen' : 'Already marked seen'}>
                    <span>
                      <Button
                        size="small"
                        variant={threadUnreadCount ? 'contained' : 'outlined'}
                        startIcon={markingSeenId === thread.id ? <CircularProgress size={14} color="inherit" /> : <VisibilityOutlinedIcon fontSize="small" />}
                        disabled={!threadUnreadCount || markingSeenId === thread.id}
                        onClick={handleMarkSeen}
                        sx={{ flexShrink: 0 }}>
                        {threadUnreadCount ? 'Mark seen' : 'Seen'}
                      </Button>
                    </span>
                  </Tooltip>
                </Stack>
              </Stack>
            </Box>

            <Box
              ref={scrollRef}
              sx={{
                flex: 1,
                minHeight: 0,
                overflowY: 'auto',
                p: 2,
                pb: footerLift ? `${Math.min(footerLift + 16, 220)}px` : 2,
                scrollPaddingBottom: footerLift ? `${Math.min(footerLift + 16, 220)}px` : undefined,
              }}
              role="log"
              aria-label={`${meta.label} conversation`}>
              <Stack spacing={0.9}>
                {thread.messages.map((message) =>
                  <SmsBubble
                    key={message.id}
                    message={reactionOverrides[message.id] ? { ...message, reactions: reactionOverrides[message.id] } : message}
                    contact={thread.contact}
                    highlighted={message.eventId === targetEventId}
                    canReact={canSendReaction}
                    reacting={reactingMessageId === message.id}
                    onReact={handleReactMessage}
                    registerTarget={(node) => {
                      if (node) messageRefs.current.set(message.eventId, node);
                      else messageRefs.current.delete(message.eventId);
                    }} />
                )}
              </Stack>
            </Box>

            <Box ref={footerRef} sx={{ flexShrink: 0 }}>
              <ReaderFooter
                threadId={thread.id}
                channel={channel}
                to={thread.replyTo || (['instagram', 'messenger'].includes(channel) ? '' : thread.contact)}
                disabledReason={disabledReason}
              />
            </Box>
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
