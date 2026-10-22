import { describe, it, expect, vi } from 'vitest';
vi.mock('../firebase/config', () => ({ isLocalMode: true }));
import fs from 'node:fs';
import {
  getOperations, createCostTransaction, postCostTransaction, createPaymentProjection, markPaymentProjectionPaid,
} from '../../data/mockOperationalData';
import { buildPaymentProjectionDataset } from './costRepository';
import { generatePaymentProjectionPdf, paymentProjectionPdfFilename, generateWeeklyReportPdf, generateMonthlyReportPdf } from '../reportPdf';
import { getRouteAllowedRoles } from '../../constants/nav';
import { ROLES } from '../../constants/roles';
import { isPaymentBatchProjection } from '../paymentAllocation';
import { initialProjects } from '../../data/mockProjects';

// C-01D.2 -- Payment Projection PDF.
//
// What this proves (Local Mode, executed): the dataset the repository builds,
// the real jsPDF document laid out from it -- read back from the generated
// pages -- pagination, read-only behaviour and the source-level authorization
// wiring. What it does NOT prove: that Firestore Rules allow a given role to
// read the underlying data (the Rules are temporarily permissive and are not
// under test here), or anything about the browser download / button
// visibility, which need manual UAT.
const pid = initialProjects[4].id;
let seq = 0;
const ops = () => getOperations(pid);

function posted(over = {}) {
  seq += 1;
  const tx = createCostTransaction(pid, {
    transactionType: 'COST', category: 'Material Purchase', sourceRole: 'SCM', amount: 1000000 + seq * 1000,
    transactionDate: `2026-11-${String(1 + (seq % 27)).padStart(2, '0')}`, referenceNumber: `PDF-${seq}`, description: `Item ${seq}`, ...over,
  });
  return postCostTransaction(pid, tx.transactionId, 'SCM User');
}
function batch(cts, createdBy = 'SCM User') {
  return createPaymentProjection(pid, { costTransactionIds: cts.map((t) => t.transactionId), createdBy });
}
const money = (n) => `IDR ${Number(n).toLocaleString()}`;

