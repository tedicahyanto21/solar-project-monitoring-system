// PDF Report Export (Sprint FT-6, Part D).
//
// This file ONLY lays out and writes PDF pages from a dataset already
// built by reportRepository.js -- it never calculates progress, schedule
// status, or issue relevance itself (FT-6 validation E4: "PDF generation
// does not calculate business rules itself").
import { jsPDF } from 'jspdf';

const NAVY = [31, 56, 100];
const MUTED = [90, 90, 90];
const PAGE_WIDTH = 210; // A4 mm
const MARGIN = 16;
let y;

function newDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  y = MARGIN;
  return doc;
}

function ensureSpace(doc, needed) {
  if (y + needed > 287) {
    doc.addPage();
    y = MARGIN;
  }
}

function header(doc, title, project) {
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('SPMS \u2014 Solar Project Monitoring System \u00b7 PT Solar EPC Nusantara', MARGIN, y);
  y += 7;
  doc.setFontSize(16);
  doc.setTextColor(...NAVY);
  doc.setFont(undefined, 'bold');
  doc.text(title, MARGIN, y);
  y += 6;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(0, 0, 0);
  doc.text(`${project.name} (${project.code}) \u00b7 PM: ${project.manager}`, MARGIN, y);
  y += 4;
  doc.setDrawColor(...NAVY);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 7;
}

function sectionTitle(doc, text) {
  ensureSpace(doc, 10);
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...NAVY);
  doc.text(text, MARGIN, y);
  y += 5.5;
  doc.setFont(undefined, 'normal');
  doc.setTextColor(0, 0, 0);
}

function keyValueRow(doc, label, value) {
  ensureSpace(doc, 6);
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(label, MARGIN, y);
  doc.setTextColor(0, 0, 0);
  doc.text(String(value ?? '\u2014'), MARGIN + 55, y);
  y += 5.5;
}

function bodyLine(doc, text) {
  ensureSpace(doc, 6);
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  const lines = doc.splitTextToSize(text, PAGE_WIDTH - MARGIN * 2);
  doc.text(lines, MARGIN, y);
  y += lines.length * 4.6 + 1.5;
}

function issuesSection(doc, issues) {
  sectionTitle(doc, 'Relevant Issues');
  if (issues.length === 0) {
    bodyLine(doc, 'No issues were relevant to this reporting period.');
    return;
  }
  issues.forEach((i) => {
    bodyLine(doc, `[${i.status}] ${i.title} (${i.priority}, ${i.category}) \u2014 opened ${i.openedAt}${i.closedAt ? `, closed ${i.closedAt}` : ''}. Responsible: ${i.responsibleUserName || '\u2014'}`);
  });
  y += 2;
}

function projectStatusSection(doc, ps) {
  sectionTitle(doc, 'Project Status Summary');
  keyValueRow(doc, 'Engineering', `${ps.engineering.approved} approved / ${ps.engineering.commented} commented / ${ps.engineering.rejected} rejected of ${ps.engineering.total}`);
  keyValueRow(doc, 'HSE / Permit', `${ps.hse.validClosed} valid-closed / ${ps.hse.pending} pending of ${ps.hse.total}`);
  keyValueRow(doc, 'Procurement', `${ps.procurement.completed} of ${ps.procurement.total} milestones completed`);
  if (ps.construction) keyValueRow(doc, 'Construction', `${ps.construction.activities} activities, ${ps.construction.averagePercent}% average completion`);
  if (ps.commissioning) keyValueRow(doc, 'Commissioning', `${ps.commissioning.complete} of ${ps.commissioning.items} items complete`);
  y += 2;
}

// D1: Weekly PDF. `dataset` must come from reportRepository.buildWeeklyReportDataset.
export function generateWeeklyReportPdf(dataset) {
  const doc = newDoc();
  header(doc, 'Weekly Project Report', dataset.project);

  sectionTitle(doc, 'Report Period');
  keyValueRow(doc, 'Period', `${dataset.reportPeriod.start} to ${dataset.reportPeriod.end}`);
  y += 2;

  sectionTitle(doc, 'Progress Summary');
  keyValueRow(doc, 'Overall Progress', dataset.progress.overall != null ? `${dataset.progress.overall}%` : '\u2014');
  keyValueRow(doc, 'Planned Progress', `${dataset.progress.planned}%`);
  keyValueRow(doc, 'Actual Progress', `${dataset.progress.actual}%`);
  keyValueRow(doc, 'Weekly Progress', dataset.progress.weekly != null ? `${dataset.progress.weekly >= 0 ? '+' : ''}${dataset.progress.weekly}%` : 'No prior snapshot available');
  keyValueRow(doc, 'Schedule Status', dataset.progress.scheduleStatus);
  y += 2;

  projectStatusSection(doc, dataset.projectStatus);

  sectionTitle(doc, 'Activities This Period');
  if (dataset.activities.length === 0) {
    bodyLine(doc, 'No recorded activity updates fall within this reporting period.');
  } else {
    dataset.activities.forEach((a) => bodyLine(doc, `${a.date} \u2014 ${a.activity}: ${a.actualQuantity} / ${a.plannedQuantity} ${a.unit}`));
  }
  y += 2;

  issuesSection(doc, dataset.issues);

  return doc;
}

