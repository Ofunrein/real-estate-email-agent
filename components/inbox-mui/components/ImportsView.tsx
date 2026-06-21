"use client";
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography } from
'@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFileOutlined';
import CloudSyncIcon from '@mui/icons-material/CloudSyncOutlined';
import SafetyIcon from '@mui/icons-material/VerifiedUserOutlined';
import SegmentIcon from '@mui/icons-material/AccountTreeOutlined';
import WarningIcon from '@mui/icons-material/ReportProblemOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline';
import LinkIcon from '@mui/icons-material/AddLinkOutlined';
import TableChartIcon from '@mui/icons-material/TableChartOutlined';
import StorageIcon from '@mui/icons-material/StorageOutlined';

type ImportPreviewRow = {
  rowIndex: number;
  status: string;
  email: string;
  phone: string;
  fullName: string;
  segments: string[];
  campaignEligible: boolean;
  unmappedColumns: string[];
  errors: string[];
};

type ImportSummary = {
  batchId: string;
  sourceType: string;
  sourceProvider: string;
  totalRows: number;
  importedLeads: number;
  mergedDuplicates: number;
  duplicateRows: number;
  invalidRows: number;
  missingContactInfo: number;
  campaignEligible: number;
  segmentCounts: Record<string, number>;
  unmappedColumns: string[];
};

type ImportBatch = {
  id: string;
  source_type: string;
  source_name: string;
  source_provider: string;
  status: string;
  total_rows: number;
  imported_count: number;
  merged_count: number;
  duplicate_count: number;
  invalid_count: number;
  campaign_eligible_count: number;
  segment_counts: Record<string, number>;
  created_at: string;
};

type ConnectorStatus = {
  id: string;
  label: string;
  provider: string;
  path: string;
  status: 'ready' | 'configured' | 'needs_config' | 'planned' | 'fallback';
  detail: string;
  action: string;
};

const segmentLabels: Record<string, string> = {
  hot_buyer: 'Hot buyer',
  seller_valuation: 'Seller / valuation',
  showing_ready: 'Showing-ready',
  nurture: 'Nurture',
  financing: 'Financing',
  renter: 'Renter',
  needs_human: 'Needs human',
  missing_contact_info: 'Missing contact',
  do_not_contact: 'Do not contact',
  duplicate_merged: 'Duplicate / merged',
  closed_no_reply: 'Closed / no reply',
};

function formatSegment(value: string): string {
  return segmentLabels[value] || value.replace(/_/g, ' ');
}

function statusColor(status: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'segmented' || status === 'imported') return 'success';
  if (status === 'failed' || status === 'invalid') return 'error';
  if (status === 'duplicate' || status === 'merged') return 'warning';
  if (status === 'validated' || status === 'mapped') return 'info';
  return 'default';
}

function connectorColor(status: ConnectorStatus['status']): 'default' | 'success' | 'warning' | 'info' {
  if (status === 'ready' || status === 'configured') return 'success';
  if (status === 'fallback') return 'info';
  if (status === 'needs_config') return 'warning';
  return 'default';
}

function connectorIcon(id: string) {
  if (id === 'csv') return <UploadFileIcon color="primary" />;
  if (id === 'google_sheets') return <TableChartIcon color="primary" />;
  if (id === 'composio') return <LinkIcon color="primary" />;
  if (id === 'ghl') return <CloudSyncIcon color="primary" />;
  return <StorageIcon color="primary" />;
}

