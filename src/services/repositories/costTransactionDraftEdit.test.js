import { describe, it, expect, vi } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: true }));
// Local Mode must never touch the Firebase cost service. Every function the
// repository can route to is provided as a spy; any OTHER access to the mocked
// module throws, so an accidental Firebase call fails loudly, and the final
// test proves none of the spies was called.
vi.mock('../firebase/costService', () => ({
  checkDuplicateTransaction: vi.fn(), createCostTransaction: vi.fn(), createPaymentProjection: vi.fn(),
  getCostTransactions: vi.fn(), getPaymentProjections: vi.fn(), getPlannedCost: vi.fn(), markPaymentProjectionPaid: vi.fn(),
  postCostTransaction: vi.fn(), setPlannedCost: vi.fn(), updateDraftCostTransaction: vi.fn(), voidCostTransaction: vi.fn(),
}));
import fs from 'node:fs';
import * as fb from '../firebase/costService';
import {
  createCostTransaction, updateDraftCostTransaction, postCostTransaction, voidCostTransaction, getCostTransactions,
  checkDuplicateTransaction, createPaymentProjection, getProjectCostSummary, calculateProjectionTotal,
} from './costRepository';
import { AMOUNT_ERROR, DRAFT_EDITABLE_FIELDS } from '../costTransactionEdit';
import { getOperations } from '../../data/mockOperationalData';
import { initialProjects } from '../../data/mockProjects';

// Final UAT Patch B -- Cost Transaction Draft editing and the shared Amount
// rule. Everything here goes through the REPOSITORY (the path the UI uses) in
// Local Mode, against the mock store: nothing reaches Firebase, real
// Firestore, or Firestore Rules. Firebase-mode behaviour is covered, with the
// SDK/service mocked, in costTransactionDraftEditRouting.test.js and
// services/firebase/costService.draftEdit.test.js.
const pid = initialProjects[8].id;
const SCM = { role: 'SCM', name: 'SCM User' };
const HC = { role: 'HC', name: 'HC User' };
const SUPER = { role: 'SUPER_ADMIN', name: 'Admin User' };
let seq = 0;
const pad = (n) => String(n).padStart(2, '0');
const stored = (id) => getOperations(pid).costTransactions.find((t) => t.transactionId === id);
const count = () => getOperations(pid).costTransactions.length;
const snap = (id) => JSON.stringify(stored(id));
const base = (over = {}) => {
  seq += 1;
  return {
    transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM', createdBy: 'SCM User',
    amount: 5_000_000 + seq * 1000, transactionDate: `2026-11-${pad(1 + (seq % 27))}`,
    referenceNumber: `EDIT-${seq}`, invoiceNumber: '', description: `Draft ${seq}`, ...over,
  };
};
const draft = (over = {}) => createCostTransaction(pid, base(over));
const outcome = async (fn) => { try { await fn(); return 'accepted'; } catch (e) { return e.message; } };

const INVALID_AMOUNTS = ['', '   ', 0, '0', -5, '-5', 'abc', '12abc', '1,000', '0x10', 'Infinity', NaN, Infinity, -Infinity, null, undefined, true, [], {}];
const VALID_AMOUNTS = [1, 0.5, 1500, '1500', ' 2500.50 ', '1e3', 1e12];

describe('Amount rule -- creation: a finite number greater than zero', () => {
  it('every invalid amount is rejected with a clear message and nothing is written', async () => {
    const before = count();
    for (const bad of INVALID_AMOUNTS) {
      await expect(createCostTransaction(pid, base({ amount: bad })), String(bad)).rejects.toThrow(AMOUNT_ERROR);
    }
    expect(count()).toBe(before);
  });

  it('valid amounts (numbers and numeric text) are accepted and stored as numbers', async () => {
    for (const ok of VALID_AMOUNTS) {
      const t = await createCostTransaction(pid, base({ amount: ok }));
      expect(typeof t.amount).toBe('number');
      expect(t.amount).toBe(Number(String(ok).trim()));
      expect(stored(t.transactionId).amount).toBe(t.amount);
    }
  });
});

