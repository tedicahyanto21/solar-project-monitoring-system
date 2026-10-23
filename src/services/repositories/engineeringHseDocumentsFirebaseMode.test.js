import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: false }));
vi.mock('../firebase/projectDetailService', () => ({
  getEngineeringDocuments: vi.fn(), addEngineeringDocument: vi.fn(), updateEngineeringDocument: vi.fn(),
  getHseDocuments: vi.fn(), addHseDocument: vi.fn(), updateHseDocument: vi.fn(),
}));
import * as fb from '../firebase/projectDetailService';
import {
  getEngineeringDocuments, createEngineeringDocument, updateEngineeringDocument,
  createHseDocument, updateHseDocument,
} from './projectDetailRepository';
import { getOperations } from '../../data/mockOperationalData';
import { initialProjects } from '../../data/mockProjects';

// Final UAT Patch A -- Firebase-mode structure. The Firebase SERVICE is mocked,
// so these tests prove WHAT the repository sends to it (exactly the intended
// fields, validated, audited) and that the mock operational store is NOT used
// as the data source in this mode. They do not prove real Firestore, or
// Firestore Rules, accept the writes: no emulator or live project is involved.
const pid = initialProjects[2].id;
const eng = (over = {}) => ({ docId: 'DWG-FB-1', name: 'Layout', category: 'Engineering Drawing', weight: 5, reviewStatus: 'COMMENTED', progressContribution: 40, responsibleEngineer: 'E', ...over });
const hse = (over = {}) => ({ name: 'Permit', category: 'Permit', weight: 5, status: 'Pending', progressContribution: 30, responsibleHse: 'H', ...over });
const keys = (o) => Object.keys(o).sort();

beforeEach(() => {
  vi.clearAllMocks();
  fb.getEngineeringDocuments.mockResolvedValue([]);
  fb.addEngineeringDocument.mockImplementation(async (_p, doc) => ({ id: 'auto-firestore-id', ...doc }));
  fb.updateEngineeringDocument.mockImplementation(async (_p, id, patch) => ({ id, ...patch }));
  fb.addHseDocument.mockImplementation(async (_p, doc) => ({ id: 'auto-hse-id', ...doc }));
  fb.updateHseDocument.mockImplementation(async (_p, id, patch) => ({ id, ...patch }));
});

describe('14. Firebase-mode create sends only the intended, validated payload', () => {
  it('the trimmed Document No. is sent with the form fields, with no internal id; the service is called once', async () => {
    const created = await createEngineeringDocument(pid, eng({ docId: '  DWG-FB-1  ' }));
    expect(fb.addEngineeringDocument).toHaveBeenCalledTimes(1);
    const [projectArg, payload] = fb.addEngineeringDocument.mock.calls[0];
    expect(projectArg).toBe(pid);
    expect(payload.docId).toBe('DWG-FB-1');
    expect('id' in payload).toBe(false);
    expect(keys(payload)).toEqual(keys(eng()));
    expect(created.id).toBe('auto-firestore-id'); // the internal id is the one the service generated, separate from docId
  });

  it('uniqueness is checked against what the FIREBASE service returns (case-insensitive), legacy records are ignored, and a clash writes nothing', async () => {
    fb.getEngineeringDocuments.mockResolvedValue([
      { id: 'a', docId: 'DWG-FB-1', name: 'Existing' },
      { id: 'legacy', name: 'No docId at all' },
    ]);
    await expect(createEngineeringDocument(pid, eng({ docId: 'dwg-fb-1' }))).rejects.toThrow(/already used in this project/);
    expect(fb.addEngineeringDocument).not.toHaveBeenCalled();
    await expect(createEngineeringDocument(pid, eng({ docId: 'DWG-FB-2' }))).resolves.toMatchObject({ docId: 'DWG-FB-2' });
    expect(fb.getEngineeringDocuments).toHaveBeenCalledWith(pid);
  });

  it('a missing Document No. or an invalid status writes nothing', async () => {
    await expect(createEngineeringDocument(pid, eng({ docId: '  ' }))).rejects.toThrow('Document No. is required.');
    await expect(createEngineeringDocument(pid, eng({ reviewStatus: 'NOPE' }))).rejects.toThrow(/Invalid Review Status/);
    await expect(createHseDocument(pid, hse({ status: 'WRONG' }))).rejects.toThrow(/Invalid HSE status/);
    expect(fb.addEngineeringDocument).not.toHaveBeenCalled();
    expect(fb.addHseDocument).not.toHaveBeenCalled();
  });
});

