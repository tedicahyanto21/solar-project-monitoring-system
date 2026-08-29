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
      // FT-5 A6: historical daily progress, preserved (never overwritten)
      // on every update -- see updateConstructionActivity below.
      history: [{ date: project.contractStart, actualQuantity: 0 }, { date: new Date().toISOString().slice(0, 10), actualQuantity }],
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

export function assignUser(projectId, role, { userId, name }, assignedBy) {
  const ops = store.get(projectId);
  if (!ops) return null;
  // Assignment reference is userId (Database Design SPMS-DOC-06, Section 6:
  // projects/{projectId}/assignments/{userId}). `name` is a denormalized
  // display convenience only -- userId is the canonical value.
  ops.assignments = ops.assignments.map((a) =>
    a.role === role ? { ...a, userId, name, assignedAt: new Date().toISOString(), assignedBy } : a
  );
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

// --- FT-5 A6: Construction activity update, with validation ----------------
// Thrown errors are business-rule violations the UI is expected to catch
// and display -- they are not bugs.
export function updateConstructionActivity(projectId, activityId, { actualQuantity, date }) {
  const ops = store.get(projectId);
  if (!ops) return null;
  const activity = ops.constructionActivities.find((a) => a.id === activityId);
  if (!activity) return null;
  if (activity.plannedQuantity <= 0) {
    throw new Error('Planned Quantity must be greater than zero before Actual Quantity can be recorded.');
  }
  if (actualQuantity < 0) {
    throw new Error('Actual Quantity cannot be negative.');
  }
  const entryDate = date || new Date().toISOString().slice(0, 10);
  // Historical daily progress is APPENDED, never overwritten (A6: "Preserve
  // /update historical daily progress information"). If an entry already
  // exists for the same date, that entry alone is corrected -- earlier
  // dates are left untouched.
  const existingSameDay = activity.history.find((h) => h.date === entryDate);
  const history = existingSameDay
    ? activity.history.map((h) => (h.date === entryDate ? { date: entryDate, actualQuantity } : h))
    : [...activity.history, { date: entryDate, actualQuantity }];

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

export function getCostTransactions(projectId) {
  return store.get(projectId)?.costTransactions ?? [];
}

function normalizeRef(value) {
  return (value ?? '').toString().trim().toLowerCase();
}

// B8/B9: layered duplicate detection. Returns { level: 'STRONG'|'POSSIBLE'|null, reasons: [...] }
// so the UI can show a human-readable explanation, not just an opaque flag.
export function checkDuplicateTransaction(projectId, candidate) {
  const ops = store.get(projectId);
  if (!ops) return { level: null, reasons: [] };
  const candidateRef = normalizeRef(candidate.referenceNumber) || normalizeRef(candidate.invoiceNumber);

  // Layer 1: strong reference match (invoice/reference number, within project).
  if (candidateRef) {
    const refMatch = ops.costTransactions.find((t) => {
      if (t.status === 'VOID') return false;
      const ref = normalizeRef(t.referenceNumber) || normalizeRef(t.invoiceNumber);
      return ref && ref === candidateRef;
    });
    if (refMatch) {
      return { level: 'STRONG', reasons: [`Matches existing transaction ${refMatch.transactionId} on the same Invoice/Reference Number ("${refMatch.referenceNumber || refMatch.invoiceNumber}").`] };
    }
  }

  // Layer 2: exact business fingerprint (project + date + amount + category + reference).
  const fingerprint = [projectId, candidate.transactionDate, Number(candidate.amount), normalizeRef(candidate.category), candidateRef].join('|');
  const fpMatch = ops.costTransactions.find((t) => {
    if (t.status === 'VOID') return false;
    const tFp = [projectId, t.transactionDate, Number(t.amount), normalizeRef(t.category), normalizeRef(t.referenceNumber) || normalizeRef(t.invoiceNumber)].join('|');
    return tFp === fingerprint;
  });
  if (fpMatch) {
    return { level: 'STRONG', reasons: [`Identical Project, Date, Amount, Category, and Reference as existing transaction ${fpMatch.transactionId}.`] };
  }

  // Layer 3: possible duplicate (same project/amount, nearby date, similar category).
  const possible = ops.costTransactions.find((t) => {
    if (t.status === 'VOID') return false;
    if (Number(t.amount) !== Number(candidate.amount)) return false;
    const dayDiff = Math.abs(new Date(t.transactionDate) - new Date(candidate.transactionDate)) / 86400000;
    return dayDiff <= 3 && normalizeRef(t.category) === normalizeRef(candidate.category);
  });
  if (possible) {
    return { level: 'POSSIBLE', reasons: [`Same amount and category as transaction ${possible.transactionId}, dated within 3 days.`] };
  }

  return { level: null, reasons: [] };
}

// B6/B9: creates a transaction. Strong duplicates are BLOCKED unless an
// explicit, reasoned Super Admin override is supplied -- override is never
// the default path.
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
  const transactionId = `CST-${new Date().getFullYear()}-${String(ops.costTransactions.length + 1).padStart(6, '0')}`;
  const record = {
    transactionId,
    projectId,
    status: 'DRAFT',
    currency: 'IDR',
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
