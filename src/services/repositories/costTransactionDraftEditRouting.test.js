import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: false }));
vi.mock('../firebase/costService', () => ({
  checkDuplicateTransaction: vi.fn(), createCostTransaction: vi.fn(), createPaymentProjection: vi.fn(),
  getCostTransactions: vi.fn(), getPaymentProjections: vi.fn(), getPlannedCost: vi.fn(), markPaymentProjectionPaid: vi.fn(),
  postCostTransaction: vi.fn(), setPlannedCost: vi.fn(), updateDraftCostTransaction: vi.fn(), voidCostTransaction: vi.fn(),
}));
import * as fb from '../firebase/costService';
import { updateDraftCostTransaction, createCostTransaction, checkDuplicateTransaction, getCostTransactions } from './costRepository';
import { getOperations } from '../../data/mockOperationalData';
import { initialProjects } from '../../data/mockProjects';

// Final UAT Patch B -- Firebase-MODE ROUTING of the repository. The Firebase
// cost service is mocked: these tests prove WHICH backend the repository calls
// and with WHAT, that errors reach the caller, and that the mock operational
// store is never used as a source or a fallback in this mode. They do not
// prove that real Firestore, or Firestore Rules, accept the writes -- no
// emulator or live project is involved. The service's own behaviour is covered
// in services/firebase/costService.draftEdit.test.js.
const pid = initialProjects[8].id;
const ACTOR = { role: 'SCM', name: 'SCM User' };

beforeEach(() => { vi.clearAllMocks(); });

describe('Firebase mode: the Draft edit is routed to the Firebase cost service', () => {
  it('forwards exactly the arguments it was given and returns the service result', async () => {
    const result = { transactionId: 'CST-1', description: 'edited' };
    fb.updateDraftCostTransaction.mockResolvedValue(result);
    const patch = { description: 'edited' };
    const override = { confirmed: true, reason: 'r', byRole: 'SUPER_ADMIN' };
    await expect(updateDraftCostTransaction(pid, 'CST-1', patch, ACTOR, override)).resolves.toBe(result);
    expect(fb.updateDraftCostTransaction).toHaveBeenCalledTimes(1);
    expect(fb.updateDraftCostTransaction).toHaveBeenCalledWith(pid, 'CST-1', patch, ACTOR, override);
  });

  it('never uses the mock store: it is byte-identical after a successful edit', async () => {
    fb.updateDraftCostTransaction.mockResolvedValue({ transactionId: 'CST-1' });
    const before = JSON.stringify(getOperations(pid));
    await updateDraftCostTransaction(pid, 'CST-1', { description: 'x' }, ACTOR);
    expect(JSON.stringify(getOperations(pid))).toBe(before);
  });

  it('a Firebase failure is passed to the caller as the SAME error -- never turned into success, a default, or a fallback to mock data', async () => {
    const boom = new Error('Firestore update failed: permission-denied');
    fb.updateDraftCostTransaction.mockRejectedValue(boom);
    const before = JSON.stringify(getOperations(pid));
    await expect(updateDraftCostTransaction(pid, 'CST-1', { description: 'x' }, ACTOR)).rejects.toBe(boom);
    expect(fb.updateDraftCostTransaction).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(getOperations(pid))).toBe(before); // no silent mock write
  });

  it('the blocking duplicate error and its detail survive the trip through the repository', async () => {
    const err = Object.assign(new Error('Strong duplicate detected -- edit blocked.'), { duplicate: { level: 'STRONG', reasons: ['x'] } });
    fb.updateDraftCostTransaction.mockRejectedValue(err);
    const caught = await updateDraftCostTransaction(pid, 'CST-1', { referenceNumber: 'R' }, ACTOR).catch((e) => e);
    expect(caught).toBe(err);
    expect(caught.duplicate.level).toBe('STRONG');
  });
});

describe('Firebase mode: the other cost paths this patch touched stay on the Firebase service', () => {
  it('creation is forwarded unchanged (the Amount rule lives in the service, at the boundary)', async () => {
    fb.createCostTransaction.mockResolvedValue({ transactionId: 'CST-9' });
    const tx = { amount: 100, category: 'Other', description: 'd', transactionDate: '2026-11-01', sourceRole: 'SCM' };
    await createCostTransaction(pid, tx, undefined);
    expect(fb.createCostTransaction).toHaveBeenCalledWith(pid, tx, undefined);
  });

  it('the duplicate check forwards the optional exclusion, and reads come from Firebase, not from the mock store', async () => {
    fb.checkDuplicateTransaction.mockResolvedValue({ level: null, reasons: [] });
    await checkDuplicateTransaction(pid, { amount: 1 }, 'CST-1');
    expect(fb.checkDuplicateTransaction).toHaveBeenCalledWith(pid, { amount: 1 }, 'CST-1');
    fb.getCostTransactions.mockResolvedValue([{ transactionId: 'ONLY-IN-FIREBASE', status: 'DRAFT' }]);
    const listed = await getCostTransactions(pid);
    expect(listed.map((t) => t.transactionId)).toEqual(['ONLY-IN-FIREBASE']);
  });
});
