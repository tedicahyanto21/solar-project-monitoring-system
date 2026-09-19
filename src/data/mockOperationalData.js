// In-memory mock "backend" for Project Master operational data.
//
// This exists purely to make the FT-4 UI functional against something
// realistic while Firestore is not yet wired up. Shape mirrors the
// subcollections defined in the Database Design (SPMS-DOC-06), Sections
// 6-14, so the repository layer built on top of this can be swapped for
// real Firestore calls later without changing the data shape.
//
// State here is mutable and resets on page reload -- there is no
// persistence. That is expected for this stage.
import { initialProjects, PROJECT_MANAGERS } from './mockProjects';

export const MILESTONE_PHASES = ['Engineering', 'Procurement', 'Construction', 'Commissioning', 'COD'];
export const REVIEW_STATUSES = ['APPROVED', 'COMMENTED', 'REJECTED'];
export const ISSUE_STATUSES = ['OPEN', 'CLOSED'];
export const ISSUE_SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

// FT-5 A5: Procurement milestones are configurable per project -- this is
// a seed default, not a hardcoded closed list. Repository code (see
// projectDetailRepository.createProcurementMilestone) can add more.
const DEFAULT_PROCUREMENT_MILESTONE_NAMES = ['PO Released', 'Manufacturing', 'FAT', 'Shipment', 'Delivery'];

// Default component weights feeding Overall Progress (Progress Engine
// Design SPMS-DOC-04, Section 4; Database Design Section 7). These are
// PER-PROJECT and editable through progressRepository.setProgressWeights --
// the values below are only the starting default, never hardcoded into the
// calculation itself. HSE is intentionally absent by default (FT-5 A2/A4:
// HSE is monitoring-only unless a project explicitly configures it as a
// weighted component, in which case its key is added here and the total
// across ALL active keys, HSE included, must still be exactly 100%).
const DEFAULT_WEIGHTS = { engineering: 20, procurement: 20, construction: 45, commissioning: 15 };
// Exported (Master Prompt #2, Section 13) so projectDetailRepository can
// fall back to the SAME default in Firebase mode for a project whose
// document has no `progressWeights` field yet -- one definition, not two.
export { DEFAULT_WEIGHTS };

function seedRandom(seed) {
  // Small deterministic PRNG (mulberry32) so mock data is stable across
  // reloads instead of reshuffling every render.
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}
function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

const ENGINEERING_DOC_NAMES = ['Single Line Diagram', 'Civil Layout Drawing', 'Structural Calculation', 'Cable Schedule', 'Inverter Layout', 'Grounding Plan', 'PV Array Layout', 'SCADA Architecture'];
const HSE_ITEM_NAMES = ['Site Safety Permit', 'Working at Height Permit', 'Hot Work Permit', 'Environmental Permit', 'PPE Compliance Audit', 'Toolbox Talk Record'];
const CONSTRUCTION_ACTIVITIES = ['Piling', 'Structure Erection', 'Module Installation', 'Cable Tray Installation', 'Cable Pulling', 'Inverter Installation'];
const ISSUE_TITLES = ['Module delivery delay', 'Access road condition', 'Cable routing clash', 'Permit renewal pending', 'Manpower shortage', 'Grid connection query', 'Design revision required', 'Weather-related delay'];

