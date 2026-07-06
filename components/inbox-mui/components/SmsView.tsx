"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Card, CircularProgress, Stack, Tooltip, Typography, Avatar, Chip, IconButton } from '@mui/material';
import PhoneIcon from '@mui/icons-material/Phone';
import PersonIcon from '@mui/icons-material/PersonOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter';
import { LiveCallPanel } from './LiveCallPanel';
import {
  agentAvatar,
  type SmsMessage,
  type LeadCategoryId } from
'../data/inboxData';
import { useInboxModel } from '../InboxDataContext';
import { clearActivityEventTarget, useActivityEventTarget } from '../hooks/useActivityEventTarget';
import { usePersistedSelection } from '../hooks/usePersistedSelection';
import { useCategoryColors } from '../theme/CategoryColorContext';
import type { ThreadTemperature } from './ConversationList';

// Temperature/status are derived from the existing lead-category id — the
// data model has no separate hot/warm/cold or per-thread status field.
// Categories with no clear signal render no chip rather than inventing one.
function categoryTemperature(category: LeadCategoryId): ThreadTemperature | undefined {
  if (category === 'hot-lead') return 'hot';
  if (category === 'showing' || category === 'financing') return 'warm';
  if (category === 'nurture' || category === 'closed') return 'cold';
  return undefined;
}
function categoryStatus(category: LeadCategoryId, needsReview?: boolean): { label: string; tone: 'accent' | 'warning' | 'success' | 'info' | 'neutral' } | undefined {
  if (needsReview || category === 'needs-human') return { label: 'Needs human', tone: 'warning' };
  if (category === 'hot-lead' || category === 'needs-reply') return { label: 'Iris active', tone: 'accent' };
  if (category === 'showing') return { label: 'Booked', tone: 'success' };
  return undefined;
}

type SmsViewProps = {
  onOpenVoice?: (threadId?: string) => void;
};

