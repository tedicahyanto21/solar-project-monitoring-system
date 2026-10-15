import { describe, it, expect, vi, beforeEach } from 'vitest';

// C-01D.2 -- failure behaviour of the Payment Projection PDF dataset in
// Firebase mode. The Firebase service layer is REPLACED by mocks (no real
// Firestore is touched): a failed read must surface as an error, never as an
// empty projection with a total of zero, and nothing may be written.
vi.mock('../firebase/config', () => ({ isLocalMode: false }));
vi.mock('../firebase/costService', () => ({
  getCostTransactions: vi.fn(), getPaymentProjections: vi.fn(), getPlannedCost: vi.fn(),
  createPaymentProjection: vi.fn(), markPaymentProjectionPaid: vi.fn(), createCostTransaction: vi.fn(),
  postCostTransaction: vi.fn(), voidCostTransaction: vi.fn(), setPlannedCost: vi.fn(),
}));
vi.mock('../firebase/projectService', () => ({
  getProjectById: vi.fn(), getProjects: vi.fn(), getProjectIdsAssignedToUser: vi.fn(), getProjectsByIds: vi.fn(),
}));

import * as costService from '../firebase/costService';
import * as projectService from '../firebase/projectService';
import { buildPaymentProjectionDataset } from './costRepository';

const PROJECT = { id: 'p1', projectCode: 'C-1', projectName: 'Project One', projectManager: 'PM' };
const PP = { projectionId: 'pp-1', projectId: 'p1', status: 'PENDING', currency: 'IDR', createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'SCM' };
const CT = (id, amount) => ({ transactionId: id, status: 'POSTED', transactionType: 'COST', amount, currency: 'IDR', category: 'Material Purchase', transactionDate: '2026-01-02', projectionId: 'pp-1' });
const permissionDenied = () => Object.assign(new Error('Could not read projects/p1/costTransactions. Please try again, or contact an administrator if this continues.'), { name: 'FirestoreOperationError' });

beforeEach(() => {
  vi.clearAllMocks();
  projectService.getProjectById.mockResolvedValue(PROJECT);
  costService.getPaymentProjections.mockResolvedValue([PP]);
  costService.getCostTransactions.mockResolvedValue([CT('CST-1', 100), CT('CST-2', 250)]);
});

const noWrites = () => ['createPaymentProjection', 'markPaymentProjectionPaid', 'createCostTransaction', 'postCostTransaction', 'voidCostTransaction', 'setPlannedCost']
  .forEach((fn) => expect(costService[fn], fn).not.toHaveBeenCalled());

describe('Firebase mode: successful read path', () => {
  it('builds the dataset from the (mocked) services, derives the total, and performs no write', async () => {
    const ds = await buildPaymentProjectionDataset('p1', 'pp-1');
    expect(ds.summary).toMatchObject({ count: 2, total: 350, currency: 'IDR' });
    expect(ds.project).toMatchObject({ id: 'p1', code: 'C-1', name: 'Project One' });
    noWrites();
  });
});

describe('11: failed reads produce a meaningful error, never a false zero', () => {
  it('Cost Transactions read fails -> rejects with context and the original message; no dataset', async () => {
    costService.getCostTransactions.mockRejectedValue(permissionDenied());
    const err = await buildPaymentProjectionDataset('p1', 'pp-1').then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/could not be generated because required data could not be loaded/);
    expect(err.message).toMatch(/Could not read projects\/p1\/costTransactions/);
    expect(err.cause).toBeDefined();
    noWrites();
  });

  it('Payment Projections read fails -> rejects', async () => {
    costService.getPaymentProjections.mockRejectedValue(permissionDenied());
    await expect(buildPaymentProjectionDataset('p1', 'pp-1')).rejects.toThrow(/required data could not be loaded/);
  });

  it('Project read fails -> rejects', async () => {
    projectService.getProjectById.mockRejectedValue(permissionDenied());
    await expect(buildPaymentProjectionDataset('p1', 'pp-1')).rejects.toThrow(/required data could not be loaded/);
  });

  it('a failed transactions read is NOT treated as an empty projection: the result is an error, not { total: 0 }', async () => {
    costService.getCostTransactions.mockRejectedValue(permissionDenied());
    const outcome = await buildPaymentProjectionDataset('p1', 'pp-1').then((ds) => ({ ds }), (error) => ({ error }));
    expect(outcome.ds).toBeUndefined();
    expect(outcome.error).toBeDefined();
  });

  it('a genuinely empty projection still yields an explicit zero (distinct from the failure above)', async () => {
    costService.getCostTransactions.mockResolvedValue([]);
    const ds = await buildPaymentProjectionDataset('p1', 'pp-1');
    expect(ds.summary).toMatchObject({ count: 0, total: 0 });
  });
});