export function ImportsView() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([]);
  const [batchesError, setBatchesError] = useState('');
  const [lastPreviewSource, setLastPreviewSource] = useState<'csv' | 'crm' | 'google_sheets' | 'composio' | null>(null);

  const topSegments = useMemo(() => {
    const counts = summary?.segmentCounts || {};
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [summary]);

  async function loadBatches() {
    setBatchesLoading(true);
    try {
      const response = await fetch('/api/leads/import', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to load batches');
      setBatches(data.batches || []);
      setConnectors(data.connectors || []);
      setBatchesError(data.batchesError || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load batches');
    } finally {
      setBatchesLoading(false);
    }
  }

  useEffect(() => {
    void loadBatches();
  }, []);

  async function submitCsv(nextDryRun = dryRun) {
    if (!file) {
      setError('Choose a CSV export first.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const body = new FormData();
      body.set('file', file);
      body.set('sourceType', 'csv');
      body.set('sourceProvider', 'csv_export');
      body.set('sourceName', file.name);
      body.set('dryRun', String(nextDryRun));
      const response = await fetch('/api/leads/import', { method: 'POST', body });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Import failed');
      setSummary(data.summary);
      setPreview(data.preview || []);
      setLastPreviewSource('csv');
      if (!nextDryRun) await loadBatches();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }

  async function pullCrm(nextDryRun = dryRun) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pullCrm: true, sourceType: 'crm', dryRun: nextDryRun, limit: 100 }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'CRM pull failed');
      setSummary(data.summary);
      setPreview(data.preview || []);
      setLastPreviewSource('crm');
      if (!nextDryRun) await loadBatches();
    } catch (pullError) {
      setError(pullError instanceof Error ? pullError.message : 'CRM pull failed');
    } finally {
      setLoading(false);
    }
  }

  async function pullSheets(nextDryRun = dryRun) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pullSheets: true, sourceType: 'google_sheets', dryRun: nextDryRun }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Google Sheets pull failed');
      setSummary(data.summary);
      setPreview(data.preview || []);
      setLastPreviewSource('google_sheets');
      if (!nextDryRun) await loadBatches();
    } catch (pullError) {
      setError(pullError instanceof Error ? pullError.message : 'Google Sheets pull failed');
    } finally {
      setLoading(false);
    }
  }

  async function pullComposio(nextDryRun = dryRun) {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/leads/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pullComposio: true, sourceType: 'composio', dryRun: nextDryRun }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Composio pull failed');
      setSummary(data.summary);
      setPreview(data.preview || []);
      setLastPreviewSource('composio');
      if (!nextDryRun) await loadBatches();
    } catch (pullError) {
      setError(pullError instanceof Error ? pullError.message : 'Composio pull failed');
    } finally {
      setLoading(false);
    }
  }

  function connectorDisabled(connector: ConnectorStatus): boolean {
    if (loading) return true;
    if (connector.id === 'csv') return !file;
    if (connector.id === 'composio') return connector.status !== 'ready';
    if (connector.id === 'ghl' || connector.id === 'google_sheets') {
      return connector.status !== 'ready' && connector.status !== 'configured';
    }
    return true;
  }

  function importLatestSource() {
    if (lastPreviewSource === 'csv') {
      void submitCsv(false);
    } else if (lastPreviewSource === 'crm') {
      void pullCrm(false);
    } else if (lastPreviewSource === 'google_sheets') {
      void pullSheets(false);
    } else if (lastPreviewSource === 'composio') {
      void pullComposio(false);
    } else {
      setError('Run a preview before importing.');
    }
  }

  function connectorAction(connector: ConnectorStatus) {
    if (connector.id === 'csv') {
      void submitCsv(true);
      return;
    }
    if (connector.id === 'ghl') {
      void pullCrm(true);
      return;
    }
    if (connector.id === 'google_sheets') {
      void pullSheets(true);
      return;
    }
    if (connector.id === 'composio') {
      void pullComposio(true);
      return;
    }
    setError(`${connector.label} is not directly connected yet. Export CSV from that CRM and use the CSV fallback.`);
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: { xs: 'visible', lg: 'auto' }, pb: 1 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={1.5} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">Lead Reopen</Typography>
          <Typography variant="caption" color="text.secondary">
            Import old CRM, CSV, Sheets, or Composio leads. Segment first. Campaign sending stays off until reviewed.
          </Typography>
        </Box>
        <Chip icon={<SafetyIcon />} color="success" variant="outlined" label="No auto-send on import" />
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(300px, 0.72fr) minmax(0, 1fr)' },
          gap: 2,
          alignItems: 'start',
        }}>
        <Box>
          <Stack spacing={2}>
            <Card sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <CheckCircleIcon color="primary" />
                  <Box>
                    <Typography variant="subtitle2">Source connections</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Composio first where coverage is deep enough. Direct adapters for real-estate CRMs. CSV remains the always-on fallback.
                    </Typography>
                  </Box>
                </Stack>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                    gap: 1,
                  }}>
                  {(connectors.length ? connectors : [
                    { id: 'csv', label: 'CSV / export', provider: 'csv_export', path: 'fallback', status: 'ready', detail: 'Works today for any CRM export.', action: 'Choose CSV file' },
                    { id: 'ghl', label: 'GoHighLevel', provider: 'ghl', path: 'direct_adapter', status: 'needs_config', detail: 'Status loads from the import API.', action: 'Configure GHL' },
                    { id: 'composio', label: 'Composio connectors', provider: 'composio', path: 'preferred', status: 'needs_config', detail: 'Status loads from the import API.', action: 'Connect Composio' },
                    { id: 'other_crm', label: 'Other CRM export', provider: 'real_estate_crm_export', path: 'csv_first', status: 'fallback', detail: 'CSV fallback works now.', action: 'Import CSV' },
                  ] as ConnectorStatus[]).map((connector) => (
                    <Card key={connector.id} variant="outlined" sx={{ p: 1.25, minHeight: 132 }}>
                      <Stack spacing={1} sx={{ height: '100%' }}>
                        <Stack direction="row" spacing={1} alignItems="flex-start">
                          {connectorIcon(connector.id)}
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography variant="body2" fontWeight={800}>{connector.label}</Typography>
                            <Typography variant="caption" color="text.secondary">{connector.provider}</Typography>
                          </Box>
                          <Chip
                            size="small"
                            color={connectorColor(connector.status)}
                            variant={connector.status === 'planned' ? 'outlined' : 'filled'}
                            label={connector.status.replace(/_/g, ' ')}
                          />
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                          {connector.detail}
                        </Typography>
                        <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="space-between">
                          <Chip size="small" variant="outlined" label={connector.path.replace(/_/g, ' ')} />
                          <Button
                            size="small"
                            variant="text"
                            disabled={connectorDisabled(connector)}
                            onClick={() => connectorAction(connector)}
                            sx={{ minWidth: 0, px: 0.5, fontWeight: 800 }}>
                            {connector.action}
                          </Button>
                        </Stack>
                      </Stack>
                    </Card>
                  ))}
                </Box>
              </Stack>
            </Card>

            <Card sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <UploadFileIcon color="primary" />
                  <Box>
                    <Typography variant="subtitle2">CSV / export import</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Universal fallback for FUB, Lofty, kvCORE, Sierra, Real Geeks, BoomTown, CINC, or custom exports.
                    </Typography>
                  </Box>
                </Stack>
                <Button component="label" variant="outlined" startIcon={<UploadFileIcon />} sx={{ justifyContent: 'flex-start' }}>
                  {file ? file.name : 'Choose CSV file'}
                  <input
                    hidden
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => setFile(event.target.files?.[0] || null)}
                  />
                </Button>
                <FormControlLabel
                  control={<Switch checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />}
                  label={<Typography variant="body2">Preview only before writing to lead memory</Typography>}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button variant="contained" disabled={loading || !file} onClick={() => submitCsv(dryRun)}>
                    {dryRun ? 'Preview CSV' : 'Import CSV'}
                  </Button>
                  <Button variant="text" disabled={loading || !file} onClick={() => submitCsv(false)}>
                    Import after preview
                  </Button>
                </Stack>
              </Stack>
            </Card>

            <Card sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <CloudSyncIcon color="primary" />
                  <Box>
                    <Typography variant="subtitle2">Connected CRM pull</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Uses the active direct CRM adapter. GHL is wired now; FUB, Lofty, kvCORE, Sierra, Real Geeks, BoomTown, and CINC plug into this same path.
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button variant="outlined" disabled={loading} onClick={() => pullCrm(true)}>
                    Preview CRM leads
                  </Button>
                  <Button variant="contained" disabled={loading} onClick={() => pullCrm(false)}>
                    Pull into lead memory
                  </Button>
                </Stack>
              </Stack>
            </Card>

            <Card sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TableChartIcon color="primary" />
                  <Box>
                    <Typography variant="subtitle2">Sheets / Composio pulls</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Sheets imports the existing lead memory tab. Composio imports from the configured CRM tool slug and normalizes into the same batch flow.
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <Button variant="outlined" disabled={loading} onClick={() => pullSheets(true)}>
                    Preview Sheets
                  </Button>
                  <Button variant="outlined" disabled={loading} onClick={() => pullComposio(true)}>
                    Preview Composio
                  </Button>
                  <Button variant="contained" disabled={loading || !summary || !lastPreviewSource} onClick={importLatestSource}>
                    Import latest source
                  </Button>
                </Stack>
              </Stack>
            </Card>

            <Card sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <SegmentIcon color="primary" />
                  <Typography variant="subtitle2">Workflow scope</Typography>
                </Stack>
                {['Upload/connect source', 'Preview field mapping', 'Validate and dedupe', 'Segment for Lead Reopen Sprint', 'Review before campaign activation'].map((step, index) => (
                  <Stack key={step} direction="row" spacing={1} alignItems="center">
                    <Chip size="small" label={index + 1} />
                    <Typography variant="body2">{step}</Typography>
                  </Stack>
                ))}
              </Stack>
            </Card>
          </Stack>
        </Box>

        <Box>
          <Stack spacing={2}>
            {loading && <LinearProgress />}
            {error && <Alert severity="error" icon={<WarningIcon />}>{error}</Alert>}
            {batchesError && <Alert severity="warning" icon={<WarningIcon />}>{batchesError}</Alert>}

            <Card sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Typography variant="subtitle2">Latest import result</Typography>
                {summary ? (
                  <>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
                        gap: 1,
                      }}>
                      {[
                        ['Rows', summary.totalRows],
                        ['Imported', summary.importedLeads],
                        ['Merged', summary.mergedDuplicates],
                        ['Duplicates', summary.duplicateRows],
                        ['Invalid', summary.invalidRows],
                        ['Eligible', summary.campaignEligible],
                      ].map(([label, value]) => (
                        <Box key={label}>
                          <Card variant="outlined" sx={{ p: 1.25 }}>
                            <Typography variant="caption" color="text.secondary">{label}</Typography>
                            <Typography variant="h6">{value}</Typography>
                          </Card>
                        </Box>
                      ))}
                    </Box>
                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                      {topSegments.map(([segment, count]) => (
                        <Chip key={segment} size="small" label={`${formatSegment(segment)} · ${count}`} />
                      ))}
                    </Stack>
                    {summary.unmappedColumns.length ? (
                      <Alert severity="warning">
                        Unmapped columns: {summary.unmappedColumns.join(', ')}
                      </Alert>
                    ) : null}
                  </>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Run a preview to see row counts, duplicates, blocked contacts, and segment distribution.
                  </Typography>
                )}
              </Stack>
            </Card>

            <Card sx={{ overflow: 'hidden' }}>
              <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="subtitle2">Preview rows</Typography>
                <Typography variant="caption" color="text.secondary">First 25 rows from the latest preview or import.</Typography>
              </Box>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Lead</TableCell>
                      <TableCell>Contact</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Segments</TableCell>
                      <TableCell align="right">Eligible</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.length ? preview.map((row) => (
                      <TableRow key={row.rowIndex}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={700}>{row.fullName || 'Unknown lead'}</Typography>
                          {row.errors.length ? <Typography variant="caption" color="error">{row.errors.join(', ')}</Typography> : null}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" color="text.secondary">{row.email || row.phone || 'Missing contact'}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" color={statusColor(row.status)} label={row.status} />
                        </TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                            {row.segments.slice(0, 3).map((segment) => <Chip key={segment} size="small" variant="outlined" label={formatSegment(segment)} />)}
                          </Stack>
                        </TableCell>
                        <TableCell align="right">{row.campaignEligible ? 'Yes' : 'No'}</TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary">No preview loaded yet.</Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Box>
            </Card>

            <Card sx={{ p: 2 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">Recent batches</Typography>
                {batchesLoading ? <CircularProgress size={18} /> : <Button size="small" onClick={loadBatches}>Refresh</Button>}
              </Stack>
              <Divider sx={{ mb: 1 }} />
              <Stack spacing={1}>
                {batches.length ? batches.map((batch) => (
                  <Stack key={batch.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
                    <Box>
                      <Typography variant="body2" fontWeight={700}>{batch.source_name || batch.source_provider || batch.source_type}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {batch.total_rows} rows · {batch.imported_count} imported · {batch.merged_count} merged · {batch.campaign_eligible_count} eligible
                      </Typography>
                    </Box>
                    <Chip size="small" color={statusColor(batch.status)} label={batch.status} />
                  </Stack>
                )) : (
                  <Typography variant="body2" color="text.secondary">
                    No persisted import batches yet. Real imports appear here after the migration is applied.
                  </Typography>
                )}
              </Stack>
            </Card>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}
