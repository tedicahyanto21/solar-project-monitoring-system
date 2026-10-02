import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Button, Chip, Alert, Checkbox, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import { getPaymentProjections, createPaymentProjection, markPaymentProjectionPaid, getCostTransactions } from '../../../services/repositories/costRepository';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

// C-01D.1 Payment Projection Batch (locked business model, replaces the
// prior one-payment-per-projection concept entirely). A Payment Projection
// is a PAYMENT BATCH: SCM selects one or more existing, POSTED, not-yet-
// allocated Cost Transactions; the system derives the total from them
// (Section 3 -- never a manually entered amount); Finance later marks the
// whole batch PENDING -> PAID.
const CAN_CREATE = [ROLES.SUPER_ADMIN, ROLES.SCM];
const CAN_MARK_PAID = [ROLES.SUPER_ADMIN, ROLES.FINANCE];
const SETTLEMENT_EMPTY = { paidDate: new Date().toISOString().slice(0, 10), paymentReference: '' };

export default function PaymentProjectionTab({ projectId, onDataChanged }) {
  const { profile } = useAuth();
  const canCreate = CAN_CREATE.includes(profile?.role);
  const canMarkPaid = CAN_MARK_PAID.includes(profile?.role);
  const [projections, setProjections] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [createError, setCreateError] = useState('');
  const [payTarget, setPayTarget] = useState(null); // the projection being marked PAID
  const [settlementForm, setSettlementForm] = useState(SETTLEMENT_EMPTY);
  const [payError, setPayError] = useState('');

  function load() {
    getPaymentProjections(projectId).then(setProjections);
    getCostTransactions(projectId).then(setTransactions);
  }
  useEffect(load, [projectId]);

  // Section 12: a transaction is eligible only if POSTED, not itself a
  // settlement record, and not already allocated to any Payment
  // Projection (PENDING or PAID -- once paid, a Cost Transaction is
  // settled for good, never available for a second batch).
  const eligibleTransactions = transactions.filter((t) => t.status === 'POSTED' && t.transactionType !== 'PAYMENT_ONLY' && !t.projectionId);
  const selectedTotal = selectedIds.reduce((sum, id) => sum + Number(eligibleTransactions.find((t) => t.transactionId === id)?.amount || 0), 0);

  function openCreate() {
    if (!canCreate) return; // defense in depth, not just a hidden button
    setSelectedIds([]);
    setCreateError('');
    setOpen(true);
  }

  function toggleSelected(transactionId) {
    setSelectedIds((ids) => (ids.includes(transactionId) ? ids.filter((id) => id !== transactionId) : [...ids, transactionId]));
  }

  // C-01D.1: the ONLY way this component ever creates a Payment
  // Projection -- always a batch of existing transactionIds, never a
  // manually entered amount. There is no amount field anywhere in this
  // dialog; the total shown is always SUM(selected transactions' amounts).
  async function handleCreate() {
    if (selectedIds.length === 0) return;
    setCreateError('');
    try {
      await createPaymentProjection(projectId, {
        costTransactionIds: selectedIds,
        createdBy: profile?.displayName ?? profile?.name ?? 'Unknown',
      });
      setOpen(false);
      load();
      onDataChanged?.();
    } catch (err) {
      setCreateError(err.message);
    }
  }

  function openMarkPaid(projection) {
    if (!canMarkPaid) return; // defense in depth
    setPayTarget(projection);
    setSettlementForm(SETTLEMENT_EMPTY);
    setPayError('');
  }

  // C-01D.1: the ONLY way Finance ever changes a Payment Projection --
  // PENDING -> PAID plus the settlement fields the schema already
  // anticipated. Finance never touches costTransactionIds or totalAmount
  // through this form; there is no field here for either.
  async function handleMarkPaid() {
    if (!payTarget) return;
    setPayError('');
    try {
      await markPaymentProjectionPaid(projectId, payTarget.projectionId, {
        paidDate: settlementForm.paidDate,
        paymentReference: settlementForm.paymentReference,
        paidBy: profile?.displayName ?? profile?.name ?? 'Unknown',
      });
      setPayTarget(null);
      load();
      onDataChanged?.();
    } catch (err) {
      setPayError(err.message);
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          A Payment Projection is a payment batch -- SCM selects one or more POSTED Cost
          Transactions; the total is always derived from them, never entered manually. Finance
          later marks the batch PAID; these are never counted twice toward Actual Cost.
        </Typography>
        {canCreate && (
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={openCreate} sx={{ whiteSpace: 'nowrap' }}>
            Create Payment Projection
          </Button>
        )}
      </Stack>

      <Stack spacing={1.5}>
        {projections.length === 0 && (
          <Typography variant="body2" color="text.secondary">No Payment Projections created yet.</Typography>
        )}
        {projections.map((p) => (
          <Accordion key={p.projectionId} disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center', width: '100%', pr: 1 }}>
                <Chip size="small" label={p.status} color={p.status === 'PAID' ? 'success' : 'warning'} variant="outlined" />
                <Typography variant="body2" fontWeight={600}>{p.currency} {Number(p.totalAmount).toLocaleString()}</Typography>
                <Typography variant="caption" color="text.secondary">{p.costTransactionIds.length} Cost Transaction{p.costTransactionIds.length === 1 ? '' : 's'}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>Created by {p.createdBy}</Typography>
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={1.5}>
                <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1, fontSize: 13 }, '& th': { color: 'text.secondary', fontSize: 11, textTransform: 'uppercase' } }}>
                  <thead><tr><th>Transaction ID</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
                  <tbody>
                    {p.costTransactionIds.map((id) => {
                      const t = transactions.find((tx) => tx.transactionId === id);
                      return (
                        <tr key={id}>
                          <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{id}</td>
                          <td>{t?.category ?? '--'}</td>
                          <td>{t?.description ?? '--'}</td>
                          <td>{t ? `${t.currency} ${Number(t.amount).toLocaleString()}` : '--'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Box>
                {p.status === 'PAID' ? (
                  <Typography variant="caption" color="text.secondary">
                    Paid on {p.paidDate} by {p.paidBy}{p.paymentReference ? ` (ref: ${p.paymentReference})` : ''}
                  </Typography>
                ) : (
                  canMarkPaid && (
                    <Box>
                      <Button size="small" startIcon={<PaymentsRoundedIcon fontSize="small" />} onClick={() => openMarkPaid(p)}>
                        Mark as Paid
                      </Button>
                    </Box>
                  )
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create Payment Projection</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Select one or more POSTED Cost Transactions to include in this payment batch.
              Already-allocated transactions are not shown.
            </Typography>
            {eligibleTransactions.length === 0 ? (
              <Alert severity="info">No eligible Cost Transactions are available right now.</Alert>
            ) : (
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1, fontSize: 13, borderBottom: '1px solid', borderColor: 'divider' } }}>
                <tbody>
                  {eligibleTransactions.map((t) => (
                    <tr key={t.transactionId} onClick={() => toggleSelected(t.transactionId)} style={{ cursor: 'pointer' }}>
                      <td style={{ width: 40 }}><Checkbox size="small" checked={selectedIds.includes(t.transactionId)} onClick={(e) => e.stopPropagation()} onChange={() => toggleSelected(t.transactionId)} /></td>
                      <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{t.transactionId}</td>
                      <td>{t.category}</td>
                      <td>{t.description}</td>
                      <td>{t.currency} {Number(t.amount).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </Box>
            )}
            <Divider />
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2">Selected: {selectedIds.length} transaction{selectedIds.length === 1 ? '' : 's'}</Typography>
              <Typography variant="body2" fontWeight={700}>Total: IDR {selectedTotal.toLocaleString()}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              The total above is always derived from the selected transactions -- there is no
              field to enter or override it.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={selectedIds.length === 0} onClick={handleCreate}>Create</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!payTarget} onClose={() => setPayTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Mark Payment Projection as Paid</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {payError && <Alert severity="error">{payError}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Total: <strong>{payTarget?.currency} {Number(payTarget?.totalAmount).toLocaleString()}</strong> across {payTarget?.costTransactionIds?.length} Cost Transaction{payTarget?.costTransactionIds?.length === 1 ? '' : 's'}.
            </Typography>
            <TextField label="Paid Date" type="date" value={settlementForm.paidDate} onChange={(e) => setSettlementForm((f) => ({ ...f, paidDate: e.target.value }))} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="Payment Reference" value={settlementForm.paymentReference} onChange={(e) => setSettlementForm((f) => ({ ...f, paymentReference: e.target.value }))} fullWidth />
            <Typography variant="caption" color="text.secondary">
              This composition and amount cannot be changed from here -- only SCM sets which
              transactions are included, at creation.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleMarkPaid}>Mark as Paid</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
