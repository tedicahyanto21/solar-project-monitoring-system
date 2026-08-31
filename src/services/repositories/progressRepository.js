// Progress calculation (Progress Engine Design SPMS-DOC-04; Database
// Design SPMS-DOC-06, Section 7).
//
// This is the ONLY place Overall Progress and per-component progress are
// calculated. Dashboard and Project Master both call into this file rather
// than computing progress themselves, per the architecture principle:
// "Do not implement independent business calculations in multiple
// Dashboard components." Component weights come from the project's own
// configured weights (mockOperationalData) -- never hardcoded here.
import {
  getOperations,
  setProgressWeights as storeSetWeights,
  recordProgressSnapshot as storeRecordSnapshot,
  getProgressHistory as storeGetProgressHistory,
} from '../../data/mockOperationalData';
import { getProjects } from './projectRepository';

// FT-4.1 Correction 3: floating-point tolerance for the 100% weight-total
// rule, so values like 99.999999 (from repeated arithmetic) are not
// falsely rejected while genuinely invalid totals still are.
export const WEIGHT_TOLERANCE = 0.01;

// FT-5 A10: named tolerance for schedule status, instead of an unexplained
// magic number. A project is ON_SCHEDULE if Actual Progress is within this
// many percentage points of where the contract timeline says it should be.
export const SCHEDULE_TOLERANCE_PERCENT = 5;

// Single, centralized validation rule -- used by both the UI (to disable
// Save / show an error) and setProjectWeights (so an invalid total can
// never reach storage even if a caller skips the UI check). There is
// exactly one place this rule is defined.
export function isValidWeightTotal(weights) {
  const total = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);
  return Math.abs(total - 100) <= WEIGHT_TOLERANCE;
}

function weightedAverage(items, weightKey, valueFrac) {
  const totalWeight = items.reduce((sum, item) => sum + (item[weightKey] || 0), 0);
  if (totalWeight === 0) return 0;
  const weighted = items.reduce((sum, item) => sum + (item[weightKey] || 0) * valueFrac(item), 0);
  return weighted / totalWeight;
}

// A3. Engineering -- document-based + weight.
//
// FT-4.1 Correction 4 / FT-5 A3: progressContribution is an independent,
// data-driven field (0-100, how complete THAT document is) -- it is never
// derived from reviewStatus via a hardcoded formula (no "COMMENTED = 50%").
export function calculateEngineeringProgress(engineeringDocuments) {
  return weightedAverage(engineeringDocuments, 'weight', (d) => (d.progressContribution ?? 0) / 100) * 100;
}

// A4. HSE / Permit -- item-based + weight, same principle as Engineering.
// Used for the HSE monitoring KPI always, and additionally folded into
// Overall Progress ONLY when a project configures `hse` as an active
// weighted component (see getProjectProgress).
export function calculateHseProgress(hseDocuments) {
  return weightedAverage(hseDocuments, 'weight', (d) => (d.progressContribution ?? 0) / 100) * 100;
}

// A5. Procurement -- milestone-based + weight. Milestones are the
// dedicated, configurable projects/{id}/procurementMilestones collection
// (Database Design SPMS-DOC-06 Section 5 concept), not the generic
// contractual milestones timeline.
export function calculateProcurementProgress(procurementMilestones) {
  return weightedAverage(procurementMilestones, 'weight', (m) => (m.progressContribution ?? 0) / 100) * 100;
}

// A6. Construction -- quantity-based. Division-by-zero and negative
// quantities are rejected at the point of entry (see
// mockOperationalData.updateConstructionActivity), so this function can
// assume plannedQuantity > 0 and actualQuantity >= 0 for any activity it
// is given; it still guards defensively.
export function calculateConstructionProgress(constructionActivities) {
  return weightedAverage(constructionActivities, 'weight', (a) => (a.plannedQuantity > 0 ? Math.max(0, a.actualQuantity) / a.plannedQuantity : 0)) * 100;
}

// A7. Commissioning -- checklist-based. Supports both equal weights
// (default seed: 25/25/25/25) and explicit per-item weights configured on
// the checklist item itself -- weightedAverage treats both identically.
export function calculateCommissioningProgress(commissioningChecklist) {
  return weightedAverage(commissioningChecklist, 'weight', (c) => (c.completionStatus === 'Complete' ? 1 : 0)) * 100;
}