// Text actually written to each page of the generated document.
function pageStrings(doc) {
  return Array.from({ length: doc.getNumberOfPages() }, (_, i) => {
    const raw = doc.internal.pages[i + 1].join('\n');
    return [...raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1'));
  });
}
const allStrings = (doc) => pageStrings(doc).flat();
const occurrences = (doc, needle) => allStrings(doc).filter((s) => s === needle).length;

describe('Dataset: canonical sources and total derivation (repository)', () => {
  it('1+3: multiple allocated CTs -- every one is listed with its real details, count and currency', async () => {
    const cts = [posted({ amount: 10000000 }), posted({ amount: 20000000 }), posted({ amount: 5000000, invoiceNumber: 'INV-77' })];
    const pp = batch(cts);
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(ds.transactions.map((t) => t.transactionId).sort()).toEqual(cts.map((t) => t.transactionId).sort());
    expect(ds.summary.count).toBe(3);
    expect(ds.summary.currency).toBe('IDR');
    const withInvoice = ds.transactions.find((t) => t.invoiceNumber === 'INV-77');
    expect(withInvoice).toMatchObject({ amount: 5000000, category: 'Material Purchase', currency: 'IDR' });
    expect(ds.project).toMatchObject({ id: pid, code: initialProjects[4].projectCode, name: initialProjects[4].projectName });
    expect(ds.projection).toMatchObject({ projectionId: pp.projectionId, status: 'PENDING', createdBy: 'SCM User' });
  });

  it('2: the total is derived from the allocated CT amounts (spec worked example 10M + 20M + 5M = 35M), never stored, never from other CTs', async () => {
    const cts = [posted({ amount: 10000000 }), posted({ amount: 20000000 }), posted({ amount: 5000000 })];
    const pp = batch(cts);
    posted({ amount: 999000000 });                      // POSTED but NOT allocated -> must not count
    batch([posted({ amount: 7000000 })]);               // another projection -> must not count
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(ds.summary.total).toBe(35000000);
    expect(ds.transactions.reduce((s, t) => s + t.amount, 0)).toBe(ds.summary.total);
    const stored = ops().paymentProjections.find((p) => p.projectionId === pp.projectionId);
    expect('totalAmount' in stored).toBe(false);
    expect('costTransactionIds' in stored).toBe(false);
  });

  it('the dataset is re-read from the persisted store on every call (not cached state)', async () => {
    const pp = batch([posted({ amount: 1000000 })]);
    const first = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(first.summary.total).toBe(1000000);
    const t = ops().costTransactions.find((x) => x.projectionId === pp.projectionId);
    t.amount = 4000000; // simulate a persisted change made elsewhere
    expect((await buildPaymentProjectionDataset(pid, pp.projectionId)).summary.total).toBe(4000000);
  });

  it('rows are in a deterministic order (transaction date, then id) and `now` controls the generation date', async () => {
    const cts = [posted({ transactionDate: '2026-11-20' }), posted({ transactionDate: '2026-11-03' }), posted({ transactionDate: '2026-11-03' })];
    const pp = batch(cts);
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId, { now: new Date('2026-12-31T23:59:00Z') });
    const dates = ds.transactions.map((t) => t.transactionDate);
    expect(dates).toEqual([...dates].sort());
    expect(ds.generatedOn).toBe('2026-12-31');
  });

  it('4: optional / missing display fields become null (never "undefined")', async () => {
    const pp = batch([posted({ referenceNumber: undefined, invoiceNumber: undefined, description: undefined })]);
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(ds.transactions[0]).toMatchObject({ referenceNumber: null, invoiceNumber: null, description: null });
  });

  it('5: an empty projection (nothing allocated) is explicit: 0 transactions, total 0 -- a real derived zero, not a failure', async () => {
    const t = posted();
    const pp = batch([t]);
    ops().costTransactions.find((x) => x.transactionId === t.transactionId).projectionId = null; // model "no CT allocated"
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(ds.transactions).toEqual([]);
    expect(ds.summary).toMatchObject({ count: 0, total: 0, currency: 'IDR' });
  });

  it('legacy PAYMENT_ONLY records that carry this projectionId are excluded from the total but counted for disclosure', async () => {
    const cts = [posted({ amount: 2000000 })];
    const pp = batch(cts);
    ops().costTransactions.unshift({ transactionId: 'CST-LEGACY-1', transactionType: 'PAYMENT_ONLY', status: 'POSTED', amount: 555, currency: 'IDR', projectionId: pp.projectionId });
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(ds.summary.total).toBe(2000000);
    expect(ds.transactions.map((t) => t.transactionId)).not.toContain('CST-LEGACY-1');
    expect(ds.excludedSettlementRecords).toBe(1);
  });
});

describe('Dataset: refuses to produce a misleading document', () => {
  it('unknown project / unknown projection', async () => {
    await expect(buildPaymentProjectionDataset('no-such-project', 'x')).rejects.toThrow(/not found/);
    await expect(buildPaymentProjectionDataset(pid, 'no-such-projection')).rejects.toThrow(/was not found on this project/);
  });

  it('a legacy plan record (not a payment batch) cannot be exported', async () => {
    ops().paymentProjections.unshift({ projectionId: 'legacy-plan-1', projectId: pid, status: 'PLANNED', plannedAmount: 123 });
    expect(isPaymentBatchProjection({ status: 'PLANNED' })).toBe(false);
    await expect(buildPaymentProjectionDataset(pid, 'legacy-plan-1')).rejects.toThrow(/legacy plan record/);
  });

  it('data inconsistencies throw instead of printing a questionable total', async () => {
    const mk = () => { const t = posted(); const pp = batch([t]); return { t, pp }; };
    let c = mk();
    ops().costTransactions.find((x) => x.transactionId === c.t.transactionId).status = 'VOID';
    await expect(buildPaymentProjectionDataset(pid, c.pp.projectionId)).rejects.toThrow(/not POSTED/);

    c = mk();
    ops().costTransactions.find((x) => x.transactionId === c.t.transactionId).currency = 'USD';
    const other = posted(); batch([other]);
    const t2 = ops().costTransactions.find((x) => x.transactionId === other.transactionId); // a second CT in the SAME projection with another currency
    t2.projectionId = c.pp.projectionId; t2.currency = 'IDR';
    await expect(buildPaymentProjectionDataset(pid, c.pp.projectionId)).rejects.toThrow(/mixes currencies/);

    c = mk();
    ops().costTransactions.find((x) => x.transactionId === c.t.transactionId).amount = 'not-a-number';
    await expect(buildPaymentProjectionDataset(pid, c.pp.projectionId)).rejects.toThrow(/non-numeric amount/);

    c = mk();
    const original = ops().costTransactions.find((x) => x.transactionId === c.t.transactionId);
    ops().costTransactions.push({ ...original }); // the same transaction listed twice
    await expect(buildPaymentProjectionDataset(pid, c.pp.projectionId)).rejects.toThrow(/more than once/);
  });
});

