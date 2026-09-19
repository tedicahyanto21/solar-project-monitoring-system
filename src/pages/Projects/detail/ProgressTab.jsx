import { useEffect, useState } from 'react';
import { Box, Stack, Typography, Paper, TextField, Button, Chip, Alert, Table, TableHead, TableBody, TableRow, TableCell } from '@mui/material';
import ProjectProgressBar from '../../../components/projects/ProjectProgressBar';
import CircularStat from '../../../components/dashboard/CircularStat';
import { getConstructionActivities, updateConstructionActivity } from '../../../services/repositories/projectDetailRepository';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

const DOMAINS = [
  { key: 'engineering', label: 'Engineering', basis: 'Document-based + Weight' },
  { key: 'procurement', label: 'Procurement', basis: 'Milestone-based + Weight' },
  { key: 'construction', label: 'Construction', basis: 'Quantity-based' },
  { key: 'commissioning', label: 'Commissioning', basis: 'Checklist-based + Weight' },
  { key: 'hse', label: 'HSE / Permit', basis: 'Item-based + Weight' },
];

const CAN_MANAGE_CONSTRUCTION = [ROLES.PROJECT_MANAGER, ROLES.SITE_MANAGER, ROLES.SUPER_ADMIN];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// C-01B Small Corrective: mirrors the repository/service layer's own
// latest-legacy-snapshot lookup, purely so the date input's `min` can
// steer the user away from an invalid date up front. This is a UX
// convenience only -- the actual rule is enforced independently in
// mockOperationalData.js / projectDetailService.js, which is what a
// bypassed or stale UI state would still be rejected by.
function getLatestLegacySnapshotDate(history) {
  const latest = (history || []).reduce(
    (acc, h) => (h.dailyQuantity === undefined && h.actualQuantity !== undefined && (!acc || h.date > acc) ? h.date : acc),
    null
  );
  return latest;
}