function round1(n) { return Math.round(n * 10) / 10; }
function clamp01(n) { return Math.max(0, Math.min(1, n)); }

// A1/A8. Overall Progress = weighted sum of whichever components are
// ACTIVE in this project's configured weights (progressWeights' own keys),
// using each component's own calculator. Engineering/Procurement/
// Construction/Commissioning are active by default; HSE participates only
// if the project has explicitly added an `hse` key to its weights (A2/A4).
// `component` always reports ALL five, however, so HSE can still be shown
// as a monitoring KPI even when it is not weighted.
//
// This is the single function every screen must call -- never compute
// Overall Progress inline in a component (A1, A8).
const COMPONENT_CALCULATORS = {
  engineering: (ops) => calculateEngineeringProgress(ops.engineeringDocuments),
  procurement: (ops) => calculateProcurementProgress(ops.procurementMilestones),
  construction: (ops) => calculateConstructionProgress(ops.constructionActivities),
  commissioning: (ops) => calculateCommissioningProgress(ops.commissioningChecklist),
  hse: (ops) => calculateHseProgress(ops.hseDocuments),
};

export async function getProjectProgress(projectId) {
  const ops = getOperations(projectId);
  if (!ops) return null;

  const component = {};
  for (const key of Object.keys(COMPONENT_CALCULATORS)) {
    component[key] = round1(COMPONENT_CALCULATORS[key](ops));
  }

  const activeWeights = ops.progressWeights;
  // Valid configurations always total 100 by construction (setProjectWeights
  // refuses anything else -- FT-4.1 Correction 3 / FT-5 A2). Dividing by
  // totalWeight here is a defensive fallback only; it must not be relied on
  // to "normalize" an invalid configuration.
  const totalWeight = Object.values(activeWeights).reduce((a, b) => a + b, 0) || 1;
  const overallProgress = round1(
    Object.entries(activeWeights).reduce((sum, [key, weight]) => sum + (component[key] ?? 0) * weight, 0) / totalWeight
  );

  return { component, overallProgress, weights: activeWeights, hseIsWeighted: 'hse' in activeWeights };
}

// A10. Schedule status: Planned Progress (from the contract timeline) vs
// Actual Progress (from the Progress Engine above), NOT an unexplained
// Dashboard-only heuristic, and NOT SPI. Tolerance is the named constant
// SCHEDULE_TOLERANCE_PERCENT, not a magic number.
function plannedProgressByTime(project) {
  const start = new Date(project.contractStart).getTime();
  const end = new Date(project.targetCOD).getTime();
  if (!(end > start)) return 0;
  return clamp01((Date.now() - start) / (end - start)) * 100;
}

export async function getScheduleStatus(project) {
  const progress = await getProjectProgress(project.id);
  const actualProgress = progress?.overallProgress ?? project.progress ?? 0;
  const plannedProgress = round1(plannedProgressByTime(project));
  const isOnSchedule = actualProgress >= plannedProgress - SCHEDULE_TOLERANCE_PERCENT;
  return {
    status: isOnSchedule ? 'ON_SCHEDULE' : 'DELAYED',
    label: isOnSchedule ? 'On Schedule' : 'Delayed',
    isOnSchedule,
    actualProgress,
    plannedProgress,
  };
}

// FT-4.1 Correction 3 / FT-5 A2: rejects an invalid configuration rather
// than saving it -- there is no silent proportional normalization. The
// calculation engine (getProjectProgress above) is entitled to assume any
// weights it reads have already passed this check. Passing a weights
// object that omits `hse` deactivates HSE as a weighted component;
// including it activates HSE -- either way the total must be exactly 100.
export async function setProjectWeights(projectId, weights) {
  if (!isValidWeightTotal(weights)) {
    const total = Object.values(weights).reduce((a, b) => a + Number(b || 0), 0);
    throw new Error(`Progress component weights must total exactly 100% (currently ${total}%).`);
  }
  return storeSetWeights(projectId, weights);
}

