import { useEffect, useState } from 'react';
import { Box, Stack, Typography, Paper, TextField, Button, Chip, Alert } from '@mui/material';
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

const CAN_MANAGE_CONSTRUCTION = [ROLES.SITE_MANAGER, ROLES.SUPER_ADMIN];

function ConstructionActivities({ projectId, onDataChanged }) {
  const { profile } = useAuth();
  const canManage = CAN_MANAGE_CONSTRUCTION.includes(profile?.role);
  const [activities, setActivities] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});

  function load() {
    getConstructionActivities(projectId).then(setActivities);
  }
  useEffect(load, [projectId]);

  // FT-5 A6: negative rejected, planned<=0 guarded, excess flagged (not
  // silently modified or discarded), history preserved by the repository.
  async function handleUpdate(activityId) {
    const value = drafts[activityId];
    if (value === undefined || value === '') return;
    try {
      await updateConstructionActivity(projectId, activityId, { actualQuantity: Number(value) });
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
        Quantity-based (Sprint FT-5 A6). Actual Quantity cannot be negative; excess over
        Planned Quantity is flagged, never silently modified or discarded.
      </Typography>
      <Stack spacing={2}>
        {activities.map((a) => {
          const pct = a.plannedQuantity > 0 ? Math.round((a.actualQuantity / a.plannedQuantity) * 100) : 0;
          const isExcess = a.actualQuantity > a.plannedQuantity;
          return (
            <Box key={a.id} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1.5fr 2fr' }, alignItems: 'center' }}>
              <Box>
                <Typography variant="body2" fontWeight={600}>{a.activity}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {a.actualQuantity} / {a.plannedQuantity} {a.unit} ({pct}%) &middot; weight {a.weight}%
                  {isExcess && <Chip size="small" color="warning" label="Exceeds planned quantity" sx={{ ml: 1 }} />}
                </Typography>
              </Box>
              <ProjectProgressBar value={Math.min(100, pct)} width="100%" />
              {canManage && (
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small" type="number" label="New Actual Quantity"
                    value={drafts[a.id] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
                  />
                  <Button size="small" variant="outlined" onClick={() => handleUpdate(a.id)}>Update</Button>
                </Stack>
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
