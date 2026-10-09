import { describe, it, expect, vi } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: true }));
import fs from 'node:fs';
import {
  getOperations, getPaymentProjections, createCostTransaction, postCostTransaction, voidCostTransaction,
  createPaymentProjection, markPaymentProjectionPaid,
} from '../../data/mockOperationalData';
import {
  calculateActualCost, calculateProjectionTotal, getAllocatedTransactions, isEligibleForPayment,
} from './costRepository';
import { initialProjects } from '../../data/mockProjects';

// C-01D.1 R2 -- Authoritative Cost Transaction allocation.
//
// WHAT THIS FILE PROVES, honestly:
//  * Repository / Local Mode behaviour -- executed for real against the mock
//    store (allocation, eligibility, derived total, reuse protection,
//    all-or-nothing validation, legacy tolerance, void guard).
//  * The TEXT of firestore.rules -- read as a string and asserted on. This
//    shows the rules were written the way the design requires; it does NOT
//    prove Firestore enforces them. No Firestore Emulator and no real
//    Firebase were available, so Firestore Rules are UNVERIFIED.
//  * NOT covered, and not faked: real concurrent allocation, and Firebase-mode
//    runTransaction behaviour. Local Mode is single-threaded, so a concurrency
//    test there would prove nothing.
const pid = initialProjects[7].id;
const otherPid = initialProjects[6].id;
let seq = 0;