describe('Amount rule -- editing applies exactly the same rule', () => {
  it('every invalid amount is rejected and the Draft is unchanged', async () => {
    const d = await draft();
    const before = snap(d.transactionId);
    for (const bad of INVALID_AMOUNTS) {
      await expect(updateDraftCostTransaction(pid, d.transactionId, { amount: bad }, SCM), String(bad)).rejects.toThrow(AMOUNT_ERROR);
    }
    expect(snap(d.transactionId)).toBe(before);
  });

  it('valid amounts are accepted and stored as numbers', async () => {
    const d = await draft();
    for (const ok of VALID_AMOUNTS) {
      const t = await updateDraftCostTransaction(pid, d.transactionId, { amount: ok }, SCM);
      expect(typeof t.amount).toBe('number');
      expect(t.amount).toBe(Number(String(ok).trim()));
    }
  });

  it('creation and editing give the same verdict for every value (one rule, not two)', async () => {
    const d = await draft();
    const all = [...INVALID_AMOUNTS, ...VALID_AMOUNTS];
    const created = [];
    const edited = [];
    for (const v of all) {
      created.push(await outcome(() => createCostTransaction(pid, base({ amount: v }))));
      edited.push(await outcome(() => updateDraftCostTransaction(pid, d.transactionId, { amount: v }, SCM)));
    }
    expect(edited).toEqual(created);
  });
});

describe('Draft editing -- the six allowed fields', () => {
  const NEW = { category: 'Procurement', description: 'Corrected description', amount: 9_876_543, transactionDate: '2026-12-05', referenceNumber: 'CORR-REF-1', invoiceNumber: 'INV-CORR-1' };

  it.each(DRAFT_EDITABLE_FIELDS)('%s can be changed on its own; everything else, including the DRAFT status, stays as it was', async (field) => {
    const d = await draft();
    const before = { ...stored(d.transactionId) };
    const updated = await updateDraftCostTransaction(pid, d.transactionId, { [field]: NEW[field] }, SCM);
    expect(updated[field]).toBe(NEW[field]);
    expect(stored(d.transactionId)).toEqual(updated);
    const { updatedAt, updatedBy, duplicateCheck, override, ...rest } = updated; void updatedAt; void updatedBy; void duplicateCheck; void override;
    const { [field]: _a, duplicateCheck: _d, override: _o, ...restBefore } = before; void _a; void _d; void _o;
    const { [field]: _b, ...restAfter } = rest; void _b;
    expect(restAfter).toEqual(restBefore);
    expect(updated.status).toBe('DRAFT');
  });

  it('all six together, trimmed, with updatedBy / updatedAt audit and the identity fields intact', async () => {
    const d = await draft();
    const before = { ...stored(d.transactionId) };
    // Unique reference/invoice here: CORR-REF-1 is already used by the single-field test above,
    // and the duplicate detection (correctly) blocks a second Draft with the same reference.
    const all = { ...NEW, referenceNumber: 'CORR-REF-ALL', invoiceNumber: 'INV-CORR-ALL' };
    const updated = await updateDraftCostTransaction(pid, d.transactionId, { ...all, description: '  Corrected description  ', referenceNumber: ' CORR-REF-ALL ' }, SCM);
    expect(updated).toMatchObject({ ...all, updatedBy: 'SCM User', status: 'DRAFT' });
    expect(new Date(updated.updatedAt).toISOString()).toBe(updated.updatedAt);
    for (const locked of ['transactionId', 'projectId', 'sourceRole', 'createdBy', 'createdAt', 'transactionType', 'relatedTransactionId', 'projectionId', 'currency']) {
      expect(updated[locked], locked).toEqual(before[locked]);
    }
  });

  it('an empty reference or invoice number is allowed (they are optional)', async () => {
    const d = await draft({ referenceNumber: 'HAS-REF', invoiceNumber: 'HAS-INV' });
    const updated = await updateDraftCostTransaction(pid, d.transactionId, { referenceNumber: '', invoiceNumber: '' }, SCM);
    expect(updated).toMatchObject({ referenceNumber: '', invoiceNumber: '' });
  });
});