describe('PDF content (read back from the generated pages)', () => {
  it('1/3: shows the projection, project, every transaction exactly once with its amount, the count and the derived total', async () => {
    const cts = [posted({ amount: 500000000, description: 'Supply of PV modules', invoiceNumber: 'INV-1' }), posted({ amount: 300000000 }), posted({ amount: 150000000, description: undefined, referenceNumber: undefined })];
    const pp = batch(cts);
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    const doc = generatePaymentProjectionPdf(ds);
    const text = allStrings(doc);
    expect(text).toContain('Payment Projection');
    expect(text).toContain(pp.projectionId);
    expect(text).toContain('PENDING');
    expect(text.some((s) => s.includes(initialProjects[4].projectName))).toBe(true);
    cts.forEach((t) => expect(occurrences(doc, t.transactionId)).toBe(1));
    cts.forEach((t) => expect(text).toContain(money(t.amount)));
    expect(text).toContain('Ref: ' + cts[0].referenceNumber);
    expect(text).toContain('Inv: INV-1');
    expect(text).toContain('Allocated transactions');
    expect(text).toContain('3');
    expect(occurrences(doc, money(950000000))).toBe(1); // the derived total, once
    expect(text.join(' ')).not.toMatch(/undefined|null|NaN/);
  });

  it('PAID shows the settlement details; PENDING does not', async () => {
    const paid = batch([posted()]);
    markPaymentProjectionPaid(pid, paid.projectionId, { paidDate: '2026-12-20', paymentReference: 'TRF-9', paidBy: 'Finance User' });
    const pending = batch([posted()]);
    const paidText = allStrings(generatePaymentProjectionPdf(await buildPaymentProjectionDataset(pid, paid.projectionId)));
    expect(paidText).toEqual(expect.arrayContaining(['PAID', '2026-12-20', 'TRF-9', 'Finance User', 'Paid Date']));
    const pendingText = allStrings(generatePaymentProjectionPdf(await buildPaymentProjectionDataset(pid, pending.projectionId)));
    expect(pendingText).not.toContain('Paid Date');
    expect(pendingText).not.toContain('Payment Reference');
  });

  it('4: missing optional fields render as a dash, not as text', async () => {
    const pp = batch([posted({ referenceNumber: undefined, invoiceNumber: undefined, description: undefined })]);
    const text = allStrings(generatePaymentProjectionPdf(await buildPaymentProjectionDataset(pid, pp.projectionId)));
    expect(text.filter((s) => s === '\u0097').length).toBeGreaterThanOrEqual(2); // description + reference cells: an em dash, which jsPDF writes as the WinAnsi byte U+0097
    expect(text.join(' ')).not.toMatch(/undefined|null/);
  });

  it('5: an empty projection says so explicitly and shows a zero total', async () => {
    const t = posted();
    const pp = batch([t]);
    ops().costTransactions.find((x) => x.transactionId === t.transactionId).projectionId = null;
    const doc = generatePaymentProjectionPdf(await buildPaymentProjectionDataset(pid, pp.projectionId));
    const text = allStrings(doc);
    expect(text).toContain('No Cost Transactions are allocated to this Payment Projection.');
    expect(text).toContain(money(0));
    expect(text).not.toContain('Transaction ID'); // no empty table is drawn
  });

  it('discloses legacy PAYMENT_ONLY records that were excluded from the total', async () => {
    const pp = batch([posted()]);
    ops().costTransactions.unshift({ transactionId: 'CST-LEGACY-2', transactionType: 'PAYMENT_ONLY', status: 'POSTED', amount: 1, currency: 'IDR', projectionId: pp.projectionId });
    const text = allStrings(generatePaymentProjectionPdf(await buildPaymentProjectionDataset(pid, pp.projectionId))).join(' ');
    expect(text).toMatch(/1 legacy PAYMENT_ONLY settlement record\(s\) reference this Payment Projection/);
  });

  it('non-Latin characters are replaced with "?" instead of corrupting the text', async () => {
    const pp = batch([posted({ description: 'Biaya \u4f60\u597d \u{1F600} test' })]);
    const text = allStrings(generatePaymentProjectionPdf(await buildPaymentProjectionDataset(pid, pp.projectionId))).join('|');
    expect(text).toContain('Biaya ?? ? test');
    expect(text).not.toMatch(/\\x00/);
  });
});