describe('14. Firebase-mode updates send ONLY the intended fields', () => {
  it('a Review Status change sends exactly reviewStatus + updatedAt + updatedBy -- never progressContribution', async () => {
    await updateEngineeringDocument(pid, 'doc-1', { reviewStatus: 'APPROVED' }, 'Eng User');
    const [projectArg, idArg, payload] = fb.updateEngineeringDocument.mock.calls[0];
    expect([projectArg, idArg]).toEqual([pid, 'doc-1']);
    expect(keys(payload)).toEqual(['reviewStatus', 'updatedAt', 'updatedBy']);
    expect(payload).toMatchObject({ reviewStatus: 'APPROVED', updatedBy: 'Eng User' });
    expect(new Date(payload.updatedAt).toISOString()).toBe(payload.updatedAt);
  });

  it('the existing progress edit sends exactly progressContribution + audit; an HSE status change sends exactly status + audit', async () => {
    await updateEngineeringDocument(pid, 'doc-1', { progressContribution: 75 }, 'Eng User');
    expect(keys(fb.updateEngineeringDocument.mock.calls[0][2])).toEqual(['progressContribution', 'updatedAt', 'updatedBy']);
    await updateHseDocument(pid, 'hse-1', { status: 'Valid / Closed' }, 'HSE User');
    const hsePayload = fb.updateHseDocument.mock.calls[0][2];
    expect(keys(hsePayload)).toEqual(['status', 'updatedAt', 'updatedBy']);
    expect(hsePayload).toMatchObject({ status: 'Valid / Closed', updatedBy: 'HSE User' });
  });

  it('a patch cannot spoof the audit fields, and a missing actor becomes null (never undefined)', async () => {
    await updateEngineeringDocument(pid, 'doc-1', { reviewStatus: 'REJECTED', updatedBy: 'Hacker' });
    const payload = fb.updateEngineeringDocument.mock.calls[0][2];
    expect(payload.updatedBy).toBeNull();
    expect(Object.values(payload).includes(undefined)).toBe(false);
  });

  it('a changed Document No., an internal-id change, or an invalid status is rejected before the service is called', async () => {
    await expect(updateEngineeringDocument(pid, 'doc-1', { docId: 'NEW' }, 'Eng User')).rejects.toThrow('cannot be changed after creation');
    await expect(updateEngineeringDocument(pid, 'doc-1', { id: 'x' }, 'Eng User')).rejects.toThrow('cannot be changed');
    await expect(updateEngineeringDocument(pid, 'doc-1', { reviewStatus: 'DONE' }, 'Eng User')).rejects.toThrow(/Invalid Review Status/);
    await expect(updateHseDocument(pid, 'hse-1', { status: 'Closed' }, 'HSE User')).rejects.toThrow(/Invalid HSE status/);
    expect(fb.updateEngineeringDocument).not.toHaveBeenCalled();
    expect(fb.updateHseDocument).not.toHaveBeenCalled();
  });
});

describe('Firebase mode does not use the mock operational store as its data source', () => {
  it('reads come from the Firebase service and the mock store is byte-identical after create and update', async () => {
    fb.getEngineeringDocuments.mockResolvedValue([{ id: 'only-in-firebase', docId: 'FB-ONLY', name: 'x' }]);
    const before = JSON.stringify(getOperations(pid));
    const listed = await getEngineeringDocuments(pid);
    expect(listed.map((d) => d.id)).toEqual(['only-in-firebase']); // not the seeded mock documents
    await createEngineeringDocument(pid, eng({ docId: 'DWG-FB-9' }));
    await updateEngineeringDocument(pid, 'only-in-firebase', { reviewStatus: 'APPROVED' }, 'Eng User');
    await createHseDocument(pid, hse());
    await updateHseDocument(pid, 'h', { status: 'Valid / Closed' }, 'HSE User');
    expect(JSON.stringify(getOperations(pid))).toBe(before);
  });
});
