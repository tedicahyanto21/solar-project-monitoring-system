// C-01D.1 R2.1 -- Projection Reference Integrity: Firestore EMULATOR test suite.
//
// *** STATUS: WRITTEN BUT NEVER EXECUTED. ***
// The Firestore Emulator could not be started in the environment this was
// authored in (its jar is hosted on storage.googleapis.com, which was blocked
// by the sandbox network allowlist). Nothing here has been run, so nothing
// here counts as verification of firestore.rules. It may contain mistakes that
// only a first real run will reveal. Run it with:
//
//     npm run test:rules
//
// It is deliberately NOT part of `npm test` (different file suffix, and it
// needs the emulator). It loads the real ../../firestore.rules into the
// emulator and exercises them with real writes, including the EXACT write
// patterns the app uses for allocation: a runTransaction that reads the
// selected Cost Transactions then sets the projection + updates each one
// (costService.createPaymentProjection), and an equivalent writeBatch.
//
// The last group is a MEASUREMENT of the open question the documentation does
// not answer: does one existsAfter() per allocated transaction stay inside
// Firestore's per-request access-call budget for large batches? A failure
// there is a real finding, not a flaky test.
import { before, after, beforeEach, describe, it } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch, runTransaction } from 'firebase/firestore';

const RULES = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
let testEnv;
const dbAs = (uid) => testEnv.authenticatedContext(uid).firestore();

const ctPath = (project, id) => `projects/${project}/costTransactions/${id}`;
const ppPath = (project, id) => `projects/${project}/paymentProjections/${id}`;
const ppDoc = (project, id) => ({
  projectId: project, projectionId: id, status: 'PENDING', currency: 'IDR',
  createdAt: '2026-12-01T00:00:00.000Z', createdBy: 'SCM', paidDate: null, paymentReference: null, paidBy: null,
});
const ctDoc = (project, extra = {}) => ({
  projectId: project, status: 'POSTED', transactionType: 'COST', amount: 100, currency: 'IDR',
  category: 'Material Purchase', sourceRole: 'SCM', projectionId: null, ...extra,
});

async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: 'demo-spms-rules', firestore: { rules: RULES } });
});
after(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed(async (db) => {
    await setDoc(doc(db, 'users/scm1'), { role: 'SCM', status: 'ACTIVE' });          // global SCM, no assignments anywhere
    await setDoc(doc(db, 'users/admin1'), { role: 'SUPER_ADMIN', status: 'ACTIVE' });
    await setDoc(doc(db, 'users/fin1'), { role: 'FINANCE', status: 'ACTIVE' });
    await setDoc(doc(db, 'projects/projA/projectAssignments/fin1'), { role: 'FINANCE' });
  });
});

// Runs the app's real allocation pattern (costService.createPaymentProjection).
function allocateViaTransaction(db, project, ppId, ctIds) {
  return runTransaction(db, async (tx) => {
    const refs = ctIds.map((id) => doc(db, ctPath(project, id)));
    await Promise.all(refs.map((r) => tx.get(r)));
    tx.set(doc(db, ppPath(project, ppId)), ppDoc(project, ppId));
    refs.forEach((r) => tx.update(r, { projectionId: ppId }));
  });
}
function allocateViaBatch(db, project, ppId, ctIds) {
  const b = writeBatch(db);
  b.set(doc(db, ppPath(project, ppId)), ppDoc(project, ppId));
  ctIds.forEach((id) => b.update(doc(db, ctPath(project, id)), { projectionId: ppId }));
  return b.commit();
}
const seedCts = (project, ids, extra) => seed(async (db) => { for (const id of ids) await setDoc(doc(db, ctPath(project, id)), ctDoc(project, extra)); });

describe('TEST 1 -- valid same-project reference (the exact R2 write patterns)', () => {
  it('runTransaction: read CTs, create the projection and allocate them in one transaction -> allowed', async () => {
    await seedCts('projA', ['CT-1', 'CT-2']);
    await assertSucceeds(allocateViaTransaction(dbAs('scm1'), 'projA', 'PP-1', ['CT-1', 'CT-2']));
  });
  it('writeBatch: the same allocation as one batch -> allowed', async () => {
    await seedCts('projA', ['CT-1', 'CT-2']);
    await assertSucceeds(allocateViaBatch(dbAs('scm1'), 'projA', 'PP-1', ['CT-1', 'CT-2']));
  });
});

describe('TEST 2 -- nonexistent projection is rejected', () => {
  it('SCM sets projectionId to a projection that does not exist -> denied', async () => {
    await seedCts('projA', ['CT-1']);
    await assertFails(updateDoc(doc(dbAs('scm1'), ctPath('projA', 'CT-1')), { projectionId: 'NON_EXISTENT_PP' }));
  });
  it('Super Admin is bound by the same rule -> denied', async () => {
    await seedCts('projA', ['CT-1']);
    await assertFails(updateDoc(doc(dbAs('admin1'), ctPath('projA', 'CT-1')), { projectionId: 'NON_EXISTENT_PP' }));
  });
});

