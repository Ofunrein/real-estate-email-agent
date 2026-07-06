"use client";
import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Card, Stack, Typography, Avatar, Chip } from '@mui/material';
import FlagIcon from '@mui/icons-material/OutlinedFlag';
import PersonIcon from '@mui/icons-material/PersonOutline';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { ConversationList } from './ConversationList';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ReaderFooter } from './ReaderFooter';
import { PropertyCardInline } from './PropertyCardInline';
import { CategoryFilter, type CategoryFilterValue } from './CategoryFilter';
import {
  agentAvatar,
  type EmailMessage,
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

export function EmailView() {
  const { emailThreads, leadCategories } = useInboxModel();
  const { colors } = useCategoryColors();
  const categoryValues = useMemo(
    () => ['all', ...leadCategories.map((c) => c.id)] as CategoryFilterValue[],
    [leadCategories]
  );
  const [category, setCategory] = usePersistedSelection<CategoryFilterValue>(
    'iris.inbox.email.category',
    'all',
    categoryValues
  );
	  const counts = useMemo(() => {
    const base = Object.fromEntries(
      leadCategories.map((c) => [c.id, 0])
    ) as Record<LeadCategoryId, number>;
    emailThreads.forEach((t) => {
      base[t.category] += 1;
    });
    return base;
	  }, [emailThreads, leadCategories]);
  const categoryMeta = useMemo(
    () => Object.fromEntries(leadCategories.map((category) => [category.id, category])),
    [leadCategories]
  ) as Record<LeadCategoryId, (typeof leadCategories)[number]>;
  const visibleThreads = useMemo(
    () =>
    category === 'all' ?
    emailThreads :
    emailThreads.filter((t) => t.category === category),
    [category, emailThreads]
  );
  const visibleThreadIds = useMemo(
    () => visibleThreads.map((t) => t.id),
    [visibleThreads]
  );
  const [selectedId, setSelectedId] = usePersistedSelection(
    'iris.inbox.email.thread',
    visibleThreadIds[0] ?? '',
    visibleThreadIds
  );
  const thread =
  visibleThreads.find((t) => t.id === selectedId) ??
  visibleThreads[0];
  const targetEventId = useActivityEventTarget('email', thread?.id);
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
        count="68 touches"
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
          items={visibleThreads.map((t) => {
            const status = categoryStatus(t.category, t.needsReview);
            return {
              id: t.id,
              title: t.contact,
              time: t.time,
              preview: t.preview,
              meta: `${t.messageCount} messages`,
              categoryLabel: categoryMeta[t.category]?.label,
              categoryColor: colors[t.category],
              needsReview: t.needsReview,
              channel: 'email' as const,
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
            ref={scrollRef}
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
                senderName={thread.name}
                highlighted={m.eventId === targetEventId}
                registerTarget={(node) => {
                  if (node) messageRefs.current.set(m.eventId, node);
                  else messageRefs.current.delete(m.eventId);
                }} />

              )}
              </Stack>
            </Box>

            <ReaderFooter
              threadId={thread.id}
              channel="email"
              to={thread.contact}
              subject={thread.messages.find((message) => message.subject)?.subject || `Re: ${thread.contact}`}
            />
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
    </Card>);

}
function EmailBubble({
  message,
  senderName,
  highlighted,
  registerTarget



}: {message: EmailMessage;senderName: string;highlighted?: boolean;registerTarget?: (node: HTMLDivElement | null) => void;}) {
  const isIris = message.direction === 'iris';
  const isOwner = message.direction === 'owner';
  const alignRight = isIris || isOwner;
  const outbound = alignRight;
  const headerLabel = isIris ?
  'Iris sent, auto' :
  isOwner ?
  'Austin Realty sent' :
  `${senderName}, inbound`;
  const imageMedia = message.media?.filter((item) => (item.kind || 'image') === 'image') || [];
  const audioMedia = message.media?.filter((item) => item.kind === 'audio') || [];
  const fileMedia = message.media?.filter((item) => item.kind === 'file') || [];
  return (
    <Box
      ref={registerTarget}
      sx={{
        display: 'flex',
        justifyContent: alignRight ? 'flex-end' : 'flex-start',
        scrollMargin: '24px'
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
            borderColor: highlighted ? 'primary.main' : isOwner ? 'primary.main' : 'divider',
            boxShadow: highlighted ? '0 0 0 3px rgba(99,102,241,0.18)' : 'none',
            bgcolor: isIris ? 'primary.main' : isOwner ? 'background.paper' : 'iris.surface2',
            color: isIris ? 'primary.contrastText' : 'text.primary'
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
                alt={isIris ? 'Iris, AI agent' : undefined}
                sx={{
                  width: 22,
                  height: 22,
                  bgcolor: isIris ? 'primary.contrastText' : 'action.selected',
                  color: isIris ? 'primary.main' : 'text.secondary'
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
                  color: isIris ? 'iris.accentInk' : isOwner ? 'primary.main' : 'text.secondary'
                }}>

                {headerLabel}
              </Typography>
            </Stack>
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'var(--font-mono)',
                color: isIris ? 'primary.contrastText' : 'text.secondary',
                opacity: isIris ? 0.7 : 1
              }}>

              {message.time}
            </Typography>
          </Stack>

          {message.subject &&
          <Typography
            variant="body2"
            sx={{
              fontWeight: 700,
              color: isIris ? 'primary.contrastText' : 'text.primary',
              mb: 1
            }}>

              {message.subject}
            </Typography>
          }
          {!!audioMedia.length &&
          <Stack spacing={0.75} sx={{ mt: message.subject ? 0.75 : 0, mb: (message.html || message.body || imageMedia.length || fileMedia.length) ? 0.9 : 0 }}>
            {audioMedia.map((item, index) =>
            <Box
              key={`${item.url}-${index}`}
              sx={{
                p: 0.75,
                borderRadius: 3,
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(148,163,184,0.12)' : theme.palette.background.paper,
                border: '1px solid',
                borderColor: 'divider',
                '& audio': {
                  display: 'block',
                  width: { xs: 210, sm: 260 },
                  maxWidth: '100%',
                  height: 34,
                  colorScheme: (theme) => theme.palette.mode
                }
              }}>
              <audio controls preload="metadata" src={item.url} />
              {item.transcript &&
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
                {item.transcript}
              </Typography>
              }
            </Box>

            )}
          </Stack>
          }
          {(message.html || message.body) &&
          (() => {
            const raw = message.html || '';
            if (raw) {
              const clean =
                typeof window !== 'undefined'
                  ? (function () {
                      // eslint-disable-next-line @typescript-eslint/no-var-requires
                      const DOMPurify = require('dompurify');
                      return DOMPurify.sanitize(raw, {
                        USE_PROFILES: { html: true },
                        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
                        FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
                      });
                    })()
                  : raw;
              return (
                <Box
                  sx={{
                    mt: message.subject ? 0.5 : 0,
                    fontSize: '0.875rem',
                    lineHeight: 1.6,
                    color: 'text.primary',
                    '& a, & a *': { color: 'primary.main !important' },
                    '& img': { maxWidth: '100%', borderRadius: 1 },
                    '& p': { m: 0, mb: 0.75 },
                    '& ul, & ol': { pl: 2.5, my: 0.5 },
                    '& table': { borderCollapse: 'collapse', width: '100%', fontSize: '0.8125rem' },
                    '& td, & th': { border: '1px solid', borderColor: 'divider', p: 0.75 },
                    // Override any inline color styles in HTML email for dark mode readability
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
                    '& [style*="background"], & td[bgcolor], & table[bgcolor]': {
                      backgroundColor: (theme: any) => theme.palette.mode === 'dark'
                        ? `${theme.palette.action.hover} !important`
                        : undefined,
                    },
                  }}
                  dangerouslySetInnerHTML={{ __html: clean }}
                />
              );
            }
            return (
              <Typography
                variant="body2"
                sx={{
                  whiteSpace: 'pre-line',
                  lineHeight: 1.6,
                  mt: message.subject ? 0.5 : 0,
                  color: isIris ? 'primary.contrastText' : 'text.primary',
                }}
              >
                {message.body}
              </Typography>
            );
          })()
          }
          {!!imageMedia.length &&
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: message.html || message.body || audioMedia.length ? 0.9 : 0 }}>
            {imageMedia.map((item, index) =>
            <Chip
              key={`${item.url}-${index}`}
              component="a"
              href={item.url}
              clickable
              size="small"
              label={item.alt || 'Image attachment'}
              sx={{
                color: 'text.primary',
                borderColor: 'divider'
              }}
              variant="outlined" />

            )}
          </Stack>
          }
          {!!fileMedia.length &&
          <Stack direction="row" flexWrap="wrap" gap={0.75} sx={{ mt: imageMedia.length || message.html || message.body || audioMedia.length ? 0.9 : 0 }}>
            {fileMedia.map((item, index) =>
            <Chip
              key={`${item.url}-${index}`}
              component="a"
              href={item.url}
              clickable
              size="small"
              label={item.alt || 'Attachment'}
              sx={{
                color: 'text.primary',
                borderColor: 'divider'
              }}
              variant="outlined" />

            )}
          </Stack>
          }
          {message.cards?.map((c, i) =>
          <PropertyCardInline
            key={i}
            card={c}
            outbound={outbound}
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
