import { describe, it, expect, vi } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: true }));
// In Local Mode the Firebase service must never be touched. Only these names are
// provided; ANY other access to the mocked module throws, so an accidental
// Firebase call fails loudly, and the spies below prove none of these is called.
vi.mock('../firebase/projectDetailService', () => ({
  getEngineeringDocuments: vi.fn(), addEngineeringDocument: vi.fn(), updateEngineeringDocument: vi.fn(),
  getHseDocuments: vi.fn(), addHseDocument: vi.fn(), updateHseDocument: vi.fn(),
}));
import fs from 'node:fs';
import * as fb from '../firebase/projectDetailService';
import {
  getEngineeringDocuments, createEngineeringDocument, updateEngineeringDocument,
  getHseDocuments, createHseDocument, updateHseDocument,
} from './projectDetailRepository';
import { getOperations, REVIEW_STATUSES, HSE_STATUSES } from '../../data/mockOperationalData';
import { buildWeeklyReportDataset } from './reportRepository';
import { initialProjects } from '../../data/mockProjects';

// Final UAT Patch A -- Engineering Document No. (docId), Review Status and HSE
// status editing. Local Mode (mock store) only: nothing here reaches Firebase,
// real Firestore, or Firestore Rules. Source-level assertions are text checks:
// they show how the code is written, not how a browser behaves (no React
// component tests exist in this repo -- the controls need manual UAT).
const pidA = initialProjects[2].id;
const pidB = initialProjects[3].id;
const pidReport = initialProjects[5].id;
const eng = (over = {}) => ({ docId: 'DWG-001', name: 'Layout', category: 'Engineering Drawing', weight: 5, reviewStatus: 'COMMENTED', progressContribution: 40, responsibleEngineer: 'E', ...over });
const hse = (over = {}) => ({ name: 'Permit', category: 'Permit', weight: 5, status: 'Pending', progressContribution: 30, responsibleHse: 'H', ...over });
const engDocs = (pid) => getOperations(pid).engineeringDocuments;
const hseDocs = (pid) => getOperations(pid).hseDocuments;
const find = (list, id) => list.find((d) => d.id === id);
const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('1. Engineering Document No. is required', () => {
  it('empty, whitespace-only, and missing numbers are rejected and nothing is stored', async () => {
    const before = engDocs(pidA).length;
    await expect(createEngineeringDocument(pidA, eng({ docId: '' }))).rejects.toThrow('Document No. is required.');
    await expect(createEngineeringDocument(pidA, eng({ docId: '   ' }))).rejects.toThrow('Document No. is required.');
    const { docId, ...noNumber } = eng(); void docId;
    await expect(createEngineeringDocument(pidA, noNumber)).rejects.toThrow('Document No. is required.');
    expect(engDocs(pidA)).toHaveLength(before);
  });
});

describe('2. Document No. is trimmed; the internal id stays separate and automatic', () => {
  it('stores the trimmed number, with a different, auto-generated internal id', async () => {
    const created = await createEngineeringDocument(pidA, eng({ docId: '  DWG-TRIM-1  ' }));
    expect(created.docId).toBe('DWG-TRIM-1');
    expect(find(engDocs(pidA), created.id).docId).toBe('DWG-TRIM-1');
    expect(created.id).not.toBe(created.docId);
    expect(created.id).toMatch(new RegExp(`^${pidA}-eng-`));
  });

  it('a caller cannot supply the internal id', async () => {
    await expect(createEngineeringDocument(pidA, { ...eng({ docId: 'DWG-ID-1' }), id: 'my-own-id' })).rejects.toThrow('internal document id is generated automatically');
  });
});

describe('3/4. Uniqueness per project, case-insensitive', () => {
  it('a duplicate in the SAME project is rejected whatever its case or surrounding spaces; nothing is stored', async () => {
    await createEngineeringDocument(pidA, eng({ docId: 'DWG-CASE-1' }));
    const before = engDocs(pidA).length;
    for (const dup of ['DWG-CASE-1', 'dwg-case-1', 'Dwg-Case-1', '  DWG-CASE-1 ', ' dWg-CaSe-1']) {
      await expect(createEngineeringDocument(pidA, eng({ docId: dup })), dup).rejects.toThrow(/already used in this project/);
    }
    expect(engDocs(pidA)).toHaveLength(before);
  });

  it('the same number is allowed in a DIFFERENT project', async () => {
    await createEngineeringDocument(pidA, eng({ docId: 'DWG-SHARED-1' }));
    await expect(createEngineeringDocument(pidB, eng({ docId: 'DWG-SHARED-1' }))).resolves.toMatchObject({ docId: 'DWG-SHARED-1' });
    await expect(createEngineeringDocument(pidB, eng({ docId: 'dwg-shared-1' }))).rejects.toThrow(/already used in this project/);
  });

  it('a different number in the same project is accepted', async () => {
    await createEngineeringDocument(pidA, eng({ docId: 'DWG-UNIQ-1' }));
    await expect(createEngineeringDocument(pidA, eng({ docId: 'DWG-UNIQ-2' }))).resolves.toMatchObject({ docId: 'DWG-UNIQ-2' });
  });
});