describe('TEST 3 -- cross-project projection is rejected', () => {
  it('CT in project A pointing at a projection that exists only in project B -> denied', async () => {
    await seedCts('projA', ['CT-1']);
    await seed(async (db) => { await setDoc(doc(db, ppPath('projB', 'PP-B')), ppDoc('projB', 'PP-B')); });
    await assertFails(updateDoc(doc(dbAs('scm1'), ctPath('projA', 'CT-1')), { projectionId: 'PP-B' }));
  });
  it('one request that creates the projection in project B while allocating a project A CT to it -> denied', async () => {
    await seedCts('projA', ['CT-1']);
    const db = dbAs('scm1');
    const b = writeBatch(db);
    b.set(doc(db, ppPath('projB', 'PP-X')), ppDoc('projB', 'PP-X'));
    b.update(doc(db, ctPath('projA', 'CT-1')), { projectionId: 'PP-X' });
    await assertFails(b.commit());
  });
});

describe('TEST 4 -- legacy CT (no projectionId field at all)', () => {
  it('is treated as unallocated and can be allocated', async () => {
    await seed(async (db) => { const { projectionId, ...legacy } = ctDoc('projA'); void projectionId; await setDoc(doc(db, ctPath('projA', 'CT-L')), legacy); });
    await assertSucceeds(allocateViaTransaction(dbAs('scm1'), 'projA', 'PP-L', ['CT-L']));
  });
});

describe('TEST 5/6 -- existing allocation stays valid and frozen', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, ppPath('projA', 'PP-E')), ppDoc('projA', 'PP-E'));
      await setDoc(doc(db, ctPath('projA', 'CT-E')), ctDoc('projA', { projectionId: 'PP-E', description: 'old' }));
      await setDoc(doc(db, ppPath('projA', 'PP-OTHER')), ppDoc('projA', 'PP-OTHER'));
    });
  });
  it('non-frozen metadata of an allocated CT can still change (R2.1 does not block it)', async () => {
    await assertSucceeds(updateDoc(doc(dbAs('admin1'), ctPath('projA', 'CT-E')), { description: 'new' }));
  });
  it('re-pointing an allocated CT at another EXISTING projection -> denied (frozen)', async () => {
    await assertFails(updateDoc(doc(dbAs('admin1'), ctPath('projA', 'CT-E')), { projectionId: 'PP-OTHER' }));
  });
  it('changing amount or status of an allocated CT -> denied (frozen)', async () => {
    await assertFails(updateDoc(doc(dbAs('admin1'), ctPath('projA', 'CT-E')), { amount: 999 }));
    await assertFails(updateDoc(doc(dbAs('admin1'), ctPath('projA', 'CT-E')), { status: 'VOID' }));
  });
});

describe('TEST 7 -- atomic: one invalid CT fails the whole request, nothing partial remains', () => {
  it('a batch with one already-allocated CT is denied; no projection and no allocation is left behind', async () => {
    await seed(async (db) => {
      await setDoc(doc(db, ppPath('projA', 'PP-E')), ppDoc('projA', 'PP-E'));
      await setDoc(doc(db, ctPath('projA', 'CT-taken')), ctDoc('projA', { projectionId: 'PP-E' }));
    });
    await seedCts('projA', ['CT-ok']);
    await assertFails(allocateViaBatch(dbAs('scm1'), 'projA', 'PP-ATOM', ['CT-ok', 'CT-taken']));
    await seed(async (db) => {
      const pp = await getDoc(doc(db, ppPath('projA', 'PP-ATOM')));
      const ok = await getDoc(doc(db, ctPath('projA', 'CT-ok')));
      if (pp.exists()) throw new Error('projection was left behind after a failed request');
      if (ok.data().projectionId !== null) throw new Error('CT-ok was partially allocated');
    });
  });
});

describe('Role boundary (unchanged by R2.1, re-checked)', () => {
  it('Finance (assigned) cannot set projectionId on a CT', async () => {
    await seedCts('projA', ['CT-F']);
    await seed(async (db) => { await setDoc(doc(db, ppPath('projA', 'PP-F')), ppDoc('projA', 'PP-F')); });
    await assertFails(updateDoc(doc(dbAs('fin1'), ctPath('projA', 'CT-F')), { projectionId: 'PP-F' }));
  });
});

// MEASUREMENT: no cap is imposed anywhere, so every size must pass. A failure
// here means the per-transaction existsAfter() exceeds Firestore's per-request
// rules budget at that size (or that caching does not apply) -- report the
// smallest failing size; do not "fix" it by adding a limit without a decision.
describe('TEST 8 -- large batches (measures the per-request access-call budget)', () => {
  for (const n of [1, 2, 5, 10, 15, 20, 25, 50, 100]) {
    const ids = () => Array.from({ length: n }, (_, i) => `CT-${i}`);
    it(`runTransaction allocating ${n} Cost Transactions`, async () => {
      await seedCts('projA', ids());
      await assertSucceeds(allocateViaTransaction(dbAs('scm1'), 'projA', `PP-T${n}`, ids()));
    });
    it(`writeBatch allocating ${n} Cost Transactions`, async () => {
      await seedCts('projA', ids());
      await assertSucceeds(allocateViaBatch(dbAs('scm1'), 'projA', `PP-B${n}`, ids()));
    });
  }
});