export function SmsView({ onOpenVoice }: SmsViewProps = {}) {
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const footerBaseHeightRef = useRef(0);
  const messageRefs = useRef(new Map<string, HTMLDivElement>());
  const scrolledTargetRef = useRef<string | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [dialing, setDialing] = useState(false);
  const [dialError, setDialError] = useState<string | null>(null);
  const [footerLift, setFooterLift] = useState(0);
  const scrollLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
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
    requestAnimationFrame(() => {
      scrollLatest();
      requestAnimationFrame(scrollLatest);
    });
    const timeout = window.setTimeout(scrollLatest, 120);
    return () => window.clearTimeout(timeout);
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
  const handleCallLead = async () => {
    if (!thread?.contact || dialing) return;
    setDialing(true);
    setDialError(null);
    try {
      const recentContext = thread.messages
        .slice(-6)
        .map((message) => `${message.direction === 'iris' ? 'Iris' : message.direction === 'owner' ? 'Owner' : thread.contact}: ${message.body || (message.media?.length ? `${message.media.length} MMS image${message.media.length === 1 ? '' : 's'}` : '')}`)
        .filter((line) => line.trim())
        .join('\n');
      const res = await fetch('/api/voice/call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: thread.contact,
          leadName: thread.contact,
          callReason: 'follow up on the active SMS conversation',
          leadContext: recentContext,
        }),
      });
      const data = await res.json();
      if (data.ok && data.callId) {
        setActiveCallId(data.callId);
      } else {
        setDialError(data.error || 'Could not start call');
      }
    } catch {
      setDialError('Could not reach the call service');
    } finally {
      setDialing(false);
    }
  };
  const handleCloseCall = () => {
    setActiveCallId(null);
    if (typeof window !== 'undefined' && thread?.id) {
      window.localStorage.setItem('iris.inbox.voice.thread', thread.id);
    }
    onOpenVoice?.(thread?.id);
  };
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
        count="51 touches" />
      

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
          items={visibleThreads.map((t) => {
            const status = categoryStatus(t.category);
            return {
              id: t.id,
              title: t.contact,
              time: t.time,
              preview: t.preview,
              meta: `${t.messageCount} messages`,
              categoryLabel: categoryMeta[t.category]?.label,
              categoryColor: colors[t.category],
              channel: 'sms' as const,
              temperature: categoryTemperature(t.category),
              statusLabel: status?.label,
              statusTone: status?.tone
            };
          })}
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
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              gap: 1
            }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle1">{thread.contact}</Typography>
                <Typography variant="caption" color="text.secondary">
                  sms:{thread.contact}
                </Typography>
              </Box>
              <Tooltip title={thread.contact ? `Call ${thread.contact} with Iris` : 'No phone number on file'}>
                <span>
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={dialing ? <CircularProgress size={14} color="inherit" /> : <PhoneIcon fontSize="small" />}
                    onClick={handleCallLead}
                    disabled={!thread.contact || dialing || Boolean(activeCallId)}
                    disableElevation
                    sx={{ flexShrink: 0 }}>
                    {dialing ? 'Calling…' : 'Call lead'}
                  </Button>
                </span>
              </Tooltip>
            </Box>

            {dialError &&
            <Box sx={{ px: 1.75, py: 1, bgcolor: (t) => t.palette.mode === 'dark' ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.07)' }}>
              <Typography variant="caption" color="error.main">{dialError}</Typography>
            </Box>
            }

            <Box
            ref={scrollRef}
            sx={{
              flex: 1,
              overflowY: 'auto',
              p: 2,
              pb: footerLift ? `${Math.min(footerLift + 16, 220)}px` : 2,
              scrollPaddingBottom: footerLift ? `${Math.min(footerLift + 16, 220)}px` : undefined,
            }}
            role="log"
            aria-label="SMS conversation">
            
              {activeCallId &&
              <LiveCallPanel
                callId={activeCallId}
                contactName={thread.contact}
                onClose={handleCloseCall} />
              }
              <Stack spacing={0.9}>
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

            <Box ref={footerRef} sx={{ flexShrink: 0 }}>
              <ReaderFooter threadId={thread.id} channel="sms" to={thread.contact} />
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

          <Stack
            spacing={1.25}
            alignItems="center"
            sx={{
              textAlign: 'center',
              maxWidth: 320,
              width: '100%',
              py: 4,
              px: 3,
              borderRadius: 3,
              border: '1px dashed',
              borderColor: 'divider'
            }}>
            <Avatar
              variant="rounded"
              sx={{
                width: 40,
                height: 40,
                borderRadius: '11px',
                bgcolor: 'action.hover',
                color: 'text.secondary'
              }}>
              <InboxOutlinedIcon fontSize="small" />
            </Avatar>
            <Typography variant="body2" color="text.secondary">
              No conversations in this category.
            </Typography>
          </Stack>
        </Card>
        }
      </Box>
    </Box>);

}
export function SmsBubble({
  message,
  contact,
  highlighted,
  registerTarget,
  canReact,
  reacting,
  onReact



}: {
  message: SmsMessage;
  contact: string;
  highlighted?: boolean;
  registerTarget?: (node: HTMLDivElement | null) => void;
  canReact?: boolean;
  reacting?: boolean;
  onReact?: (messageId: string, providerMessageId: string, reaction: string) => void;
}) {
  const isIris = message.direction === 'iris';
  const isOwner = message.direction === 'owner';
  const isOutbound = message.direction !== 'inbound';
  const imageMedia = message.media?.filter((item) => (item.kind || 'image') === 'image') || [];
  const videoMedia = message.media?.filter((item) => item.kind === 'video') || [];
  const audioMedia = message.media?.filter((item) => item.kind === 'audio') || [];
  const fileMedia = message.media?.filter((item) => item.kind === 'file') || [];
  const voiceTranscripts = (message.body || "")
    .split("\n")
    .map((line) => line.trim().match(/^Voice note transcript:\s*(.+)$/i)?.[1]?.trim() || "")
    .filter(Boolean);
  const visibleBody = (message.body || "")
    .split("\n")
    .filter((line) => !/^Voice note transcript:/i.test(line.trim()))
    .join("\n")
    .trim();
  const displayBody = isRedundantMediaPreviewBody(visibleBody, imageMedia) ? "" : visibleBody;
  const visibleReactions = (message.reactions || []).filter((reaction) => reaction.action !== 'unreact' && reaction.emoji);
  const canReactToMessage = Boolean(canReact && message.direction === 'inbound' && message.providerMessageId);
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
        flexDirection: isOutbound ? 'row-reverse' : 'row',
        alignItems: 'flex-end',
        gap: 1,
        scrollMargin: '24px',
        '&:hover .message-reaction-rail, &:focus-within .message-reaction-rail': {
          opacity: 1,
          transform: 'translateY(0)',
          pointerEvents: 'auto'
        }
      }}>

      <Avatar
        src={isIris ? agentAvatar : undefined}
        alt={isIris ? 'Iris, AI agent' : undefined}
        sx={{
          width: 28,
          height: 28,
          flexShrink: 0,
          bgcolor: (theme) => isIris
            ? theme.palette.primary.main
            : isOwner
              ? theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.2)' : theme.palette.text.primary
              : theme.palette.action.selected,
          color: (theme) => isOwner && theme.palette.mode === 'dark' ? theme.palette.text.primary : 'background.paper'
        }}>
        {!isIris && <PersonIcon sx={{ fontSize: 16, color: (theme) => isOwner && theme.palette.mode === 'dark' ? theme.palette.text.primary : isOwner ? theme.palette.background.paper : '#64748b' }} aria-hidden />}
      </Avatar>

      <Box
        sx={{
          maxWidth: { xs: '84%', md: '68%' },
          display: 'flex',
          flexDirection: 'column',
          alignItems: isOutbound ? 'flex-end' : 'flex-start'
        }}>

        <Stack
          direction="row"
          spacing={1}
          justifyContent={isOutbound ? 'flex-end' : 'flex-start'}
          alignItems="center"
          sx={{
            mb: 0.25
          }}>

          <Typography
            sx={{
              fontSize: '11px',
              fontWeight: 700,
              color: isIris ? 'iris.accentInk' : isOwner ? 'primary.main' : 'text.secondary'
            }}>

            {isIris ? 'Iris sent, auto' : isOwner ? 'Austin Realty sent' : `${contact}, inbound`}
          </Typography>
          <Typography
            sx={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'text.secondary'
            }}>
            {message.time}
          </Typography>
        </Stack>
        {!!imageMedia.length &&
        <SmsMediaGallery
          media={imageMedia}
          isIris={isOutbound}
          hasText={Boolean(displayBody || cleanHtml || voiceTranscripts.length || videoMedia.length || audioMedia.length)} />
        }
        {!!videoMedia.length &&
        <Stack spacing={0.75} sx={{ mt: imageMedia.length ? 0.7 : 0, mb: (displayBody || cleanHtml || audioMedia.length) ? 0.7 : 0, alignSelf: isOutbound ? 'flex-end' : 'flex-start' }}>
          {videoMedia.map((item, index) => (
            <Box
              key={`${item.url}-${index}`}
              sx={{
                width: { xs: 246, sm: 286 },
                maxWidth: '100%',
                overflow: 'hidden',
                borderRadius: 3,
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(15,23,42,0.82)' : theme.palette.background.paper,
                border: '1px solid',
                borderColor: isOutbound ? 'rgba(99,102,241,0.35)' : 'divider',
                boxShadow: '0 12px 28px rgba(15,23,42,0.18)',
                '& video': {
                  display: 'block',
                  width: '100%',
                  maxHeight: 340,
                  bgcolor: '#000'
                }
              }}>
              <video controls preload="metadata" src={item.url} poster={item.thumbnailUrl} />
              {(item.label || item.alt || item.transcript) &&
              <Box sx={{ px: 1.1, py: 0.8, borderTop: '1px solid', borderColor: 'divider' }}>
                {(item.label || item.alt) &&
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 800,
                    lineHeight: 1.25,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                  {item.label || item.alt}
                </Typography>
                }
                {item.transcript &&
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    mt: item.label || item.alt ? 0.45 : 0,
                    color: 'text.secondary',
                    lineHeight: 1.35,
                    whiteSpace: 'pre-wrap'
                  }}>
                  {item.transcript}
                </Typography>
                }
              </Box>
              }
            </Box>
          ))}
        </Stack>
        }
        {!!audioMedia.length &&
        <Stack spacing={0.75} sx={{ mt: imageMedia.length || videoMedia.length ? 0.7 : 0, mb: (displayBody || cleanHtml) ? 0.7 : 0, alignSelf: isOutbound ? 'flex-end' : 'flex-start' }}>
          {audioMedia.map((item, index) => {
            const transcript = item.transcript || voiceTranscripts[index];
            return (
            <Box
              key={`${item.url}-${index}`}
              sx={{
                p: 0.75,
                borderRadius: 3,
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.12)' : theme.palette.background.paper,
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: 'none',
                '& audio': {
                  display: 'block',
                  width: { xs: 210, sm: 260 },
                  maxWidth: '100%',
                  height: 34,
                  colorScheme: (theme) => theme.palette.mode
                }
              }}>
              <audio controls preload="metadata" src={item.url} />
              {transcript &&
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  mt: 0.65,
                  px: 0.5,
                  color: 'text.secondary',
                  lineHeight: 1.35,
                  whiteSpace: 'pre-wrap'
                }}>
                {transcript}
              </Typography>
              }
            </Box>
            );
          })}
        </Stack>
        }
        {!!fileMedia.length &&
        <Stack spacing={0.5} sx={{ mt: imageMedia.length || videoMedia.length || audioMedia.length ? 0.7 : 0, mb: (displayBody || cleanHtml) ? 0.7 : 0, alignSelf: isOutbound ? 'flex-end' : 'flex-start' }}>
          {fileMedia.map((item, index) => (
            <Chip
              key={`${item.url}-${index}`}
              component="a"
              href={item.url}
              clickable
              size="small"
              label={item.alt || 'Attachment'}
            />
          ))}
        </Stack>
        }
        {(displayBody || cleanHtml) &&
        <Box
          sx={{
            mt: message.media?.length ? 0.7 : 0,
            py: 1,
            px: 1.75,
            borderRadius: '16px',
            borderBottomRightRadius: isOutbound ? '4px' : '16px',
            borderBottomLeftRadius: isOutbound ? '16px' : '4px',
            bgcolor: isIris ? 'primary.main' : isOwner ? 'background.paper' : 'iris.surface2',
            color: isIris ? 'primary.contrastText' : 'text.primary',
            border: '1px solid',
            borderColor: highlighted ? 'primary.main' : isOwner ? 'primary.main' : 'divider',
            boxShadow: highlighted ? '0 0 0 3px rgba(99,102,241,0.18)' : 'none'
          }}>

          {cleanHtml ?
          <Box
            sx={{
              fontSize: '0.875rem',
              lineHeight: 1.5,
              color: isIris ? 'primary.contrastText' : 'text.primary',
              overflowWrap: 'anywhere',
              '& a': { color: 'primary.main' },
              '& img': { maxWidth: '100%', borderRadius: 1, display: 'block', my: 0.75 },
              '& p': { m: 0, mb: 0.75 },
              '& :not(img)': {
                color: (theme: any) => theme.palette.mode === 'dark'
                  ? `${theme.palette.text.primary} !important`
                  : undefined,
              },
              '& [style*="color"]': {
                color: (theme: any) => theme.palette.mode === 'dark'
                  ? `${theme.palette.text.primary} !important`
                  : undefined,
              },
            }}
            dangerouslySetInnerHTML={{ __html: cleanHtml }} /> :
          <Typography
            variant="body2"
            sx={{
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere'
            }}>

            {displayBody}
          </Typography>
          }
        </Box>
        }
        {!!visibleReactions.length &&
        <Stack
          direction="row"
          spacing={0.35}
          sx={{
            mt: 0.45,
            alignSelf: isOutbound ? 'flex-end' : 'flex-start',
            px: 0.65,
            py: 0.15,
            borderRadius: '6px',
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.92)',
            border: '1px solid',
            borderColor: 'divider'
          }}>
          {visibleReactions.slice(-3).map((reaction, index) =>
            <Typography
              key={`${reaction.emoji}-${reaction.by}-${index}`}
              component="span"
              sx={{
                fontSize: 13,
                lineHeight: 1.25,
                fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'
              }}>
              {reactionGlyph(reaction.emoji)}
            </Typography>
          )}
        </Stack>
        }
        {canReactToMessage &&
        <Stack
          className="message-reaction-rail"
          direction="row"
          spacing={0.2}
          sx={{
            mt: 0.45,
            alignSelf: isOutbound ? 'flex-end' : 'flex-start',
            opacity: { xs: 1, sm: 0 },
            transform: { xs: 'none', sm: 'translateY(2px)' },
            pointerEvents: { xs: 'auto', sm: 'none' },
            transition: 'opacity 140ms ease, transform 140ms ease',
            px: 0.35,
            py: 0.25,
            borderRadius: '6px',
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(2,6,23,0.86)' : 'rgba(255,255,255,0.95)',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 'none'
          }}>
          {reactionOptions.map((option) =>
            <Tooltip title={option.label} key={option.value}>
              <span>
                <IconButton
                  aria-label={`React ${option.label}`}
                  size="small"
                  disabled={Boolean(reacting)}
                  onClick={() => onReact?.(message.id, message.providerMessageId || '', option.value)}
                  sx={{
                    width: 26,
                    height: 26,
                    fontSize: 15,
                    color: 'text.primary'
                  }}>
                  {reacting ? <CircularProgress size={13} color="inherit" /> : option.glyph}
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>
        }
      </Box>
    </Box>);

}

