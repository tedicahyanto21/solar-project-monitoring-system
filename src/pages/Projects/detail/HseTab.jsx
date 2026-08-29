import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Paper, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { getHseDocuments, createHseDocument, updateHseDocument } from '../../../services/repositories/projectDetailRepository';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

const CAN_MANAGE = [ROLES.HSE, ROLES.SUPER_ADMIN];
const EMPTY = { name: '', category: 'Permit', weight: 10, status: 'Pending', progressContribution: 0, responsibleHse: '' };

export default function HseTab({ projectId, onDataChanged }) {
  const { profile } = useAuth();
  const canManage = CAN_MANAGE.includes(profile?.role);
  const [docs, setDocs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  function load() {
    getHseDocuments(projectId).then(setDocs);
  }
  useEffect(load, [projectId]);

  // FT-5 A4: authorized HSE users maintain progressContribution on an
  // EXISTING item, independent of status.
  async function handleContributionChange(docId, value) {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    await updateHseDocument(projectId, docId, { progressContribution: clamped });
    load();
    onDataChanged?.();
  }

  // FT-4.1 Correction 5: Status and Progress Contribution are separate --
  // no "Valid/Closed = 100%, else = 0%" rule. Contribution comes directly
  // from the form.
  async function handleCreate() {
    if (!form.name.trim()) return;
    await createHseDocument(projectId, {
      ...form,
      weight: Number(form.weight),
      progressContribution: Number(form.progressContribution),
    });
    setForm(EMPTY);
    setOpen(false);
    load();
    onDataChanged?.();
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No physical file upload in SPMS v1.0 -- status and weight tracking only.
        </Typography>
        {canManage && (
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setOpen(true)}>
            Add Item
          </Button>
        )}
      </Stack>

      <Paper sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1.5, borderBottom: '1px solid', borderColor: 'divider', fontSize: 14 }, '& th': { color: 'text.secondary', fontSize: 12, textTransform: 'uppercase' } }}>
          <thead>
            <tr><th>Item</th><th>Category</th><th>Weight</th><th>Status</th><th>Contribution</th><th>Responsible</th></tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td>{d.name}</td>
                <td>{d.category}</td>
                <td>{d.weight}%</td>
                <td><Chip size="small" label={d.status} color={d.status === 'Valid / Closed' ? 'success' : 'warning'} variant="outlined" /></td>
                <td>
                  {canManage ? (
                    <TextField
                      type="number" size="small" value={d.progressContribution}
                      onChange={(e) => handleContributionChange(d.id, e.target.value)}
                      slotProps={{ input: { endAdornment: '%' } }}
                      sx={{ width: 100 }}
                    />
                  ) : `${d.progressContribution}%`}
                </td>
                <td>{d.responsibleHse}</td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add HSE / Permit Item</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Item Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth />
            <TextField label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} fullWidth />
            <TextField label="Weight" type="number" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} fullWidth />
            <TextField
              label="Progress Contribution"
              type="number"
              value={form.progressContribution}
              onChange={(e) => setForm((f) => ({ ...f, progressContribution: e.target.value }))}
              helperText="Set independently of Status -- not derived automatically."
              slotProps={{ input: { endAdornment: '%' } }}
              fullWidth
            />
            <TextField label="Responsible HSE" value={form.responsibleHse} onChange={(e) => setForm((f) => ({ ...f, responsibleHse: e.target.value }))} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate}>Add</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