describe('5. Legacy records without docId remain readable and never conflict', () => {
  it('documents with no / empty docId are listed unchanged and do not block new numbers', async () => {
    engDocs(pidA).unshift({ id: 'legacy-a', name: 'Legacy A', reviewStatus: 'APPROVED', progressContribution: 20 });
    engDocs(pidA).unshift({ id: 'legacy-b', name: 'Legacy B', docId: '', reviewStatus: 'REJECTED', progressContribution: 10 });
    const listed = await getEngineeringDocuments(pidA);
    expect(listed.find((d) => d.id === 'legacy-a')).toMatchObject({ name: 'Legacy A', reviewStatus: 'APPROVED' });
    expect(listed.find((d) => d.id === 'legacy-b')).toMatchObject({ name: 'Legacy B', docId: '' });
    await expect(createEngineeringDocument(pidA, eng({ docId: 'DWG-LEGACY-OK' }))).resolves.toMatchObject({ docId: 'DWG-LEGACY-OK' });
  });
});

describe('6. Document No. cannot be changed after creation', () => {
  it('an update that carries docId (or the internal id) is rejected and nothing changes', async () => {
    const doc = await createEngineeringDocument(pidA, eng({ docId: 'DWG-LOCK-1' }));
    const snapshot = JSON.stringify(find(engDocs(pidA), doc.id));
    await expect(updateEngineeringDocument(pidA, doc.id, { docId: 'DWG-LOCK-2' }, 'Eng User')).rejects.toThrow('Document No. cannot be changed after creation.');
    await expect(updateEngineeringDocument(pidA, doc.id, { docId: 'DWG-LOCK-1', reviewStatus: 'APPROVED' }, 'Eng User')).rejects.toThrow('cannot be changed');
    await expect(updateEngineeringDocument(pidA, doc.id, { id: 'other' }, 'Eng User')).rejects.toThrow('internal document id cannot be changed');
    expect(JSON.stringify(find(engDocs(pidA), doc.id))).toBe(snapshot);
  });
});

describe('7/8/9. Engineering Review Status', () => {
  it('every canonical status can be set, and nothing but the status and the audit fields changes', async () => {
    const doc = await createEngineeringDocument(pidA, eng({ docId: 'DWG-RS-1', reviewStatus: 'COMMENTED', progressContribution: 40, weight: 7 }));
    for (const status of REVIEW_STATUSES) {
      const before = { ...find(engDocs(pidA), doc.id) };
      const updated = await updateEngineeringDocument(pidA, doc.id, { reviewStatus: status }, 'Eng User');
      expect(updated.reviewStatus).toBe(status);
      const { reviewStatus, updatedAt, updatedBy, ...rest } = updated; void reviewStatus; void updatedAt; void updatedBy;
      const { reviewStatus: _r, updatedAt: _a, updatedBy: _b, ...restBefore } = before; void _r; void _a; void _b;
      expect(rest).toEqual(restBefore); // docId, id, name, category, weight, progressContribution, responsibleEngineer untouched
    }
  });

  it('an invalid Review Status is rejected (including empty and undefined) and the document is unchanged', async () => {
    const doc = await createEngineeringDocument(pidA, eng({ docId: 'DWG-RS-2', reviewStatus: 'COMMENTED' }));
    const snapshot = JSON.stringify(find(engDocs(pidA), doc.id));
    for (const bad of ['DONE', 'approved', '', null, undefined]) {
      await expect(updateEngineeringDocument(pidA, doc.id, { reviewStatus: bad }, 'Eng User'), String(bad)).rejects.toThrow(/Invalid Review Status/);
    }
    expect(JSON.stringify(find(engDocs(pidA), doc.id))).toBe(snapshot);
  });

  it('an invalid Review Status is also rejected at creation', async () => {
    await expect(createEngineeringDocument(pidA, eng({ docId: 'DWG-RS-3', reviewStatus: 'NOPE' }))).rejects.toThrow(/Invalid Review Status/);
  });
});

