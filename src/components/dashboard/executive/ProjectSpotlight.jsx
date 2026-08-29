import { useEffect, useMemo, useState } from 'react';
import {
  Box, Stack, Typography, TextField, MenuItem, Switch, FormControlLabel,
} from '@mui/material';
import StatusBadge from '../StatusBadge';
import ProjectProgressBar from '../../projects/ProjectProgressBar';
import { PROJECT_STATUSES } from '../../../services/repositories/projectRepository';

const INTERVAL_OPTIONS_MIN = [1, 5, 10, 15, 30];

// Dashboard project rotation (Project Blueprint SPMS-DOC-05, Section 10).
// Auto-advances through a filterable project list every N minutes.
//
// FT-4.1 Correction 6: a manual project selection actually PAUSES the
// interval (it is not just visually overridden while a background timer
// keeps ticking) -- the effect's run condition includes `!manualId`, so
// picking a project clears the interval via the cleanup function below,
// and returning the Project selector to "Auto" lets it resume.
//
// Cleanup: the interval is created in a useEffect keyed on [enabled,
// manualId, intervalMinutes, filtered.length] and always cleared in the
// effect's cleanup function before any re-run and on unmount, so changing
// settings or unmounting never leaves a stale or duplicate timer running.
export default function ProjectSpotlight({ projects }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [enabled, setEnabled] = useState(true);
  const [intervalMinutes, setIntervalMinutes] = useState(5);
  const [index, setIndex] = useState(0);
  const [manualId, setManualId] = useState('');

  const filtered = useMemo(
    () => (statusFilter === 'all' ? projects : projects.filter((p) => p.status === statusFilter)),
    [projects, statusFilter]
  );

  const isRotating = enabled && !manualId;

  useEffect(() => {
    if (!isRotating || filtered.length === 0) return undefined;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % filtered.length);
    }, intervalMinutes * 60 * 1000);
    return () => clearInterval(id);
  }, [isRotating, intervalMinutes, filtered.length]);

  useEffect(() => {
    // Keep the index in range if the filtered list shrinks.
    if (index >= filtered.length) setIndex(0);
  }, [filtered.length, index]);

  const current = manualId ? projects.find((p) => p.id === manualId) : filtered[index];

  return (
    <Stack spacing={1.25} sx={{ height: '100%' }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <FormControlLabel
          control={<Switch size="small" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setManualId(''); }} />}
          label={<Typography variant="caption">{isRotating ? 'Auto rotate' : enabled && manualId ? 'Auto rotate (paused)' : 'Auto rotate'}</Typography>}
          sx={{ mr: 0 }}
        />
        <TextField
          select size="small" label="Interval" value={intervalMinutes}
          onChange={(e) => setIntervalMinutes(Number(e.target.value))}
          sx={{ width: 110 }}
        >
          {INTERVAL_OPTIONS_MIN.map((m) => <MenuItem key={m} value={m}>{m} min</MenuItem>)}
        </TextField>
      </Stack>
      <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
        <TextField
          select size="small" label="Project" value={manualId}
          onChange={(e) => setManualId(e.target.value)}
        >
          <MenuItem value="">Auto</MenuItem>
          {projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.projectName}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Filter" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <MenuItem value="all">All statuses</MenuItem>
          {PROJECT_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
        </TextField>
      </Box>

      {current ? (
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Typography variant="subtitle1" fontWeight={700} noWrap>{current.projectName}</Typography>
          <Typography variant="caption" color="text.secondary">{current.projectCode} &middot; {current.projectManager}</Typography>
          <Box sx={{ mt: 1.5 }}>
            <ProjectProgressBar value={Math.round(current.progress)} width="100%" />
          </Box>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <StatusBadge health={current.isOnSchedule ? 'green' : 'red'} label={current.scheduleStatus} />
          </Stack>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">No project matches the current filter.</Typography>
      )}
    </Stack>
  );
}