function generateOperationsFor(project) {
  const rng = seedRandom(hashCode(project.id));
  const progressFrac = clamp(project.progress / 100, 0, 1);

  // --- Milestones -----------------------------------------------------
  const milestones = MILESTONE_PHASES.map((phase, i) => {
    const phaseProgress = clamp(progressFrac * (1.25 - i * 0.2) + (rng() - 0.5) * 0.08, 0, 1);
    const status = phaseProgress >= 0.999 ? 'Completed' : phaseProgress > 0 ? 'In Progress' : 'Not Started';
    return {
      id: `${project.id}-ms-${i}`,
      phase,
      name: `${phase} Milestone`,
      plannedStart: project.contractStart,
      plannedFinish: project.targetCOD,
      weight: DEFAULT_WEIGHTS[phase.toLowerCase()] ?? Math.round(100 / MILESTONE_PHASES.length),
      status,
      completion: Math.round(phaseProgress * 100),
    };
  });

  // --- Engineering documents -------------------------------------------
  // FT-4.1 Correction 4: reviewStatus and progressContribution are
  // generated independently -- progressContribution is its own data-driven
  // field (0-100, per document), never derived from reviewStatus via a
  // hardcoded formula such as "COMMENTED = 50%".
  const engDocCount = 4 + Math.floor(rng() * 3);
  const engineeringDocuments = Array.from({ length: engDocCount }, (_, i) => {
    const roll = rng();
    const reviewStatus = roll < progressFrac * 0.8 ? 'APPROVED' : roll < 0.85 ? 'COMMENTED' : 'REJECTED';
    const weight = Math.round(100 / engDocCount);
    const progressContribution = Math.round(clamp(progressFrac + (rng() - 0.5) * 0.3, 0, 1) * 100);
    return {
      id: `${project.id}-eng-${i}`,
      docId: `ENG-${project.projectCode}-${String(i + 1).padStart(3, '0')}`,
      name: pick(rng, ENGINEERING_DOC_NAMES),
      category: 'Engineering Drawing',
      weight,
      reviewStatus,
      progressContribution,
      responsibleEngineer: 'Engineering Team',
    };
  });

  // --- HSE / permit documents -------------------------------------------
  // FT-4.1 Correction 5: status and progressContribution are likewise
  // independent -- no "Valid/Closed = 100%, else = 0%" rule.
  const hseDocCount = 3 + Math.floor(rng() * 2);
  const hseDocuments = Array.from({ length: hseDocCount }, (_, i) => {
    const done = rng() < progressFrac + 0.15;
    const weight = Math.round(100 / hseDocCount);
    const progressContribution = Math.round(clamp(progressFrac + (rng() - 0.5) * 0.3, 0, 1) * 100);
    return {
      id: `${project.id}-hse-${i}`,
      name: pick(rng, HSE_ITEM_NAMES),
      category: 'Permit',
      weight,
      status: done ? 'Valid / Closed' : 'Pending',
      responsibleHse: 'HSE Team',
      progressContribution,
    };
  });

  // --- Procurement milestones (FT-5 A5: dedicated, configurable, used for
  // Procurement progress calculation -- separate from the general
  // contractual `milestones` timeline above, which stays as high-level
  // per-phase schedule display). --------------------------------------
  const procurementMilestones = DEFAULT_PROCUREMENT_MILESTONE_NAMES.map((name, i, arr) => {
    const target = (i + 1) / arr.length;
    const progressContribution = Math.round(clamp((progressFrac / target) * 100, 0, 100));
    const status = progressContribution >= 100 ? 'Completed' : progressContribution > 0 ? 'In Progress' : 'Not Started';
    return {
      id: `${project.id}-pm-${i}`,
      name,
      weight: Math.round(100 / arr.length),
      plannedDate: project.targetCOD,
      actualDate: status === 'Completed' ? project.contractStart : null,
      status,
      progressContribution,
    };
  });

  // --- Construction activities (quantity-based) -------------------------
  const constructionActivities = CONSTRUCTION_ACTIVITIES.slice(0, 4 + Math.floor(rng() * 2)).map((activity, i) => {
    const plannedQuantity = Math.round(50 + rng() * 200);
    const actualQuantity = Math.round(plannedQuantity * clamp(progressFrac + (rng() - 0.5) * 0.2, 0, 1));
    return {
      id: `${project.id}-con-${i}`,
      activity,
      plannedQuantity,
      actualQuantity,
      unit: 'units',
      weight: Math.round(100 / (4 + Math.floor(rng() * 2))),
      // C-01B: history entries use `dailyQuantity` (independent daily
      // delta), not a cumulative snapshot. Seeding a zero-quantity day-one
      // entry plus one entry equal to the full seeded actualQuantity keeps
      // SUM(dailyQuantity) === actualQuantity for this seed data, while
      // representing the new daily model going forward (see
      // computeCumulativeFromHistory).
      history: [{ date: project.contractStart, dailyQuantity: 0 }, { date: new Date().toISOString().slice(0, 10), dailyQuantity: actualQuantity }],
      updatedAt: new Date().toISOString(),
    };
  });

  // --- Commissioning checklist ------------------------------------------
  const commissioningChecklist = ['Pre-commissioning Test', 'Functional Test', 'Performance Test', 'Punch List Closure'].map((item, i) => {
    const done = rng() < clamp(progressFrac - 0.5, 0, 1) + 0.05;
    return {
      id: `${project.id}-com-${i}`,
      item,
      weight: 25,
      completionStatus: done ? 'Complete' : 'Pending',
    };
  });

  // --- Issues -------------------------------------------------------------
  // FT-6 A1: canonical field names (issueId, projectId, priority,
  // responsibleUserId/Name, openedAt/closedAt/closedBy). createdAt is the
  // record-creation timestamp; openedAt is the business "issue is open
  // since" date -- for seed data they coincide, but they are conceptually
  // distinct (an issue could be logged some time after it was first
  // observed on site).
  const issueCount = project.openIssues ?? 2;
  const issues = Array.from({ length: issueCount + 2 }, (_, i) => {
    const isOpen = i < issueCount;
    const openDaysAgo = Math.floor(rng() * 20) + 1;
    const openedAt = new Date(Date.now() - openDaysAgo * 86400000).toISOString().slice(0, 10);
    const closedAt = isOpen ? null : new Date(Date.now() - Math.floor(rng() * openDaysAgo) * 86400000).toISOString().slice(0, 10);
    return {
      issueId: `${project.id}-iss-${i}`,
      projectId: project.id,
      title: pick(rng, ISSUE_TITLES),
      description: 'Auto-generated example issue for mock data purposes.',
      category: pick(rng, ['Engineering', 'Procurement', 'Construction', 'HSE']),
      priority: pick(rng, ISSUE_SEVERITIES),
      status: isOpen ? 'OPEN' : 'CLOSED',
      responsibleUserId: null,
      responsibleUserName: pick(rng, ['Site Manager', 'Engineering', 'SCM']),
      createdBy: project.projectManager,
      createdAt: openedAt,
      openedAt,
      closedAt,
      closedBy: isOpen ? null : project.projectManager,
    };
  });

  // --- Team assignments ----------------------------------------------------
  // userId is the canonical reference (Database Design SPMS-DOC-06, Section 6:
  // projects/{projectId}/assignments/{userId}); name is denormalized for display.
  const assignments = [
    { userId: `${project.id}-pm`, name: project.projectManager, role: 'PROJECT_MANAGER', assignedAt: project.contractStart, assignedBy: 'seed' },
    { userId: `${project.id}-sm`, name: pick(rng, PROJECT_MANAGERS).name, role: 'SITE_MANAGER', assignedAt: project.contractStart, assignedBy: 'seed' },
    { userId: `${project.id}-eng`, name: 'Unassigned', role: 'ENGINEERING', assignedAt: null, assignedBy: null },
    { userId: `${project.id}-hse`, name: 'Unassigned', role: 'HSE', assignedAt: null, assignedBy: null },
  ];

  return {
    milestones,
    procurementMilestones,
    engineeringDocuments,
    hseDocuments,
    constructionActivities,
    commissioningChecklist,
    issues,
    assignments,
    progressWeights: { ...DEFAULT_WEIGHTS },
    progressHistory: [],
    // --- FT-5 Part B seeds: Cost Control ---------------------------------
    plannedCost: { amount: Math.round(project.capacity * 12_000_000_000 * (0.9 + rng() * 0.3)), currency: 'IDR', updatedAt: project.contractStart, updatedBy: 'seed' },
    costTransactions: [],
    paymentProjections: [],
    duplicateControls: new Map(),
  };
}

