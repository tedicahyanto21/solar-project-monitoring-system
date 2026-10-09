// SPMS Firestore Security Rules -- full policy suite (MP#5 corrective audit).
//
// *** STATUS: WRITTEN BUT NEVER EXECUTED. ***
// The Firestore Emulator could not be started where this was authored (its
// jar is hosted on a host the sandbox blocks). Nothing in this file has been
// run, so it verifies NOTHING yet and may contain mistakes that only a first
// real run reveals. If a test here fails, first consider that the TEST may be
// wrong; then read the failing rule. Run it with:
//
//     npm run test:rules
//
// (needs Java 11+ and network access so firebase-tools can download the
// emulator). It loads the real ../../firestore.rules and exercises it with
// real reads/writes/queries, including the exact collection-group query the
// app issues in getProjectIdsAssignedToUser().
import { before, after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

const RULES = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
let env;
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const seed = (fn) => env.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });

const USERS = {
  adm1: 'SUPER_ADMIN', hpm1: 'HEAD_PM', bod1: 'BOD', pm1: 'PROJECT_MANAGER', pm2: 'PROJECT_MANAGER',
  sm1: 'SITE_MANAGER', eng1: 'ENGINEERING', scm1: 'SCM', fin1: 'FINANCE', hc1: 'HC',
};

before(async () => { env = await initializeTestEnvironment({ projectId: 'demo-spms-policy', firestore: { rules: RULES } }); });
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async (db) => {
    for (const [uid, role] of Object.entries(USERS)) await setDoc(doc(db, `users/${uid}`), { role, status: 'ACTIVE', name: uid });
    await setDoc(doc(db, 'users/inactive1'), { role: 'PROJECT_MANAGER', status: 'INACTIVE', name: 'inactive1' });
    // 'noprofile1' deliberately has NO users document.
    await setDoc(doc(db, 'projects/projA'), { projectName: 'BPK Penabur', status: 'In Progress' });
    await setDoc(doc(db, 'projects/projB'), { projectName: 'Other', status: 'In Progress' });
    const assign = (project, uid, role) => setDoc(doc(db, `projects/${project}/projectAssignments/${uid}`), { role, userId: uid, name: uid });
    await assign('projA', 'pm1', 'PROJECT_MANAGER'); await assign('projA', 'sm1', 'SITE_MANAGER');
    await assign('projA', 'eng1', 'ENGINEERING'); await assign('projA', 'fin1', 'FINANCE'); await assign('projA', 'hc1', 'HC');
    await assign('projA', 'inactive1', 'PROJECT_MANAGER'); await assign('projA', 'noprofile1', 'PROJECT_MANAGER');
    await assign('projB', 'pm2', 'PROJECT_MANAGER');
    await setDoc(doc(db, 'projects/projA/engineeringDocuments/ED-1'), { name: 'Drawing', weight: 10, progressContribution: 0 });
    await setDoc(doc(db, 'projects/projA/procurementMilestones/PM-1'), { name: 'Modules', weight: 20, plannedDate: '2026-12-01', progressContribution: 0, status: 'Not Started', actualDate: null });
    await setDoc(doc(db, 'projects/projA/constructionActivities/CA-1'), { activity: 'Piling', plannedQuantity: 100, unit: 'pcs', weight: 10, actualQuantity: 0, history: [] });
    await setDoc(doc(db, 'projects/projA/costTransactions/CT-1'), { projectId: 'projA', status: 'POSTED', transactionType: 'COST', amount: 100, sourceRole: 'SCM', projectionId: null });
    await setDoc(doc(db, 'projects/projB/costTransactions/CT-B'), { projectId: 'projB', status: 'POSTED', transactionType: 'COST', amount: 100, sourceRole: 'SCM', projectionId: null });
    const pp = (project, id) => setDoc(doc(db, `projects/${project}/paymentProjections/${id}`), { projectId: project, projectionId: id, status: 'PENDING', currency: 'IDR', createdAt: '2026-01-01', createdBy: 'x', paidDate: null, paymentReference: null, paidBy: null });
    await pp('projA', 'PP-A'); await pp('projB', 'PP-B');
  });
});

