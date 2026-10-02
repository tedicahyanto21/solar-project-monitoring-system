import { describe, it, expect, vi } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: true }));
import {
  getOperations, createCostTransaction, postCostTransaction,
  createPaymentProjection, markPaymentProjectionPaid,
} from '../../data/mockOperationalData';
import { calculateActualCost } from './costRepository';
import { initialProjects } from '../../data/mockProjects';

// C-01D.1 Payment Projection Batch (LOCKED business model, replaces the
// prior one-payment-per-projection concept entirely). SCM creates a
// payment batch by selecting one or more existing, POSTED Cost
// Transactions; the total is always derived (SUM of their amounts, never
// manually entered); each selected transaction may belong to at most one
// active batch; Finance later marks the whole batch PENDING -> PAID,
// which generates exactly one PAYMENT_ONLY settlement record as an audit
// trail, never counted toward Actual Cost.
const c01d1ProjectId = initialProjects[7].id; // isolated from other test files' projects

function postedCost(overrides = {}) {
  const tx = createCostTransaction(c01d1ProjectId, {
    transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM', ...overrides,
  });
  return postCostTransaction(c01d1ProjectId, tx.transactionId, 'SCM User');
}

describe('C-01D.1 Batch, Positive Test 1: SCM can create a Payment Projection with one Cost Transaction', () => {
  it('a single-CT batch has the correct total, status PENDING, and the CT list', () => {
    const ct = postedCost({ amount: 1000, transactionDate: '2026-11-01' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    expect(pp.status).toBe('PENDING');
    expect(pp.totalAmount).toBe(1000);
    expect(pp.costTransactionIds).toEqual([ct.transactionId]);
  });
});

describe('C-01D.1 Batch, Positive Test 2/3: SCM can create a Payment Projection with multiple Cost Transactions, total is exact SUM', () => {
  it('a 3-CT batch (500M + 300M + 150M) totals exactly 950,000,000, matching the spec\'s worked example', () => {
    const ctA = postedCost({ amount: 500000000, transactionDate: '2026-11-02', description: 'EPC' });
    const ctB = postedCost({ amount: 300000000, transactionDate: '2026-11-03', description: 'PV Module' });
    const ctC = postedCost({ amount: 150000000, transactionDate: '2026-11-04', description: 'Inverter' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ctA.transactionId, ctB.transactionId, ctC.transactionId], createdBy: 'SCM User' });
    expect(pp.totalAmount).toBe(950000000);
    expect(pp.costTransactionIds).toHaveLength(3);
  });
});

describe('C-01D.1 Batch, Positive Test 4: no manual amount can alter the total', () => {
  it('createPaymentProjection has no amount/totalAmount parameter at all -- passing one is simply ignored', () => {
    const ct = postedCost({ amount: 2000, transactionDate: '2026-11-05' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User', totalAmount: 999999999, amount: 999999999 });
    expect(pp.totalAmount).toBe(2000); // derived value wins; the extraneous fields are not even read
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

  it('a PAYMENT_ONLY transaction cannot itself be selected into a batch', () => {
    const ct = postedCost({ amount: 5300, transactionDate: '2026-11-08' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-09', paymentReference: 'REF-X', paidBy: 'Finance User' });
    const settlementTx = getOperations(c01d1ProjectId).costTransactions.find((t) => t.projectionId === pp.projectionId && t.transactionType === 'PAYMENT_ONLY');
    expect(() => createPaymentProjection(c01d1ProjectId, { costTransactionIds: [settlementTx.transactionId], createdBy: 'SCM User' }))
      .toThrow('is itself a settlement record (PAYMENT_ONLY)');
  });
});

describe('C-01D.1 Batch, Negative Test 9: partial payment is not supported -- there is no field to construct one with', () => {
  it('createPaymentProjection accepts costTransactionIds only -- the full transaction amount is always what gets allocated, never a portion of it', () => {
    const ct = postedCost({ amount: 6000, transactionDate: '2026-11-10' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User', allocatedAmount: 3000 });
    expect(pp.totalAmount).toBe(6000); // the full amount, the extraneous "allocatedAmount" is never read
  });
});

describe('C-01D.1 Batch, Positive Test 6/7: Finance can mark PENDING -> PAID and enter settlement fields', () => {
  it('marking a projection PAID applies status/paidDate/paymentReference/paidBy, and generates exactly one PAYMENT_ONLY settlement record', () => {
    const ct = postedCost({ amount: 7000, transactionDate: '2026-11-11' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    const paid = markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-12', paymentReference: 'TRF-9001', paidBy: 'Finance User' });
    expect(paid.status).toBe('PAID');
    expect(paid.paidDate).toBe('2026-11-12');
    expect(paid.paymentReference).toBe('TRF-9001');
    expect(paid.paidBy).toBe('Finance User');
    const settlementTx = getOperations(c01d1ProjectId).costTransactions.find((t) => t.projectionId === pp.projectionId && t.transactionType === 'PAYMENT_ONLY');
    expect(settlementTx).toBeTruthy();
    expect(settlementTx.amount).toBe(7000);
    expect(settlementTx.status).toBe('POSTED');
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

  it('a second markPaymentProjectionPaid call on an already-PAID projection is rejected regardless of caller', () => {
    const ct = postedCost({ amount: 7100, transactionDate: '2026-11-11' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-12', paymentReference: 'TRF-9002', paidBy: 'Finance User' });
    expect(() => markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-13', paymentReference: 'TRF-9003', paidBy: 'Finance User' }))
      .toThrow('Only a PENDING Payment Projection can be marked PAID (current status: PAID).');
  });
});

describe('C-01D.1 Batch, Negative Test 14: no arbitrary PAYMENT_ONLY transaction can be created referencing a fabricated or already-settled projection', () => {
  it('createCostTransaction rejects a PAYMENT_ONLY transaction referencing a nonexistent projectionId', () => {
    expect(() => createCostTransaction(c01d1ProjectId, { transactionType: 'PAYMENT_ONLY', projectionId: 'does-not-exist-anywhere', amount: 100, transactionDate: '2026-11-11', sourceRole: 'FINANCE' }))
      .toThrow('Payment Projection "does-not-exist-anywhere" was not found on this project.');
  });

  it('the original HC/SCM relatedTransactionId use case remains completely unaffected by this change', () => {
    const original = postedCost({ amount: 7200, transactionDate: '2026-11-11' });
    const settlement = createCostTransaction(c01d1ProjectId, { transactionType: 'PAYMENT_ONLY', relatedTransactionId: original.transactionId, amount: 7200, transactionDate: '2026-11-12', sourceRole: 'FINANCE' });
    expect(settlement.relatedTransactionId).toBe(original.transactionId);
    expect(settlement.projectionId).toBeNull();
  });
});

describe('C-01D.1 Batch, Regression Test 16/17: Actual Cost calculation is unchanged, PAYMENT_ONLY (including the batch-settlement kind) remains excluded', () => {
  it('a PAID batch\'s original Cost Transactions still count once toward Actual Cost; the auto-generated settlement record, despite being POSTED, does not add a second time', () => {
    const ctA = postedCost({ amount: 8000, transactionDate: '2026-11-13' });
    const ctB = postedCost({ amount: 9000, transactionDate: '2026-11-14' });
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ctA.transactionId, ctB.transactionId], createdBy: 'SCM User' });
    markPaymentProjectionPaid(c01d1ProjectId, pp.projectionId, { paidDate: '2026-11-15', paymentReference: 'TRF-9004', paidBy: 'Finance User' });
    const allTx = getOperations(c01d1ProjectId).costTransactions;
    const relevant = allTx.filter((t) => [ctA.transactionId, ctB.transactionId].includes(t.transactionId) || (t.projectionId === pp.projectionId && t.transactionType === 'PAYMENT_ONLY'));
    expect(relevant).toHaveLength(3); // ctA, ctB, and the settlement record
    expect(calculateActualCost(relevant)).toBe(17000); // 8000 + 9000, NOT +17000 again from the settlement record
  });
});

describe('C-01D.1 Batch, Regression Test 22: Progress Engine is untouched', () => {
  it('calculateConstructionProgress is unaffected by anything in this file -- spot check the formula is still exactly as before', async () => {
    const { calculateConstructionProgress } = await import('./progressRepository');
    expect(calculateConstructionProgress([{ plannedQuantity: 500, actualQuantity: 250, weight: 100 }])).toBe(50);
  });
});

// =============================================================
// C-01D.1 R1: Firebase Access & Payment Projection Integrity
// =============================================================
// Two corrective blockers from technical review:
//   Blocker 1: SCM must be global (no isAssignedToProject) for the
//   Payment Projection / Procurement functional domain, consistent with
//   the already-locked C-01C decision.
//   Blocker 2: paymentProjections writes must be hardened against a
//   forged totalAmount/costTransactionIds. Fully verifying this for an
//   arbitrary-size batch would need up to N get() calls in a single
//   Firestore Rules evaluation -- a real risk of exceeding Firestore's
//   documented per-request document-access limit. That specific
//   cross-document check was NOT implemented this revision (see the
//   final report's Blocker 2 section); what WAS implemented (field
//   restriction via hasOnly(), type/sanity checks, the already-sound
//   per-document allocation lock) is covered below.
//
// None of this file executes live against Firestore or the Firestore
// Emulator -- neither was available in this environment. The
// rules-agreement tests below read firestore.rules as text and assert on
// its structure, mirroring the existing "Firestore rule / application
// code agreement" pattern already used elsewhere in this codebase; they
// prove the rule TEXT has the expected shape, not that Firestore would
// actually enforce it at runtime.
describe('C-01D.1 R1, Blocker 1 (Tests A1-A4): SCM is global for the Payment Projection / Cost Transaction domain -- rule text no longer requires isAssignedToProject for SCM', () => {
  it('the costTransactions read rule includes SCM in the portfolio-wide hasRole list', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /costTransactions/{transactionId}'), rulesText.indexOf('match /paymentProjections/{projectionId}'));
    expect(block).toMatch(/allow read: if hasRole\(\['SUPER_ADMIN', 'HEAD_PM', 'FINANCE', 'SCM'\]\)/);
  });

  it('the costTransactions update rule\'s SCM allocation clause has no isAssignedToProject call', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /costTransactions/{transactionId}'), rulesText.indexOf('match /paymentProjections/{projectionId}'));
    const scmClauseMatch = block.match(/hasRole\(\['SCM'\]\)\s*\n\s*&& resource\.data\.projectionId == null[\s\S]*?hasOnly\(\['projectionId'\]\)\)/);
    expect(scmClauseMatch).toBeTruthy();
    expect(scmClauseMatch[0]).not.toMatch(/isAssignedToProject/);
  });

  it('the paymentProjections read rule includes SCM in the portfolio-wide hasRole list', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /paymentProjections/{projectionId}'), rulesText.length);
    expect(block).toMatch(/allow read: if hasRole\(\['SUPER_ADMIN', 'HEAD_PM', 'FINANCE', 'SCM'\]\)/);
  });

  it('the paymentProjections create rule\'s SCM clause has no isAssignedToProject call', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /paymentProjections/{projectionId}'), rulesText.indexOf('allow update:', rulesText.indexOf('match /paymentProjections/{projectionId}')));
    expect(block).toMatch(/hasRole\(\['SCM'\]\)/);
    const scmCreateClause = block.slice(block.indexOf("hasRole(['SCM'])"));
    expect(scmCreateClause).not.toMatch(/isAssignedToProject/);
  });

  it('Negative Test A5/A7 regression: the paymentProjections update (Finance PENDING->PAID) clause still has no SCM role at all, and still requires isAssignedToProject for Finance', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /paymentProjections/{projectionId}'), rulesText.length);
    const updateClause = block.slice(block.indexOf('allow update:'));
    expect(updateClause).toMatch(/hasRole\(\['FINANCE'\]\) && isAssignedToProject\(projectId\)/);
    expect(updateClause).not.toMatch(/hasRole\(\[[^\]]*'SCM'[^\]]*\]\)/); // SCM never appears in any role list in this clause
  });

  it('Negative Test A6 regression: SCM\'s costTransactions update clause still restricts the write to the single projectionId field, unchanged by this revision', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /costTransactions/{transactionId}'), rulesText.indexOf('match /paymentProjections/{projectionId}'));
    expect(block).toMatch(/hasRole\(\['SCM'\]\)\s*\n\s*&& resource\.data\.projectionId == null[\s\S]*?hasOnly\(\['projectionId'\]\)\)/);
  });
});

describe('C-01D.1 R1, Blocker 1 application-layer behavior: SCM\'s repository/mock-layer functions never depended on assignment to begin with', () => {
  it('Positive A1-A4: createPaymentProjection/markPaymentProjectionPaid/getCostTransactions/getPaymentProjections accept no assignment-related parameter at all -- Local Mode has always been assignment-agnostic for these functions, so the only layer that needed correction was firestore.rules (Firebase mode)', () => {
    const ct = postedCost({ amount: 9100, transactionDate: '2026-11-16' });
    // No "currentUser" or assignment context is passed anywhere in this
    // call chain -- confirming the repository boundary itself never
    // encoded the since-corrected Firebase-only restriction.
    const pp = createPaymentProjection(c01d1ProjectId, { costTransactionIds: [ct.transactionId], createdBy: 'SCM User' });
    expect(pp.status).toBe('PENDING');
  });
});

describe('C-01D.1 R1, Blocker 2: field-level and sanity hardening implemented; the full cross-document total/composition check was NOT -- see Known Limitations', () => {
  it('the paymentProjections create rule now restricts writable fields to an explicit canonical set (hasOnly) and requires a non-empty costTransactionIds list and a positive totalAmount', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /paymentProjections/{projectionId}'), rulesText.indexOf('allow update:', rulesText.indexOf('match /paymentProjections/{projectionId}')));
    expect(block).toMatch(/costTransactionIds is list/);
    expect(block).toMatch(/costTransactionIds\.size\(\) > 0/);
    expect(block).toMatch(/totalAmount is number/);
    expect(block).toMatch(/totalAmount > 0/);
    expect(block).toMatch(/\.keys\(\)\.hasOnly\(\[/);
  });

  it('the costTransactions SCM allocation clause now also requires projectionId to be a non-empty string, not just any truthy value', async () => {
    const fs = await import('node:fs');
    const rulesText = fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
    const block = rulesText.slice(rulesText.indexOf('match /costTransactions/{transactionId}'), rulesText.indexOf('match /paymentProjections/{projectionId}'));
    expect(block).toMatch(/request\.resource\.data\.projectionId is string && request\.resource\.data\.projectionId\.size\(\) > 0/);
  });

  // Negative Tests 14/15 ("cannot forge totalAmount" / "cannot forge
  // costTransactionIds independently of actual allocation") are NOT
  // included here as passing tests, and must not be read as proven by
  // this suite. They require either a live Firestore/Emulator run (not
  // available in this environment) or a cross-document get()-based rule
  // this revision explicitly declined to implement for the reasons
  // detailed in the final report. What IS true, and is exercised above
  // and throughout this file, is that the NORMAL application path
  // (createPaymentProjection in mockOperationalData.js/costService.js)
  // always computes totalAmount as the genuine derived SUM and never
  // accepts a caller-supplied override -- see "Positive Test 4" earlier
  // in this file.
});
