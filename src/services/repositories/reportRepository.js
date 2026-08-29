// Report Data Engine (Sprint FT-6, Part B/C).
//
// This is the ONLY place report period rules and dataset assembly live.
// PDF export (reportPdf.js) and any future report UI must consume the
// datasets built here -- they must never recompute progress, schedule
// status, or issue relevance themselves.
import { getProjectById } from './projectRepository';
import { getProjectProgress, getScheduleStatus, getProgressHistory } from './progressRepository';
import {
  getEngineeringDocuments, getHseDocuments, getProcurementMilestones, getConstructionActivities, getCommissioningChecklist,
} from './projectDetailRepository';
import { getIssues } from './issueRepository';

function round1(n) { return Math.round(n * 10) / 10; }

// B1/B2: THE single period-overlap rule, used identically for Weekly and
// Monthly reports. An issue is relevant to a period if its active interval
// -- [openedAt, closedAt ?? "still open"] -- overlaps the period at all.
// This deliberately does NOT look at current status; a closed issue is
// still relevant to a past period it was open during.
export function isIssueRelevantToPeriod(issue, periodStart, periodEnd) {
  const opened = new Date(issue.openedAt).getTime();
  const closed = issue.closedAt ? new Date(issue.closedAt).getTime() : Infinity;
  const start = new Date(periodStart).getTime();
  const end = new Date(periodEnd).getTime();
  return opened <= end && closed >= start;
}

export function filterIssuesForPeriod(issues, periodStart, periodEnd) {
  return issues.filter((i) => isIssueRelevantToPeriod(i, periodStart, periodEnd));
}

async function buildProjectStatusSummary(projectId) {
  const [engDocs, hseDocs, procurement, construction, commissioning] = await Promise.all([
    getEngineeringDocuments(projectId),
    getHseDocuments(projectId),
    getProcurementMilestones(projectId),
    getConstructionActivities(projectId),
    getCommissioningChecklist(projectId),
  ]);
  return {
    engineering: {
      approved: engDocs.filter((d) => d.reviewStatus === 'APPROVED').length,
      commented: engDocs.filter((d) => d.reviewStatus === 'COMMENTED').length,
      rejected: engDocs.filter((d) => d.reviewStatus === 'REJECTED').length,
      total: engDocs.length,
    },
    hse: {
      validClosed: hseDocs.filter((d) => d.status === 'Valid / Closed').length,
      pending: hseDocs.filter((d) => d.status !== 'Valid / Closed').length,
      total: hseDocs.length,
    },
    procurement: {
      completed: procurement.filter((m) => m.status === 'Completed').length,
      total: procurement.length,
    },
    construction: construction.length
      ? { activities: construction.length, averagePercent: round1(construction.reduce((s, a) => s + (a.plannedQuantity > 0 ? (a.actualQuantity / a.plannedQuantity) * 100 : 0), 0) / construction.length) }
      : null,
    commissioning: commissioning.length
      ? { items: commissioning.length, complete: commissioning.filter((c) => c.completionStatus === 'Complete').length }
      : null,
  };
}

// C1: Weekly Report Dataset.
export async function buildWeeklyReportDataset(projectId, periodStart, periodEnd) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  const [progress, schedule, history, allIssues, projectStatus, constructionActivities] = await Promise.all([
    getProjectProgress(projectId),
    getScheduleStatus(project),
    getProgressHistory(projectId),
    getIssues(projectId),
    buildProjectStatusSummary(projectId),
    getConstructionActivities(projectId),
  ]);

  // Weekly Progress = Actual Progress now minus the closest snapshot at/before
  // periodStart. If no snapshot exists that far back, this is honestly
  // reported as unavailable rather than guessed.
  const priorSnapshot = [...history].reverse().find((h) => h.snapshotDate <= periodStart);
  const weeklyProgress = priorSnapshot ? round1(schedule.actualProgress - priorSnapshot.actualProgress) : null;

  // Activities during the period: construction history entries whose date
  // falls inside [periodStart, periodEnd] -- real recorded updates, not
  // fabricated for the report.
  const activities = constructionActivities.flatMap((a) =>
    a.history.filter((h) => h.date >= periodStart && h.date <= periodEnd).map((h) => ({
      activity: a.activity, date: h.date, actualQuantity: h.actualQuantity, unit: a.unit, plannedQuantity: a.plannedQuantity,
    }))
  );

  return {
    reportType: 'WEEKLY',
    project: { code: project.projectCode, name: project.projectName, manager: project.projectManager },
    reportPeriod: { start: periodStart, end: periodEnd },
    progress: {
      overall: progress?.overallProgress ?? null,
      planned: schedule.plannedProgress,
      actual: schedule.actualProgress,
      weekly: weeklyProgress,
      scheduleStatus: schedule.label,
    },
    projectStatus,
    activities,
    issues: filterIssuesForPeriod(allIssues, periodStart, periodEnd),
  };
}

// C2: Monthly Report Dataset.
export async function buildMonthlyReportDataset(projectId, year, month) {
  const project = await getProjectById(projectId);
  if (!project) return null;
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = new Date(year, month, 0).toISOString().slice(0, 10); // last calendar day of month

  const [, schedule, history, allIssues, projectStatus] = await Promise.all([
    getProjectProgress(projectId),
    getScheduleStatus(project),
    getProgressHistory(projectId),
    getIssues(projectId),
    buildProjectStatusSummary(projectId),
  ]);

  const inMonth = history.filter((h) => h.snapshotDate >= monthStart && h.snapshotDate <= monthEnd);
  const before = [...history].reverse().find((h) => h.snapshotDate < monthStart);
  // Honest about data availability -- FT-6 mock architecture only has
  // snapshots for days a user actually opened the project, so a full daily
  // history is not guaranteed. null means "not available", never a guess.
  const startOfMonth = inMonth[0]?.actualProgress ?? before?.actualProgress ?? null;
  const endOfMonth = inMonth.length ? inMonth[inMonth.length - 1].actualProgress : schedule.actualProgress;
  const increase = startOfMonth != null ? round1(endOfMonth - startOfMonth) : null;

  return {
    reportType: 'MONTHLY',
    project: { code: project.projectCode, name: project.projectName, manager: project.projectManager },
    reportingMonth: { year, month, start: monthStart, end: monthEnd },
    progressSummary: {
      startOfMonth, endOfMonth, increase,
      planned: schedule.plannedProgress, actual: schedule.actualProgress, scheduleStatus: schedule.label,
    },
    sCurve: {
      plannedHistory: history.map((h) => ({ date: h.snapshotDate, value: h.plannedProgress })),
      actualHistory: history.map((h) => ({ date: h.snapshotDate, value: h.actualProgress })),
      dataAvailable: history.length > 0,
    },
    projectStatus,
    issues: filterIssuesForPeriod(allIssues, monthStart, monthEnd),
  };
}