const store = new Map(initialProjects.map((p) => [p.id, generateOperationsFor(p)]));

export function getOperations(projectId) {
  return store.get(projectId) ?? null;
}

export function addEngineeringDocument(projectId, doc) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const record = { id: `${projectId}-eng-${Date.now()}`, progressContribution: 0, ...doc };
  ops.engineeringDocuments = [record, ...ops.engineeringDocuments];
  return record;
}

export function addHseDocument(projectId, doc) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const record = { id: `${projectId}-hse-${Date.now()}`, progressContribution: 0, ...doc };
  ops.hseDocuments = [record, ...ops.hseDocuments];
  return record;
}

// FT-6 A1/A2: issueId is the identity; projectId is stamped for report
// filtering. createdAt/openedAt default together at creation time --
// closing/reopening never touches either.
export function addIssue(projectId, issue) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const now = new Date().toISOString().slice(0, 10);
  const record = {
    issueId: `${projectId}-iss-${Date.now()}`,
    projectId,
    status: 'OPEN',
    createdAt: now,
    openedAt: now,
    closedAt: null,
    closedBy: null,
    responsibleUserId: null,
    responsibleUserName: '',
    ...issue,
  };
  ops.issues = [record, ...ops.issues];
  return record;
}

export function updateIssue(projectId, issueId, patch) {
  const ops = store.get(projectId);
  if (!ops) return null;
  ops.issues = ops.issues.map((i) => (i.issueId === issueId ? { ...i, ...patch } : i));
  return ops.issues.find((i) => i.issueId === issueId) ?? null;
}

