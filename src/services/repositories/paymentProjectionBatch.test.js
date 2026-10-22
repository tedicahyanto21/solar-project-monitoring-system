import { describe, it, expect, vi } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: true }));
import {
  getOperations, getPaymentProjections, createCostTransaction, postCostTransaction,
  createPaymentProjection, markPaymentProjectionPaid,
} from '../../data/mockOperationalData';
import {
  calculateActualCost, calculateProjectionTotal, getAllocatedTransactions, buildPaymentProjectionDataset,
} from './costRepository';
import { generatePaymentProjectionPdf } from '../reportPdf';
import { initialProjects } from '../../data/mockProjects';

// C-01D.1 Payment Projection batch -- tests aligned (C-01D.2 R1) with the
// approved settlement decision, "Option A" (docs/07_Decision_Log/
// Payment_Projection_PAID_Settlement_Decision.md).
//
// Canonical model these tests describe:
//   * SCM creates a payment batch by selecting one or more existing, POSTED
//     Cost Transactions; each transaction may belong to at most one active
//     batch. `CostTransaction.projectionId` is the authoritative relationship.
//   * The Payment Projection record holds metadata and settlement fields
//     only. The total (and the list of transactions) is DERIVED from the
//     allocated Cost Transactions -- it is never stored on the projection and
//     can never be set by the caller.
//   * Finance later marks the batch PENDING -> PAID, recording status,
//     paidDate, paymentReference and paidBy ON THE PROJECTION. Marking PAID
//     does NOT create a PAYMENT_ONLY settlement Cost Transaction, does not
//     touch any allocated transaction, and does not change Actual Cost.
//
// History: this file was written for the first C-01D.1 batch model, which
// stored totalAmount/costTransactionIds on the projection and generated a
// PAYMENT_ONLY settlement record on PAID. C-01D.1 R2 removed both; this file
// was not updated then, and 8 of its 16 tests failed against the canonical
// model. Each of those 8 was rewritten to assert the approved behaviour (the
// still-valid invariant behind each one is kept); the 8 that still passed are
// unchanged. The overlapping, newer coverage is in
// paymentProjectionAllocation.test.js and projectionReferenceIntegrity.test.js.
//
// Local Mode (mock store) only. Firebase-mode behaviour of markPaymentProjectionPaid
// is covered, with the Firestore SDK mocked, in
// services/firebase/costService.paymentProjection.test.js. Neither proves real
// Firestore or Firestore Rules behaviour.
const c01d1ProjectId = initialProjects[7].id; // isolated from other test files' projects
const ops = () => getOperations(c01d1ProjectId);

function postedCost(overrides = {}) {
  const tx = createCostTransaction(c01d1ProjectId, {
    transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM', ...overrides,
  });
  return postCostTransaction(c01d1ProjectId, tx.transactionId, 'SCM User');
}
// The canonical way to read a projection's total / contents: from the allocated Cost Transactions.
const derived = (pp) => ({
  total: calculateProjectionTotal(ops().costTransactions, pp.projectionId),
  ids: getAllocatedTransactions(ops().costTransactions, pp.projectionId).map((t) => t.transactionId),
});
const settlementRecords = (projectionId) => ops().costTransactions.filter((t) => t.projectionId === projectionId && t.transactionType === 'PAYMENT_ONLY');
const storedProjection = (pp) => getPaymentProjections(c01d1ProjectId).find((p) => p.projectionId === pp.projectionId);

