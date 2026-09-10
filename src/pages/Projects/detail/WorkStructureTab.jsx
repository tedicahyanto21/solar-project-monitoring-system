import { useEffect, useState } from 'react';
import { Box, Stack, Typography, Paper, TextField, Alert, Button, Checkbox, FormControlLabel, Dialog, DialogTitle, DialogContent, DialogActions, MenuItem } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import {
  getMilestones, getProcurementMilestones, updateProcurementMilestone,
  getConstructionActivities, createConstructionActivity, updateConstructionActivityPlan,
} from '../../../services/repositories/projectDetailRepository';
import { setProjectWeights, isValidWeightTotal } from '../../../services/repositories/progressRepository';
import ProjectProgressBar from '../../../components/projects/ProjectProgressBar';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

// Master Prompt #1, Section 9 (Plan vs Actual ownership): progress
// component weights are PLAN-level configuration. Previously this tab had
// NO role restriction at all on editing/saving them -- any authenticated
// role that could open this tab could change them. Restricted to the
// established PLAN-owning roles (Blueprint SPMS-DOC-05 Section 5:
// PROJECT_MANAGER owns delivery; HEAD_PM/SUPER_ADMIN oversee).
const CAN_MANAGE_WEIGHTS = [ROLES.SUPER_ADMIN, ROLES.HEAD_PM, ROLES.PROJECT_MANAGER];
const CAN_MANAGE_PROCUREMENT = [ROLES.SCM, ROLES.SUPER_ADMIN];
// Master Prompt #3, Section 4: Construction PLAN (activity/plannedQuantity/
// unit/weight) is PROJECT_MANAGER territory -- Site Manager's ACTUAL entry
// happens in ProgressTab instead (Section 12: no PLAN editor duplicated
// there, no ACTUAL editor duplicated here).
const CAN_MANAGE_CONSTRUCTION_PLAN = [ROLES.SUPER_ADMIN, ROLES.PROJECT_MANAGER];
const CONSTRUCTION_PLAN_EMPTY = { activity: '', plannedQuantity: '', unit: 'units', weight: '' };

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
  const canManageWeights = CAN_MANAGE_WEIGHTS.includes(profile?.role);
  const canManageProcurement = CAN_MANAGE_PROCUREMENT.includes(profile?.role);
  const [milestones, setMilestones] = useState([]);
  const [procurementMilestones, setProcurementMilestones] = useState([]);
  const canManageConstructionPlan = CAN_MANAGE_CONSTRUCTION_PLAN.includes(profile?.role);
  const [constructionActivities, setConstructionActivities] = useState([]);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [editingActivityId, setEditingActivityId] = useState(null);
  const [planForm, setPlanForm] = useState(CONSTRUCTION_PLAN_EMPTY);
  const [planError, setPlanError] = useState('');
  const [weights, setWeights] = useState(progress?.weights ?? {});
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState('');

  function loadProcurement() {
    getProcurementMilestones(projectId).then(setProcurementMilestones);
  }

  function loadConstruction() {
    getConstructionActivities(projectId).then(setConstructionActivities);
  }

  useEffect(() => {
    let cancelled = false;
    getMilestones(projectId).then((data) => { if (!cancelled) setMilestones(data); });
    getProcurementMilestones(projectId).then((data) => { if (!cancelled) setProcurementMilestones(data); });
    getConstructionActivities(projectId).then((data) => { if (!cancelled) setConstructionActivities(data); });
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
    if (!canManageWeights) return; // defense in depth, not just disabled inputs
    setWeights((w) => ({ ...w, [key]: value === '' ? '' : Number(value) }));
    setSaved(false);
    setError('');
  }

  function handleToggleHse(checked) {
    if (!canManageWeights) return;
    setWeights((w) => {
      if (checked) return { ...w, hse: 0 };
      const { hse: _drop, ...rest } = w;
      return rest;
    });
    setSaved(false);
    setError('');
  }

  async function handleSave() {
    if (!canManageWeights) return;
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

  // Master Prompt #3, Section 4: PM PLAN capability for Construction
  // Activities. openAddActivity/openEditActivity/handleSavePlan are all
  // PLAN-only -- they never read or write actualQuantity/history, which
  // stays exclusively in ProgressTab's Site Manager entry point.
  function openAddActivity() {
    if (!canManageConstructionPlan) return; // defense in depth, not just a hidden button
    setEditingActivityId(null);
    setPlanForm(CONSTRUCTION_PLAN_EMPTY);
    setPlanError('');
    setPlanDialogOpen(true);
  }

  function openEditActivity(activity) {
    if (!canManageConstructionPlan) return;
    setEditingActivityId(activity.id);
    setPlanForm({ activity: activity.activity, plannedQuantity: activity.plannedQuantity, unit: activity.unit, weight: activity.weight });
    setPlanError('');
    setPlanDialogOpen(true);
  }

  async function handleSavePlan() {
    if (!canManageConstructionPlan) return;
    if (!planForm.activity.trim() || !planForm.plannedQuantity || !planForm.weight) return;
    setPlanError('');
    const payload = {
      activity: planForm.activity,
      plannedQuantity: Number(planForm.plannedQuantity),
      unit: planForm.unit,
      weight: Number(planForm.weight),
    };
    try {
      if (editingActivityId) {
        await updateConstructionActivityPlan(projectId, editingActivityId, payload);
      } else {
        await createConstructionActivity(projectId, payload);
      }
      setPlanDialogOpen(false);
      loadConstruction();
      onWeightsChanged?.();
    } catch (err) {
      // The repository/service layer refuses an invalid Planned Quantity
      // (must be > 0) -- this catch is defense in depth, not the only
      // place the rule is enforced.
      setPlanError(err.message);
    }
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
              disabled={!canManageWeights}
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
              disabled={!canManageWeights}
              slotProps={{ input: { endAdornment: '%' } }}
            />
          )}
        </Box>
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Checkbox size="small" checked={hseIncluded} onChange={(e) => handleToggleHse(e.target.checked)} disabled={!canManageWeights} />}
          label={
            <Typography variant="caption" color="text.secondary">
              Include HSE / Permit as a weighted Overall Progress component (otherwise it is
              monitoring-only) -- Progress Engine Design SPMS-DOC-04.
            </Typography>
          }
        />
        {canManageWeights ? (
          <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: 'center' }}>
            <Button variant="contained" size="small" disabled={!isValid || saved} onClick={handleSave}>
              Save Weights
            </Button>
            <Typography variant="body2" color={isValid ? 'text.secondary' : 'error.main'} fontWeight={isValid ? 400 : 600}>
              Total: {totalWeight}%
            </Typography>
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Total: {totalWeight}% &middot; Only Super Admin, Head PM, and the assigned Project
            Manager may change progress weights (Master Prompt #1, Section 9).
          </Typography>
        )}
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

      <Paper sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Box>
            <Typography variant="subtitle1" fontWeight={700}>Construction Activities (Plan)</Typography>
            <Typography variant="body2" color="text.secondary">
              Master Prompt #3: Activity, Planned Quantity, Unit, and Weight are
              PROJECT_MANAGER-owned PLAN fields. Actual Quantity is entered by the Site
              Manager in the Progress tab, not here.
            </Typography>
          </Box>
          {canManageConstructionPlan && (
            <Button size="small" startIcon={<AddRoundedIcon />} onClick={openAddActivity}>
              Add Activity
            </Button>
          )}
        </Stack>
        <Stack spacing={1.5}>
          {constructionActivities.length === 0 && (
            <Typography variant="body2" color="text.secondary">No construction activities defined yet.</Typography>
          )}
          {constructionActivities.map((a) => (
            <Box key={a.id} sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr 1fr 1.2fr auto' }, alignItems: 'center' }}>
              <Typography variant="body2" fontWeight={600}>{a.activity}</Typography>
              <Typography variant="caption" color="text.secondary">Planned: {a.plannedQuantity} {a.unit}</Typography>
              <Typography variant="caption" color="text.secondary">Weight: {a.weight}%</Typography>
              <Typography variant="caption" color="text.secondary">Actual: {a.actualQuantity} {a.unit} (Site Manager)</Typography>
              <ProjectProgressBar value={a.plannedQuantity > 0 ? Math.round((a.actualQuantity / a.plannedQuantity) * 100) : 0} width="100%" />
              {canManageConstructionPlan && (
                <Button size="small" onClick={() => openEditActivity(a)}>Edit Plan</Button>
              )}
            </Box>
          ))}
        </Stack>
      </Paper>

      <Dialog open={planDialogOpen} onClose={() => setPlanDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{editingActivityId ? 'Edit Construction Activity (Plan)' : 'Add Construction Activity'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {planError && <Alert severity="error">{planError}</Alert>}
            <TextField label="Activity" value={planForm.activity} onChange={(e) => setPlanForm((f) => ({ ...f, activity: e.target.value }))} fullWidth />
            <Stack direction="row" spacing={2}>
              <TextField label="Planned Quantity" type="number" value={planForm.plannedQuantity} onChange={(e) => setPlanForm((f) => ({ ...f, plannedQuantity: e.target.value }))} fullWidth />
              <TextField select label="Unit" value={planForm.unit} onChange={(e) => setPlanForm((f) => ({ ...f, unit: e.target.value }))} fullWidth>
                {['units', 'meters', 'sets', 'towers', 'panels', 'm3', 'kg'].map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField label="Weight" type="number" value={planForm.weight} onChange={(e) => setPlanForm((f) => ({ ...f, weight: e.target.value }))} slotProps={{ input: { endAdornment: '%' } }} fullWidth />
            {editingActivityId && (
              <Typography variant="caption" color="text.secondary">
                Editing PLAN only -- Actual Quantity and daily history are untouched by this
                form (Master Prompt #3, Section 4).
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlanDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSavePlan}>{editingActivityId ? 'Save Changes' : 'Add Activity'}</Button>
        </DialogActions>
      </Dialog>

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