describe('PDF pagination', () => {
  it('6/7/8: 100 transactions with long descriptions -- multiple pages, every transaction exactly once, header repeated, one total on the last page with its summary', async () => {
    const longText = 'Pengadaan material kabel dan aksesoris instalasi untuk blok array tiga, termasuk ongkos kirim dan asuransi pengiriman. '.repeat(3);
    const cts = Array.from({ length: 100 }, (_, i) => posted({ description: i % 9 === 0 ? longText : `Cable tray section ${i}`, invoiceNumber: i % 3 === 0 ? `INV-${i}` : undefined }));
    const pp = batch(cts);
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    const doc = generatePaymentProjectionPdf(ds);
    const pages = pageStrings(doc);
    expect(pages.length).toBeGreaterThan(2);

    cts.forEach((t) => expect(occurrences(doc, t.transactionId), t.transactionId).toBe(1)); // none lost, none duplicated

    const tablePages = pages.filter((p) => p.some((s) => /^CST-\d{4}-\d{6}$/.test(s)));
    expect(tablePages.length).toBeGreaterThan(1);
    tablePages.forEach((p) => expect(p.filter((s) => s === 'Transaction ID')).toHaveLength(1)); // column headings on every table page
    expect(pages.slice(1).filter((p) => p.includes('Allocated Cost Transactions (continued)')).length).toBe(tablePages.length - 1);

    const expectedTotal = money(cts.reduce((s, t) => s + t.amount, 0));
    expect(ds.summary.total).toBe(cts.reduce((s, t) => s + t.amount, 0));
    expect(occurrences(doc, expectedTotal)).toBe(1);                       // 8: the total is printed exactly once ...
    const last = pages[pages.length - 1];
    expect(last).toContain(expectedTotal);                                  // ... on the last page ...
    expect(last).toContain('Financial Summary');                            // ... together with its heading
    expect(last).toContain('100');

    pages.forEach((p, i) => expect(p).toContain(`Page ${i + 1} of ${pages.length}`)); // footer on every page
    pages.forEach((p) => expect(p).toContain(`Payment Projection ${pp.projectionId}`));
  });

  it('the financial summary is never split from its total at a page boundary (sweep over table lengths)', async () => {
    for (const n of [1, 8, 20, 21, 22, 23, 24, 25, 40, 41, 42, 43, 60]) {
      const cts = Array.from({ length: n }, () => posted({ description: 'Short item' }));
      const pp = batch(cts);
      const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
      const pages = pageStrings(generatePaymentProjectionPdf(ds));
      const withHeading = pages.filter((p) => p.includes('Financial Summary'));
      expect(withHeading, `n=${n}`).toHaveLength(1);
      expect(withHeading[0], `n=${n}`).toContain(money(ds.summary.total));
      expect(withHeading[0], `n=${n}`).toContain('Calculated total');
    }
  });

  it('6: a long unbreakable token is hard-wrapped (never overflows) and loses no characters', async () => {
    const pp = batch([posted({ description: 'X'.repeat(160) })]);
    const strings = allStrings(generatePaymentProjectionPdf(await buildPaymentProjectionDataset(pid, pp.projectionId)));
    const runs = strings.filter((s) => /^X+$/.test(s));
    expect(runs.length).toBeGreaterThan(3);
    expect(Math.max(...runs.map((s) => s.length))).toBeLessThan(40);
    expect(runs.join('').length).toBe(160);
  });

  it('6: a single description taller than a whole page is split across pages without losing a word', async () => {
    const words = Array.from({ length: 1500 }, (_, i) => `w${String(i).padStart(4, '0')}`);
    const pp = batch([posted({ description: words.join(' ') })]);
    const doc = generatePaymentProjectionPdf(await buildPaymentProjectionDataset(pid, pp.projectionId));
    expect(doc.getNumberOfPages()).toBeGreaterThan(3);
    const printed = allStrings(doc).join(' ');
    words.forEach((w) => { expect(printed.split(w).length - 1, w).toBe(1); });
  });
});