// D2: Monthly PDF. `dataset` must come from reportRepository.buildMonthlyReportDataset.
export function generateMonthlyReportPdf(dataset) {
  const doc = newDoc();
  header(doc, 'Monthly Project Report', dataset.project);

  sectionTitle(doc, 'Reporting Month');
  keyValueRow(doc, 'Month', `${dataset.reportingMonth.year}-${String(dataset.reportingMonth.month).padStart(2, '0')}`);
  keyValueRow(doc, 'Period', `${dataset.reportingMonth.start} to ${dataset.reportingMonth.end}`);
  y += 2;

  sectionTitle(doc, 'Monthly Progress Summary');
  keyValueRow(doc, 'Start of Month', dataset.progressSummary.startOfMonth != null ? `${dataset.progressSummary.startOfMonth}%` : 'No historical data available');
  keyValueRow(doc, 'End of Month', `${dataset.progressSummary.endOfMonth}%`);
  keyValueRow(doc, 'Monthly Increase', dataset.progressSummary.increase != null ? `${dataset.progressSummary.increase >= 0 ? '+' : ''}${dataset.progressSummary.increase}%` : '\u2014');
  keyValueRow(doc, 'Planned Progress', `${dataset.progressSummary.planned}%`);
  keyValueRow(doc, 'Actual Progress', `${dataset.progressSummary.actual}%`);
  keyValueRow(doc, 'Schedule Status', dataset.progressSummary.scheduleStatus);
  y += 2;

  sectionTitle(doc, 'S-Curve Summary');
  if (!dataset.sCurve.dataAvailable) {
    bodyLine(doc, 'No recorded progress snapshots exist yet for this project -- S-Curve history will populate as Project Detail is used over time.');
  } else {
    keyValueRow(doc, 'Snapshots Recorded', dataset.sCurve.actualHistory.length);
    keyValueRow(doc, 'Latest Actual', `${dataset.sCurve.actualHistory.at(-1)?.value}%`);
  }
  y += 2;

  projectStatusSection(doc, dataset.projectStatus);
  issuesSection(doc, dataset.issues);

  return doc;
}

// ---------------------------------------------------------------------------
// C-01D.2 -- Payment Projection PDF.
//
// Same contract as the report PDFs above: this only LAYS OUT a dataset built
// by costRepository.buildPaymentProjectionDataset. It reads nothing, writes
// nothing, and calculates nothing -- the total printed here is the
// `summary.total` the repository derived from the allocated Cost
// Transactions.
// ---------------------------------------------------------------------------
const CONTENT_BOTTOM = 287; // same limit ensureSpace() uses; the footer sits below it
const FOOTER_Y = 292;
const TABLE_FONT = 8;
const LINE_H = 3.6;
const CELL_PAD = 1.2;
const HEADER_ROW_H = 6.5;
const CONTINUED_CAPTION_H = 5;
const TABLE_COLUMNS = [
  { key: 'transactionId', label: 'Transaction ID', width: 27 },
  { key: 'transactionDate', label: 'Date', width: 19 },
  { key: 'category', label: 'Category', width: 26 },
  { key: 'description', label: 'Description', width: 44 },
  { key: 'reference', label: 'Reference / Invoice', width: 28 },
  { key: 'amount', label: 'Amount', width: 34, align: 'right' },
]; // widths add up to 178 mm = the usable A4 width between the margins

// jsPDF's built-in fonts only cover Latin-1 / Windows-1252. Any other
// character (CJK, emoji, ...) is emitted as corrupted UTF-16 bytes, which
// would garble a financial document, so those are replaced with '?'.
const WIN_ANSI_EXTRA = new Set('\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178');
function pdfText(value) {
  if (value == null) return null;
  let out = '';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (code === 0x09 || code === 0x0a || code === 0x0d) out += ' ';
    else out += '?';
  }
  return out;
}

