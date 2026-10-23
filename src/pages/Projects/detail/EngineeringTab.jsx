import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Paper, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Alert,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { getEngineeringDocuments, createEngineeringDocument, updateEngineeringDocument } from '../../../services/repositories/projectDetailRepository';
import { REVIEW_STATUSES } from '../../../data/mockOperationalData';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

const STATUS_COLOR = { APPROVED: 'success', COMMENTED: 'warning', REJECTED: 'error' };
const CAN_MANAGE = [ROLES.ENGINEERING, ROLES.SUPER_ADMIN];

const EMPTY = { docId: '', name: '', category: 'Engineering Drawing', weight: 10, reviewStatus: 'COMMENTED', progressContribution: 0, responsibleEngineer: '' };

export default function EngineeringTab({ projectId, onDataChanged }) {
  const { profile } = useAuth();
  const canManage = CAN_MANAGE.includes(profile?.role);
  const [docs, setDocs] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  // Audit identity: the display-name convention used by every other module.
  const actor = profile?.displayName ?? profile?.name ?? 'Unknown';

  function load() {
    getEngineeringDocuments(projectId).then(setDocs);
  }
  useEffect(load, [projectId]);

  // FT-5 A3: authorized Engineering users maintain progressContribution on
  // an EXISTING document -- this is the day-to-day path, not just creation.
  async function handleContributionChange(docId, value) {
    if (!canManage) return; // defense in depth, not just a hidden control
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    await updateEngineeringDocument(projectId, docId, { progressContribution: clamped }, actor);
    load();
    onDataChanged?.();
  }

  // Final UAT Patch A: authorized Engineering users (and Super Admin) change the
  // Review Status of an EXISTING document. Only reviewStatus is sent --
  // progressContribution is an independent value and is never touched here.
  // `docId` below is the INTERNAL document id, not the Document No.
  async function handleReviewStatusChange(docId, value) {
    if (!canManage) return; // defense in depth, not just a hidden control
    setError('');
    try {
      await updateEngineeringDocument(projectId, docId, { reviewStatus: value }, actor);
      load();
      onDataChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  // FT-4.1 Correction 4: progressContribution comes directly from the form
  // (a separately defined, data-driven value) -- it is never derived from
  // reviewStatus via a hardcoded formula.
  //
  // Final UAT Patch A: the Document No. (`docId`) is entered by the user -- it is
  // no longer generated. The repository trims it, requires it, and rejects a
  // number already used in this project (case-insensitive); that error is shown
  // here and the dialog stays open so it can be corrected.
  async function handleCreate() {
    if (!canManage) return; // defense in depth, not just a hidden button
    if (!form.name.trim()) return;
    if (!form.docId.trim()) { setError('Document No. is required.'); return; }
    setError('');
    try {
      await createEngineeringDocument(projectId, {
        ...form,
        weight: Number(form.weight),
        progressContribution: Number(form.progressContribution),
      });
      setForm(EMPTY);
      setOpen(false);
      load();
      onDataChanged?.();
    } catch (err) {
      setError(err.message);
    }
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

      {!open && error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Paper sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1.5, borderBottom: '1px solid', borderColor: 'divider', fontSize: 14 }, '& th': { color: 'text.secondary', fontSize: 12, textTransform: 'uppercase' } }}>
          <thead>
            <tr><th>Document No.</th><th>Name</th><th>Category</th><th>Weight</th><th>Review Status</th><th>Contribution</th><th>Responsible</th></tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id}>
                <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{d.docId || '\u2014'}</td>
                <td>{d.name}</td>
                <td>{d.category}</td>
                <td>{d.weight}%</td>
                <td>
                  {canManage ? (
                    <TextField
                      select size="small" value={d.reviewStatus ?? ''}
                      onChange={(e) => handleReviewStatusChange(d.id, e.target.value)}
                      sx={{ minWidth: 130 }}
                    >
                      {REVIEW_STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                    </TextField>
                  ) : (
                    <Chip size="small" label={d.reviewStatus} color={STATUS_COLOR[d.reviewStatus]} variant="outlined" />
                  )}
                </td>
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
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Document No." required value={form.docId}
              onChange={(e) => setForm((f) => ({ ...f, docId: e.target.value }))}
              helperText="The official document / drawing number. Must be unique in this project (upper/lower case ignored) and cannot be changed after the document is added."
              fullWidth
            />
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
          <Button onClick={() => { setOpen(false); setError(''); }}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate}>Add</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