export function closeIssue(projectId, issueId, closedBy) {
  // Closing preserves openedAt/createdAt -- only status, closedAt, and
  // closedBy change (FT-6 validation A6/A7).
  return updateIssue(projectId, issueId, { status: 'CLOSED', closedAt: new Date().toISOString().slice(0, 10), closedBy });
}

// FT-6 A2/A3: reopening clears closedAt/closedBy but never touches
// openedAt/createdAt -- the issue's original open date remains historically
// accurate even across a close/reopen cycle.
export function reopenIssue(projectId, issueId) {
  return updateIssue(projectId, issueId, { status: 'OPEN', closedAt: null, closedBy: null });
}

// C-01A: dedicated, non-additive PM assignment for the mock store --
// PROJECT_MANAGER must always remain exactly one holder, so it cannot go
// through the additive assignUser above (which is correct for SITE_MANAGER/
// ENGINEERING/HSE, but would let PM accumulate multiple holders too).
// Removes ANY existing PROJECT_MANAGER row (regardless of which user held
// it) before adding the new one, mirroring the delete-then-set pattern
// projectDetailService.setProjectManager uses for Firebase.
export function setProjectManagerAssignment(projectId, { userId, name }, assignedBy) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const now = new Date().toISOString();
  const withoutExistingPm = ops.assignments.filter((a) => a.role !== 'PROJECT_MANAGER');
  ops.assignments = [...withoutExistingPm, { userId, name, role: 'PROJECT_MANAGER', assignedAt: now, assignedBy }];
  return ops.assignments;
}

// C-01A: identity-based (role + userId), additive assignment. Previously
// this found the existing row for a ROLE ALONE and overwrote it -- meaning
// assigning a second SITE_MANAGER silently REPLACED the first one, making
// "multiple Site Managers per project" structurally impossible even though
// nothing about the underlying data shape required that limitation.
//
// New behavior:
//   - same user, same role already exists -> update that row in place
//     (e.g. refreshing the denormalized name).
//   - a DIFFERENT user for a role that currently only has an "Unassigned"
//     placeholder (the seed convention for an empty slot) -> replace the
//     placeholder, since it was never a real assignment.
//   - a DIFFERENT user for a role some OTHER real user already holds ->
//     ADD a new row; the existing user's assignment is left untouched.
// PROJECT_MANAGER never reaches this function -- projectDetailRepository
// routes PM assignment through setProjectManager() instead, which keeps
// its own single-PM-per-project invariant untouched by this change.
export function assignUser(projectId, role, { userId, name }, assignedBy) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const now = new Date().toISOString();
  const sameUserSameRole = ops.assignments.find((a) => a.role === role && a.userId === userId);
  if (sameUserSameRole) {
    ops.assignments = ops.assignments.map((a) =>
      (a.role === role && a.userId === userId) ? { ...a, name, assignedAt: now, assignedBy } : a
    );
  } else {
    const withoutPlaceholder = ops.assignments.filter((a) => !(a.role === role && a.name === 'Unassigned'));
    ops.assignments = [...withoutPlaceholder, { userId, name, role, assignedAt: now, assignedBy }];
  }
  return ops.assignments;
}

// C-01A: remove one specific (role, userId) assignment -- the natural
// counterpart to the additive assignUser above. Never used for
// PROJECT_MANAGER (which always has exactly one holder, changed via
// setProjectManager, never removed to zero).
export function removeAssignment(projectId, role, userId) {
  const ops = store.get(projectId);
  if (!ops) return null;
  ops.assignments = ops.assignments.filter((a) => !(a.role === role && a.userId === userId));
  return ops.assignments;
}

