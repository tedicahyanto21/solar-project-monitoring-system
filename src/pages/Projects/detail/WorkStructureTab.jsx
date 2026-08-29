import { useEffect, useState } from 'react';
import { Box, Stack, Typography, Paper, TextField, Alert, Button, Checkbox, FormControlLabel } from '@mui/material';
import { getMilestones, getProcurementMilestones, updateProcurementMilestone } from '../../../services/repositories/projectDetailRepository';
import { setProjectWeights, isValidWeightTotal } from '../../../services/repositories/progressRepository';
import ProjectProgressBar from '../../../components/projects/ProjectProgressBar';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

const CAN_MANAGE_PROCUREMENT = [ROLES.SCM, ROLES.SUPER_ADMIN];

function formatDate(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// WorkStructureTab owns the weight EDITOR UI; the actual calculation AND
// validation live in progressRepository, which this tab calls -- it never
// computes or validates progress itself (Sprint FT-4 architecture rule).
//
// FT-4.1 Correction 3: edits are a local DRAFT until explicitly saved.
// Nothing is written to the repository until the total equals exactly
// 100% (within floating-point tolerance) -- there is no silent proportional
// normalization of an invalid configuration.
//
// FT-5 A2/A4: HSE is monitoring-only by default. Checking "Include HSE"
// adds an `hse` key to the draft weights; the 100% rule then applies to
// the whole active set, HSE included.
export default function WorkStructureTab({ projectId, progress, onWeightsChanged }) {
  const { profile } = useAuth();
  const canManageProcurement = CAN_MANAGE_PROCUREMENT.includes(profile?.role);
  const [milestones, setMilestones] = useState([]);
  const [procurementMilestones, setProcurementMilestones] = useState([]);
  const [weights, setWeights] = useState(progress?.weights ?? {});
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState('');

  function loadProcurement() {
    getProcurementMilestones(projectId).then(setProcurementMilestones);
  }

  useEffect(() => {
    let cancelled = false;
    getMilestones(projectId).then((data) => { if (!cancelled) setMilestones(data); });
    getProcurementMilestones(projectId).then((data) => { if (!cancelled) setProcurementMilestones(data); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    setWeights(progress?.weights ?? {});
    setSaved(true);
    setError('');
  }, [progress]);

  const hseIncluded = 'hse' in weights;
  const totalWeight = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);
  const isValid = isValidWeightTotal(weights);

  function handleWeightChange(key, value) {
    setWeights((w) => ({ ...w, [key]: value === '' ? '' : Number(value) }));
    setSaved(false);
    setError('');
  }

  function handleToggleHse(checked) {
    setWeights((w) => {
      if (checked) return { ...w, hse: 0 };
      const { hse: _drop, ...rest } = w;
      return rest;
    });
    setSaved(false);
    setError('');
  }

  async function handleSave() {
    try {
      await setProjectWeights(projectId, weights);
      setSaved(true);
      setError('');
      onWeightsChanged?.();
    } catch (err) {
      // setProjectWeights itself refuses an invalid total -- this catch is
      // defense in depth, not the only place the rule is enforced.
      setError(err.message);
    }
  }

  async function handleMilestoneContribution(milestoneId, value) {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    const status = clamped >= 100 ? 'Completed' : clamped > 0 ? 'In Progress' : 'Not Started';
    await updateProcurementMilestone(projectId, milestoneId, {
      progressContribution: clamped,
      status,
      actualDate: clamped >= 100 ? new Date().toISOString().slice(0, 10) : null,
    });
    loadProcurement();
    onWeightsChanged?.();
  }

  return (
    <Stack spacing={3}>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Progress Component Weights</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configured per project and fed into the Progress Engine -- never hardcoded
          globally (Progress Engine Design SPMS-DOC-04, Section 4). The total must equal
          exactly 100% before it can be saved.
        </Typography>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' } }}>
          {['engineering', 'procurement', 'construction', 'commissioning'].map((key) => (
            <TextField
              key={key}
              label={key[0].toUpperCase() + key.slice(1)}
              type="number"
              size="small"
              value={weights[key] ?? ''}
              onChange={(e) => handleWeightChange(key, e.target.value)}
              slotProps={{ input: { endAdornment: '%' } }}
            />
          ))}
          {hseIncluded && (
            <TextField
              label="HSE"
              type="number"
              size="small"
              value={weights.hse ?? ''}
              onChange={(e) => handleWeightChange('hse', e.target.value)}
              slotProps={{ input: { endAdornment: '%' } }}
            />
          )}
        </Box>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox size="small" checked={hseIncluded} onChange={(e) => handleToggleHse(e.target.checked)} />}
          label={
            <Typography variant="caption" color="text.secondary">
              Include HSE / Permit as a weighted Overall Progress component (otherwise it is
              monitoring-only) -- Progress Engine Design SPMS-DOC-04.
            </Typography>
          }
        />
        <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: 'center' }}>
          <Button variant="contained" size="small" disabled={!isValid || saved} onClick={handleSave}>
            Save Weights
          </Button>
          <Typography variant="body2" color={isValid ? 'text.secondary' : 'error.main'} fontWeight={isValid ? 400 : 600}>
            Total: {totalWeight}%
          </Typography>
        </Stack>
        {!isValid && (
          <Alert severity="error" sx={{ mt: 2 }}>
            Weights must total exactly 100% (currently {totalWeight}%). This configuration
            cannot be saved or applied until corrected -- it is not normalized automatically.
          </Alert>
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {isValid && !saved && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Unsaved changes -- click Save Weights to apply.
          </Alert>
        )}
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>Procurement Milestones</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Configurable per project (Sprint FT-5 A5) -- these are not the only possible
          milestones. Progress Contribution feeds the Procurement component above.
        </Typography>
        <Stack spacing={1.5}>
          {procurementMilestones.map((m) => (
            <Box key={m.id} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr 1fr 1.5fr' }, alignItems: 'center' }}>
              <Typography variant="body2" fontWeight={600}>{m.name}</Typography>
              <Typography variant="caption" color="text.secondary">Planned: {formatDate(m.plannedDate)}</Typography>
              <Typography variant="caption" color="text.secondary">Weight: {m.weight}%</Typography>
              <Typography variant="caption" color="text.secondary">{m.status}</Typography>
              {canManageProcurement ? (
                <TextField
                  type="number" size="small" value={m.progressContribution}
                  onChange={(e) => handleMilestoneContribution(m.id, e.target.value)}
                  slotProps={{ input: { endAdornment: '%' } }}
                />
              ) : (
                <ProjectProgressBar value={m.progressContribution} width="100%" />
              )}
            </Box>
          ))}
        </Stack>
      </Paper>

      {['Engineering', 'Construction', 'Commissioning', 'COD'].map((phase) => {
        const phaseMilestones = milestones.filter((m) => m.phase === phase);
        if (phaseMilestones.length === 0) return null;
        return (
          <Paper key={phase} sx={{ p: 2.5 }}>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>{phase}</Typography>
            <Stack spacing={1.5}>
              {phaseMilestones.map((m) => (
                <Box key={m.id} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr 1fr 1.5fr' }, alignItems: 'center' }}>
                  <Typography variant="body2" fontWeight={600}>{m.name}</Typography>
                  <Typography variant="caption" color="text.secondary">Start: {formatDate(m.plannedStart)}</Typography>
                  <Typography variant="caption" color="text.secondary">Finish: {formatDate(m.plannedFinish)}</Typography>
                  <Typography variant="caption" color="text.secondary">Weight: {m.weight}%</Typography>
                  <ProjectProgressBar value={m.completion} width="100%" />
                </Box>
              ))}
            </Stack>
          </Paper>
        );
      })}
    </Stack>
  );
}