const reactionOptions = [
  { value: 'love', glyph: '❤️', label: 'Love' },
  { value: 'like', glyph: '👍', label: 'Like' },
  { value: 'laugh', glyph: '😂', label: 'Laugh' },
  { value: 'wow', glyph: '😮', label: 'Wow' },
  { value: 'sad', glyph: '😢', label: 'Sad' },
  { value: 'angry', glyph: '😡', label: 'Angry' },
] as const;

function reactionGlyph(value: string) {
  return reactionOptions.find((option) => option.value === value)?.glyph || value;
}

export function SmsMediaGallery({
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
  if (count === 1 && visible[0]?.linkUrl) {
    return (
      <SocialLinkPreview
        item={visible[0]}
        isIris={isIris}
        hasText={hasText} />
    );
  }
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
        mb: hasText ? 0.1 : 0,
        width: count === 1 ? cardWidth : 240,
        height: stackHeight,
        position: 'relative',
        alignSelf: isIris ? 'flex-end' : 'flex-start',
        flexShrink: 0
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
      {visible.map((item, index) => {
        const frameSx = {
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
          zIndex: offsets[index].z,
          display: 'block',
          color: 'inherit',
          textDecoration: 'none'
        } as const;
        const content = (
          <>
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
            {item.label &&
            <Box
              sx={{
                position: 'absolute',
                left: 8,
                right: 8,
                bottom: 8,
                px: 0.75,
                py: 0.35,
                borderRadius: 1,
                bgcolor: 'rgba(15,23,42,0.78)',
                color: '#fff',
                fontSize: 11,
                fontWeight: 800,
                lineHeight: 1.25,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}>
              {item.label}
            </Box>
            }
          </>
        );
        return item.linkUrl ? (
          <Box
            key={`${item.url}-${index}`}
            component="a"
            href={item.linkUrl}
            target="_blank"
            rel="noreferrer"
            sx={frameSx}>
            {content}
          </Box>
        ) : (
          <Box key={`${item.url}-${index}`} sx={frameSx}>
            {content}
          </Box>
        );
      })}
    </Box>);
}

function canRenderPreviewImage(value = "") {
  return /\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#])/i.test(value) || /lookaside\.fbsbx\.com|fbcdn\.net|cdninstagram\.com/i.test(value);
}

function SocialLinkPreview({
  item,
  isIris,
  hasText
}: {
  item: NonNullable<SmsMessage['media']>[number];
  isIris: boolean;
  hasText: boolean;
}) {
  const host = linkHost(item.linkUrl || "");
  const previewImage = item.thumbnailUrl || (canRenderPreviewImage(item.url) ? item.url : "");
  const isInstagram = /(?:^|\.)instagram\.com$/i.test(host);
  return (
    <Box
      component="a"
      href={item.linkUrl}
      target="_blank"
      rel="noreferrer"
      sx={{
        display: 'block',
        width: { xs: 246, sm: 286 },
        maxWidth: '100%',
        overflow: 'hidden',
        borderRadius: 3,
        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(15,23,42,0.82)' : theme.palette.background.paper,
        border: '1px solid',
        borderColor: isIris ? 'rgba(99,102,241,0.35)' : 'divider',
        boxShadow: '0 12px 28px rgba(15,23,42,0.24)',
        color: 'text.primary',
        textDecoration: 'none',
        alignSelf: isIris ? 'flex-end' : 'flex-start',
        mb: hasText ? 0.1 : 0,
        flexShrink: 0
      }}>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '4 / 5',
          bgcolor: 'background.default',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
        {previewImage ? (
          <Box
            component="img"
            src={previewImage}
            alt={item.alt}
            loading="lazy"
            sx={{
              display: 'block',
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }} />
        ) : (
          <Stack spacing={1} alignItems="center" sx={{ px: 2, textAlign: 'center' }}>
            <PlayArrowIcon sx={{ fontSize: 38, color: 'primary.main' }} />
            <Typography sx={{ fontSize: 12, fontWeight: 900, color: 'text.secondary' }}>
              {isInstagram ? 'Instagram shared post' : 'Shared media'}
            </Typography>
          </Stack>
        )}
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(15,23,42,0.08) 0%, rgba(15,23,42,0) 44%, rgba(15,23,42,0.72) 100%)',
            pointerEvents: 'none'
          }} />
        <Box
          sx={{
            position: 'absolute',
            left: 10,
            bottom: 10,
            width: 28,
            height: 28,
            borderRadius: '50%',
            bgcolor: 'rgba(255,255,255,0.92)',
            color: '#111827',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 900,
            lineHeight: 1
          }}>
          <PlayArrowIcon sx={{ fontSize: 18 }} />
        </Box>
      </Box>
      <Box sx={{ px: 1.25, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 800,
            lineHeight: 1.25,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
          {item.label || item.alt || 'Instagram media'}
        </Typography>
        {host && <Typography sx={{ mt: 0.35, fontSize: 11, color: 'text.secondary', fontWeight: 700 }}>{host}</Typography>}
      </Box>
    </Box>
  );
}

function linkHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isRedundantMediaPreviewBody(body: string, media: NonNullable<SmsMessage['media']>) {
  if (!body || media.length !== 1) return false;
  const item = media[0];
  if (!item?.linkUrl || !(item.label || item.alt)) return false;

  const bodyText = normalizePreviewText(body);
  const label = normalizePreviewText(item.label || item.alt || '');
  const link = normalizePreviewText(item.linkUrl);
  const host = normalizePreviewText(linkHost(item.linkUrl));
  if (!bodyText || !label) return false;

  const redundantForms = [
    label,
    normalizePreviewText(`${label} ${link}`),
    normalizePreviewText(`${label} ${host}`),
  ].filter(Boolean);

  return redundantForms.includes(bodyText);
}

function normalizePreviewText(value: string) {
  return value
    .replace(/https?:\/\/(?:www\.)?/gi, '')
    .replace(/\/+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