describe('Draft editing -- locked fields are rejected explicitly (never silently dropped or applied)', () => {
  const LOCKED = ['transactionId', 'id', 'projectId', 'sourceRole', 'createdBy', 'createdAt', 'status', 'transactionType', 'relatedTransactionId', 'projectionId'];
  const SYSTEM = ['duplicateCheck', 'override', 'updatedBy', 'updatedAt', 'currency', 'postedBy', 'postedAt', 'voidedBy', 'voidReason'];

  it.each([...LOCKED, ...SYSTEM])('%s cannot be edited', async (field) => {
    const d = await draft();
    const before = snap(d.transactionId);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { [field]: 'x' }, SCM)).rejects.toThrow(/Cannot edit/);
    expect(snap(d.transactionId)).toBe(before);
  });

  it('a valid change combined with a locked field is rejected as a whole -- nothing is applied', async () => {
    const d = await draft();
    const before = snap(d.transactionId);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { description: 'would be applied', status: 'POSTED' }, SCM)).rejects.toThrow(/Cannot edit status/);
    expect(snap(d.transactionId)).toBe(before);
  });

  it('a whole transaction object cannot be passed through as the patch', async () => {
    const d = await draft();
    const before = snap(d.transactionId);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { ...stored(d.transactionId), description: 'new' }, SCM)).rejects.toThrow(/Cannot edit/);
    expect(snap(d.transactionId)).toBe(before);
  });

  it('an unknown field is rejected, and an empty or missing patch is rejected', async () => {
    const d = await draft();
    await expect(updateDraftCostTransaction(pid, d.transactionId, { surprise: 1 }, SCM)).rejects.toThrow(/Cannot edit surprise/);
    for (const empty of [{}, null, undefined, []]) await expect(updateDraftCostTransaction(pid, d.transactionId, empty, SCM)).rejects.toThrow('No changes were supplied.');
  });

  it('the editable-field list is exactly the six approved fields', () => {
    expect(DRAFT_EDITABLE_FIELDS).toEqual(['category', 'description', 'amount', 'transactionDate', 'referenceNumber', 'invoiceNumber']);
  });
});

describe('Draft editing -- lifecycle: only an unallocated DRAFT', () => {
  it('a POSTED transaction is rejected and unchanged', async () => {
    const d = await draft();
    await postCostTransaction(pid, d.transactionId, 'SCM User');
    const before = snap(d.transactionId);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { description: 'x' }, SCM)).rejects.toThrow('Only a DRAFT Cost Transaction can be edited (current status: POSTED).');
    expect(snap(d.transactionId)).toBe(before);
  });

  it('a VOID transaction is rejected and unchanged', async () => {
    const d = await draft();
    await postCostTransaction(pid, d.transactionId, 'SCM User');
    await voidCostTransaction(pid, d.transactionId, { voidedBy: 'Admin', voidReason: 'entered in error' });
    const before = snap(d.transactionId);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { description: 'x' }, SUPER)).rejects.toThrow('current status: VOID');
    expect(snap(d.transactionId)).toBe(before);
  });

  it('a transaction allocated to a Payment Projection is rejected (real allocation of a POSTED transaction)', async () => {
    const d = await draft();
    await postCostTransaction(pid, d.transactionId, 'SCM User');
    const pp = await createPaymentProjection(pid, { costTransactionIds: [d.transactionId], createdBy: 'SCM User' });
    const before = snap(d.transactionId);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { amount: 1 }, SUPER)).rejects.toThrow(/(allocated|current status: POSTED)/);
    expect(snap(d.transactionId)).toBe(before);
    expect(stored(d.transactionId).projectionId).toBe(pp.projectionId);
  });

  it('a DRAFT that somehow carries a projectionId is rejected as allocated', async () => {
    const d = await draft();
    stored(d.transactionId).projectionId = 'pp-ghost';
    const before = snap(d.transactionId);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { description: 'x' }, SUPER)).rejects.toThrow(/is allocated to Payment Projection "pp-ghost"/);
    expect(snap(d.transactionId)).toBe(before);
  });

  it('an unknown transaction id is rejected (never reported as a success)', async () => {
    await expect(updateDraftCostTransaction(pid, 'CST-NOPE', { description: 'x' }, SCM)).rejects.toThrow('Cost Transaction was not found.');
    await expect(updateDraftCostTransaction('no-such-project', 'CST-1', { description: 'x' }, SCM)).rejects.toThrow(/not found/);
  });
});

