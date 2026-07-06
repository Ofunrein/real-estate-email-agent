"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/RefreshOutlined";
import SearchIcon from "@mui/icons-material/SearchOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMoreOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import { WorkspaceHeader } from "./WorkspaceHeader";

type AuditEvent = {
  id: string;
  requestId: string;
  route: string;
  method: string;
  channel: string;
  provider: string;
  threadRef: string;
  contactRef: string;
  providerMessageId: string;
  stage: string;
  outcome: string;
  statusCode: number | null;
  durationMs: number | null;
  errorCode: string;
  errorMessage: string;
  costUsd: number;
  costService: string;
  costUnits: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditSummary = {
  totalCostUsd: number;
  rowsWithCost: number;
  byService: Record<string, number>;
};

type SocialFallbackHealth = {
  fallbackEvents24h: number;
  lastFallbackAt: string;
  lastFallbackChannel: string;
  lastFallbackThreadRef: string;
  directMetaLastAt: string;
  stuckJobs: number;
};

const CHANNELS = ["", "instagram", "messenger", "sms", "whatsapp", "email", "website_chat"];
const OUTCOMES = ["", "received", "fallback_active", "sent", "drafted", "blocked", "failed", "skipped"];

function formatWhen(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatCost(value: number) {
  if (!value) return "$0.00000";
  return `$${value.toFixed(value < 0.01 ? 5 : 4)}`;
}

const SECRET_KEY_PATTERN = /token|secret|key|password|authorization|cookie/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redact(val),
      ])
    );
  }
  return value;
}

function redactedPayload(event: AuditEvent): string {
  const payload = {
    metadata: redact(event.metadata || {}),
    costUnits: redact(event.costUnits || {}),
    errorCode: event.errorCode || undefined,
  };
  return JSON.stringify(payload, null, 2);
}

// ok -> success, warn -> warning "Retrying", bad -> danger "Failed", info -> info "Received"
type Severity = "ok" | "warn" | "bad" | "info";

function severityForEvent(event: AuditEvent): Severity {
  const isBad = event.outcome === "failed" || Number(event.statusCode || 0) >= 400 || Boolean(event.errorMessage);
  if (isBad) return "bad";
  if (event.outcome === "fallback_active" || event.stage.startsWith("retry")) return "warn";
  if (event.outcome === "received") return "info";
  if (event.outcome === "sent" || event.outcome === "drafted") return "ok";
  return "info";
}

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: "Success",
  warn: "Retrying",
  bad: "Failed",
  info: "Received",
};

const SEVERITY_COLOR: Record<Severity, "success" | "warning" | "error" | "info"> = {
  ok: "success",
  warn: "warning",
  bad: "error",
  info: "info",
};

const OPS_COLUMNS = "88px 1.3fr 1fr 1fr 100px 90px 24px";

