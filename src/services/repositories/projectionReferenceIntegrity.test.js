import { describe, it, expect, vi } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: true }));
import fs from 'node:fs';
import {
  getOperations, getPaymentProjections, createCostTransaction, postCostTransaction,
  createPaymentProjection,
} from '../../data/mockOperationalData';
import { calculateProjectionTotal, getAllocatedTransactions } from './costRepository';
import { findInvalidProjectionReferences, isUnallocated } from '../paymentAllocation';
import { initialProjects } from '../../data/mockProjects';

// C-01D.1 R2.1 -- Projection Reference Integrity.
//
// HONEST SCOPE OF THIS FILE
//  * EXECUTED for real: app-level behaviour in Local Mode (allocation always
//    binds to a projection created in the same project; the shared integrity
//    helper; atomicity; no batch-size limit; legacy tolerance).
//  * RULES TEXT: firestore.rules is read as a string and asserted on. That
//    shows the rule is written as designed. It does NOT prove Firestore
//    enforces it.
//  * NOT RUN: the actual security boundary -- a direct Firestore write that
//    sets projectionId to a nonexistent or other-project projection must be
//    REJECTED BY FIRESTORE. That needs the Firestore Emulator, which could not
//    be started here (its jar is hosted on a blocked host). The ready-to-run
//    emulator suite is tests/rules/projectionReference.emu.mjs; it has NOT
//    been executed, so no test below may be read as Rules verification.
const A = initialProjects[5].id;
const B = initialProjects[4].id;
let seq = 0;

function posted(projectId, overrides = {}) {
  seq += 1;
  const tx = createCostTransaction(projectId, {
    transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM',
    amount: 5000 + seq, transactionDate: '2026-12-05', referenceNumber: `R21-${seq}`, ...overrides,
  });
  return postCostTransaction(projectId, tx.transactionId, 'SCM User');
}
const ops = (p) => getOperations(p);
const ct = (p, id) => ops(p).costTransactions.find((t) => t.transactionId === id);
const rulesText = () => fs.readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8');
const between = (t, a, b) => { const i = t.indexOf(a); return t.slice(i, b ? t.indexOf(b, i) : undefined); };
const code = (blk) => blk.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const ctRules = () => code(between(rulesText(), 'match /costTransactions/{transactionId}', 'match /paymentProjections/{projectionId}'));
const ppRules = () => code(between(rulesText(), 'match /paymentProjections/{projectionId}'));

describe('TEST 1 -- valid same-project reference', () => {
  it('CT-A -> PP-A resolves within project A, and nothing in the store is an invalid reference', () => {
    const t = posted(A);
    const pp = createPaymentProjection(A, { costTransactionIds: [t.transactionId], createdBy: 'SCM' });
    expect(ct(A, t.transactionId).projectionId).toBe(pp.projectionId);
    expect(getPaymentProjections(A).some((p) => p.projectionId === pp.projectionId)).toBe(true);
    expect(findInvalidProjectionReferences(ops(A).costTransactions, getPaymentProjections(A))).toEqual([]);
  });

  it('the projection is created in the SAME project as its transactions, never another one', () => {
    const t = posted(A);
    const pp = createPaymentProjection(A, { costTransactionIds: [t.transactionId], createdBy: 'SCM' });
    expect(getPaymentProjections(B).some((p) => p.projectionId === pp.projectionId)).toBe(false);
    expect(pp.projectId).toBe(A);
  });
});

describe('TEST 2 -- nonexistent projection is an invalid reference (app-level check; the Firestore rejection itself is NOT RUN)', () => {
  it('a CT whose projectionId names no projection in its project is flagged', () => {
    const bad = { transactionId: 'CT-A', projectionId: 'NON_EXISTENT_PP' };
    expect(findInvalidProjectionReferences([bad], getPaymentProjections(A))).toEqual([bad]);
  });
});