// Existing SPMS money convention (see the Cost Control tabs): `${currency} ${Number(amount).toLocaleString()}`.
function formatMoney(currency, amount) {
  return `${currency} ${Number(amount).toLocaleString()}`;
}

// Greedy word wrap measured with the real font, hard-breaking any single
// token wider than the column, so a cell can never run into its neighbour.
function wrapCell(doc, text, width) {
  const clean = String(pdfText(text) ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return ['\u2014'];
  const lines = [];
  let line = '';
  const flush = () => { if (line) { lines.push(line); line = ''; } };
  for (const word of clean.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (doc.getTextWidth(candidate) <= width) { line = candidate; continue; }
    flush();
    if (doc.getTextWidth(word) <= width) { line = word; continue; }
    let chunk = '';
    for (const ch of word) {
      if (doc.getTextWidth(chunk + ch) > width) { lines.push(chunk); chunk = ch; } else chunk += ch;
    }
    line = chunk;
  }
  flush();
  return lines;
}

function keyValueWrapped(doc, label, value) {
  const lines = doc.splitTextToSize(String(pdfText(value) ?? '\u2014'), PAGE_WIDTH - MARGIN * 2 - 55);
  ensureSpace(doc, lines.length * 4.6 + 1);
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(label, MARGIN, y);
  doc.setTextColor(0, 0, 0);
  doc.text(lines, MARGIN + 55, y);
  y += lines.length * 4.6 + 1;
}

function drawTableHeader(doc) {
  doc.setFillColor(232, 237, 246);
  doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, HEADER_ROW_H, 'F');
  doc.setFont(undefined, 'bold');
  doc.setFontSize(TABLE_FONT);
  doc.setTextColor(...NAVY);
  let x = MARGIN;
  TABLE_COLUMNS.forEach((c) => {
    if (c.align === 'right') doc.text(c.label, x + c.width - 1, y + 4.3, { align: 'right' });
    else doc.text(c.label, x + 1, y + 4.3);
    x += c.width;
  });
  doc.setFont(undefined, 'normal');
  doc.setTextColor(0, 0, 0);
  y += HEADER_ROW_H;
}

// A continuation page repeats the column headings so every printed page of
// the table is readable on its own.
function startTablePage(doc) {
  doc.addPage();
  y = MARGIN;
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text('Allocated Cost Transactions (continued)', MARGIN, y);
  y += CONTINUED_CAPTION_H;
  drawTableHeader(doc);
}

function drawRowLines(doc, cells, from, count) {
  doc.setFontSize(TABLE_FONT);
  doc.setTextColor(0, 0, 0);
  let x = MARGIN;
  TABLE_COLUMNS.forEach((c, i) => {
    cells[i].slice(from, from + count).forEach((text, k) => {
      const baseline = y + CELL_PAD + 2.7 + k * LINE_H;
      if (c.align === 'right') doc.text(text, x + c.width - 1, baseline, { align: 'right' });
      else doc.text(text, x + 1, baseline);
    });
    x += c.width;
  });
  y += count * LINE_H + CELL_PAD * 2;
  doc.setDrawColor(210, 214, 222);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
}

// One table row. A row that fits is drawn whole; a row that would straddle a
// page boundary but fits on a fresh page moves there intact; only a row taller
// than a whole page (an extremely long description) is split line by line.
// Either way every line of every cell is drawn exactly once.
function drawTableRow(doc, cells) {
  const total = Math.max(...cells.map((c) => c.length));
  const freshCapacity = Math.floor((CONTENT_BOTTOM - (MARGIN + CONTINUED_CAPTION_H + HEADER_ROW_H) - CELL_PAD * 2) / LINE_H);
  let drawn = 0;
  while (drawn < total) {
    const remaining = total - drawn;
    const fitNow = Math.floor((CONTENT_BOTTOM - y - CELL_PAD * 2) / LINE_H);
    if (remaining <= fitNow) {
      drawRowLines(doc, cells, drawn, remaining);
      return;
    }
    if (drawn === 0 && remaining <= freshCapacity) {
      startTablePage(doc);
      continue;
    }
    if (fitNow >= 1) {
      drawRowLines(doc, cells, drawn, fitNow);
      drawn += fitNow;
    }
    startTablePage(doc);
  }
}

