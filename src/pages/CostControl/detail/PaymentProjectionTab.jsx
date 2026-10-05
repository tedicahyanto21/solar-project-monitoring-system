import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Button, Chip, Alert, Checkbox, Divider,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import {
  getPaymentProjections, createPaymentProjection, markPaymentProjectionPaid, getCostTransactions,
  isEligibleForPayment, getAllocatedTransactions, calculateProjectionTotal,
} from '../../../services/repositories/costRepository';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

// C-01D.1 R2 -- Authoritative Cost Transaction allocation.
// A Payment Projection is ONE payment batch: metadata + settlement only.
// Which Cost Transactions belong to it, and the batch total, are DERIVED
// here from `CostTransaction.projectionId` (the authoritative relationship)
// -- nothing about composition or amount is typed in or read from the
// projection document itself.
const CAN_CREATE = [ROLES.SUPER_ADMIN, ROLES.SCM];
const CAN_MARK_PAID = [ROLES.SUPER_ADMIN, ROLES.FINANCE];
const SETTLEMENT_EMPTY = { paidDate: new Date().toISOString().slice(0, 10), paymentReference: '' };
const BATCH_STATUSES = ['PENDING', 'PAID'];

export default function PaymentProjectionTab({ projectId, onDataChanged }) {
  const { profile } = useAuth();
  const canCreate = CAN_CREATE.includes(profile?.role);
  const canMarkPaid = CAN_MARK_PAID.includes(profile?.role);
  const [projections, setProjections] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [createError, setCreateError] = useState('');
  const [payTarget, setPayTarget] = useState(null);
  const [settlementForm, setSettlementForm] = useState(SETTLEMENT_EMPTY);
  const [payError, setPayError] = useState('');

  function load() {
    getPaymentProjections(projectId).then(setProjections);
    getCostTransactions(projectId).then(setTransactions);
  }
  useEffect(load, [projectId]);

  // Eligible: POSTED, not PAYMENT_ONLY, not yet allocated (a legacy
  // transaction with no projectionId field counts as unallocated).
  const eligibleTransactions = transactions.filter(isEligibleForPayment);
  const selectedTotal = selectedIds.reduce(
    (sum, id) => sum + Number(eligibleTransactions.find((t) => t.transactionId === id)?.amount || 0), 0,
  );

  function openCreate() {
    if (!canCreate) return; // defense in depth, not just a hidden button
    setSelectedIds([]);
    setCreateError('');
    setOpen(true);
  }

  function toggleSelected(transactionId) {
    setSelectedIds((ids) => (ids.includes(transactionId) ? ids.filter((id) => id !== transactionId) : [...ids, transactionId]));
  }

  // There is no amount field anywhere in this flow: the dialog total below
  // is SUM(selected transactions' amounts), and the repository call receives
  // only the selection.
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

  // Finance's only action: PENDING -> PAID with settlement information.
  // No field here touches composition or amount.
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

  const payTargetItems = payTarget ? getAllocatedTransactions(transactions, payTarget.projectionId) : [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          A Payment Projection is a payment batch. SCM selects one or more POSTED Cost
          Transactions; the batch's contents and total are derived from them, never typed in.
          Finance later marks the batch PAID. Allocated transactions are frozen.
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
        {projections.map((p) => {
          const isBatch = BATCH_STATUSES.includes(p.status);
          const items = getAllocatedTransactions(transactions, p.projectionId);
          const total = calculateProjectionTotal(transactions, p.projectionId);
          return (
            <Accordion key={p.projectionId} disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', width: '100%', pr: 1 }}>
                  <Chip size="small" label={isBatch ? p.status : 'LEGACY PLAN'} color={p.status === 'PAID' ? 'success' : isBatch ? 'warning' : 'default'} variant="outlined" />
                  {isBatch || items.length > 0 ? (
                    <>
                      <Typography variant="body2" fontWeight={600}>{p.currency ?? 'IDR'} {total.toLocaleString()}</Typography>
                      <Typography variant="caption" color="text.secondary">{items.length} Cost Transaction{items.length === 1 ? '' : 's'}</Typography>
                    </>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {p.description ?? 'Legacy planned payment'}{p.plannedAmount != null ? ` -- planned ${p.currency ?? 'IDR'} ${Number(p.plannedAmount).toLocaleString()}` : ''}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>Created by {p.createdBy}</Typography>
                </Stack>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  {!isBatch && items.length === 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      Legacy record kept for history. It predates payment batches and is not part of the
                      allocation workflow; it cannot be marked PAID.
                    </Typography>
                  ) : (
                    <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1, fontSize: 13 }, '& th': { color: 'text.secondary', fontSize: 11, textTransform: 'uppercase' } }}>
                      <thead><tr><th>Transaction ID</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead>
                      <tbody>
                        {items.map((t) => (
                          <tr key={t.transactionId}>
                            <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{t.transactionId}</td>
                            <td>{t.category}</td>
                            <td>{t.description}</td>
                            <td>{t.currency} {Number(t.amount).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Box>
                  )}
                  {p.status === 'PAID' && (
                    <Typography variant="caption" color="text.secondary">
                      Paid on {p.paidDate} by {p.paidBy}{p.paymentReference ? ` (ref: ${p.paymentReference})` : ''}
                    </Typography>
                  )}
                  {p.status === 'PENDING' && canMarkPaid && (
                    <Box>
                      <Button size="small" startIcon={<PaymentsRoundedIcon fontSize="small" />} onClick={() => openMarkPaid(p)}>
                        Mark as Paid
                      </Button>
                    </Box>
                  )}
                </Stack>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Stack>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Create Payment Projection</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {createError && <Alert severity="error">{createError}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Select one or more POSTED Cost Transactions for this payment batch. Transactions
              already allocated to a batch are not shown. They become frozen once allocated.
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
              The total is derived from the selected transactions -- there is no field to enter or
              override it.
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
              Derived total: <strong>{payTarget?.currency ?? 'IDR'} {payTarget ? calculateProjectionTotal(transactions, payTarget.projectionId).toLocaleString() : 0}</strong> across {payTargetItems.length} Cost Transaction{payTargetItems.length === 1 ? '' : 's'}.
            </Typography>
            <TextField label="Paid Date" type="date" value={settlementForm.paidDate} onChange={(e) => setSettlementForm((f) => ({ ...f, paidDate: e.target.value }))} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            <TextField label="Payment Reference" value={settlementForm.paymentReference} onChange={(e) => setSettlementForm((f) => ({ ...f, paymentReference: e.target.value }))} fullWidth />
            <Typography variant="caption" color="text.secondary">
              Composition and amount cannot be changed from here.
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