describe('Assigned Project Manager -- the reported failures', () => {
  it('reads their own assignment document and the assigned project', async () => {
    await assertSucceeds(getDoc(doc(as('pm1'), 'projects/projA/projectAssignments/pm1')));
    await assertSucceeds(getDoc(doc(as('pm1'), 'projects/projA')));
  });
  it('cannot read an unassigned project', async () => {
    await assertFails(getDoc(doc(as('pm1'), 'projects/projB')));
  });
  it('THE APP QUERY: collectionGroup(projectAssignments).where(userId == own uid) succeeds and returns only their own assignment', async () => {
    const snap = await assertSucceeds(getDocs(query(collectionGroup(as('pm1'), 'projectAssignments'), where('userId', '==', 'pm1'))));
    assert.deepEqual(snap.docs.map((d) => d.ref.parent.parent.id), ['projA']);
    assert.ok(snap.docs.every((d) => d.data().userId === 'pm1'));
  });
  it('the same query for ANOTHER user\'s uid is denied (no enumeration of others\' assignments)', async () => {
    await assertFails(getDocs(query(collectionGroup(as('pm1'), 'projectAssignments'), where('userId', '==', 'pm2'))));
  });
  it('an UNFILTERED collection-group query is denied', async () => {
    await assertFails(getDocs(collectionGroup(as('pm1'), 'projectAssignments')));
  });
  it('reads their project\'s other assignments through the nested rule (Team tab), but not another project\'s', async () => {
    await assertSucceeds(getDocs(collection(as('pm1'), 'projects/projA/projectAssignments')));
    await assertFails(getDocs(collection(as('pm1'), 'projects/projB/projectAssignments')));
  });
});

describe('Inactive, profile-less and unauthenticated users', () => {
  it('inactive: can read OWN profile (to show "deactivated"), nothing else', async () => {
    await assertSucceeds(getDoc(doc(as('inactive1'), 'users/inactive1')));
    await assertFails(getDoc(doc(as('inactive1'), 'projects/projA')));
    await assertFails(getDocs(query(collectionGroup(as('inactive1'), 'projectAssignments'), where('userId', '==', 'inactive1'))));
  });
  it('profile-less (signed in, no users document): denied everywhere that matters', async () => {
    await assertFails(getDoc(doc(as('noprofile1'), 'projects/projA')));
    await assertFails(getDocs(query(collectionGroup(as('noprofile1'), 'projectAssignments'), where('userId', '==', 'noprofile1'))));
  });
  it('unauthenticated: cannot read or write anything', async () => {
    await assertFails(getDoc(doc(anon(), 'users/pm1')));
    await assertFails(getDoc(doc(anon(), 'projects/projA')));
    await assertFails(getDocs(collection(anon(), 'projects')));
    await assertFails(getDocs(query(collectionGroup(anon(), 'projectAssignments'), where('userId', '==', 'pm1'))));
    await assertFails(setDoc(doc(anon(), 'projects/projX'), { projectName: 'x' }));
  });
  it('a user cannot read another user\'s profile, and PROJECT_MANAGER cannot list users', async () => {
    await assertFails(getDoc(doc(as('pm1'), 'users/pm2')));
    await assertFails(getDocs(collection(as('pm1'), 'users')));
  });
});

describe('Super Admin and Head PM keep administrative access', () => {
  it('both read the whole project list and every profile', async () => {
    await assertSucceeds(getDocs(collection(as('adm1'), 'projects')));
    await assertSucceeds(getDocs(collection(as('hpm1'), 'projects')));
    await assertSucceeds(getDocs(collection(as('adm1'), 'users')));
    await assertSucceeds(getDocs(collection(as('hpm1'), 'users'))); // SPMS-DOC-07 Section 6
  });
  it('both may update project master fields; only Super Admin writes users', async () => {
    await assertSucceeds(updateDoc(doc(as('adm1'), 'projects/projA'), { projectName: 'renamed by admin' }));
    await assertSucceeds(updateDoc(doc(as('hpm1'), 'projects/projA'), { projectName: 'renamed by head pm' }));
    await assertFails(updateDoc(doc(as('hpm1'), 'users/pm1'), { role: 'SUPER_ADMIN' }));
    await assertSucceeds(updateDoc(doc(as('adm1'), 'users/pm1'), { department: 'ops' }));
  });
  it('a Project Manager cannot rename the project, but may save progressWeights', async () => {
    await assertFails(updateDoc(doc(as('pm1'), 'projects/projA'), { projectName: 'hijack' }));
    await assertSucceeds(updateDoc(doc(as('pm1'), 'projects/projA'), { progressWeights: { engineering: 25 } }));
  });
  it('only Super Admin may delete a project', async () => {
    await assertFails(deleteDoc(doc(as('hpm1'), 'projects/projA')));
    await assertFails(deleteDoc(doc(as('pm1'), 'projects/projA')));
    await assertSucceeds(deleteDoc(doc(as('adm1'), 'projects/projB')));
  });
});

