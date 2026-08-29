import { useState } from 'react';
import { Box, Stack, Typography, Paper, TextField, Button, Chip } from '@mui/material';
import { setPlannedCost } from '../../../services/repositories/costRepository';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

// B2: same authority as Cost Transactions for setting Planned Cost.
const CAN_EDIT = [ROLES.SUPER_ADMIN, ROLES.SCM, ROLES.HC, ROLES.FINANCE];

function formatCurrency(amount, currency) {
  return `${currency} ${Number(amount || 0).toLocaleString()}`;
}

export default function CostOverviewTab({ projectId, summary, onChanged }) {
  const { profile } = useAuth();
  const canEdit = CAN_EDIT.includes(profile?.role);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);

  async function handleSave() {
    if (!draft) return;
    await setPlannedCost(projectId, { amount: Number(draft), currency: summary.currency, updatedBy: profile?.displayName ?? profile?.name });
    setEditing(false);
    setDraft('');
    onChanged?.();
  }

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>Planned Cost</Typography>
        {editing ? (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <TextField size="small" type="number" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
            <Button size="small" variant="contained" onClick={handleSave}>Save</Button>
          </Stack>
        ) : (
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
            <Typography variant="h6" fontWeight={700}>{formatCurrency(summary.plannedCost, summary.currency)}</Typography>
            {canEdit && <Button size="small" onClick={() => { setEditing(true); setDraft(String(summary.plannedCost)); }}>Edit</Button>}
          </Stack>
        )}
      </Paper>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>Actual Cost</Typography>
        <Typography variant="h6" fontWeight={700} sx={{ mt: 0.5 }}>{formatCurrency(summary.actualCost, summary.currency)}</Typography>
        <Typography variant="caption" color="text.secondary">Sum of POSTED transactions -- not directly editable.</Typography>
      </Paper>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase' }}>Budget Status</Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mt: 0.5 }}>
          <Typography variant="h6" fontWeight={700}>{formatCurrency(Math.abs(summary.variance), summary.currency)}</Typography>
          <Chip size="small" label={summary.status} color={summary.status === 'ON_BUDGET' ? 'success' : 'error'} />
        </Stack>
        <Typography variant="caption" color="text.secondary">{summary.variance >= 0 ? 'Over' : 'Under'} planned cost</Typography>
      </Paper>
    </Box>
  );
}
