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

export function ImportsView() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [batchesLoading, setBatchesLoading] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [batches, setBatches] = useState<ImportBatch[]>([]);

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
      if (!nextDryRun) await loadBatches();
    } catch (pullError) {
      setError(pullError instanceof Error ? pullError.message : 'CRM pull failed');
    } finally {
      setLoading(false);
    }
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
                      Uses the active CRM adapter. GHL is wired now; Composio and direct real-estate CRM adapters plug into this same path.
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
