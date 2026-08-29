import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Paper, Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { getPaymentProjections, createPaymentProjection } from '../../../services/repositories/costRepository';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

// B2/B5: Payment Projection creation authority is narrower than Cost
// Transaction authority -- SCM and Super Admin only, not HC/Finance.
const CAN_CREATE = [ROLES.SUPER_ADMIN, ROLES.SCM];
const EMPTY = { description: '', plannedAmount: '', plannedDate: new Date().toISOString().slice(0, 10) };

export default function PaymentProjectionTab({ projectId }) {
  const { profile } = useAuth();
  const canCreate = CAN_CREATE.includes(profile?.role);
  const [projections, setProjections] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  function load() {
    getPaymentProjections(projectId).then(setProjections);
  }
  useEffect(load, [projectId]);

  async function handleCreate() {
    if (!form.description.trim() || !form.plannedAmount) return;
    await createPaymentProjection(projectId, {
      description: form.description,
      plannedAmount: Number(form.plannedAmount),
      plannedDate: form.plannedDate,
      createdBy: profile?.displayName ?? profile?.name ?? 'Unknown',
    });
    setForm(EMPTY);
    setOpen(false);
    load();
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Planned future payments -- these are never counted as Actual Cost.
        </Typography>
        {canCreate && (
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setOpen(true)}>
            New Projection
          </Button>
        )}
      </Stack>

      <Paper sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1.5, borderBottom: '1px solid', borderColor: 'divider', fontSize: 14 }, '& th': { color: 'text.secondary', fontSize: 12, textTransform: 'uppercase' } }}>
          <thead>
            <tr><th>Milestone / Description</th><th>Planned Date</th><th>Planned Amount</th><th>Status</th><th>Created By</th></tr>
          </thead>
          <tbody>
            {projections.map((p) => (
              <tr key={p.projectionId}>
                <td>{p.description}</td>
                <td>{p.plannedDate}</td>
                <td>{p.currency} {Number(p.plannedAmount).toLocaleString()}</td>
                <td>{p.status}</td>
                <td>{p.createdBy}</td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New Payment Projection</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Milestone / Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} fullWidth />
            <TextField label="Planned Amount (IDR)" type="number" value={form.plannedAmount} onChange={(e) => setForm((f) => ({ ...f, plannedAmount: e.target.value }))} fullWidth />
            <TextField label="Planned Date" type="date" value={form.plannedDate} onChange={(e) => setForm((f) => ({ ...f, plannedDate: e.target.value }))} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate}>Create</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
