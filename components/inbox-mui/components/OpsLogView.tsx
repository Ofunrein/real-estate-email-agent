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
  metadata: Record<string, unknown>;
  createdAt: string;
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

export function OpsLogView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
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
      const payload = await res.json().catch(() => ({})) as { events?: AuditEvent[]; error?: string };
      if (!res.ok) throw new Error(payload.error || "Could not load audit events.");
      setEvents(payload.events || []);
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
        subtitle="Request-level webhook, dashboard send, media, and review audit trail."
        count={`${events.length} rows`}
        agentActive={!error}
        agentLabel={error ? "Needs attention" : "Live audit"}
      />

      <Card sx={{ p: 1.5, mb: 2, flexShrink: 0 }}>
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
            <Card key={event.id} sx={{ p: 1.5, borderColor: isBad ? "warning.dark" : "divider" }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                <Chip size="small" label={event.outcome || "event"} color={isBad ? "warning" : event.outcome === "sent" ? "success" : "default"} variant="outlined" />
                <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 0, flex: 1 }} noWrap>
                  {event.route} · {event.stage}
                </Typography>
                <Typography variant="caption" color="text.secondary">{formatWhen(event.createdAt)}</Typography>
                <Button size="small" endIcon={<ExpandMoreIcon />} onClick={() => setExpanded(isExpanded ? "" : event.id)}>
                  Details
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, overflowWrap: "anywhere" }}>
                {event.channel || "no-channel"} · {event.threadRef || "no-thread"} · {event.requestId}
              </Typography>
              {event.errorMessage && <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>{event.errorMessage}</Typography>}
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
            </Card>
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