describe('BOD is read-only', () => {
  it('reads the portfolio and operational data it needs for the dashboard', async () => {
    await assertSucceeds(getDocs(collection(as('bod1'), 'projects')));
    await assertSucceeds(getDocs(collection(as('bod1'), 'projects/projA/engineeringDocuments')));
  });
  it('writes nothing, anywhere', async () => {
    await assertFails(updateDoc(doc(as('bod1'), 'projects/projA'), { projectName: 'x' }));
    await assertFails(setDoc(doc(as('bod1'), 'projects/projA/engineeringDocuments/ED-2'), { name: 'x' }));
    await assertFails(setDoc(doc(as('bod1'), 'projects/projA/issues/I-1'), { title: 'x' }));
  });
  it('cannot read cost data', async () => {
    await assertFails(getDoc(doc(as('bod1'), 'projects/projA/costTransactions/CT-1')));
    await assertFails(getDoc(doc(as('bod1'), 'projects/projA/paymentProjections/PP-A')));
  });
});

describe('SCM: global procurement, nothing broader', () => {
  it('reads every project and procurement data without being assigned', async () => {
    await assertSucceeds(getDoc(doc(as('scm1'), 'projects/projA')));
    await assertSucceeds(getDoc(doc(as('scm1'), 'projects/projB')));
    await assertSucceeds(getDocs(collection(as('scm1'), 'projects')));
    await assertSucceeds(getDocs(collection(as('scm1'), 'projects/projA/procurementMilestones')));
  });
  it('updates procurement ACTUAL fields but not PLAN fields', async () => {
    await assertSucceeds(updateDoc(doc(as('scm1'), 'projects/projA/procurementMilestones/PM-1'), { progressContribution: 50, status: 'In Progress' }));
    await assertFails(updateDoc(doc(as('scm1'), 'projects/projA/procurementMilestones/PM-1'), { name: 'renamed' }));
  });
  it('has NO write access to the project, assignments, or other domains; cannot read engineering data', async () => {
    await assertFails(updateDoc(doc(as('scm1'), 'projects/projA'), { projectName: 'x' }));
    await assertFails(setDoc(doc(as('scm1'), 'projects/projA/projectAssignments/scm1'), { role: 'SCM', userId: 'scm1' }));
    await assertFails(setDoc(doc(as('scm1'), 'projects/projA/engineeringDocuments/ED-9'), { name: 'x' }));
    await assertFails(getDoc(doc(as('scm1'), 'projects/projA/engineeringDocuments/ED-1')));
  });
  it('cannot mark a Payment Projection PAID', async () => {
    await assertFails(updateDoc(doc(as('scm1'), 'projects/projA/paymentProjections/PP-A'), { status: 'PAID', paidDate: '2026-01-02', paymentReference: 'R', paidBy: 'scm1' }));
  });
});

describe('Finance stays project-scoped', () => {
  it('reads cost data of its assigned project only', async () => {
    await assertSucceeds(getDoc(doc(as('fin1'), 'projects/projA/costTransactions/CT-1')));
    await assertFails(getDoc(doc(as('fin1'), 'projects/projB/costTransactions/CT-B')));
  });
  it('marks an assigned project\'s projection PENDING -> PAID with settlement fields only', async () => {
    await assertSucceeds(updateDoc(doc(as('fin1'), 'projects/projA/paymentProjections/PP-A'), { status: 'PAID', paidDate: '2026-01-02', paymentReference: 'R', paidBy: 'fin1' }));
  });
  it('cannot settle an unassigned project\'s projection, cannot create a projection, cannot touch other fields', async () => {
    await assertFails(updateDoc(doc(as('fin1'), 'projects/projB/paymentProjections/PP-B'), { status: 'PAID', paidDate: '2026-01-02', paymentReference: 'R', paidBy: 'fin1' }));
    await assertFails(setDoc(doc(as('fin1'), 'projects/projA/paymentProjections/PP-NEW'), { projectId: 'projA', projectionId: 'PP-NEW', status: 'PENDING', createdAt: 'x', createdBy: 'fin1' }));
    await assertFails(updateDoc(doc(as('fin1'), 'projects/projA/paymentProjections/PP-A'), { status: 'PAID', createdBy: 'tampered' }));
  });
});

describe('Plan-versus-actual ownership between roles', () => {
  it('Site Manager cannot change construction PLAN fields but can record ACTUAL', async () => {
    await assertFails(updateDoc(doc(as('sm1'), 'projects/projA/constructionActivities/CA-1'), { plannedQuantity: 999 }));
    await assertSucceeds(updateDoc(doc(as('sm1'), 'projects/projA/constructionActivities/CA-1'), { actualQuantity: 10, history: [{ date: '2026-01-01', dailyQuantity: 10 }], updatedAt: 'x' }));
  });
  it('Project Manager cannot write procurement ACTUAL fields but can edit PLAN fields', async () => {
    await assertFails(updateDoc(doc(as('pm1'), 'projects/projA/procurementMilestones/PM-1'), { progressContribution: 10 }));
    await assertSucceeds(updateDoc(doc(as('pm1'), 'projects/projA/procurementMilestones/PM-1'), { name: 'Modules v2' }));
  });
});