describe('C-01D.1 Batch, Positive Test 1: SCM can create a Payment Projection with one Cost Transaction', () => {
  it('a single-CT batch is PENDING and its total and CT list are derived from the allocated transaction, not stored', () => {
    const ct = postedCost({ amount: 1000, transactionDate: '2026-11-01' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    expect(pp.status).toBe('PENDING');
    expect(derived(pp)).toEqual({ total: 1000, ids: [ct.transactionId] });
    expect('totalAmount' in pp).toBe(false);
    expect('costTransactionIds' in pp).toBe(false);
  });
});

describe('C-01D.1 Batch, Positive Test 2/3: SCM can create a Payment Projection with multiple Cost Transactions, total is exact SUM', () => {
  it('a 3-CT batch (500M + 300M + 150M) derives exactly 950,000,000, matching the spec\'s worked example', () => {
    const ctA = postedCost({ amount: 500000000, transactionDate: '2026-11-02', description: 'EPC' });
    const ctB = postedCost({ amount: 300000000, transactionDate: '2026-11-03', description: 'PV Module' });
    const ctC = postedCost({ amount: 150000000, transactionDate: '2026-11-04', description: 'Inverter' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ctA.transactionId, ctB.transactionId, ctC.transactionId], createdBy: 'SCM User' });
    const d = derived(pp);
    expect(d.total).toBe(950000000);
    expect(d.ids).toHaveLength(3);
    expect(d.ids.slice().sort()).toEqual([ctA.transactionId, ctB.transactionId, ctC.transactionId].sort());
    expect('totalAmount' in storedProjection(pp)).toBe(false);
  });
});

describe('C-01D.1 Batch, Positive Test 4: no manual amount can alter the total', () => {
  it('createPaymentProjection has no amount/totalAmount parameter at all -- passing one is ignored and never stored', () => {
    const ct = postedCost({ amount: 2000, transactionDate: '2026-11-05' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User', totalAmount: 999999999, amount: 999999999 });
    expect(derived(pp).total).toBe(2000); // the canonical calculation wins; the extraneous fields are not even read
    for (const record of [pp, storedProjection(pp)]) {
      expect('totalAmount' in record).toBe(false);
      expect('amount' in record).toBe(false);
    }
  });

  it('the total follows the canonical Cost Transaction amounts, not a copy: the projection holds nothing that can go stale', () => {
    const ct = postedCost({ amount: 12000, transactionDate: '2026-11-20' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    const recordBefore = JSON.stringify(storedProjection(pp));
    expect(derived(pp).total).toBe(12000);
    ops().costTransactions.find((t) => t.transactionId === ct.transactionId).amount = 15000; // models a persisted change of the canonical amount
    expect(derived(pp).total).toBe(15000);
    expect(JSON.stringify(storedProjection(pp))).toBe(recordBefore);
  });
});

describe('C-01D.1 Batch, Positive Test 5: selected transactions become unavailable after projection creation', () => {
  it('each allocated Cost Transaction gets a non-null projectionId matching the new batch', () => {
    const ctA = postedCost({ amount: 3000, transactionDate: '2026-11-06' });
    const ctB = postedCost({ amount: 4000, transactionDate: '2026-11-07' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ctA.transactionId, ctB.transactionId], createdBy: 'SCM User' });
    const allTx = getOperations(c01d1ProjectId).costTransactions;
    expect(allTx.find((t) => t.transactionId === ctA.transactionId).projectionId).toBe(pp.projectionId);
    expect(allTx.find((t) => t.transactionId === ctB.transactionId).projectionId).toBe(pp.projectionId);
  });
});

describe('C-01D.1 Batch, Negative Test 8: the same Cost Transaction cannot be included in a second active Payment Projection', () => {
  it('a CT already allocated to PP-1 is rejected when selected again for PP-2', () => {
    const ct = postedCost({ amount: 5000, transactionDate: '2026-11-08' });
    createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    expect(() => createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' }))
      .toThrow(`Cost Transaction "${ct.transactionId}" is already allocated to Payment Projection`);
  });

  it('listing the same Cost Transaction twice within ONE request is also rejected', () => {
    const ct = postedCost({ amount: 5100, transactionDate: '2026-11-08' });
    expect(() => createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId, ct.transactionId], createdBy: 'SCM User' }))
      .toThrow('The same Cost Transaction cannot be selected more than once in a single Payment Projection.');
  });

  it('a DRAFT (not yet POSTED) Cost Transaction is not eligible', () => {
    const draft = createCostTransaction(c01d1ProjectId, { transactionType: 'COST', category: 'Material Purchase', amount: 5200, transactionDate: '2026-11-08', sourceRole: 'SCM' });
    expect(() => createPaymentProjection(c01d1ProjectId, { costTransactionIds: [draft.transactionId], createdBy: 'SCM User' }))
      .toThrow(`Cost Transaction "${draft.transactionId}" must be POSTED before it can be included`);
  });

  it('a PAYMENT_ONLY transaction cannot itself be selected into a batch (and nothing is created or allocated)', () => {
    const base = postedCost({ amount: 5300, transactionDate: '2026-11-08' });
    // The supported way a PAYMENT_ONLY record exists: it settles an existing Cost Transaction via relatedTransactionId.
    const settle = createCostTransaction(c01d1ProjectId, { transactionType: 'PAYMENT_ONLY', relatedTransactionId: base.transactionId, category: 'Milestone Payment', amount: 5300, transactionDate: '2026-11-09', sourceRole: 'FINANCE' });
    postCostTransaction(c01d1ProjectId, settle.transactionId, 'Finance User');
    const projectionsBefore = getPaymentProjections(c01d1ProjectId).length;
    expect(() => createPaymentProjection(c01d1ProjectId, { costTransactionIds: [settle.transactionId], createdBy: 'SCM User' }))
      .toThrow(`Cost Transaction "${settle.transactionId}" is a PAYMENT_ONLY record and cannot be included in a Payment Projection.`);
    expect(getPaymentProjections(c01d1ProjectId)).toHaveLength(projectionsBefore);
    expect(ops().costTransactions.find((t) => t.transactionId === settle.transactionId).projectionId).toBeNull();
  });
});

describe('C-01D.1 Batch, Negative Test 9: partial payment is not supported -- there is no field to construct one with', () => {
  it('createPaymentProjection accepts costTransactionIds only -- the full transaction amount is always what is allocated, never a portion of it', () => {
    const ct = postedCost({ amount: 6000, transactionDate: '2026-11-10' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User', allocatedAmount: 3000 });
    expect(derived(pp).total).toBe(6000); // the full amount; the extraneous "allocatedAmount" is never read
    expect(ops().costTransactions.find((t) => t.transactionId === ct.transactionId).amount).toBe(6000);
    expect('allocatedAmount' in pp).toBe(false);
  });
});

describe('C-01D.1 Batch, Positive Test 6/7 (Option A): Finance can mark PENDING -> PAID; the projection is the audit trail and NO settlement transaction is created', () => {
  it('marking PAID records status/paidDate/paymentReference/paidBy on the projection, creates no PAYMENT_ONLY record, and leaves the whole ledger untouched', () => {
    const ct = postedCost({ amount: 7000, transactionDate: '2026-11-11' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    const ledgerBefore = JSON.stringify(ops().costTransactions);
    const paymentOnlyBefore = ops().costTransactions.filter((t) => t.transactionType === 'PAYMENT_ONLY').length;
    const paid = markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-12', paymentReference: 'TRF-9001', paidBy: 'Finance User' });
    expect(paid.status).toBe('PAID');
    expect(paid.paidDate).toBe('2026-11-12');
    expect(paid.paymentReference).toBe('TRF-9001');
    expect(paid.paidBy).toBe('Finance User');
    expect(storedProjection(pp)).toMatchObject({ status: 'PAID', paidDate: '2026-11-12', paymentReference: 'TRF-9001', paidBy: 'Finance User' });
    // Option A: no automatic settlement transaction.
    expect(settlementRecords(pp.projectionId)).toHaveLength(0);
    expect(ops().costTransactions.filter((t) => t.transactionType === 'PAYMENT_ONLY')).toHaveLength(paymentOnlyBefore);
    expect(JSON.stringify(ops().costTransactions)).toBe(ledgerBefore); // not one transaction was added, changed or removed
  });

  it('marking PAID can change only the settlement fields: composition/amount arguments are ignored and the derived total is unchanged', () => {
    const ct = postedCost({ amount: 7500, transactionDate: '2026-11-11' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    const paid = markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, {
      paidDate: '2026-11-12', paymentReference: 'TRF-9005', paidBy: 'Finance User',
      totalAmount: 1, amount: 1, costTransactionIds: ['CST-not-real'], status: 'PENDING',
    });
    expect(paid.status).toBe('PAID'); // a caller cannot set a different status
    for (const key of ['totalAmount', 'amount', 'costTransactionIds']) expect(key in paid).toBe(false);
    expect(derived(pp)).toEqual({ total: 7500, ids: [ct.transactionId] });
  });
});

describe('C-01D.1 Batch, Negative Test 15: SCM cannot mark payment PAID (no such capability exists in the repository)', () => {
  it('markPaymentProjectionPaid is the only PENDING->PAID path; there is no SCM-facing equivalent in mockOperationalData.js', async () => {
    const mod = await import('../../data/mockOperationalData');
    expect(typeof mod.markPaymentProjectionPaid).toBe('function');
    // Role gating of WHO may call it is enforced at the UI (CAN_MARK_PAID
    // in PaymentProjectionTab.jsx) and Firestore Rules layers -- the
    // repository function itself is role-agnostic, like every other
    // repository function in this codebase; this test records that there
    // is exactly one such function, not a parallel SCM-callable one.
  });

  it('a second markPaymentProjectionPaid call on an already-PAID projection is rejected regardless of caller, and the first settlement data is untouched', () => {
    const ct = postedCost({ amount: 7100, transactionDate: '2026-11-11' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-12', paymentReference: 'TRF-9002', paidBy: 'Finance User' });
    expect(() => markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-13', paymentReference: 'TRF-9003', paidBy: 'Finance User' }))
      .toThrow('Only a PENDING Payment Projection can be marked PAID (current status: PAID).');
    expect(storedProjection(pp)).toMatchObject({ status: 'PAID', paidDate: '2026-11-12', paymentReference: 'TRF-9002' }); // the rejected call changed nothing
    expect(settlementRecords(pp.projectionId)).toHaveLength(0);
  });
});

describe('C-01D.1 Batch: invalid PAID transitions are handled by the existing rules', () => {
  it('an unknown projection, or an unknown project, returns null and changes nothing', () => {
    const ledgerBefore = JSON.stringify(ops().costTransactions);
    const projectionsBefore = JSON.stringify(getPaymentProjections(c01d1ProjectId));
    expect(markPaymentProjectionPaid(c01d1ProjectId, 'no-such-projection', { paidDate: '2026-11-12', paymentReference: 'X', paidBy: 'F' })).toBeNull();
    expect(markPaymentProjectionPaid('no-such-project', 'no-such-projection', { paidDate: '2026-11-12', paymentReference: 'X', paidBy: 'F' })).toBeNull();
    expect(JSON.stringify(ops().costTransactions)).toBe(ledgerBefore);
    expect(JSON.stringify(getPaymentProjections(c01d1ProjectId))).toBe(projectionsBefore);
  });

  it('a legacy plan record (not a PENDING batch) cannot be marked PAID', () => {
    ops().paymentProjections.unshift({ projectionId: 'legacy-plan-batchtest', projectId: c01d1ProjectId, status: 'PLANNED', plannedAmount: 123 });
    expect(() => markPaymentProjectionPaid(c01d1ProjectId, 'legacy-plan-batchtest', { paidDate: '2026-11-12', paymentReference: 'X', paidBy: 'F' }))
      .toThrow('Only a PENDING Payment Projection can be marked PAID (current status: PLANNED).');
  });
});

describe('C-01D.1 Batch, Negative Test 14: no arbitrary PAYMENT_ONLY transaction, and no pre-allocated transaction, can be created', () => {
  it('a PAYMENT_ONLY transaction with a fabricated projectionId is rejected, with or without a relatedTransactionId, and so is a COST one; nothing is created', () => {
    const base = postedCost({ amount: 7300, transactionDate: '2026-11-11' });
    const ledgerBefore = JSON.stringify(ops().costTransactions);
    // (a) no relatedTransactionId: a PAYMENT_ONLY record must settle an existing transaction
    expect(() => createCostTransaction(c01d1ProjectId, { transactionType: 'PAYMENT_ONLY', projectionId: 'does-not-exist-anywhere', amount: 100, transactionDate: '2026-11-11', sourceRole: 'FINANCE' }))
      .toThrow('A PAYMENT_ONLY transaction must reference the existing Cost Transaction it settles (relatedTransactionId).');
    // (b) valid relatedTransactionId + fabricated projectionId: a new transaction can never be created already allocated
    expect(() => createCostTransaction(c01d1ProjectId, { transactionType: 'PAYMENT_ONLY', relatedTransactionId: base.transactionId, projectionId: 'does-not-exist-anywhere', amount: 100, transactionDate: '2026-11-11', sourceRole: 'FINANCE' }))
      .toThrow('A new Cost Transaction cannot be created already allocated to a Payment Projection (projectionId must be empty).');
    // (c) an ordinary COST transaction with a fabricated projectionId
    expect(() => createCostTransaction(c01d1ProjectId, { transactionType: 'COST', category: 'Material Purchase', projectionId: 'does-not-exist-anywhere', amount: 100, transactionDate: '2026-11-11', sourceRole: 'SCM' }))
      .toThrow('A new Cost Transaction cannot be created already allocated to a Payment Projection (projectionId must be empty).');
    expect(JSON.stringify(ops().costTransactions)).toBe(ledgerBefore);
  });

  it('selecting an id that does not exist is rejected (an unsupported/fabricated reference can never be allocated)', () => {
    const projectionsBefore = getPaymentProjections(c01d1ProjectId).length;
    expect(() => createPaymentProjection(c01d1ProjectId, { costTransactionIds: ['CST-9999-999999'], createdBy: 'SCM User' })).toThrow(/not found/);
    expect(getPaymentProjections(c01d1ProjectId)).toHaveLength(projectionsBefore);
  });

  it('the original HC/SCM relatedTransactionId use case remains completely unaffected by this change', () => {
    const original = postedCost({ amount: 7200, transactionDate: '2026-11-11' });
    const settlement = createCostTransaction(c01d1ProjectId, { transactionType: 'PAYMENT_ONLY', relatedTransactionId: original.transactionId, amount: 7200, transactionDate: '2026-11-12', sourceRole: 'FINANCE' });
    expect(settlement.relatedTransactionId).toBe(original.transactionId);
    expect(settlement.projectionId).toBeNull();
  });
});

describe('C-01D.1 Batch, Regression Test 16/17 (Option A): Actual Cost is unchanged by allocation and by PAID; PAYMENT_ONLY remains excluded', () => {
  it('a PAID batch\'s original Cost Transactions count exactly once toward Actual Cost; becoming PAID adds nothing (there is no settlement record to add)', () => {
    const ctA = postedCost({ amount: 8000, transactionDate: '2026-11-13' });
    const ctB = postedCost({ amount: 9000, transactionDate: '2026-11-14' });
    const own = () => ops().costTransactions.filter((t) => [ctA.transactionId, ctB.transactionId].includes(t.transactionId));
    expect(calculateActualCost(own())).toBe(17000);
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ctA.transactionId, ctB.transactionId], createdBy: 'SCM User' });
    expect(calculateActualCost(own())).toBe(17000); // allocation alone changes nothing
    markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-15', paymentReference: 'TRF-9004', paidBy: 'Finance User' });
    expect(own()).toHaveLength(2);
    expect(settlementRecords(pp.projectionId)).toHaveLength(0);
    expect(calculateActualCost(own())).toBe(17000); // PAID adds nothing: not 17000 + 17000
    expect(calculateActualCost(ops().costTransactions.filter((t) => t.projectionId === pp.projectionId))).toBe(17000);
    expect(derived(pp).total).toBe(17000);
  });

  it('an existing PAYMENT_ONLY record (the supported relatedTransactionId path) is still excluded from Actual Cost', () => {
    const base = postedCost({ amount: 9100, transactionDate: '2026-11-16' });
    const settle = createCostTransaction(c01d1ProjectId, { transactionType: 'PAYMENT_ONLY', relatedTransactionId: base.transactionId, category: 'Milestone Payment', amount: 9100, transactionDate: '2026-11-17', sourceRole: 'FINANCE' });
    postCostTransaction(c01d1ProjectId, settle.transactionId, 'Finance User');
    const both = ops().costTransactions.filter((t) => [base.transactionId, settle.transactionId].includes(t.transactionId));
    expect(both).toHaveLength(2);
    expect(calculateActualCost(both)).toBe(9100); // counted once, not 18200
  });
});

describe('C-01D.2 R1: exporting a PAID projection to PDF stays read-only and consistent with Option A', () => {
  it('the PDF dataset of a PAID projection carries the derived total and the paid metadata, and neither building nor laying it out creates a settlement or changes the ledger', async () => {
    const ct = postedCost({ amount: 21000, transactionDate: '2026-11-18' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-19', paymentReference: 'TRF-9006', paidBy: 'Finance User' });
    const snapshot = JSON.stringify({ tx: ops().costTransactions, pp: getPaymentProjections(c01d1ProjectId) });
    const dataset = await buildPaymentProjectionDataset(c01d1ProjectId, pp.projectionId);
    const doc = generatePaymentProjectionPdf(dataset);
    expect(dataset.summary.total).toBe(derived(pp).total);
    expect(dataset.projection).toMatchObject({ status: 'PAID', paidDate: '2026-11-19', paymentReference: 'TRF-9006', paidBy: 'Finance User' });
    expect(doc.getNumberOfPages()).toBeGreaterThan(0);
    expect(settlementRecords(pp.projectionId)).toHaveLength(0);
    expect(JSON.stringify({ tx: ops().costTransactions, pp: getPaymentProjections(c01d1ProjectId) })).toBe(snapshot);
  });
});

describe('C-01D.1 Batch, Regression Test 22: Progress Engine is untouched', () => {
  it('calculateConstructionProgress is unaffected by anything in this file -- spot check the formula is still exactly as before', async () => {
    const { calculateConstructionProgress } = await import('./progressRepository');
    expect(calculateConstructionProgress([{ plannedQuantity: 500, actualQuantity: 250, weight: 100 }])).toBe(50);
  });
});