function ConstructionActivities({ projectId, onDataChanged }) {
  const { profile } = useAuth();
  // C-01B: both PROJECT_MANAGER and SITE_MANAGER may enter Daily Actual
  // (the previous implementation allowed SITE_MANAGER only). Neither role
  // gains PLAN editing capability here -- Activity/Planned Quantity/Unit/
  // Weight remain exclusively managed in Work Structure (updateConstructionActivityPlan),
  // which this component never calls.
  const canManage = CAN_MANAGE_CONSTRUCTION.includes(profile?.role);
  const [activities, setActivities] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [dateDrafts, setDateDrafts] = useState({});
  const [errors, setErrors] = useState({});
  const [expandedHistory, setExpandedHistory] = useState({});

  function load() {
    getConstructionActivities(projectId).then(setActivities);
  }
  useEffect(load, [projectId]);

  // C-01B: the user enters TODAY'S (or a chosen date's) quantity only --
  // the repository/service layer computes the resulting cumulative total
  // from history; this component never calculates cumulative itself and
  // never sends anything other than { dailyQuantity, date }.
  async function handleUpdate(activityId) {
    const value = drafts[activityId];
    if (value === undefined || value === '') return;
    const date = dateDrafts[activityId] || todayIso();
    try {
      await updateConstructionActivity(projectId, activityId, { dailyQuantity: Number(value), date });
      setErrors((e) => ({ ...e, [activityId]: null }));
      setDrafts((d) => ({ ...d, [activityId]: '' }));
      load();
      onDataChanged?.();
    } catch (err) {
      setErrors((e) => ({ ...e, [activityId]: err.message }));
    }
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Construction Activities</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Quantity-based (Sprint FT-5 A6). Enter the DAILY quantity completed for a given date --
        the system calculates the running Cumulative Actual from daily entries. Actual Quantity
        cannot be negative; a cumulative total exceeding Planned Quantity is flagged, never
        silently modified or discarded.
      </Typography>
      <Stack spacing={2}>
        {activities.map((a) => {
          const pct = a.plannedQuantity > 0 ? Math.round((a.actualQuantity / a.plannedQuantity) * 100) : 0;
          const isExcess = a.actualQuantity > a.plannedQuantity;
          const sortedHistory = [...(a.history || [])].sort((h1, h2) => (h1.date < h2.date ? 1 : -1));
          const isExpanded = !!expandedHistory[a.id];
          return (
            <Box key={a.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 2 }}>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1.5fr 2fr 1fr' }, alignItems: 'center' }}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>{a.activity}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Cumulative Actual: {a.actualQuantity} / {a.plannedQuantity} {a.unit} ({pct}%) &middot; weight {a.weight}%
                    {isExcess && <Chip size="small" color="warning" label="Exceeds planned quantity" sx={{ ml: 1 }} />}
                  </Typography>
                </Box>
                <ProjectProgressBar value={Math.min(100, pct)} width="100%" />
                {canManage && (
                  <Stack direction="row" spacing={1}>
                    <TextField
                      size="small" type="date" label="Date"
                      value={dateDrafts[a.id] ?? todayIso()}
                      onChange={(e) => setDateDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                      slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: getLatestLegacySnapshotDate(a.history) || undefined } }}
                    />
                    <TextField
                      size="small" type="number" label="Daily Actual Quantity"
                      value={drafts[a.id] ?? ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                    />
                    <Button size="small" variant="outlined" onClick={() => handleUpdate(a.id)}>Update</Button>
                  </Stack>
                )}
                <Button size="small" onClick={() => setExpandedHistory((s) => ({ ...s, [a.id]: !s[a.id] }))}>
                  {isExpanded ? 'Hide history' : 'Show history'}
                </Button>
              </Box>
              {isExpanded && (
                <Table size="small" sx={{ mt: 1.5 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Date</TableCell>
                      <TableCell align="right">Daily Actual</TableCell>
                      <TableCell align="right">Cumulative Actual</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(() => {
                      // Display-only running total, replayed oldest-first so
                      // each row's Cumulative Actual matches what the
                      // system would have shown as of that date. This is a
                      // PRESENTATION convenience over data already computed
                      // by the repository/service layer -- the
                      // authoritative cumulative (a.actualQuantity) is
                      // never recalculated here, only replayed
                      // chronologically for the table. A legacy entry (pre-
                      // C-01B, no dailyQuantity) already represents a
                      // cumulative-as-of-that-date snapshot, so it becomes
                      // the running baseline directly; only entries with a
                      // real dailyQuantity add on top of it.
                      const chronological = [...sortedHistory].reverse();
                      let running = 0;
                      const rows = chronological.map((h) => {
                        const isLegacy = h.dailyQuantity === undefined;
                        if (isLegacy) {
                          running = h.actualQuantity ?? 0;
                        } else {
                          running += h.dailyQuantity;
                        }
                        return { date: h.date, dailyDisplay: isLegacy ? '\u2014 (legacy entry)' : h.dailyQuantity, cumulativeDisplay: running };
                      });
                      return rows.slice().reverse().map((row) => (
                        <TableRow key={row.date}>
                          <TableCell>{formatDate(row.date)}</TableCell>
                          <TableCell align="right">{row.dailyDisplay}</TableCell>
                          <TableCell align="right">{row.cumulativeDisplay}</TableCell>
                        </TableRow>
                      ));
                    })()}
                  </TableBody>
                </Table>
              )}
            </Box>
          );
        })}
      </Stack>
      {Object.entries(errors).filter(([, v]) => v).map(([id, msg]) => (
        <Alert key={id} severity="error" sx={{ mt: 2 }}>{msg}</Alert>
      ))}
    </Paper>
  );
}

// Read-only by design for Overall Progress (Sprint FT-4 validation item 10:
// "Overall Progress must not be directly editable"). There is no input
// field for it anywhere -- it is always rendered from progressRepository's
// output. Weight configuration lives in WorkStructureTab, not here.
export default function ProgressTab({ progress, projectId, onDataChanged }) {
  if (!progress) return <Typography color="text.secondary">Loading progress&hellip;</Typography>;
  const activeDomains = DOMAINS.filter((d) => d.key !== 'hse' || progress.hseIsWeighted);

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' } }}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>Progress by Component</Typography>
          <Stack spacing={2.5}>
            {activeDomains.map((d) => (
              <Box key={d.key}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" fontWeight={600}>{d.label}</Typography>
                  <Typography variant="caption" color="text.secondary">{d.basis} &middot; weight {progress.weights[d.key]}%</Typography>
                </Stack>
                <ProjectProgressBar value={Math.round(progress.component[d.key])} width="100%" />
              </Box>
            ))}
            {!progress.hseIsWeighted && (
              <Box>
                <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="body2" fontWeight={600} color="text.secondary">HSE / Permit (monitoring only)</Typography>
                  <Typography variant="caption" color="text.secondary">Not included in Overall Progress</Typography>
                </Stack>
                <ProjectProgressBar value={Math.round(progress.component.hse)} width="100%" />
              </Box>
            )}
          </Stack>
        </Paper>
        <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
          <Typography variant="subtitle2" color="text.secondary">Overall Progress</Typography>
          <CircularStat size={140} strokeWidth={11} value={progress.overallProgress} caption="Weighted average" />
        </Paper>
      </Box>
      <ConstructionActivities projectId={projectId} onDataChanged={onDataChanged} />
    </Stack>
  );
}