function rowCells(doc, t) {
  doc.setFont(undefined, 'normal');
  doc.setFontSize(TABLE_FONT);
  const w = (key) => TABLE_COLUMNS.find((c) => c.key === key).width - 2;
  const refLines = [];
  if (t.referenceNumber) refLines.push(...wrapCell(doc, `Ref: ${t.referenceNumber}`, w('reference')));
  if (t.invoiceNumber) refLines.push(...wrapCell(doc, `Inv: ${t.invoiceNumber}`, w('reference')));
  const money = formatMoney(t.currency, t.amount);
  // An amount too wide for its column goes on two lines rather than overlapping its neighbour.
  const amountLines = doc.getTextWidth(money) <= w('amount') ? [money] : [t.currency, Number(t.amount).toLocaleString()];
  return [
    wrapCell(doc, t.transactionId, w('transactionId')),
    wrapCell(doc, t.transactionDate, w('transactionDate')),
    wrapCell(doc, t.category, w('category')),
    wrapCell(doc, t.description, w('description')),
    refLines.length ? refLines : ['\u2014'],
    amountLines,
  ];
}

function drawFooters(doc, projectionId) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont(undefined, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(`Payment Projection ${pdfText(projectionId)}`, MARGIN, FOOTER_Y);
    doc.text(`Page ${i} of ${pages}`, PAGE_WIDTH - MARGIN, FOOTER_Y, { align: 'right' });
  }
  doc.setPage(pages);
}

// `dataset` must come from costRepository.buildPaymentProjectionDataset.
export function generatePaymentProjectionPdf(dataset) {
  const { project, projection, transactions, summary } = dataset;
  const doc = newDoc();
  doc.setProperties({ title: `Payment Projection ${pdfText(projection.projectionId)}` });

  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Generated: ${dataset.generatedOn} (UTC)`, PAGE_WIDTH - MARGIN, y, { align: 'right' });
  header(doc, 'Payment Projection', {
    name: pdfText(project.name) ?? '\u2014',
    code: pdfText(project.code) ?? '\u2014',
    manager: pdfText(project.manager) ?? '\u2014',
  });

  sectionTitle(doc, 'Payment Projection Details');
  keyValueWrapped(doc, 'Projection ID', projection.projectionId);
  keyValueWrapped(doc, 'Project ID', project.id);
  keyValueRow(doc, 'Status', pdfText(projection.status));
  keyValueRow(doc, 'Created', projection.createdAt ? `${String(projection.createdAt).slice(0, 10)}${projection.createdBy ? ` by ${pdfText(projection.createdBy)}` : ''}` : null);
  if (projection.status === 'PAID') {
    keyValueRow(doc, 'Paid Date', pdfText(projection.paidDate));
    keyValueWrapped(doc, 'Payment Reference', projection.paymentReference);
    keyValueRow(doc, 'Paid By', pdfText(projection.paidBy));
  }
  y += 2;

  ensureSpace(doc, 10 + HEADER_ROW_H + 3 * LINE_H + CELL_PAD * 2); // keep the heading with its header row and first row
  sectionTitle(doc, 'Allocated Cost Transactions');
  if (transactions.length === 0) {
    bodyLine(doc, 'No Cost Transactions are allocated to this Payment Projection.');
  } else {
    drawTableHeader(doc);
    transactions.forEach((t) => drawTableRow(doc, rowCells(doc, t)));
  }
  y += 8;

  // The whole summary block is kept together so the total can never be
  // separated from its heading or clipped at a page boundary.
  ensureSpace(doc, 40);
  sectionTitle(doc, 'Financial Summary');
  keyValueRow(doc, 'Allocated transactions', summary.count);
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text('Calculated total', MARGIN, y + 1);
  doc.setFontSize(13);
  doc.setFont(undefined, 'bold');
  doc.setTextColor(...NAVY);
  doc.text(formatMoney(pdfText(summary.currency), summary.total), MARGIN + 55, y + 1);
  doc.setFont(undefined, 'normal');
  doc.setTextColor(0, 0, 0);
  y += 8;
  bodyLine(doc, 'The total is calculated from the Cost Transactions listed above, which are the transactions allocated to this Payment Projection. It is not a stored or manually entered value.');
  if (dataset.excludedSettlementRecords > 0) {
    bodyLine(doc, `Note: ${dataset.excludedSettlementRecords} legacy PAYMENT_ONLY settlement record(s) reference this Payment Projection. They are settlements, not allocated costs, and are not part of the total above.`);
  }

  drawFooters(doc, projection.projectionId);
  return doc;
}

// Deterministic, filesystem-safe name derived from the project code and the
// projection identifier (existing convention: `${project.code}_<Report>_<id>.pdf`).
export function paymentProjectionPdfFilename(dataset) {
  const safe = (v) => String(v).replace(/[^A-Za-z0-9._-]+/g, '_');
  return `${safe(dataset.project.code ?? dataset.project.id)}_PaymentProjection_${safe(dataset.projection.projectionId)}.pdf`;
}