describe('Draft editing -- ownership: the source role, or Super Admin', () => {
  it('the role recorded as sourceRole can edit', async () => {
    const d = await draft({ sourceRole: 'SCM' });
    await expect(updateDraftCostTransaction(pid, d.transactionId, { description: 'by owner' }, SCM)).resolves.toMatchObject({ description: 'by owner', updatedBy: 'SCM User' });
    const h = await draft({ sourceRole: 'HC' });
    await expect(updateDraftCostTransaction(pid, h.transactionId, { description: 'by HC' }, HC)).resolves.toMatchObject({ description: 'by HC' });
  });

  it('Super Admin can edit a Draft of any source role, and sourceRole is NOT changed to Super Admin', async () => {
    const d = await draft({ sourceRole: 'SCM' });
    const updated = await updateDraftCostTransaction(pid, d.transactionId, { description: 'by admin' }, SUPER);
    expect(updated).toMatchObject({ description: 'by admin', updatedBy: 'Admin User', sourceRole: 'SCM', createdBy: 'SCM User' });
  });

  it('any other role -- or no actor at all -- is rejected and the Draft is unchanged', async () => {
    const d = await draft({ sourceRole: 'SCM' });
    const before = snap(d.transactionId);
    for (const actor of [HC, { role: 'FINANCE', name: 'F' }, { role: 'PROJECT_MANAGER', name: 'P' }, { role: 'ENGINEERING', name: 'E' }, { role: undefined, name: 'x' }, {}, null, undefined]) {
      await expect(updateDraftCostTransaction(pid, d.transactionId, { description: 'intruder' }, actor), JSON.stringify(actor)).rejects.toThrow(/Only the role that created this Draft/);
    }
    expect(snap(d.transactionId)).toBe(before);
  });
});

describe('Draft editing -- field validation, all-or-nothing', () => {
  it('category and description are required', async () => {
    const d = await draft();
    for (const bad of ['', '   ', null, undefined, 5]) {
      await expect(updateDraftCostTransaction(pid, d.transactionId, { category: bad }, SCM), `category ${String(bad)}`).rejects.toThrow('Category is required.');
      await expect(updateDraftCostTransaction(pid, d.transactionId, { description: bad }, SCM), `description ${String(bad)}`).rejects.toThrow('Description is required.');
    }
  });

  it('the transaction date must be a real YYYY-MM-DD date', async () => {
    const d = await draft();
    for (const bad of ['', '2026-13-01', '2026-02-30', '11/05/2026', '2026-1-5', 20261105, null, undefined]) {
      await expect(updateDraftCostTransaction(pid, d.transactionId, { transactionDate: bad }, SCM), String(bad)).rejects.toThrow('Transaction Date must be a valid date (YYYY-MM-DD).');
    }
    await expect(updateDraftCostTransaction(pid, d.transactionId, { transactionDate: '2028-02-29' }, SCM)).resolves.toMatchObject({ transactionDate: '2028-02-29' });
  });

  it('reference and invoice numbers must be text', async () => {
    const d = await draft();
    await expect(updateDraftCostTransaction(pid, d.transactionId, { referenceNumber: 42 }, SCM)).rejects.toThrow('Reference Number must be text.');
    await expect(updateDraftCostTransaction(pid, d.transactionId, { invoiceNumber: {} }, SCM)).rejects.toThrow('Invoice Number must be text.');
  });

  it('a failed validation stores nothing, even when other fields in the same patch are valid', async () => {
    const d = await draft();
    const before = snap(d.transactionId);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { description: 'valid change', amount: -1 }, SCM)).rejects.toThrow(AMOUNT_ERROR);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { amount: 123, transactionDate: 'not-a-date' }, SCM)).rejects.toThrow(/valid date/);
    expect(snap(d.transactionId)).toBe(before);
  });
});

