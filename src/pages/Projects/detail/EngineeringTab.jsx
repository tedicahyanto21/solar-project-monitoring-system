import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Paper, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { getEngineeringDocuments, createEngineeringDocument, updateEngineeringDocument } from '../../../services/repositories/projectDetailRepository';
import { REVIEW_STATUSES } from '../../../data/mockOperationalData';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

const STATUS_COLOR = { APPROVED: 'success', COMMENTED: 'warning', REJECTED: 'error' };
const CAN_MANAGE = [ROLES.ENGINEERING, ROLES.SUPER_ADMIN];

const EMPTY = { name: '', category: 'Engineering Drawing', weight: 10, reviewStatus: 'COMMENTED', progressContribution: 0, responsibleEngineer: '' };

export default function EngineeringTab({ projectId, onDataChanged }) {
  const { profile } = useAuth();
  const canManage = CAN_MANAGE.includes(profile?.role);
  const [docs, setDocs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  function load() {
    getEngineeringDocuments(projectId).then(setDocs);
  }
  useEffect(load, [projectId]);

  // FT-5 A3: authorized Engineering users maintain progressContribution on
  // an EXISTING document -- this is the day-to-day path, not just creation.
  async function handleContributionChange(docId, value) {
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    await updateEngineeringDocument(projectId, docId, { progressContribution: clamped });
    load();
    onDataChanged?.();
  }

  // FT-4.1 Correction 4: progressContribution comes directly from the form
  // (a separately defined, data-driven value) -- it is never derived from
  // reviewStatus via a hardcoded formula.
  async function handleCreate() {
    if (!form.name.trim()) return;
    await createEngineeringDocument(projectId, {
      docId: `ENG-${Date.now()}`,
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
            Add Document
          </Button>
        )}
      </Stack>

      <Paper sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1.5, borderBottom: '1px solid', borderColor: 'divider', fontSize: 14 }, '& th': { color: 'text.secondary', fontSize: 12, textTransform: 'uppercase' } }}>
          <thead>
            <tr><th>Doc ID</th><th>Name</th><th>Category</th><th>Weight</th><th>Review Status</th><th>Contribution</th><th>Responsible</th></tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{d.docId}</td>
                <td>{d.name}</td>
                <td>{d.category}</td>
                <td>{d.weight}%</td>
                <td><Chip size="small" label={d.reviewStatus} color={STATUS_COLOR[d.reviewStatus]} variant="outlined" /></td>
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
                <td>{d.responsibleEngineer}</td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Add Engineering Document</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Document Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth />
            <TextField label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} fullWidth />
            <TextField label="Weight" type="number" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} fullWidth />
            <TextField select label="Review Status" value={form.reviewStatus} onChange={(e) => setForm((f) => ({ ...f, reviewStatus: e.target.value }))} fullWidth>
              {REVIEW_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
            <TextField
              label="Progress Contribution"
              type="number"
              value={form.progressContribution}
              onChange={(e) => setForm((f) => ({ ...f, progressContribution: e.target.value }))}
              helperText="Set independently of Review Status -- not derived automatically."
              slotProps={{ input: { endAdornment: '%' } }}
              fullWidth
            />
            <TextField label="Responsible Engineer" value={form.responsibleEngineer} onChange={(e) => setForm((f) => ({ ...f, responsibleEngineer: e.target.value }))} fullWidth />
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
