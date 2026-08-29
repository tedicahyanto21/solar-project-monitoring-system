import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Paper, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem, Alert,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import {
  getCostTransactions, createCostTransaction, checkDuplicateTransaction, postCostTransaction, voidCostTransaction,
} from '../../../services/repositories/costRepository';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

// B2: Actual Cost input authority.
const CAN_CREATE = [ROLES.SUPER_ADMIN, ROLES.SCM, ROLES.HC, ROLES.FINANCE];
const STATUS_COLOR = { DRAFT: 'default', POSTED: 'success', VOID: 'error' };
const CATEGORIES = ['Material Purchase', 'Procurement', 'Vendor Payment', 'Accommodation', 'Transportation', 'Milestone Payment', 'Other'];

const EMPTY = { category: 'Material Purchase', description: '', amount: '', transactionDate: new Date().toISOString().slice(0, 10), referenceNumber: '', invoiceNumber: '' };

export default function CostLedgerTab({ projectId, onDataChanged }) {
  const { profile } = useAuth();
  const canCreate = CAN_CREATE.includes(profile?.role);
  const [transactions, setTransactions] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [duplicate, setDuplicate] = useState({ level: null, reasons: [] });
  const [error, setError] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [voidReason, setVoidReason] = useState('');

  function load() {
    getCostTransactions(projectId).then(setTransactions);
  }
  useEffect(load, [projectId]);

  // B8: live duplicate check as the form changes, so the warning is visible
  // BEFORE the user attempts to submit -- not just as a rejection after.
  useEffect(() => {
    if (!open || !form.amount) { setDuplicate({ level: null, reasons: [] }); return; }
    let cancelled = false;
    checkDuplicateTransaction(projectId, { ...form, amount: Number(form.amount), sourceRole: profile?.role }).then((d) => {
      if (!cancelled) setDuplicate(d);
    });
    return () => { cancelled = true; };
  }, [open, form, projectId, profile?.role]);

  async function handleCreate() {
    if (!form.description.trim() || !form.amount) return;
    setError('');
    try {
      await createCostTransaction(projectId, {
        ...form,
        amount: Number(form.amount),
        sourceRole: profile?.role,
        createdBy: profile?.displayName ?? profile?.name ?? 'Unknown',
      });
      setForm(EMPTY);
      setOpen(false);
      load();
      onDataChanged?.();
    } catch (err) {
      // B9: strong duplicates are blocked by the repository, not just
      // warned about -- this is the block taking effect.
      setError(err.message);
    }
  }

  async function handlePost(transactionId) {
    const tx = transactions.find((t) => t.transactionId === transactionId);
    if (!(profile?.role === 'SUPER_ADMIN' || tx?.sourceRole === profile?.role)) return; // defense in depth, not just a hidden button
    try {
      await postCostTransaction(projectId, transactionId, profile?.displayName ?? profile?.name);
      load();
      onDataChanged?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleVoid() {
    if (!voidReason.trim()) return;
    const tx = transactions.find((t) => t.transactionId === voidTarget);
    if (!(profile?.role === 'SUPER_ADMIN' || tx?.sourceRole === profile?.role)) return;
    await voidCostTransaction(projectId, voidTarget, { voidedBy: profile?.displayName ?? profile?.name, voidReason });
    setVoidTarget(null);
    setVoidReason('');
    load();
    onDataChanged?.();
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Actual Cost = SUM of POSTED transactions only. DRAFT and VOID never affect it.
        </Typography>
        {canCreate && (
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={() => setOpen(true)}>
            New Transaction
          </Button>
        )}
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Paper sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1.5, borderBottom: '1px solid', borderColor: 'divider', fontSize: 14 }, '& th': { color: 'text.secondary', fontSize: 12, textTransform: 'uppercase' } }}>
          <thead>
            <tr><th>Transaction ID</th><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Source</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.transactionId}>
                <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{t.transactionId}</td>
                <td>{t.transactionDate}</td>
                <td>{t.category}</td>
                <td>{t.description}</td>
                <td>{t.currency} {Number(t.amount).toLocaleString()}</td>
                <td>{t.sourceRole}</td>
                <td><Chip size="small" label={t.status} color={STATUS_COLOR[t.status]} variant="outlined" /></td>
                <td>
                  {t.status === 'DRAFT' && (profile?.role === 'SUPER_ADMIN' || t.sourceRole === profile?.role) && (
                    <Button size="small" onClick={() => handlePost(t.transactionId)}>Post</Button>
                  )}
                  {t.status === 'POSTED' && (profile?.role === 'SUPER_ADMIN' || t.sourceRole === profile?.role) && (
                    <Button size="small" color="error" onClick={() => setVoidTarget(t.transactionId)}>Void</Button>
                  )}
                  {t.status === 'VOID' && (
                    <Typography variant="caption" color="text.secondary">Reason: {t.voidReason}</Typography>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Paper>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Cost Transaction (DRAFT)</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField select label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} fullWidth>
              {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
            <TextField label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} fullWidth />
            <Stack direction="row" spacing={2}>
              <TextField label="Amount (IDR)" type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} fullWidth />
              <TextField label="Transaction Date" type="date" value={form.transactionDate} onChange={(e) => setForm((f) => ({ ...f, transactionDate: e.target.value }))} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Reference Number" value={form.referenceNumber} onChange={(e) => setForm((f) => ({ ...f, referenceNumber: e.target.value }))} fullWidth />
              <TextField label="Invoice Number" value={form.invoiceNumber} onChange={(e) => setForm((f) => ({ ...f, invoiceNumber: e.target.value }))} fullWidth />
            </Stack>
            <Typography variant="caption" color="text.secondary">Source role: {profile?.role} (recorded automatically -- cannot be changed here)</Typography>
            {duplicate.level === 'STRONG' && (
              <Alert severity="error">
                Strong duplicate detected -- this will be BLOCKED on submit.
                {duplicate.reasons.map((r) => <div key={r}>{r}</div>)}
              </Alert>
            )}
            {duplicate.level === 'POSSIBLE' && (
              <Alert severity="warning">
                Possible duplicate -- please review before posting.
                {duplicate.reasons.map((r) => <div key={r}>{r}</div>)}
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreate}>Save as Draft</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!voidTarget} onClose={() => setVoidTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Void Transaction</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            The transaction remains visible for audit -- this does not delete it.
          </Typography>
          <TextField label="Void Reason (required)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} fullWidth multiline minRows={2} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVoidTarget(null)}>Cancel</Button>
          <Button variant="contained" color="error" disabled={!voidReason.trim()} onClick={handleVoid}>Void</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
