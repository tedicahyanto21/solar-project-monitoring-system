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