function postedCost(overrides = {}) {
  seq += 1;
  const tx = createCostTransaction(pid, {
    transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM',
    amount: 1000 + seq, transactionDate: '2026-12-01', referenceNumber: `R2-${seq}`, ...overrides,
  });
  return postCostTransaction(pid, tx.transactionId, 'SCM User');
}
function ops() { return getOperations(pid); }
function ct(id) { return ops().costTransactions.find((t) => t.transactionId === id); }
function rulesText() { return fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8'); }
function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  const b = endMarker ? text.indexOf(endMarker, a) : text.length;
  return text.slice(a, b);
}
function code(block) { return block.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n'); }
const ctRules = () => code(between(rulesText(), 'match /costTransactions/{transactionId}', 'match /paymentProjections/{projectionId}'));
const ppRules = () => code(between(rulesText(), 'match /paymentProjections/{projectionId}'));
const statement = (block, name, nextName) => between(block, `allow ${name}:`, nextName ? `allow ${nextName}:` : undefined);

// ---------------------------------------------------------------- 22.1
describe('22.1 Allocation size -- there is no arbitrary application limit', () => {
  it.each([1, 2, 5, 10, 15, 20, 25, 50, 100])('a batch of %i Cost Transactions allocates fully, atomically, with an exact derived total', (n) => {
    const cts = Array.from({ length: n }, () => postedCost());
    const expectedTotal = cts.reduce((s, t) => s + t.amount, 0);
    const pp = createPaymentProjection(pid, { costTransactionIds: cts.map((t) => t.transactionId), createdBy: 'SCM User' });
    expect(pp.status).toBe('PENDING');
    cts.forEach((t) => expect(ct(t.transactionId).projectionId).toBe(pp.projectionId));
    const allocated = getAllocatedTransactions(ops().costTransactions, pp.projectionId);
    expect(allocated).toHaveLength(n);
    expect(calculateProjectionTotal(ops().costTransactions, pp.projectionId)).toBe(expectedTotal);
  });
});

// ---------------------------------------------------------------- 22.2
describe('22.2 Eligibility: POSTED + non-PAYMENT_ONLY + unallocated', () => {
  it('a POSTED, unallocated COST transaction is eligible and can be allocated', () => {
    const t = postedCost();
    expect(isEligibleForPayment(ct(t.transactionId))).toBe(true);
    expect(() => createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' })).not.toThrow();
  });

  it('DRAFT is rejected, and left untouched', () => {
    seq += 1;
    const draft = createCostTransaction(pid, { transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM', amount: 1000 + seq, transactionDate: '2026-12-01', referenceNumber: `R2-${seq}` });
    expect(() => createPaymentProjection(pid, { costTransactionIds: [draft.transactionId], createdBy: 'SCM User' })).toThrow('must be POSTED');
    expect(ct(draft.transactionId).status).toBe('DRAFT');
    expect(ct(draft.transactionId).projectionId).toBeNull();
  });

  it('VOID is rejected', () => {
    const t = postedCost();
    voidCostTransaction(pid, t.transactionId, { voidedBy: 'SCM User', voidReason: 'entered in error' });
    expect(() => createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' })).toThrow('must be POSTED');
  });

  it('PAYMENT_ONLY is rejected, even when POSTED', () => {
    const base = postedCost();
    seq += 1;
    const settle = createCostTransaction(pid, { transactionType: 'PAYMENT_ONLY', relatedTransactionId: base.transactionId, category: 'Milestone Payment', sourceRole: 'FINANCE', amount: 1000 + seq, transactionDate: '2026-12-02', referenceNumber: `R2-${seq}` });
    postCostTransaction(pid, settle.transactionId, 'Finance User');
    expect(() => createPaymentProjection(pid, { costTransactionIds: [settle.transactionId], createdBy: 'SCM User' })).toThrow('PAYMENT_ONLY');
  });

  it('an already-allocated transaction is rejected', () => {
    const t = postedCost();
    createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' });
    expect(() => createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' })).toThrow('already allocated');
  });

  it('listing one transaction twice in a single request, an empty selection and an unknown id are all rejected', () => {
    const t = postedCost();
    expect(() => createPaymentProjection(pid, { costTransactionIds: [t.transactionId, t.transactionId], createdBy: 'x' })).toThrow('more than once');
    expect(() => createPaymentProjection(pid, { costTransactionIds: [], createdBy: 'x' })).toThrow('at least one');
    expect(() => createPaymentProjection(pid, { costTransactionIds: ['CST-nope'], createdBy: 'x' })).toThrow('not found');
  });
});

// ---------------------------------------------------------------- 22.3
describe('22.3 Cost Transaction creation always starts unallocated', () => {
  it('a normal CT is created unallocated', () => {
    seq += 1;
    const t = createCostTransaction(pid, { transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM', amount: 1000 + seq, transactionDate: '2026-12-01', referenceNumber: `R2-${seq}` });
    expect(t.projectionId).toBeNull();
  });

  it('a client-supplied projectionId is rejected and nothing is created', () => {
    const before = ops().costTransactions.length;
    seq += 1;
    expect(() => createCostTransaction(pid, { transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM', amount: 1000 + seq, transactionDate: '2026-12-01', referenceNumber: `R2-${seq}`, projectionId: 'some-projection' }))
      .toThrow('cannot be created already allocated');
    expect(ops().costTransactions).toHaveLength(before);
  });

  it('the old PAYMENT_ONLY-with-projectionId creation path no longer exists', () => {
    seq += 1;
    expect(() => createCostTransaction(pid, { transactionType: 'PAYMENT_ONLY', projectionId: 'p', sourceRole: 'FINANCE', amount: 1000 + seq, transactionDate: '2026-12-01' })).toThrow();
  });
});

// ---------------------------------------------------------------- 22.4
describe('22.4 An allocated Cost Transaction is frozen', () => {
  it('an allocated CT cannot be voided (status unchanged), while an unallocated one still can', () => {
    const allocated = postedCost();
    const free = postedCost();
    createPaymentProjection(pid, { costTransactionIds: [allocated.transactionId], createdBy: 'SCM User' });
    expect(() => voidCostTransaction(pid, allocated.transactionId, { voidedBy: 'x', voidReason: 'oops' })).toThrow('allocated to a Payment Projection');
    expect(ct(allocated.transactionId).status).toBe('POSTED');
    expect(() => voidCostTransaction(pid, free.transactionId, { voidedBy: 'x', voidReason: 'oops' })).not.toThrow();
  });

  it('allocation itself changes nothing but projectionId (amount/status/type preserved)', () => {
    const t = postedCost();
    const before = { ...ct(t.transactionId) };
    const pp = createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' });
    const after = ct(t.transactionId);
    expect(after).toEqual({ ...before, projectionId: pp.projectionId });
  });

  it('RULES TEXT: amount/status/transactionType/projectionId are frozen once allocated, for every role, gating all update clauses', () => {
    const rules = ctRules();
    expect(rules).toMatch(/function touchesFrozenFields\(\)[\s\S]*?hasAny\(\['amount', 'status', 'transactionType', 'projectionId'\]\)/);
    expect(rules).toMatch(/function isAllocated\(\)[\s\S]*?resource\.data\.get\('projectionId', null\) != null/);
    const update = statement(rules, 'update', 'delete');
    // The freeze is the FIRST conjunct, then the R2.1 reference check, and only then the
    // role clauses -- so both gate the Super Admin, owner and SCM clauses together.
    expect(update.trim()).toMatch(/^allow update: if \(!isAllocated\(\) \|\| !touchesFrozenFields\(\)\)\s*&& projectionReferenceValid\(projectId\)\s*&& \(/);
  });

  it('RULES TEXT: the owner clause can no longer write projectionId; only the SCM allocation clause may', () => {
    const update = statement(ctRules(), 'update', 'delete');
    expect(update).toMatch(/resource\.data\.sourceRole == myRole\(\) && isAssignedToProject\(projectId\)\s*&& !request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['projectionId'\]\)/);
  });

  it('RULES TEXT: a new CT cannot be created with projectionId populated', () => {
    const create = statement(ctRules(), 'create', 'update');
    expect(create).toMatch(/request\.resource\.data\.get\('projectionId', null\) == null;/);
  });
});

// ---------------------------------------------------------------- 22.5
describe('22.5 Projection: PENDING, metadata only, total derived, recoverable through projectionId', () => {
  it('starts PENDING with metadata only -- no totalAmount, no costTransactionIds', () => {
    const t = postedCost();
    const pp = createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User', totalAmount: 999999999, costTransactionIdsExtra: ['x'] });
    expect(pp.status).toBe('PENDING');
    expect(Object.keys(pp).sort()).toEqual(['createdAt', 'createdBy', 'currency', 'paidBy', 'paidDate', 'paymentReference', 'projectId', 'projectionId', 'status']);
    expect('totalAmount' in pp).toBe(false);
    expect('costTransactionIds' in pp).toBe(false);
    const stored = getPaymentProjections(pid).find((p) => p.projectionId === pp.projectionId);
    expect('totalAmount' in stored).toBe(false);
  });

  it('the total is the exact SUM of the allocated CTs\' full amounts, derived live (the spec worked example)', () => {
    const cts = [postedCost({ amount: 10000000 }), postedCost({ amount: 20000000 }), postedCost({ amount: 5000000 })];
    const pp = createPaymentProjection(pid, { costTransactionIds: cts.map((t) => t.transactionId), createdBy: 'SCM User' });
    expect(calculateProjectionTotal(ops().costTransactions, pp.projectionId)).toBe(35000000);
    expect(getAllocatedTransactions(ops().costTransactions, pp.projectionId).map((t) => t.transactionId).sort()).toEqual(cts.map((t) => t.transactionId).sort());
  });

  it('RULES TEXT: the projection create rule accepts exactly the metadata fields, with no totalAmount/costTransactionIds', () => {
    const create = statement(ppRules(), 'create', 'update');
    expect(create).toMatch(/hasOnly\(\['projectId', 'projectionId', 'status', 'currency', 'createdAt', 'createdBy', 'paidDate', 'paymentReference', 'paidBy'\]\)/);
    expect(create).not.toMatch(/totalAmount|costTransactionIds/);
    expect(create).toMatch(/request\.resource\.data\.status == 'PENDING'/);
  });
});

// ---------------------------------------------------------------- 22.6
describe('22.6 Reuse protection', () => {
  it('Projection B using CT-001 fails; CT-001 stays allocated to Projection A only; no Projection B exists', () => {
    const ct001 = postedCost();
    const a = createPaymentProjection(pid, { costTransactionIds: [ct001.transactionId], createdBy: 'SCM-A' });
    const projectionsBefore = getPaymentProjections(pid).length;
    expect(() => createPaymentProjection(pid, { costTransactionIds: [ct001.transactionId], createdBy: 'SCM-B' })).toThrow('already allocated');
    expect(ct(ct001.transactionId).projectionId).toBe(a.projectionId);
    expect(getPaymentProjections(pid)).toHaveLength(projectionsBefore);
  });
});

// ---------------------------------------------------------------- 22.7
describe('22.7 Atomicity -- all or nothing', () => {
  it('one ineligible CT in a multi-CT selection: no projection is created and no CT is allocated', () => {
    const good1 = postedCost();
    const good2 = postedCost();
    seq += 1;
    const draft = createCostTransaction(pid, { transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM', amount: 1000 + seq, transactionDate: '2026-12-01', referenceNumber: `R2-${seq}` });
    const projectionsBefore = getPaymentProjections(pid).length;
    expect(() => createPaymentProjection(pid, { costTransactionIds: [good1.transactionId, draft.transactionId, good2.transactionId], createdBy: 'SCM User' })).toThrow('must be POSTED');
    expect(ct(good1.transactionId).projectionId).toBeNull();
    expect(ct(good2.transactionId).projectionId).toBeNull();
    expect(getPaymentProjections(pid)).toHaveLength(projectionsBefore);
  });

  it('a CT that was allocated by someone else between selection and submit makes the whole request fail, leaving the rest free', () => {
    const t1 = postedCost();
    const t2 = postedCost();
    createPaymentProjection(pid, { costTransactionIds: [t2.transactionId], createdBy: 'SCM-A' }); // A wins t2
    expect(() => createPaymentProjection(pid, { costTransactionIds: [t1.transactionId, t2.transactionId], createdBy: 'SCM-B' })).toThrow('already allocated');
    expect(ct(t1.transactionId).projectionId).toBeNull(); // no partial allocation of t1
  });
});

// ---------------------------------------------------------------- 22.8
describe('22.8 Legacy data', () => {
  it('a CT with no projectionId field at all is treated as unallocated and can be allocated', () => {
    const t = postedCost();
    delete ct(t.transactionId).projectionId; // simulate a record created before allocation existed
    expect('projectionId' in ct(t.transactionId)).toBe(false);
    expect(isEligibleForPayment(ct(t.transactionId))).toBe(true);
    const pp = createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' });
    expect(ct(t.transactionId).projectionId).toBe(pp.projectionId);
  });

  it('a legacy PAYMENT_ONLY record stays readable and never counts toward a derived total, even if it carries a projectionId', () => {
    const base = postedCost();
    seq += 1;
    const legacySettlement = createCostTransaction(pid, { transactionType: 'PAYMENT_ONLY', relatedTransactionId: base.transactionId, category: 'Milestone Payment', sourceRole: 'FINANCE', amount: 7777, transactionDate: '2026-12-03', referenceNumber: `R2-${seq}` });
    ct(legacySettlement.transactionId).projectionId = 'legacy-batch-era-projection'; // C-01D.1 batch-era settlement shape
    expect(ops().costTransactions.some((t) => t.transactionId === legacySettlement.transactionId)).toBe(true);
    expect(calculateProjectionTotal(ops().costTransactions, 'legacy-batch-era-projection')).toBe(0);
    expect(getAllocatedTransactions(ops().costTransactions, 'legacy-batch-era-projection')).toHaveLength(0);
  });

  it('a legacy Payment Projection holding old fields does not corrupt the new workflow, and cannot be paid', () => {
    const legacy = { projectionId: 'legacy-pp-1', projectId: pid, status: 'PLANNED', description: 'Old plan', plannedAmount: 123, totalAmount: 999999, costTransactionIds: ['ghost'], currency: 'IDR', createdBy: 'Old User' };
    ops().paymentProjections = [legacy, ...ops().paymentProjections];
    const t = postedCost();
    const pp = createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' });
    expect(calculateProjectionTotal(ops().costTransactions, pp.projectionId)).toBe(t.amount);
    expect(calculateProjectionTotal(ops().costTransactions, 'legacy-pp-1')).toBe(0); // stored totalAmount is ignored
    expect(getPaymentProjections(pid).find((p) => p.projectionId === 'legacy-pp-1')).toEqual(legacy); // record preserved byte-for-byte
    expect(() => markPaymentProjectionPaid(pid, 'legacy-pp-1', { paidDate: '2026-12-05', paymentReference: 'X', paidBy: 'F' })).toThrow('Only a PENDING');
  });
});

// ---------------------------------------------------------------- 22.9
describe('22.9 Finance: PENDING -> PAID only, project-scoped, composition untouched', () => {
  it('PENDING -> PAID records settlement fields and leaves every allocated CT (amount/status/type/projectionId) unchanged', () => {
    const cts = [postedCost(), postedCost()];
    const pp = createPaymentProjection(pid, { costTransactionIds: cts.map((t) => t.transactionId), createdBy: 'SCM User' });
    const snapshot = cts.map((t) => ({ ...ct(t.transactionId) }));
    const countBefore = ops().costTransactions.length;
    const paid = markPaymentProjectionPaid(pid, pp.projectionId, { paidDate: '2026-12-10', paymentReference: 'TRF-1', paidBy: 'Finance User' });
    expect(paid).toMatchObject({ status: 'PAID', paidDate: '2026-12-10', paymentReference: 'TRF-1', paidBy: 'Finance User' });
    cts.forEach((t, i) => expect(ct(t.transactionId)).toEqual(snapshot[i]));
    expect(ops().costTransactions).toHaveLength(countBefore); // no PAYMENT_ONLY record is generated
    expect(calculateProjectionTotal(ops().costTransactions, pp.projectionId)).toBe(cts.reduce((s, t) => s + t.amount, 0));
  });

  it('a PAID projection cannot be paid again', () => {
    const t = postedCost();
    const pp = createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' });
    markPaymentProjectionPaid(pid, pp.projectionId, { paidDate: '2026-12-10', paymentReference: 'A', paidBy: 'F' });
    expect(() => markPaymentProjectionPaid(pid, pp.projectionId, { paidDate: '2026-12-11', paymentReference: 'B', paidBy: 'F' })).toThrow('Only a PENDING');
  });

  it('a projection is only reachable within its own project (another project\'s Finance flow cannot pay it)', () => {
    const t = postedCost();
    const pp = createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM User' });
    expect(markPaymentProjectionPaid(otherPid, pp.projectionId, { paidDate: '2026-12-10', paymentReference: 'A', paidBy: 'F' })).toBeNull();
    expect(getPaymentProjections(pid).find((p) => p.projectionId === pp.projectionId).status).toBe('PENDING');
  });

  it('RULES TEXT: Finance may only move PENDING -> PAID, only the settlement fields, and only on an assigned project', () => {
    const update = statement(ppRules(), 'update', 'delete');
    expect(update).toMatch(/hasRole\(\['FINANCE'\]\) && isAssignedToProject\(projectId\)\s*&& resource\.data\.status == 'PENDING' && request\.resource\.data\.status == 'PAID'\s*&& request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasOnly\(\['status', 'paidDate', 'paymentReference', 'paidBy'\]\)/);
  });

  it('RULES TEXT: Finance cannot create a projection, and is not in either read blanket list (project-assignment scoped)', () => {
    expect(statement(ppRules(), 'create', 'update')).not.toMatch(/FINANCE/);
    expect(statement(ppRules(), 'read', 'create')).not.toMatch(/FINANCE/);
    expect(statement(ctRules(), 'read', 'create')).not.toMatch(/FINANCE/);
    expect(statement(ctRules(), 'read', 'create')).toMatch(/isAssignedToProject\(projectId\)/);
  });

  it('RULES TEXT: Finance (any non-SCM role) has no allocation capability -- the only clause that may set projectionId is SCM\'s', () => {
    const update = statement(ctRules(), 'update', 'delete');
    const allocationClause = update.slice(update.indexOf("hasRole(['SCM'])\n"));
    expect(allocationClause).toMatch(/hasOnly\(\['projectionId'\]\)/);
    expect(update.match(/hasOnly\(\['projectionId'\]\)/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- 22.10
describe('22.10 SCM: global for this domain, nothing else', () => {
  it('allocation and projection creation need no assignment context at all', () => {
    const t = postedCost();
    const pp = createPaymentProjection(pid, { costTransactionIds: [t.transactionId], createdBy: 'SCM With No Assignments' });
    expect(pp.status).toBe('PENDING');
  });

  it('RULES TEXT: SCM read is global, and its allocation clause has no isAssignedToProject and enforces eligibility per document', () => {
    expect(statement(ctRules(), 'read', 'create')).toMatch(/hasRole\(\['SUPER_ADMIN', 'HEAD_PM', 'SCM'\]\)/);
    expect(statement(ppRules(), 'read', 'create')).toMatch(/hasRole\(\['SUPER_ADMIN', 'HEAD_PM', 'SCM'\]\)/);
    const update = statement(ctRules(), 'update', 'delete');
    const clause = update.slice(update.indexOf("hasRole(['SCM'])\n"));
    expect(clause).not.toMatch(/isAssignedToProject/);
    expect(clause).toMatch(/!isAllocated\(\)/);
    expect(clause).toMatch(/resource\.data\.status == 'POSTED'/);
    expect(clause).toMatch(/resource\.data\.get\('transactionType', 'COST'\) != 'PAYMENT_ONLY'/);
    expect(clause).toMatch(/projectionId is string && request\.resource\.data\.projectionId\.size\(\) > 0/);
  });

  it('RULES TEXT: SCM can create a projection globally but cannot mark it PAID; SCM gets no Project Master or assignment write', () => {
    expect(statement(ppRules(), 'create', 'update')).not.toMatch(/isAssignedToProject/);
    expect(statement(ppRules(), 'update', 'delete')).not.toMatch(/SCM/);
    const projectsBlock = code(between(rulesText(), 'match /projects/{projectId} {', 'match /projectAssignments/{assignmentId}'));
    const writes = projectsBlock.match(/allow (create|update|delete)[\s\S]*?;/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    writes.forEach((w) => expect(w).not.toMatch(/SCM/));
    const assignments = code(between(rulesText(), 'match /projectAssignments/{assignmentId}', 'match /'.concat('procurementMilestones')));
    (assignments.match(/allow (write|create|update|delete)[\s\S]*?;/g) ?? []).forEach((w) => expect(w).not.toMatch(/SCM/));
  });
});

// ---------------------------------------------------------------- pure helpers
describe('Pure allocation helpers (single source of the rules, shared by mock/service/UI)', () => {
  it('eligibility table', () => {
    const base = { status: 'POSTED', transactionType: 'COST', projectionId: null };
    expect(isEligibleForPayment(base)).toBe(true);
    expect(isEligibleForPayment({ status: 'POSTED', transactionType: 'COST' })).toBe(true); // legacy: no field
    expect(isEligibleForPayment({ ...base, status: 'DRAFT' })).toBe(false);
    expect(isEligibleForPayment({ ...base, status: 'VOID' })).toBe(false);
    expect(isEligibleForPayment({ ...base, transactionType: 'PAYMENT_ONLY' })).toBe(false);
    expect(isEligibleForPayment({ ...base, projectionId: 'p1' })).toBe(false);
  });
});

// ---------------------------------------------------------------- regression
describe('Regression: Actual Cost and Progress Engine are unchanged', () => {
  it('allocating and paying a batch does not change Actual Cost (each POSTED COST counted once; PAYMENT_ONLY still excluded)', () => {
    const cts = [postedCost({ amount: 4000000 }), postedCost({ amount: 6000000 })];
    const costBefore = calculateActualCost(ops().costTransactions.filter((t) => cts.some((c) => c.transactionId === t.transactionId)));
    const pp = createPaymentProjection(pid, { costTransactionIds: cts.map((t) => t.transactionId), createdBy: 'SCM User' });
    markPaymentProjectionPaid(pid, pp.projectionId, { paidDate: '2026-12-10', paymentReference: 'R', paidBy: 'F' });
    const costAfter = calculateActualCost(ops().costTransactions.filter((t) => cts.some((c) => c.transactionId === t.transactionId)));
    expect(costBefore).toBe(10000000);
    expect(costAfter).toBe(10000000);
    expect(calculateActualCost([{ status: 'POSTED', transactionType: 'PAYMENT_ONLY', amount: 5 }, { status: 'POSTED', transactionType: 'COST', amount: 7 }])).toBe(7);
  });

  it('the Progress Engine formula is untouched', async () => {
    const { calculateConstructionProgress } = await import('./progressRepository');
    expect(calculateConstructionProgress([{ plannedQuantity: 500, actualQuantity: 250, weight: 100 }])).toBe(50);
  });
});
