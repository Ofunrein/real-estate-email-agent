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
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/RefreshOutlined";
import SearchIcon from "@mui/icons-material/SearchOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMoreOutlined";
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

const CHANNELS = ["", "instagram", "messenger", "sms", "whatsapp", "email", "website_chat"];
const OUTCOMES = ["", "received", "sent", "drafted", "blocked", "failed", "skipped"];

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

function shortId(value: string) {
  if (!value) return "";
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

export function OpsLogView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [summary, setSummary] = useState<AuditSummary>({ totalCostUsd: 0, rowsWithCost: 0, byService: {} });
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
      const payload = await res.json().catch(() => ({})) as { events?: AuditEvent[]; summary?: AuditSummary; error?: string };
      if (!res.ok) throw new Error(payload.error || "Could not load audit events.");
      setEvents(payload.events || []);
      setSummary(payload.summary || { totalCostUsd: 0, rowsWithCost: 0, byService: {} });
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

      <Card sx={{ p: 1.5, mb: 2, flexShrink: 0 }}>
        <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
          <Chip size="small" label={`Cost ${formatCost(summary.totalCostUsd)}`} color={summary.totalCostUsd ? "warning" : "default"} variant="outlined" />
          <Chip size="small" label={`${summary.rowsWithCost} billed rows`} variant="outlined" />
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

      <Stack spacing={1} sx={{ overflowY: "auto", minHeight: 0, pr: 0.5 }}>
        {events.map((event) => {
          const isExpanded = expanded === event.id;
          const isBad = event.outcome === "failed" || Number(event.statusCode || 0) >= 400 || Boolean(event.errorMessage);
          return (
            <Box
              key={event.id}
              sx={{
                p: 1.25,
                border: "1px solid",
                borderColor: isBad ? "warning.dark" : "divider",
                borderRadius: 1,
                bgcolor: "background.paper",
                minHeight: 76,
                display: "flex",
                flexDirection: "column",
                gap: 0.75,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0, flexWrap: "wrap" }}>
                  <Chip size="small" label={event.outcome || "event"} color={isBad ? "warning" : event.outcome === "sent" ? "success" : "default"} variant="outlined" />
                  {event.channel && <Chip size="small" label={event.channel} variant="outlined" />}
                  {event.costUsd > 0 && <Chip size="small" label={`${event.costService || "cost"} ${formatCost(event.costUsd)}`} color="warning" variant="outlined" />}
                </Stack>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                    {event.route} · {event.stage}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.25, lineHeight: 1.35, overflowWrap: "anywhere" }}>
                    {event.threadRef || "no-thread"} · req {shortId(event.requestId)}{event.providerMessageId ? ` · msg ${shortId(event.providerMessageId)}` : ""}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>{formatWhen(event.createdAt)}</Typography>
                  <Button size="small" endIcon={<ExpandMoreIcon />} onClick={() => setExpanded(isExpanded ? "" : event.id)}>
                    Details
                  </Button>
                </Stack>
              </Stack>
              {event.errorMessage && <Typography variant="caption" color="warning.main" sx={{ display: "block", overflowWrap: "anywhere" }}>{event.errorMessage}</Typography>}
              <Collapse in={isExpanded}>
                <Box component="pre" sx={{
                  mt: 1,
                  p: 1,
                  borderRadius: 1,
                  bgcolor: "action.hover",
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}>
                  {JSON.stringify(event, null, 2)}
                </Box>
              </Collapse>
            </Box>
          );
        })}
        {!events.length && !loading && (
          <Card sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">No audit rows match these filters.</Typography>
          </Card>
        )}
      </Stack>
    </Box>
  );
}