export function setProgressWeights(projectId, weights) {
  const ops = store.get(projectId);
  if (!ops) return null;
  // FT-5 A2: full replace, not merge -- this is how a component (e.g. HSE)
  // gets removed from the active weighted set, not just added/overwritten.
  // Validation of the total happens in progressRepository before this is
  // ever called.
  ops.progressWeights = { ...weights };
  return ops.progressWeights;
}

// --- FT-5 A3/A4: editing existing Engineering/HSE items -------------------
// (creation already existed from FT-4; FT-5 adds the ability to update the
// progress contribution of an EXISTING item, which is how an authorized
// Engineering/HSE user is expected to actually maintain progress day to
// day, per A3/A4's "manually maintained" requirement.)
export function updateEngineeringDocument(projectId, docId, patch) {
  const ops = store.get(projectId);
  if (!ops) return null;
  ops.engineeringDocuments = ops.engineeringDocuments.map((d) => (d.id === docId ? { ...d, ...patch } : d));
  return ops.engineeringDocuments.find((d) => d.id === docId) ?? null;
}

export function updateHseDocument(projectId, docId, patch) {
  const ops = store.get(projectId);
  if (!ops) return null;
  ops.hseDocuments = ops.hseDocuments.map((d) => (d.id === docId ? { ...d, ...patch } : d));
  return ops.hseDocuments.find((d) => d.id === docId) ?? null;
}

// --- FT-5 A5: Procurement milestones (configurable) -----------------------
export function createProcurementMilestone(projectId, milestone) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const record = { id: `${projectId}-pm-${Date.now()}`, progressContribution: 0, status: 'Not Started', actualDate: null, ...milestone };
  ops.procurementMilestones = [...ops.procurementMilestones, record];
  return record;
}

export function updateProcurementMilestone(projectId, milestoneId, patch) {
  const ops = store.get(projectId);
  if (!ops) return null;
  ops.procurementMilestones = ops.procurementMilestones.map((m) => (m.id === milestoneId ? { ...m, ...patch } : m));
  return ops.procurementMilestones.find((m) => m.id === milestoneId) ?? null;
}