export function OpsLogView() {
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  // Iris Dashboard.dc.html --card-hi / --elev recipe, translated to MUI boxShadow strings.
  const cardHi = isDark ? "inset 0 1px 0 rgba(255,255,255,.06)" : "inset 0 1px 0 rgba(255,255,255,.9)";
  const elev = isDark
    ? "inset 0 1px 0 rgba(255,255,255,.04), 0 18px 50px rgba(0,0,0,.4)"
    : "0 1px 1px rgba(15,23,42,.04), 0 8px 18px rgba(15,23,42,.08), 0 24px 60px rgba(15,23,42,.06)";
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [summary, setSummary] = useState<AuditSummary>({ totalCostUsd: 0, rowsWithCost: 0, byService: {} });
  const [health, setHealth] = useState<SocialFallbackHealth>({ fallbackEvents24h: 0, lastFallbackAt: "", lastFallbackChannel: "", lastFallbackThreadRef: "", directMetaLastAt: "", stuckJobs: 0 });
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string>("");
  const [channel, setChannel] = useState("");
  const [outcome, setOutcome] = useState("");
  const [query, setQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    const search = new URLSearchParams({ limit: "100" });
    if (channel) search.set("channel", channel);
    if (outcome) search.set("outcome", outcome);
    if (errorsOnly) search.set("errorsOnly", "true");
    const trimmed = query.trim();
    if (trimmed) {
      if (trimmed.includes(":")) search.set("threadRef", trimmed);
      else search.set("requestId", trimmed);
    }
    return search;
  }, [channel, errorsOnly, outcome, query]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/ops/audit?${params.toString()}`, { cache: "no-store" });
      const payload = await res.json().catch(() => ({})) as { events?: AuditEvent[]; summary?: AuditSummary; health?: SocialFallbackHealth; error?: string };
      if (!res.ok) throw new Error(payload.error || "Could not load audit events.");
      setEvents(payload.events || []);
      setSummary(payload.summary || { totalCostUsd: 0, rowsWithCost: 0, byService: {} });
      setHealth(payload.health || { fallbackEvents24h: 0, lastFallbackAt: "", lastFallbackChannel: "", lastFallbackThreadRef: "", directMetaLastAt: "", stuckJobs: 0 });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load audit events.");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <WorkspaceHeader
        title="Ops Log"
        subtitle="Omnichannel webhooks, background workers, agent sends, media actions, review events, and cost trail."
        count={`${events.length} rows · ${formatCost(summary.totalCostUsd)}`}
        agentActive={!error}
        agentLabel={error ? "Needs attention" : "Live audit"}
      />

      <Card sx={{ p: 1.5, mb: 2, flexShrink: 0, boxShadow: `${cardHi}, ${elev}` }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
          <Chip size="small" label={`Cost ${formatCost(summary.totalCostUsd)}`} color={summary.totalCostUsd ? "warning" : "default"} variant="outlined" />
          <Chip size="small" label={`${summary.rowsWithCost} billed rows`} variant="outlined" />
          <Chip size="small" label={`Fallback 24h ${health.fallbackEvents24h}`} color={health.fallbackEvents24h ? "info" : "default"} variant="outlined" />
          <Chip size="small" label={`Stuck social jobs ${health.stuckJobs}`} color={health.stuckJobs ? "warning" : "default"} variant="outlined" />
          {health.lastFallbackAt && <Chip size="small" label={`Last fallback ${health.lastFallbackChannel || "social"} ${formatWhen(health.lastFallbackAt)}`} color="info" variant="outlined" />}
          {health.directMetaLastAt && <Chip size="small" label={`Meta direct ${formatWhen(health.directMetaLastAt)}`} variant="outlined" />}
          {Object.entries(summary.byService || {}).map(([service, cost]) => (
            <Chip key={service} size="small" label={`${service} ${formatCost(cost)}`} variant="outlined" />
          ))}
        </Stack>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ xs: "stretch", md: "center" }}>
          <TextField
            size="small"
            select
            label="Channel"
            value={channel}
            onChange={(event) => setChannel(event.target.value)}
            sx={{ minWidth: 150 }}
          >
            {CHANNELS.map((value) => <MenuItem key={value || "all"} value={value}>{value || "All"}</MenuItem>)}
          </TextField>
          <TextField
            size="small"
            select
            label="Outcome"
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            sx={{ minWidth: 150 }}
          >
            {OUTCOMES.map((value) => <MenuItem key={value || "all"} value={value}>{value || "All"}</MenuItem>)}
          </TextField>
          <TextField
            size="small"
            label="Thread or request id"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            InputProps={{ startAdornment: <SearchIcon sx={{ mr: 0.75, fontSize: 18, color: "text.secondary" }} /> }}
            sx={{ flex: 1, minWidth: 220 }}
          />
          <FormControlLabel
            control={<Switch checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} />}
            label="Errors"
            sx={{ m: 0 }}
          />
          <Button startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading} variant="outlined">
            Refresh
          </Button>
        </Stack>
        {error && <Typography color="error" variant="caption" sx={{ display: "block", mt: 1 }}>{error}</Typography>}
      </Card>

      {/* Sticky filter chip row — mirrors Iris Dashboard.dc.html ops log filter bar */}
      <Stack
        direction="row"
        spacing={0.75}
        useFlexGap
        flexWrap="wrap"
        sx={{ position: "sticky", top: 0, zIndex: 2, bgcolor: "background.default", py: 1, mb: 0.5, flexShrink: 0 }}
      >
        <Chip
          size="small"
          label="All"
          onClick={() => { setChannel(""); setOutcome(""); setErrorsOnly(false); }}
          sx={{
            bgcolor: !channel && !outcome && !errorsOnly ? "primary.main" : "action.hover",
            color: !channel && !outcome && !errorsOnly ? "primary.contrastText" : "text.primary",
            fontWeight: 700,
          }}
        />
        {channel && <Chip size="small" variant="outlined" label={`Channel: ${channel}`} onDelete={() => setChannel("")} />}
        {outcome && <Chip size="small" variant="outlined" label={`Outcome: ${outcome}`} onDelete={() => setOutcome("")} />}
        {errorsOnly && <Chip size="small" variant="outlined" color="warning" label="Errors only" onDelete={() => setErrorsOnly(false)} />}
      </Stack>

      <Card sx={{ overflow: "hidden", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", boxShadow: `${cardHi}, ${elev}` }}>
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: OPS_COLUMNS,
            gap: 1.25,
            px: 2,
            py: 1.1,
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
            color: "text.secondary",
            bgcolor: "action.hover",
            borderBottom: "1px solid",
            borderColor: "divider",
            flexShrink: 0,
          }}
        >
          <span>Time</span>
          <span>Event</span>
          <span>Channel</span>
          <span>Provider</span>
          <span>Status</span>
          <span>Cost</span>
          <span />
        </Box>

        <Box sx={{ overflowY: "auto", minHeight: 0 }}>
          {events.map((event) => {
            const isExpanded = expanded === event.id;
            const severity = severityForEvent(event);
            return (
              <Box key={event.id}>
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpanded(isExpanded ? "" : event.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setExpanded(isExpanded ? "" : event.id);
                  }}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: OPS_COLUMNS,
                    gap: 1.25,
                    alignItems: "center",
                    px: 2,
                    py: 1.1,
                    fontSize: 12,
                    borderTop: "1px solid",
                    borderColor: "divider",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    {formatWhen(event.createdAt)}
                  </Typography>
                  <Typography variant="caption" sx={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, overflowWrap: "anywhere" }}>
                    {event.route}{event.stage ? ` · ${event.stage}` : ""}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{event.channel || "—"}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>{event.provider || "—"}</Typography>
                  <Box sx={{ justifySelf: "start" }}>
                    <Chip size="small" color={SEVERITY_COLOR[severity]} label={SEVERITY_LABEL[severity]} sx={{ height: 20, "& .MuiChip-label": { px: 0.9, fontSize: 10.5 } }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                    {event.costUsd > 0 ? formatCost(event.costUsd) : "—"}
                  </Typography>
                  <ExpandMoreIcon
                    fontSize="small"
                    sx={{ color: "text.secondary", transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform .15s" }}
                  />
                </Box>
                <Collapse in={isExpanded}>
                  <Box sx={{ px: 2, pt: 1.25, pb: 1.5, bgcolor: "action.hover", borderTop: "1px solid", borderColor: "divider" }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Typography variant="caption" color="text.secondary">Correlation ID</Typography>
                      <Typography variant="caption" sx={{ fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
                        {event.requestId || "—"}
                      </Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ContentCopyIcon sx={{ fontSize: 13 }} />}
                        onClick={() => { void navigator.clipboard?.writeText(event.requestId || ""); }}
                        sx={{ minHeight: 0, py: 0.25, fontSize: 10.5 }}
                      >
                        Copy
                      </Button>
                    </Stack>
                    {event.errorMessage && (
                      <Typography variant="caption" color="warning.main" sx={{ display: "block", mb: 1, overflowWrap: "anywhere" }}>
                        {event.errorMessage}
                      </Typography>
                    )}
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 1.25,
                        borderRadius: 1.5,
                        bgcolor: "background.paper",
                        border: "1px solid",
                        borderColor: "divider",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "text.secondary",
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {redactedPayload(event)}
                    </Box>
                  </Box>
                </Collapse>
              </Box>
            );
          })}
          {!events.length && !loading && (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">No audit rows match these filters.</Typography>
            </Box>
          )}
        </Box>
      </Card>
    </Box>
  );
}