describe('Draft editing -- duplicate detection (same semantics as creation, the Draft excluded from its own comparison)', () => {
  it('a Draft is not a duplicate of itself: the unexcluded check says STRONG, the edit path does not', async () => {
    const d = await draft({ referenceNumber: 'SELF-REF-1' });
    expect((await checkDuplicateTransaction(pid, stored(d.transactionId))).level).toBe('STRONG'); // would match itself
    expect((await checkDuplicateTransaction(pid, stored(d.transactionId), d.transactionId)).level).toBeNull();
    const updated = await updateDraftCostTransaction(pid, d.transactionId, { description: 'only the text changes' }, SCM);
    expect(updated.duplicateCheck).toBeNull();
  });

  it('omitting the exclusion leaves checkDuplicateTransaction exactly as it was (creation-time behaviour)', async () => {
    const other = await draft({ referenceNumber: 'OLD-REF-1' });
    const probe = { ...base(), referenceNumber: 'OLD-REF-1' };
    const withoutArg = await checkDuplicateTransaction(pid, probe);
    expect(withoutArg.level).toBe('STRONG');
    expect(withoutArg.reasons[0]).toContain(other.transactionId);
  });

  it('editing the reference to match ANOTHER transaction is a STRONG duplicate: blocked, nothing changes', async () => {
    const other = await draft({ referenceNumber: 'DUP-TARGET-1' });
    const d = await draft({ referenceNumber: 'DUP-OWN-1' });
    const before = snap(d.transactionId);
    const err = await updateDraftCostTransaction(pid, d.transactionId, { referenceNumber: ' dup-target-1 ' }, SCM).catch((e) => e);
    expect(err.message).toBe('Strong duplicate detected -- edit blocked.');
    expect(err.duplicate.level).toBe('STRONG');
    expect(err.duplicate.reasons[0]).toContain(other.transactionId);
    expect(snap(d.transactionId)).toBe(before);
  });

  it('the block also applies against a POSTED transaction, and a VOID one does not count', async () => {
    const posted = await draft({ referenceNumber: 'DUP-POSTED-1' });
    await postCostTransaction(pid, posted.transactionId, 'SCM User');
    const voided = await draft({ referenceNumber: 'DUP-VOID-1' });
    await postCostTransaction(pid, voided.transactionId, 'SCM User');
    await voidCostTransaction(pid, voided.transactionId, { voidedBy: 'Admin', voidReason: 'wrong' });
    const d = await draft({ referenceNumber: 'DUP-OWN-2' });
    await expect(updateDraftCostTransaction(pid, d.transactionId, { referenceNumber: 'DUP-POSTED-1' }, SCM)).rejects.toThrow('Strong duplicate detected -- edit blocked.');
    await expect(updateDraftCostTransaction(pid, d.transactionId, { referenceNumber: 'DUP-VOID-1' }, SCM)).resolves.toMatchObject({ referenceNumber: 'DUP-VOID-1' });
  });

  it('the existing Super Admin override policy applies unchanged: a valid override allows it and is recorded; any other is blocked', async () => {
    await draft({ referenceNumber: 'DUP-OVR-1' });
    const d = await draft({ referenceNumber: 'DUP-OVR-OWN' });
    const goodOverride = { confirmed: true, reason: 'verified with vendor', byRole: 'SUPER_ADMIN' };
    for (const bad of [undefined, { confirmed: true, reason: 'x', byRole: 'SCM' }, { confirmed: false, reason: 'x', byRole: 'SUPER_ADMIN' }, { confirmed: true, byRole: 'SUPER_ADMIN' }]) {
      await expect(updateDraftCostTransaction(pid, d.transactionId, { referenceNumber: 'DUP-OVR-1' }, SUPER, bad)).rejects.toThrow('Strong duplicate detected -- edit blocked.');
    }
    const updated = await updateDraftCostTransaction(pid, d.transactionId, { referenceNumber: 'DUP-OVR-1' }, SUPER, goodOverride);
    expect(updated.duplicateCheck.level).toBe('STRONG');
    expect(updated.override).toMatchObject({ confirmed: true, reason: 'verified with vendor', byRole: 'SUPER_ADMIN' });
    expect(new Date(updated.override.at).toISOString()).toBe(updated.override.at);
  });

  it('a POSSIBLE duplicate stays a warning: the edit is saved with the warning recorded, and cleared when no longer applicable', async () => {
    await draft({ amount: 777_000, category: 'Procurement', transactionDate: '2026-12-10', referenceNumber: 'POSS-A' });
    const d = await draft({ amount: 123_456, category: 'Procurement', transactionDate: '2026-12-12', referenceNumber: 'POSS-B' });
    const flagged = await updateDraftCostTransaction(pid, d.transactionId, { amount: 777_000 }, SCM);
    expect(flagged.amount).toBe(777_000);
    expect(flagged.duplicateCheck.level).toBe('POSSIBLE');
    expect(flagged.override).toBeNull();
    const cleared = await updateDraftCostTransaction(pid, d.transactionId, { amount: 321_321 }, SCM);
    expect(cleared.duplicateCheck).toBeNull();
  });
});