// --- FT-5 A6 / Master Prompt #3: Construction PLAN vs ACTUAL --------------
// Two explicit, separate entry points -- never one unrestricted "update"
// function -- so PLAN and ACTUAL responsibilities cannot accidentally
// cross paths at the code level, not just by convention.
//
// createConstructionActivity / updateConstructionActivityPlan: PLAN fields
// only (activity/plannedQuantity/unit/weight) -- PROJECT_MANAGER territory.
export function createConstructionActivity(projectId, { activity, plannedQuantity, unit, weight }) {
  const ops = store.get(projectId);
  if (!ops) return null;
  if (!(plannedQuantity > 0)) {
    throw new Error('Planned Quantity must be greater than zero.');
  }
  const record = {
    // Date.now() alone can collide if two activities are created within
    // the same millisecond (e.g. rapid sequential calls, or a fast test
    // suite) -- the random suffix guarantees a unique id even then.
    id: `${projectId}-con-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    activity,
    plannedQuantity,
    unit,
    weight,
    // Initial ACTUAL state -- a brand-new PLAN item has no site progress
    // yet. This is the ONLY place actualQuantity/history are set by a PLAN
    // operation; every operation after this goes through
    // updateConstructionActivity (ACTUAL-only) instead.
    actualQuantity: 0,
    history: [],
    updatedAt: new Date().toISOString(),
  };
  ops.constructionActivities = [...ops.constructionActivities, record];
  return record;
}

export function updateConstructionActivityPlan(projectId, activityId, { activity, plannedQuantity, unit, weight }) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const current = ops.constructionActivities.find((a) => a.id === activityId);
  if (!current) return null;
  if (plannedQuantity !== undefined && !(plannedQuantity > 0)) {
    throw new Error('Planned Quantity must be greater than zero.');
  }
  const patch = {};
  if (activity !== undefined) patch.activity = activity;
  if (plannedQuantity !== undefined) patch.plannedQuantity = plannedQuantity;
  if (unit !== undefined) patch.unit = unit;
  if (weight !== undefined) patch.weight = weight;
  // Structural guarantee, not just convention: only the four PLAN fields
  // above are ever assigned here -- actualQuantity/history are copied
  // through UNCHANGED via the spread, never touched by this function,
  // however the caller's object is shaped.
  ops.constructionActivities = ops.constructionActivities.map((a) => (a.id === activityId ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a));
  return ops.constructionActivities.find((a) => a.id === activityId) ?? null;
}

// --- C-01B: daily actual -> system-calculated cumulative ------------------
// History entries now record an independent DAILY quantity per date
// (`dailyQuantity`), not a cumulative snapshot. Cumulative actualQuantity
// is always SUM(history.dailyQuantity) -- never entered directly by a user
// and never recalculated anywhere outside this function (progressRepository
// keeps reading the resulting top-level actualQuantity exactly as before;
// it has no daily-vs-cumulative concept and needs none).
//
// Legacy compatibility (C-01B Step 3): a history entry written before this
// change has `actualQuantity` (a cumulative-at-that-date snapshot) and no
// `dailyQuantity`. Summing those directly would double-count. Instead, the
// LAST such legacy entry's value is treated as a one-time starting
// baseline -- "how far along this activity was before daily tracking
// began" -- and only entries carrying `dailyQuantity` are summed as
// independent deltas on top of it. This never touches or rewrites a
// legacy entry's own data; it only affects how NEW cumulative totals are
// computed going forward.
// C-01B Corrective, Fix #1: the legacy baseline must be the LATEST legacy
// snapshot BY DATE, not the numerically largest one -- a cumulative
// snapshot could in principle have been corrected downward in the old
// system, so "latest date" is the only reading that stays faithful to
// the chronological history rather than assuming values only ever grew.
// Uses the same string date comparison already used elsewhere in this
// codebase (ISO YYYY-MM-DD sorts correctly lexicographically) rather than
// introducing a new date utility.
export function computeCumulativeFromHistory(history) {
  const legacyEntries = history.filter((h) => h.dailyQuantity === undefined && h.actualQuantity !== undefined);
  const dailyEntries = history.filter((h) => h.dailyQuantity !== undefined);
  const latestLegacyEntry = legacyEntries.reduce(
    (latest, h) => (!latest || h.date > latest.date ? h : latest),
    null
  );
  const legacyBaseline = latestLegacyEntry ? latestLegacyEntry.actualQuantity : 0;
  const dailySum = dailyEntries.reduce((sum, h) => sum + h.dailyQuantity, 0);
  return legacyBaseline + dailySum;
}

// --- FT-5 A6 / C-01B: Construction activity ACTUAL update, with validation --
// Thrown errors are business-rule violations the UI is expected to catch
// and display -- they are not bugs. C-01B: the caller now supplies the
// DAY'S quantity (dailyQuantity), never the running total -- the running
// total (actualQuantity) is always computed here, from history, never
// accepted as an input.
export function updateConstructionActivity(projectId, activityId, { dailyQuantity, date }) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const activity = ops.constructionActivities.find((a) => a.id === activityId);
  if (!activity) return null;
  if (activity.plannedQuantity <= 0) {
    throw new Error('Planned Quantity must be greater than zero before Actual Quantity can be recorded.');
  }
  if (dailyQuantity < 0) {
    throw new Error('Actual Quantity cannot be negative.');
  }
  const entryDate = date || new Date().toISOString().slice(0, 10);
  // C-01B Small Corrective: a Daily Actual date must be >= the latest
  // legacy snapshot's date. Backdating before that point would record a
  // daily delta for a period the legacy system had already accounted for
  // in its own cumulative snapshot, silently double-counting progress that
  // predates daily tracking. The submitted date itself is never modified
  // -- an invalid date is rejected outright, not clamped or moved.
  const latestLegacyEntry = activity.history.reduce(
    (latest, h) => (h.dailyQuantity === undefined && h.actualQuantity !== undefined && (!latest || h.date > latest.date) ? h : latest),
    null
  );
  if (latestLegacyEntry && entryDate < latestLegacyEntry.date) {
    throw new Error('Daily Actual date cannot be earlier than the latest legacy actual date.');
  }
  // C-01B, fixed business decision: a SECOND entry for the same date
  // REPLACES that day's dailyQuantity (a correction) -- it is never added
  // to the existing value and never creates a second entry for that date.
  //
  // C-01B Corrective, Fix #2: this lookup matches only an EXISTING
  // NEW-STYLE (dailyQuantity) entry for the date -- never a legacy
  // {date, actualQuantity} snapshot that happens to share it. A legacy
  // entry is a cumulative snapshot, not a daily delta; overwriting it with
  // {date, dailyQuantity} would silently destroy the legacy baseline
  // computeCumulativeFromHistory depends on (e.g. a legacy 200 replaced by
  // a "50" would wrongly make cumulative 50 instead of 250). When no
  // NEW-style entry exists yet for this date -- whether because there is
  // no entry at all, or because the only entry sharing the date is a
  // legacy one -- a new entry is appended, leaving any legacy entry on
  // that same date completely untouched.
  const existingDailyEntry = activity.history.find((h) => h.date === entryDate && h.dailyQuantity !== undefined);
  const history = existingDailyEntry
    ? activity.history.map((h) => (h === existingDailyEntry ? { date: entryDate, dailyQuantity } : h))
    : [...activity.history, { date: entryDate, dailyQuantity }];
  const actualQuantity = computeCumulativeFromHistory(history);

  ops.constructionActivities = ops.constructionActivities.map((a) =>
    a.id === activityId ? { ...a, actualQuantity, history, updatedAt: new Date().toISOString() } : a
  );
  return ops.constructionActivities.find((a) => a.id === activityId);
}

// --- FT-5 A9: Progress history snapshots -----------------------------------
// One snapshot per project per calendar day -- calling this again on the
// same day UPDATES that day's snapshot rather than creating a duplicate
// (A9: "Avoid duplicating the same snapshot for the same project/date").
// Existing snapshots for OTHER dates are never rewritten.
export function recordProgressSnapshot(projectId, { snapshotDate, plannedProgress, actualProgress, source }) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const date = snapshotDate || new Date().toISOString().slice(0, 10);
  // FT-7 Part D: explicit stable snapshotId, alongside the natural
  // (projectId, snapshotDate) composite key already used for de-duplication.
  const snapshot = { snapshotId: `${projectId}-snap-${date}`, projectId, snapshotDate: date, plannedProgress, actualProgress, source: source || 'progressRepository' };
  const existingIndex = ops.progressHistory.findIndex((s) => s.snapshotDate === date);
  if (existingIndex >= 0) {
    ops.progressHistory = ops.progressHistory.map((s, i) => (i === existingIndex ? snapshot : s));
  } else {
    ops.progressHistory = [...ops.progressHistory, snapshot].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  }
  return snapshot;
}

export function getProgressHistory(projectId) {
  return store.get(projectId)?.progressHistory ?? [];
}

// ===========================================================================
// FT-5 Part B: Project Cost Control
// ===========================================================================

export function getPlannedCost(projectId) {
  return store.get(projectId)?.plannedCost ?? null;
}

export function setPlannedCost(projectId, { amount, currency, updatedBy }) {
  const ops = store.get(projectId);
  if (!ops) return null;
  // B4: changing Planned Cost never touches transaction history.
  ops.plannedCost = { amount, currency: currency || ops.plannedCost.currency, updatedAt: new Date().toISOString(), updatedBy };
  return ops.plannedCost;
}

export function getPaymentProjections(projectId) {
  return store.get(projectId)?.paymentProjections ?? [];
}

// FT-7 Part D: stable ID is projectionId (not a generic `id`), consistent
// with issueId/transactionId elsewhere -- display names are never the
// relationship key.
export function createPaymentProjection(projectId, projection) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const record = {
    projectionId: `${projectId}-pp-${Date.now()}`,
    projectId,
    status: 'PLANNED',
    createdAt: new Date().toISOString(),
    currency: 'IDR',
    ...projection,
  };
  ops.paymentProjections = [record, ...ops.paymentProjections];
  return record;
}

import { checkDuplicateTransaction as sharedCheckDuplicate } from '../services/duplicateDetection';

export function getCostTransactions(projectId) {
  return store.get(projectId)?.costTransactions ?? [];
}

// B8/B9: layered duplicate detection -- logic itself lives in
// services/duplicateDetection.js (shared with the Firestore backend, see
// FT-5→FT-8 consolidation Part D); this just supplies the mock store's
// current transaction list.
export function checkDuplicateTransaction(projectId, candidate) {
  const ops = store.get(projectId);
  if (!ops) return { level: null, reasons: [] };
  return sharedCheckDuplicate(projectId, candidate, ops.costTransactions);
}

// B6/B9: creates a transaction. Strong duplicates are BLOCKED unless an
// explicit, reasoned Super Admin override is supplied -- override is never
// the default path.
// FT-5→FT-8 Consolidation, Section 14 -- CRITICAL: prevent HC/Finance
// double counting. Every transaction now carries a transactionType:
//   COST         -> an incurred expense/accrual. Counts toward Actual Cost.
//                   This is the normal type for SCM and HC transactions,
//                   and for a Finance transaction that records a cost with
//                   no prior SCM/HC entry (e.g. a direct owner payment).
//   PAYMENT_ONLY -> a cash movement that SETTLES a cost already recorded
//                   (via relatedTransactionId). Does NOT count toward
//                   Actual Cost a second time -- the expense was already
//                   counted once, when the COST transaction was posted.
// Finance users choose the type explicitly; SCM/HC are always COST (an
// accommodation or procurement entry is never "just a payment" for
// something already on the ledger from the same source role).
export const TRANSACTION_TYPES = ['COST', 'PAYMENT_ONLY'];

export function createCostTransaction(projectId, transaction, override) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const duplicate = checkDuplicateTransaction(projectId, transaction);
  if (duplicate.level === 'STRONG') {
    const validOverride = override && override.confirmed && override.reason && override.byRole === 'SUPER_ADMIN';
    if (!validOverride) {
      const err = new Error('Strong duplicate detected -- posting blocked.');
      err.duplicate = duplicate;
      throw err;
    }
  }
  if (transaction.transactionType === 'PAYMENT_ONLY' && !transaction.relatedTransactionId) {
    throw new Error('A PAYMENT_ONLY transaction must reference the existing Cost Transaction it settles (relatedTransactionId).');
  }
  if (transaction.relatedTransactionId && !ops.costTransactions.some((t) => t.transactionId === transaction.relatedTransactionId)) {
    throw new Error(`Related transaction "${transaction.relatedTransactionId}" was not found on this project.`);
  }
  const transactionId = `CST-${new Date().getFullYear()}-${String(ops.costTransactions.length + 1).padStart(6, '0')}`;
  const record = {
    transactionId,
    projectId,
    status: 'DRAFT',
    currency: 'IDR',
    transactionType: 'COST', // SCM/HC default; Finance may override to PAYMENT_ONLY
    relatedTransactionId: null,
    createdAt: new Date().toISOString(),
    ...transaction,
    duplicateCheck: duplicate.level ? duplicate : null,
    override: duplicate.level === 'STRONG' ? { ...override, at: new Date().toISOString() } : null,
  };
  ops.costTransactions = [record, ...ops.costTransactions];
  return record;
}

// B6: POSTED is the only status that requires the duplicate control record
// (created atomically alongside the status change, per Database Design
// SPMS-DOC-06 Section 15, to prevent a race between two concurrent posts).
export function postCostTransaction(projectId, transactionId, postedBy) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const tx = ops.costTransactions.find((t) => t.transactionId === transactionId);
  if (!tx) return null;
  if (tx.status !== 'DRAFT') throw new Error(`Only a DRAFT transaction can be posted (current status: ${tx.status}).`);
  const duplicateKey = [projectId, normalizeRef(tx.referenceNumber) || normalizeRef(tx.invoiceNumber)].join('::');
  if (duplicateKey.trim() !== `${projectId}::` && ops.duplicateControls.has(duplicateKey)) {
    throw new Error('A transaction with this reference has already been posted for this project.');
  }
  ops.duplicateControls.set(duplicateKey, transactionId);
  ops.costTransactions = ops.costTransactions.map((t) =>
    t.transactionId === transactionId ? { ...t, status: 'POSTED', postedBy, postedAt: new Date().toISOString() } : t
  );
  return ops.costTransactions.find((t) => t.transactionId === transactionId);
}

// B6: normal workflow is VOID, never physical delete -- a voided
// transaction remains fully visible for audit.
export function voidCostTransaction(projectId, transactionId, { voidedBy, voidReason }) {
  const ops = store.get(projectId);
  if (!ops) return null;
  if (!voidReason || !voidReason.trim()) throw new Error('A void reason is required.');
  ops.costTransactions = ops.costTransactions.map((t) =>
    t.transactionId === transactionId ? { ...t, status: 'VOID', voidedBy, voidedAt: new Date().toISOString(), voidReason } : t
  );
  return ops.costTransactions.find((t) => t.transactionId === transactionId);
}