describe('9. Review Status changes do not modify progressContribution (or anything else)', () => {
  it('progressContribution, weight and project progress are identical before and after a status change', async () => {
    const doc = await createEngineeringDocument(pidReport, eng({ docId: 'DWG-PROG-1', reviewStatus: 'REJECTED', progressContribution: 35, weight: 12 }));
    const ds = () => buildWeeklyReportDataset(pidReport, '2026-10-01', '2026-10-07');
    const before = await ds();
    await updateEngineeringDocument(pidReport, doc.id, { reviewStatus: 'APPROVED' }, 'Eng User');
    const after = await ds();
    expect(find(engDocs(pidReport), doc.id)).toMatchObject({ progressContribution: 35, weight: 12, reviewStatus: 'APPROVED' });
    expect(after.progress.overall).toBe(before.progress.overall); // Progress Engine reads contributions, not statuses
  });
});

describe('audit metadata (updatedBy / updatedAt)', () => {
  it('is stamped with the acting user and an ISO timestamp, and a patch cannot spoof it', async () => {
    const doc = await createEngineeringDocument(pidA, eng({ docId: 'DWG-AUD-1' }));
    const updated = await updateEngineeringDocument(pidA, doc.id, { reviewStatus: 'APPROVED', updatedBy: 'Hacker', updatedAt: '1999-01-01' }, 'Eng User');
    expect(updated.updatedBy).toBe('Eng User');
    expect(new Date(updated.updatedAt).toISOString()).toBe(updated.updatedAt);
    expect(updated.updatedAt).not.toBe('1999-01-01');
  });

  it('without an actor, updatedBy is null (never undefined: Firestore rejects undefined)', async () => {
    const doc = await createEngineeringDocument(pidA, eng({ docId: 'DWG-AUD-2' }));
    const updated = await updateEngineeringDocument(pidA, doc.id, { reviewStatus: 'APPROVED' });
    expect(updated.updatedBy).toBeNull();
  });

  it('the existing progress edit still works, is stamped too, and leaves the Review Status alone', async () => {
    const doc = await createEngineeringDocument(pidA, eng({ docId: 'DWG-AUD-3', reviewStatus: 'APPROVED', progressContribution: 10 }));
    const updated = await updateEngineeringDocument(pidA, doc.id, { progressContribution: 80 }, 'Eng User');
    expect(updated).toMatchObject({ progressContribution: 80, reviewStatus: 'APPROVED', updatedBy: 'Eng User' });
  });
});

describe('10/11. HSE status', () => {
  it('both canonical statuses can be set; progressContribution and every other field are untouched', async () => {
    const item = await createHseDocument(pidA, hse({ progressContribution: 30, weight: 9 }));
    for (const status of HSE_STATUSES) {
      const updated = await updateHseDocument(pidA, item.id, { status }, 'HSE User');
      expect(updated).toMatchObject({ status, progressContribution: 30, weight: 9, name: 'Permit', updatedBy: 'HSE User' });
    }
  });

  it('an invalid HSE status is rejected (update and create) and nothing changes', async () => {
    const item = await createHseDocument(pidA, hse());
    const snapshot = JSON.stringify(find(hseDocs(pidA), item.id));
    for (const bad of ['Closed', 'valid / closed', '', null, undefined]) {
      await expect(updateHseDocument(pidA, item.id, { status: bad }, 'HSE User'), String(bad)).rejects.toThrow(/Invalid HSE status/);
    }
    expect(JSON.stringify(find(hseDocs(pidA), item.id))).toBe(snapshot);
    const before = hseDocs(pidA).length;
    await expect(createHseDocument(pidA, hse({ status: 'WRONG' }))).rejects.toThrow(/Invalid HSE status/);
    expect(hseDocs(pidA)).toHaveLength(before);
  });

  it('the internal id cannot be supplied or changed; creation without a status (legacy callers) still works; the progress edit is stamped', async () => {
    await expect(createHseDocument(pidA, { ...hse(), id: 'mine' })).rejects.toThrow('internal item id is generated automatically');
    const { status, ...noStatus } = hse(); void status;
    const item = await createHseDocument(pidA, noStatus);
    await expect(updateHseDocument(pidA, item.id, { id: 'other' }, 'HSE User')).rejects.toThrow('internal item id cannot be changed');
    expect(await updateHseDocument(pidA, item.id, { progressContribution: 55 }, 'HSE User')).toMatchObject({ progressContribution: 55, updatedBy: 'HSE User' });
  });

  it('the canonical status values are exactly the ones the reports and seed data already use', () => {
    expect(HSE_STATUSES).toEqual(['Pending', 'Valid / Closed']);
    expect(REVIEW_STATUSES).toEqual(['APPROVED', 'COMMENTED', 'REJECTED']);
  });
});