describe('Payment Projection and cost integrity', () => {
  it('editing a Draft never changes Actual Cost or any existing Payment Projection total', async () => {
    const anchor = await draft({ amount: 4_000_000 });
    await postCostTransaction(pid, anchor.transactionId, 'SCM User');
    const pp = await createPaymentProjection(pid, { costTransactionIds: [anchor.transactionId], createdBy: 'SCM User' });
    const totalBefore = calculateProjectionTotal(await getCostTransactions(pid), pp.projectionId);
    const actualBefore = (await getProjectCostSummary(pid)).actualCost;
    const d = await draft({ amount: 1_000_000 });
    await updateDraftCostTransaction(pid, d.transactionId, { amount: 2_500_000, description: 'edited' }, SCM);
    expect(calculateProjectionTotal(await getCostTransactions(pid), pp.projectionId)).toBe(totalBefore);
    expect((await getProjectCostSummary(pid)).actualCost).toBe(actualBefore); // DRAFT never counts
  });

  it('edit -> post -> allocate: the lifecycle works unchanged and the derived total uses the edited amount; after allocation the amount is frozen', async () => {
    const d = await draft({ amount: 1_000_000 });
    await updateDraftCostTransaction(pid, d.transactionId, { amount: 6_500_000 }, SCM);
    expect(stored(d.transactionId).status).toBe('DRAFT'); // the edit never posts
    const posted = await postCostTransaction(pid, d.transactionId, 'SCM User');
    expect(posted).toMatchObject({ status: 'POSTED', amount: 6_500_000 });
    const pp = await createPaymentProjection(pid, { costTransactionIds: [d.transactionId], createdBy: 'SCM User' });
    expect(calculateProjectionTotal(await getCostTransactions(pid), pp.projectionId)).toBe(6_500_000);
    await expect(updateDraftCostTransaction(pid, d.transactionId, { amount: 1 }, SUPER)).rejects.toThrow();
    expect(calculateProjectionTotal(await getCostTransactions(pid), pp.projectionId)).toBe(6_500_000);
  });

  it('posting and voiding behave as before for an edited Draft', async () => {
    const d = await draft();
    await updateDraftCostTransaction(pid, d.transactionId, { description: 'edited before posting' }, SCM);
    await expect(postCostTransaction(pid, d.transactionId, 'SCM User')).resolves.toMatchObject({ status: 'POSTED', description: 'edited before posting' });
    await expect(voidCostTransaction(pid, d.transactionId, { voidedBy: 'Admin', voidReason: 'test' })).resolves.toMatchObject({ status: 'VOID' });
  });
});

describe('UI wiring (source-level text checks -- no React component tests exist in this repo)', () => {
  const ui = fs.readFileSync(new URL('../../pages/CostControl/detail/CostLedgerTab.jsx', import.meta.url), 'utf8');

  it('the tab edits only through the repository and never reaches Firebase directly', () => {
    expect(ui).toMatch(/updateDraftCostTransaction[\s\S]*from '\.\.\/\.\.\/\.\.\/services\/repositories\/costRepository'/);
    expect(ui).not.toMatch(/firebase/i);
    expect(ui).not.toMatch(/mockOperationalData/);
  });

  it('Edit appears only for an unallocated DRAFT the user owns, and the handler re-checks it', () => {
    expect(ui).toMatch(/const canEdit = \(t\) => t\.status === 'DRAFT' && !t\.projectionId && ownsTransaction\(t\);/);
    expect(ui).toMatch(/\{canEdit\(t\) && \(\s*<Button size="small" onClick=\{\(\) => openEdit\(t\)\}>Edit<\/Button>/);
    expect(ui).toMatch(/if \(!tx \|\| !canEdit\(tx\)\) \{/);
  });

  it('the update payload is exactly the six fields, built explicitly -- the form object is never passed through', () => {
    const call = ui.match(/await updateDraftCostTransaction\(projectId, editing, \{([\s\S]*?)\}, \{ role/)[1];
    const keys = [...call.matchAll(/^\s+(\w+)(?::|,)/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual([...DRAFT_EDITABLE_FIELDS].sort());
    expect(call).not.toMatch(/\.\.\.form/);
  });

  it('the type / related-transaction controls are hidden while editing, and the amount is validated with the shared rule before saving', () => {
    expect(ui).toMatch(/\{isFinance && !editing && \(/);
    expect(ui.match(/parseAmount\(form\.amount\)/g).length).toBe(2); // create and edit
  });
});

describe('Local Mode never calls Firebase', () => {
  it('a full create / edit / post / void / allocate / duplicate-check flow leaves every Firebase cost-service function uncalled', async () => {
    const d = await draft();
    await updateDraftCostTransaction(pid, d.transactionId, { description: 'flow' }, SCM);
    await checkDuplicateTransaction(pid, stored(d.transactionId), d.transactionId);
    await postCostTransaction(pid, d.transactionId, 'SCM User');
    await createPaymentProjection(pid, { costTransactionIds: [d.transactionId], createdBy: 'SCM User' });
    await getCostTransactions(pid);
    for (const fn of Object.keys(fb)) expect(fb[fn], fn).not.toHaveBeenCalled();
  });
});