describe('TEST 3 -- cross-project projection is an invalid reference (app-level check; the Firestore rejection itself is NOT RUN)', () => {
  it('CT in project A -> PP that exists only in project B is flagged, because only project A\'s own projections can resolve it', () => {
    const tb = posted(B);
    const ppB = createPaymentProjection(B, { costTransactionIds: [tb.transactionId], createdBy: 'SCM' });
    expect(getPaymentProjections(B).some((p) => p.projectionId === ppB.projectionId)).toBe(true); // PP-B really exists...
    const ctA = { transactionId: 'CT-A', projectionId: ppB.projectionId };
    expect(findInvalidProjectionReferences([ctA], getPaymentProjections(A))).toEqual([ctA]); // ...but does not resolve from A
    expect(findInvalidProjectionReferences([ctA], getPaymentProjections(B))).toEqual([]);   // (it would, if wrongly looked up in B)
  });

  it('allocating in one project never touches another project\'s transactions or projections', () => {
    const ta = posted(A);
    const tb = posted(B);
    const projectionsBBefore = getPaymentProjections(B).length;
    createPaymentProjection(A, { costTransactionIds: [ta.transactionId], createdBy: 'SCM' });
    expect(getPaymentProjections(B)).toHaveLength(projectionsBBefore);
    expect(isUnallocated(ct(B, tb.transactionId))).toBe(true);
  });

  it('transaction ids are per-project counters (so a bare id proves nothing across projects): an id absent from this project is rejected, and a same-named id in another project is never touched', () => {
    const ta = posted(A);
    const tb = posted(B);
    expect(() => createPaymentProjection(A, { costTransactionIds: ['CST-2026-999999'], createdBy: 'SCM' })).toThrow('not found');
    // Same-named ids can exist in both projects; allocating in A must leave B's untouched.
    const sameNameInB = ct(B, ta.transactionId);
    const bBefore = sameNameInB ? { ...sameNameInB } : null;
    createPaymentProjection(A, { costTransactionIds: [ta.transactionId], createdBy: 'SCM' });
    if (bBefore) expect(ct(B, ta.transactionId)).toEqual(bBefore);
    expect(isUnallocated(ct(B, tb.transactionId))).toBe(true);
  });
});

describe('TEST 4 -- legacy CT', () => {
  it('a CT with no projectionId field is unallocated, is not an invalid reference, and can be allocated', () => {
    const t = posted(A);
    delete ct(A, t.transactionId).projectionId;
    expect(isUnallocated(ct(A, t.transactionId))).toBe(true);
    expect(findInvalidProjectionReferences([ct(A, t.transactionId)], getPaymentProjections(A))).toEqual([]);
    const pp = createPaymentProjection(A, { costTransactionIds: [t.transactionId], createdBy: 'SCM' });
    expect(ct(A, t.transactionId).projectionId).toBe(pp.projectionId);
  });
});

describe('TEST 5 -- an existing valid allocation remains valid', () => {
  it('unrelated later activity (other batches, other projects) leaves it resolving and its total unchanged', () => {
    const t = posted(A, { amount: 777000 });
    const pp = createPaymentProjection(A, { costTransactionIds: [t.transactionId], createdBy: 'SCM' });
    const other = posted(A);
    createPaymentProjection(A, { costTransactionIds: [other.transactionId], createdBy: 'SCM' });
    createPaymentProjection(B, { costTransactionIds: [posted(B).transactionId], createdBy: 'SCM' });
    expect(ct(A, t.transactionId).projectionId).toBe(pp.projectionId);
    expect(calculateProjectionTotal(ops(A).costTransactions, pp.projectionId)).toBe(777000);
    expect(findInvalidProjectionReferences(ops(A).costTransactions, getPaymentProjections(A))).toEqual([]);
    expect(findInvalidProjectionReferences(ops(B).costTransactions, getPaymentProjections(B))).toEqual([]);
  });
});

describe('TEST 6 -- an allocated CT cannot be re-pointed at another projection', () => {
  it('re-allocating an allocated CT into a new projection is rejected and it stays on PP-A', () => {
    const t = posted(A);
    const ppA = createPaymentProjection(A, { costTransactionIds: [t.transactionId], createdBy: 'SCM' });
    const projectionsBefore = getPaymentProjections(A).length;
    expect(() => createPaymentProjection(A, { costTransactionIds: [t.transactionId], createdBy: 'SCM' })).toThrow('already allocated');
    expect(ct(A, t.transactionId).projectionId).toBe(ppA.projectionId);
    expect(getPaymentProjections(A)).toHaveLength(projectionsBefore);
  });

  it('RULES TEXT: projectionId stays frozen once allocated, for every role (R2 protection intact)', () => {
    const rules = ctRules();
    expect(rules).toMatch(/function touchesFrozenFields\(\)[\s\S]*?hasAny\(\['amount', 'status', 'transactionType', 'projectionId'\]\)/);
    expect(rules).toMatch(/allow update: if \(!isAllocated\(\) \|\| !touchesFrozenFields\(\)\)/);
  });
});

describe('TEST 7 -- atomic allocation: no partial result when one CT fails validation', () => {
  it('one already-allocated CT in the selection: no new projection, no CT allocated', () => {
    const good1 = posted(A);
    const good2 = posted(A);
    const taken = posted(A);
    createPaymentProjection(A, { costTransactionIds: [taken.transactionId], createdBy: 'SCM-first' });
    const projectionsBefore = getPaymentProjections(A).length;
    expect(() => createPaymentProjection(A, { costTransactionIds: [good1.transactionId, taken.transactionId, good2.transactionId], createdBy: 'SCM-second' })).toThrow('already allocated');
    expect(isUnallocated(ct(A, good1.transactionId))).toBe(true);
    expect(isUnallocated(ct(A, good2.transactionId))).toBe(true);
    expect(getPaymentProjections(A)).toHaveLength(projectionsBefore);
    expect(findInvalidProjectionReferences(ops(A).costTransactions, getPaymentProjections(A))).toEqual([]);
  });
});