describe('Cost transaction and payment projection restrictions', () => {
  const ct = (id, sourceRole) => ({ projectId: 'projA', status: 'DRAFT', transactionType: 'COST', amount: 10, sourceRole, projectionId: null });
  it('sourceRole must equal the caller\'s own role (no impersonation)', async () => {
    await assertSucceeds(setDoc(doc(as('hc1'), 'projects/projA/costTransactions/CT-HC'), ct('CT-HC', 'HC')));
    await assertFails(setDoc(doc(as('hc1'), 'projects/projA/costTransactions/CT-HC2'), ct('CT-HC2', 'SCM')));
  });
  it('a new transaction cannot be created already allocated', async () => {
    await assertFails(setDoc(doc(as('hc1'), 'projects/projA/costTransactions/CT-HC3'), { ...ct('CT-HC3', 'HC'), projectionId: 'PP-A' }));
  });
  it('allocation: SCM may set projectionId (once, to an existing projection in the same project); after that the transaction is frozen', async () => {
    await assertSucceeds(updateDoc(doc(as('scm1'), 'projects/projA/costTransactions/CT-1'), { projectionId: 'PP-A' }));
    await assertFails(updateDoc(doc(as('adm1'), 'projects/projA/costTransactions/CT-1'), { amount: 999 }));
    await assertFails(updateDoc(doc(as('adm1'), 'projects/projA/costTransactions/CT-1'), { projectionId: 'PP-OTHER' }));
  });
  it('allocation to a projection that does not exist, or that exists only in another project, is denied', async () => {
    await assertFails(updateDoc(doc(as('scm1'), 'projects/projA/costTransactions/CT-1'), { projectionId: 'NON_EXISTENT_PP' }));
    await assertFails(updateDoc(doc(as('scm1'), 'projects/projA/costTransactions/CT-1'), { projectionId: 'PP-B' }));
  });
  it('a projection document cannot be forged with totalAmount/costTransactionIds', async () => {
    const base = { projectId: 'projA', projectionId: 'PP-F', status: 'PENDING', currency: 'IDR', createdAt: 'x', createdBy: 'scm1' };
    await assertSucceeds(setDoc(doc(as('scm1'), 'projects/projA/paymentProjections/PP-F'), base));
    await assertFails(setDoc(doc(as('scm1'), 'projects/projA/paymentProjections/PP-G'), { ...base, projectionId: 'PP-G', totalAmount: 999999 }));
    await assertFails(setDoc(doc(as('scm1'), 'projects/projA/paymentProjections/PP-H'), { ...base, projectionId: 'PP-H', costTransactionIds: ['CT-1'] }));
  });
});

describe('Assignment writes: id and userId cannot disagree; no escalation', () => {
  it('Head PM and an assigned PM can add a user whose id matches the document id', async () => {
    await assertSucceeds(setDoc(doc(as('hpm1'), 'projects/projA/projectAssignments/sm9'), { role: 'SITE_MANAGER', userId: 'sm9', name: 'sm9' }));
    await assertSucceeds(setDoc(doc(as('pm1'), 'projects/projA/projectAssignments/sm8'), { role: 'SITE_MANAGER', userId: 'sm8', name: 'sm8' }));
  });
  it('a document whose userId differs from its id is denied for everyone', async () => {
    await assertFails(setDoc(doc(as('hpm1'), 'projects/projA/projectAssignments/sm7'), { role: 'SITE_MANAGER', userId: 'someoneElse', name: 'x' }));
    await assertFails(setDoc(doc(as('pm1'), 'projects/projA/projectAssignments/sm6'), { role: 'SITE_MANAGER', userId: 'pm2', name: 'x' }));
  });
  it('a PM cannot write assignments on a project they are not assigned to; Site Manager cannot write assignments at all', async () => {
    await assertFails(setDoc(doc(as('pm1'), 'projects/projB/projectAssignments/sm5'), { role: 'SITE_MANAGER', userId: 'sm5', name: 'x' }));
    await assertFails(setDoc(doc(as('sm1'), 'projects/projA/projectAssignments/sm4'), { role: 'SITE_MANAGER', userId: 'sm4', name: 'x' }));
  });
});