describe('Read-only: exporting never mutates data or changes status', () => {
  it('9/10: store snapshot and payment status are identical before and after building and generating, for PENDING and PAID', async () => {
    const pending = batch([posted(), posted()]);
    const paid = batch([posted()]);
    markPaymentProjectionPaid(pid, paid.projectionId, { paidDate: '2026-12-20', paymentReference: 'R', paidBy: 'F' });
    const before = JSON.stringify({ tx: ops().costTransactions, pp: ops().paymentProjections });
    for (const p of [pending, paid]) {
      const ds = await buildPaymentProjectionDataset(pid, p.projectionId);
      generatePaymentProjectionPdf(ds);
      paymentProjectionPdfFilename(ds);
    }
    expect(JSON.stringify({ tx: ops().costTransactions, pp: ops().paymentProjections })).toBe(before);
    expect(ops().paymentProjections.find((p) => p.projectionId === pending.projectionId).status).toBe('PENDING');
    expect(ops().paymentProjections.find((p) => p.projectionId === paid.projectionId).status).toBe('PAID');
  });

  it('the dataset builder contains no write call of any kind (source-level guard)', () => {
    const src = fs.readFileSync(new URL('./costRepository.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export async function buildPaymentProjectionDataset'), src.indexOf('// B8: layered duplicate check'));
    expect(body.length).toBeGreaterThan(500);
    for (const forbidden of ['createPaymentProjection(', 'markPaymentProjectionPaid(', 'voidCostTransaction(', 'postCostTransaction(', 'createCostTransaction(', 'setPlannedCost(', 'updateDoc', 'setDoc', 'addDoc', 'deleteDoc', 'writeBatch', 'runTransaction']) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});

describe('Filename', () => {
  it('is deterministic, filesystem-safe and based on the project code and projection id', () => {
    const ds = { project: { id: 'p1', code: 'SPMS-MKS-10' }, projection: { projectionId: 'proj-008-pp-1792028056259-7gk8zt' } };
    expect(paymentProjectionPdfFilename(ds)).toBe('SPMS-MKS-10_PaymentProjection_proj-008-pp-1792028056259-7gk8zt.pdf');
    expect(paymentProjectionPdfFilename(ds)).toBe(paymentProjectionPdfFilename(ds));
    const odd = { project: { id: 'p1', code: 'My Code/1' }, projection: { projectionId: 'a b\\c:d*e' } };
    expect(paymentProjectionPdfFilename(odd)).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(paymentProjectionPdfFilename({ project: { id: 'fallback-id', code: null }, projection: { projectionId: 'x' } })).toBe('fallback-id_PaymentProjection_x.pdf');
  });
});

describe('12: existing authorization is unchanged, and the export adds none', () => {
  it('Project Cost Control stays reachable by exactly the same six roles (BOD and field roles still excluded) -- the export is offered to no one else', () => {
    expect([...getRouteAllowedRoles('/cost-control')].sort()).toEqual([ROLES.SUPER_ADMIN, ROLES.HEAD_PM, ROLES.PROJECT_MANAGER, ROLES.SCM, ROLES.HC, ROLES.FINANCE].sort());
    for (const r of [ROLES.BOD, ROLES.SITE_MANAGER, ROLES.ENGINEERING, ROLES.HSE]) expect(getRouteAllowedRoles('/cost-control')).not.toContain(r);
  });

  it('the Payment Projection tab: create/pay role lists untouched; export gated by the central route lookup, re-checked in the handler; no direct Firestore; goes through the repository', () => {
    const src = fs.readFileSync(new URL('../../pages/CostControl/detail/PaymentProjectionTab.jsx', import.meta.url), 'utf8');
    expect(src).toMatch(/const CAN_CREATE = \[ROLES\.SUPER_ADMIN, ROLES\.SCM\];/);
    expect(src).toMatch(/const CAN_MARK_PAID = \[ROLES\.SUPER_ADMIN, ROLES\.FINANCE\];/);
    expect(src).toMatch(/const canExport = \(getRouteAllowedRoles\('\/cost-control'\) \?\? \[\]\)\.includes\(profile\?\.role\);/);
    expect(src).toMatch(/async function handleExportPdf[\s\S]*?if \(!canExport\) return;/);
    expect(src).toMatch(/\{isBatch && canExport && \(/);
    expect(src).toContain('buildPaymentProjectionDataset');
    expect(src).not.toMatch(/from 'firebase\//);
    expect(src).not.toMatch(/firestoreHelpers|firebase\/firestore/);
  });

  it('the PDF layout module imports only jsPDF (no repository, service or Firebase access)', () => {
    const src = fs.readFileSync(new URL('../reportPdf.js', import.meta.url), 'utf8');
    expect([...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1])).toEqual(['jspdf']);
  });
});

describe('13: existing PDF exports still work', () => {
  const projectStatus = { engineering: { approved: 1, commented: 0, rejected: 0, total: 1 }, hse: { validClosed: 1, pending: 0, total: 1 }, procurement: { completed: 0, total: 1 } };
  const project = { name: 'P', code: 'C', manager: 'M' };
  it('weekly and monthly report PDFs are still generated with their titles', () => {
    const weekly = generateWeeklyReportPdf({ project, reportPeriod: { start: '2026-01-01', end: '2026-01-07' }, progress: { overall: 10, planned: 10, actual: 10, weekly: 1, scheduleStatus: 'On Track' }, projectStatus, activities: [], issues: [] });
    expect(allStrings(weekly)).toContain('Weekly Project Report');
    const monthly = generateMonthlyReportPdf({ project, reportingMonth: { year: 2026, month: 1, start: '2026-01-01', end: '2026-01-31' }, progressSummary: { startOfMonth: 0, endOfMonth: 10, increase: 10, planned: 10, actual: 10, scheduleStatus: 'On Track' }, sCurve: { dataAvailable: false }, projectStatus, issues: [] });
    expect(allStrings(monthly)).toContain('Monthly Project Report');
  });
});

// ---------------------------------------------------------------------------
// C-01D.2 R3 -- Project No. display integrity. The identity row of the report
// is the human-readable Project No. (the Project Master `projectCode`,
// SPMS-REQ-002), looked up through the repository from the projection's own
// project reference. It is never the internal project id and never the
// projection id.
// ---------------------------------------------------------------------------
const valueAfter = (doc, label) => {
  const t = allStrings(doc);
  const i = t.indexOf(label);
  return i < 0 ? undefined : t[i + 1];
};
const MISSING_MARKER = 'Not set on the project record';

describe('C-01D.2 R3: a projection linked to a project with a known Project No.', () => {
  const projectNo = initialProjects[4].projectCode;

  it('the report shows that project\'s Project No. (Project Master projectCode) under "Project No."; the internal-id row is gone', async () => {
    const pp = batch([posted()]);
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(projectNo).toBeTruthy(); // the fixture really has a Project No.
    expect(ds.project.code).toBe(projectNo);
    const doc = generatePaymentProjectionPdf(ds);
    expect(valueAfter(doc, 'Project No.')).toBe(projectNo);
    expect(allStrings(doc)).not.toContain('Project ID');
  });

  it('Projection ID stays separate: printed unchanged under its own label, and never used as the Project No.', async () => {
    const pp = batch([posted()]);
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    const doc = generatePaymentProjectionPdf(ds);
    expect(ds.projection.projectionId).toBe(pp.projectionId);
    expect(valueAfter(doc, 'Projection ID')).toBe(pp.projectionId);
    expect(valueAfter(doc, 'Project No.')).not.toBe(pp.projectionId);
    expect(valueAfter(doc, 'Project No.')).not.toContain('-pp-');
  });

  it('the Project No. is the project code, not the project\'s internal id (which is available but must not be shown as the identity)', async () => {
    const pp = batch([posted()]);
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(ds.project.id).toBe(pid);
    expect(pid).not.toBe(projectNo);
    const shown = valueAfter(generatePaymentProjectionPdf(ds), 'Project No.');
    expect(shown).toBe(projectNo); // positively the code (not merely "something other than the id")
    expect(shown).not.toBe(pid);
  });

  it('surrounding whitespace in the stored project code is trimmed', async () => {
    const original = initialProjects[4].projectCode;
    try {
      initialProjects[4].projectCode = `  ${original}  `;
      const pp = batch([posted()]);
      const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
      expect(ds.project.code).toBe(original);
      expect(valueAfter(generatePaymentProjectionPdf(ds), 'Project No.')).toBe(original);
    } finally {
      initialProjects[4].projectCode = original;
    }
  });
});

describe('C-01D.2 R3: a missing or invalid project reference is handled explicitly, never substituted', () => {
  it('a project with no/blank project code shows an explicit marker -- not the project id, not the projection id, not a blank', async () => {
    const original = initialProjects[4].projectCode;
    const pp = batch([posted()]);
    try {
      for (const blank of ['', '   ', undefined, null]) {
        initialProjects[4].projectCode = blank;
        const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
        expect(ds.project.code).toBeNull();
        const shown = valueAfter(generatePaymentProjectionPdf(ds), 'Project No.');
        expect(shown).toBe(MISSING_MARKER);
        expect(shown).not.toBe(pid);
        expect(shown).not.toBe(pp.projectionId);
        expect(shown).not.toBe('');
      }
    } finally {
      initialProjects[4].projectCode = original;
    }
  });

  it('a projection whose recorded projectId names ANOTHER project is refused with an explicit error (no report is produced)', async () => {
    const pp = batch([posted()]);
    ops().paymentProjections.find((p) => p.projectionId === pp.projectionId).projectId = 'some-other-project';
    await expect(buildPaymentProjectionDataset(pid, pp.projectionId))
      .rejects.toThrow(`Payment Projection "${pp.projectionId}" is linked to project "some-other-project", not "${pid}"; the PDF was not generated.`);
  });

  it('a projection with no projectId field is still unambiguous (it lives under its project) and exports with that project\'s Project No.', async () => {
    const pp = batch([posted()]);
    delete ops().paymentProjections.find((p) => p.projectionId === pp.projectionId).projectId;
    const ds = await buildPaymentProjectionDataset(pid, pp.projectionId);
    expect(valueAfter(generatePaymentProjectionPdf(ds), 'Project No.')).toBe(initialProjects[4].projectCode);
  });

  it('an unknown project is still refused (unchanged behaviour)', async () => {
    await expect(buildPaymentProjectionDataset('no-such-project', 'x')).rejects.toThrow(/not found/);
  });
});
