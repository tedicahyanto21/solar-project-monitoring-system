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
import { generatePaymentProjectionPdf } from '../reportPdf';

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

// ---------------------------------------------------------------------------
// C-01D.2 R3 -- project identity in Firebase mode (SDK layer mocked). The
// project object comes from getOneDoc, which spreads STORED data after the
// document id, so a stored `id` can replace the real one (an empty string made
// the old report print a blank "Project ID"). The report must not depend on it.
// ---------------------------------------------------------------------------
const pdfStrings = (doc) => doc.internal.pages
  .slice(1)
  .flatMap((page) => [...page.join('\n').matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')));
const valueAfter = (doc, label) => { const t = pdfStrings(doc); const i = t.indexOf(label); return i < 0 ? undefined : t[i + 1]; };

describe('C-01D.2 R3: project identity in Firebase mode', () => {
  it('a stored EMPTY id field no longer yields a blank identity: Project No. is the project code, the dataset id is the lookup key, and no value in the report is blank', async () => {
    projectService.getProjectById.mockResolvedValue({ ...PROJECT, id: '', projectId: '' });
    const ds = await buildPaymentProjectionDataset('p1', 'pp-1');
    expect(ds.project).toMatchObject({ id: 'p1', code: 'C-1', name: 'Project One' });
    const doc = generatePaymentProjectionPdf(ds);
    expect(valueAfter(doc, 'Project No.')).toBe('C-1');
    expect(pdfStrings(doc).every((s) => s.trim() !== '')).toBe(true);
    noWrites();
  });

  it('a stale stored id is never used or displayed: the lookup key is the project id', async () => {
    projectService.getProjectById.mockResolvedValue({ ...PROJECT, id: 'stale-old-id', projectId: 'stale-old-id' });
    const ds = await buildPaymentProjectionDataset('p1', 'pp-1');
    expect(ds.project.id).toBe('p1');
    expect(pdfStrings(generatePaymentProjectionPdf(ds))).not.toContain('stale-old-id');
  });

  it('a project record without a project code prints the explicit marker -- never the project id or the projection id', async () => {
    const { projectCode, ...withoutCode } = PROJECT;
    void projectCode;
    projectService.getProjectById.mockResolvedValue(withoutCode);
    const ds = await buildPaymentProjectionDataset('p1', 'pp-1');
    expect(ds.project.code).toBeNull();
    const doc = generatePaymentProjectionPdf(ds);
    expect(valueAfter(doc, 'Project No.')).toBe('Not set on the project record');
    expect(pdfStrings(doc)).not.toContain('p1');          // the internal project id is not displayed anywhere
    expect(valueAfter(doc, 'Project No.')).not.toBe('pp-1');
  });

  it('the Projection ID is printed unchanged and is not the Project No.', async () => {
    const ds = await buildPaymentProjectionDataset('p1', 'pp-1');
    const doc = generatePaymentProjectionPdf(ds);
    expect(valueAfter(doc, 'Projection ID')).toBe('pp-1');
    expect(valueAfter(doc, 'Project No.')).toBe('C-1');
  });

  it('a projection whose stored projectId names another project is refused, and nothing is written', async () => {
    costService.getPaymentProjections.mockResolvedValue([{ ...PP, projectId: 'p2' }]);
    await expect(buildPaymentProjectionDataset('p1', 'pp-1')).rejects.toThrow('Payment Projection "pp-1" is linked to project "p2", not "p1"; the PDF was not generated.');
    noWrites();
  });
});