// A9. Progress history snapshots. One snapshot per project per day --
// calling this again today updates today's snapshot rather than creating a
// duplicate; snapshots for other days are untouched (see
// mockOperationalData.recordProgressSnapshot).
export async function recordProgressSnapshot(project) {
  const progress = await getProjectProgress(project.id);
  const actualProgress = progress?.overallProgress ?? project.progress ?? 0;
  const plannedProgress = round1(plannedProgressByTime(project));
  return storeRecordSnapshot(project.id, {
    snapshotDate: new Date().toISOString().slice(0, 10),
    plannedProgress,
    actualProgress,
    source: 'progressRepository.getProjectProgress',
  });
}

export async function getProgressHistory(projectId) {
  return storeGetProgressHistory(projectId);
}

// FT-5→FT-8 Consolidation, Section 15: portfolio S-Curve built from REAL
// recorded progress snapshots (progressHistory), never static/hardcoded
// data. Uses last-known-value carry-forward per project for any date a
// given project has no snapshot of its own, since snapshots are only
// recorded when a project's detail page is actually visited (see
// mockOperationalData.recordProgressSnapshot) -- the mock architecture
// does not guarantee a snapshot exists for every project on every date.
export async function getPortfolioSCurve() {
  const projects = await getProjects();
  const allHistories = await Promise.all(projects.map((p) => getProgressHistory(p.id)));
  const dateSet = new Set();
  allHistories.forEach((h) => h.forEach((snap) => dateSet.add(snap.snapshotDate)));
  const labels = [...dateSet].sort();

  if (labels.length === 0) {
    return { labels: [], plan: [], actual: [], variance: [], dataAvailable: false };
  }

  const plan = [];
  const actual = [];
  labels.forEach((date) => {
    const plannedVals = [];
    const actualVals = [];
    allHistories.forEach((h) => {
      const latest = [...h].reverse().find((s) => s.snapshotDate <= date);
      if (latest) {
        plannedVals.push(latest.plannedProgress);
        actualVals.push(latest.actualProgress);
      }
    });
    plan.push(plannedVals.length ? round1(plannedVals.reduce((a, b) => a + b, 0) / plannedVals.length) : null);
    actual.push(actualVals.length ? round1(actualVals.reduce((a, b) => a + b, 0) / actualVals.length) : null);
  });
  const variance = plan.map((p, i) => (p != null && actual[i] != null ? round1(actual[i] - p) : null));

  return { labels, plan, actual, variance, dataAvailable: true };
}

// Portfolio-wide aggregation for the Dashboard (Project Blueprint
// SPMS-DOC-05, Section 10). Reads the same per-project calculation used by
// Project Master -- the Dashboard does not define its own version.
export async function getPortfolioSummary() {
  const projects = await getProjects();
  const perProject = await Promise.all(
    projects.map(async (p) => ({ project: p, progress: await getProjectProgress(p.id), schedule: await getScheduleStatus(p) }))
  );

  const totalProjects = projects.length;
  const overallProgress = round1(
    perProject.reduce((sum, x) => sum + (x.progress?.overallProgress ?? x.project.progress ?? 0), 0) / (totalProjects || 1)
  );
  const onSchedule = perProject.filter((x) => x.schedule.isOnSchedule).length;
  const onDelay = totalProjects - onSchedule;

  const allEngDocs = perProject.flatMap((x) => getOperations(x.project.id)?.engineeringDocuments ?? []);
  const engineeringDocStatus = {
    approved: allEngDocs.filter((d) => d.reviewStatus === 'APPROVED').length,
    commented: allEngDocs.filter((d) => d.reviewStatus === 'COMMENTED').length,
    rejected: allEngDocs.filter((d) => d.reviewStatus === 'REJECTED').length,
    total: allEngDocs.length,
  };

  const procurementStatus = round1(
    perProject.reduce((sum, x) => sum + (x.progress?.component.procurement ?? 0), 0) / (totalProjects || 1)
  );

  const allIssues = perProject.flatMap((x) => getOperations(x.project.id)?.issues ?? []);
  const openIssues = allIssues.filter((i) => i.status === 'OPEN');
  const siteIssues = {
    open: openIssues.length,
    closed: allIssues.length - openIssues.length,
    byPriority: ['Critical', 'High', 'Medium', 'Low'].map((p) => ({
      priority: p,
      count: openIssues.filter((i) => i.priority === p).length,
    })),
  };

  return { totalProjects, overallProgress, onSchedule, onDelay, engineeringDocStatus, procurementStatus, siteIssues };
}