describe('15. Existing report behaviour stays correct', () => {
  it('the weekly report status counts follow Engineering and HSE status edits, totals and progress unchanged', async () => {
    const pid = initialProjects[6].id;
    const e = await createEngineeringDocument(pid, eng({ docId: 'DWG-RPT-1', reviewStatus: 'COMMENTED' }));
    const h = await createHseDocument(pid, hse({ status: 'Pending' }));
    const ds = () => buildWeeklyReportDataset(pid, '2026-10-01', '2026-10-07');
    const before = await ds();
    await updateEngineeringDocument(pid, e.id, { reviewStatus: 'APPROVED' }, 'Eng User');
    await updateHseDocument(pid, h.id, { status: 'Valid / Closed' }, 'HSE User');
    const after = await ds();
    expect(after.projectStatus.engineering.approved).toBe(before.projectStatus.engineering.approved + 1);
    expect(after.projectStatus.engineering.commented).toBe(before.projectStatus.engineering.commented - 1);
    expect(after.projectStatus.engineering.total).toBe(before.projectStatus.engineering.total);
    expect(after.projectStatus.hse.validClosed).toBe(before.projectStatus.hse.validClosed + 1);
    expect(after.projectStatus.hse.pending).toBe(before.projectStatus.hse.pending - 1);
    expect(after.projectStatus.hse.total).toBe(before.projectStatus.hse.total);
    expect(after.progress.overall).toBe(before.progress.overall);
  });
});

describe('13. Local Mode never calls Firebase', () => {
  it('every operation above path (create, list, update, status edits, HSE) leaves the Firebase service untouched', async () => {
    const e = await createEngineeringDocument(pidA, eng({ docId: 'DWG-LOCAL-1' }));
    await getEngineeringDocuments(pidA);
    await updateEngineeringDocument(pidA, e.id, { reviewStatus: 'REJECTED' }, 'Eng User');
    const h = await createHseDocument(pidA, hse());
    await getHseDocuments(pidA);
    await updateHseDocument(pidA, h.id, { status: 'Valid / Closed' }, 'HSE User');
    for (const fn of Object.keys(fb)) expect(fb[fn], fn).not.toHaveBeenCalled();
  });
});

describe('12. Existing role and assignment restrictions remain intact (source-level)', () => {
  it('the UI role lists are unchanged, every mutating handler re-checks them, and the new controls render only for authorized users', () => {
    const engSrc = read('../../pages/Projects/detail/EngineeringTab.jsx');
    const hseSrc = read('../../pages/Projects/detail/HseTab.jsx');
    expect(engSrc).toMatch(/const CAN_MANAGE = \[ROLES\.ENGINEERING, ROLES\.SUPER_ADMIN\];/);
    expect(hseSrc).toMatch(/const CAN_MANAGE = \[ROLES\.HSE, ROLES\.SUPER_ADMIN\];/);
    expect(engSrc.match(/if \(!canManage\) return;/g).length).toBeGreaterThanOrEqual(3); // contribution, status, create
    expect(hseSrc.match(/if \(!canManage\) return;/g).length).toBeGreaterThanOrEqual(3);
    expect(engSrc).toMatch(/\{canManage \? \(\s*<TextField\s+select size="small" value=\{d\.reviewStatus/);
    expect(hseSrc).toMatch(/\{canManage \? \(\s*<TextField\s+select size="small" value=\{d\.status/);
  });

  it('Document No. is no longer generated: no Date.now() remains in the Engineering tab, and the form has a required Document No. field', () => {
    const engSrc = read('../../pages/Projects/detail/EngineeringTab.jsx');
    expect(engSrc).not.toMatch(/Date\.now\(\)/);
    expect(engSrc).not.toMatch(/ENG-\$\{/);
    expect(engSrc).toMatch(/label="Document No\." required/);
  });

  it('the Firestore rules for both collections are exactly as before (role + assignment) and this patch relies on, but does not change, them', () => {
    const rules = read('../../../firestore.rules');
    expect(rules).toMatch(/match \/engineeringDocuments\/\{docId\} \{[\s\S]*?allow write: if hasRole\(\['SUPER_ADMIN', 'ENGINEERING'\]\) && isAssignedToProject\(projectId\) \|\| isSuperAdmin\(\);/);
    expect(rules).toMatch(/match \/hseItems\/\{itemId\} \{[\s\S]*?allow write: if hasRole\(\['SUPER_ADMIN', 'HSE'\]\) && isAssignedToProject\(projectId\) \|\| isSuperAdmin\(\);/);
  });
});