describe('TEST 8 -- no arbitrary batch-size limit', () => {
  it.each([1, 2, 5, 10, 15, 20, 25, 50, 100])('a batch of %i is allocated in full and every reference still resolves', (n) => {
    const cts = Array.from({ length: n }, () => posted(A));
    const pp = createPaymentProjection(A, { costTransactionIds: cts.map((t) => t.transactionId), createdBy: 'SCM' });
    expect(getAllocatedTransactions(ops(A).costTransactions, pp.projectionId)).toHaveLength(n);
    expect(findInvalidProjectionReferences(cts.map((t) => ct(A, t.transactionId)), getPaymentProjections(A))).toEqual([]);
  });

  it('RULES TEXT: the new rule adds no cap -- one existsAfter call site, no get()/getAfter() loops, no size comparison against a selection', () => {
    const rules = ctRules();
    expect(rules.match(/existsAfter\(/g)).toHaveLength(1);
    expect(rules).not.toMatch(/getAfter\(/);
    expect(rules).not.toMatch(/\bget\(\/databases/);
    expect(rules).not.toMatch(/\.size\(\)\s*(<=|<)\s*\d/);
  });
});

describe('RULES TEXT -- how R2.1 closes orphan and cross-project references (written as designed; NOT executed against Firestore)', () => {
  it('projectionReferenceValid uses existsAfter on a path built from the transaction\'s OWN project (pid), never from client-supplied data', () => {
    const rules = ctRules();
    const fn = between(rules, 'function projectionReferenceValid(pid)', 'allow read:');
    expect(fn).toMatch(/existsAfter\(\/databases\/\$\(database\)\/documents\/projects\/\$\(pid\)\/paymentProjections\/\$\(request\.resource\.data\.projectionId\)\)/);
    expect(fn).not.toMatch(/projects\/\$\(request\.resource\.data/); // a client-chosen project id would defeat Rule B
  });

  it('it fires only when projectionId is actually being set/changed', () => {
    const fn = between(ctRules(), 'function projectionReferenceValid(pid)', 'allow read:');
    expect(fn).toMatch(/!request\.resource\.data\.diff\(resource\.data\)\.affectedKeys\(\)\.hasAny\(\['projectionId'\]\)\s*\|\|\s*existsAfter/);
  });

  it('it is a top-level conjunct of the update rule, called with the path\'s own projectId, and sits BEFORE every role clause (so it binds Super Admin too)', () => {
    const update = between(ctRules(), 'allow update:', 'allow delete:');
    expect(update).toMatch(/&& projectionReferenceValid\(projectId\)/);
    expect(update.indexOf('projectionReferenceValid(projectId)')).toBeLessThan(update.indexOf("hasRole(['SUPER_ADMIN'])"));
    expect(update.indexOf('projectionReferenceValid(projectId)')).toBeLessThan(update.indexOf("hasRole(['SCM'])"));
  });

  it('create still forces projectionId empty, so a reference can only ever be set by the update path above', () => {
    expect(between(ctRules(), 'allow create:', 'allow update:')).toMatch(/request\.resource\.data\.get\('projectionId', null\) == null;/);
  });

  it('a projection document must carry its own id and the project of its path (no mislabelled projectId)', () => {
    const create = between(ppRules(), 'allow create:', 'allow update:');
    expect(create).toMatch(/request\.resource\.data\.projectionId == projectionId/);
    expect(create).toMatch(/request\.resource\.data\.projectId == projectId/);
  });

  it('R2 guarantees are intact: no totalAmount/costTransactionIds on projections; SCM allocation still global; Finance still project-scoped', () => {
    expect(between(ppRules(), 'allow create:', 'allow update:')).not.toMatch(/totalAmount|costTransactionIds/);
    const update = between(ctRules(), 'allow update:', 'allow delete:');
    expect(update.slice(update.indexOf("hasRole(['SCM'])\n"))).not.toMatch(/isAssignedToProject/);
    expect(between(ppRules(), 'allow update:', 'allow delete:')).toMatch(/hasRole\(\['FINANCE'\]\) && isAssignedToProject\(projectId\)/);
  });
});

describe('Regression: no Progress Engine change; Actual Cost unchanged', () => {
  it('Progress Engine formula untouched', async () => {
    const { calculateConstructionProgress } = await import('./progressRepository');
    expect(calculateConstructionProgress([{ plannedQuantity: 500, actualQuantity: 250, weight: 100 }])).toBe(50);
  });
});
