// Repository for Project Cost Control (Database Design SPMS-DOC-06,
// Section 13; Progress Engine Design SPMS-DOC-04; Sprint FT-5 Part B).
//
// This is the ONLY place Actual Cost, Budget Variance, and Budget Status
// are calculated -- no UI component computes these independently
// (Sprint FT-5 B7). Actual Cost is always ledger-based: the sum of POSTED
// transactions, never a freely editable number (B1).
import {
  getPlannedCost as storeGetPlannedCost,
  setPlannedCost as storeSetPlannedCost,
  getPaymentProjections as storeGetPaymentProjections,
  createPaymentProjection as storeCreatePaymentProjection,
  getCostTransactions as storeGetCostTransactions,
  checkDuplicateTransaction as storeCheckDuplicate,
  createCostTransaction as storeCreateCostTransaction,
  postCostTransaction as storePostCostTransaction,
  voidCostTransaction as storeVoidCostTransaction,
} from '../../data/mockOperationalData';
import { getProjects } from './projectRepository';

function round0(n) { return Math.round(n); }

// B7: Actual Cost = SUM(Amount of POSTED transactions). DRAFT and VOID are
// excluded either way.
export function calculateActualCost(costTransactions) {
  return costTransactions.filter((t) => t.status === 'POSTED').reduce((sum, t) => sum + Number(t.amount || 0), 0);
}

// B7: Budget Variance and Status, from the same two numbers every screen
// must read from here -- never recomputed inline.
export function calculateBudgetStatus(actualCost, plannedCostAmount) {
  const variance = actualCost - plannedCostAmount;
  return { variance, status: actualCost <= plannedCostAmount ? 'ON_BUDGET' : 'OVER_BUDGET' };
}

export async function getCostTransactions(projectId) {
  return storeGetCostTransactions(projectId);
}

export async function getPlannedCost(projectId) {
  return storeGetPlannedCost(projectId);
}

// B4: changing Planned Cost never overwrites transaction history -- see
// mockOperationalData.setPlannedCost, which only ever replaces the
// plannedCost record itself.
export async function setPlannedCost(projectId, { amount, currency, updatedBy }) {
  return storeSetPlannedCost(projectId, { amount, currency, updatedBy });
}

export async function getPaymentProjections(projectId) {
  return storeGetPaymentProjections(projectId);
}

// B5: Payment Projection is never counted as Actual Cost -- it has its own
// store and is never read by calculateActualCost above.
export async function createPaymentProjection(projectId, projection) {
  return storeCreatePaymentProjection(projectId, projection);
}

// B8: layered duplicate check, exposed so the UI can show a live warning
// before the user even attempts to submit.
export async function checkDuplicateTransaction(projectId, candidate) {
  return storeCheckDuplicate(projectId, candidate);
}

// B6/B9: creates a DRAFT transaction. Throws (with `.duplicate` detail) if
// a strong duplicate is found and no valid Super Admin override is given.
export async function createCostTransaction(projectId, transaction, override) {
  return storeCreateCostTransaction(projectId, transaction, override);
}

// B6: DRAFT -> POSTED. Only a POSTED transaction affects Actual Cost.
export async function postCostTransaction(projectId, transactionId, postedBy) {
  return storePostCostTransaction(projectId, transactionId, postedBy);
}

// B6: normal workflow is VOID, never physical deletion. A void reason is
// required and the transaction remains visible for audit afterward.
export async function voidCostTransaction(projectId, transactionId, { voidedBy, voidReason }) {
  return storeVoidCostTransaction(projectId, transactionId, { voidedBy, voidReason });
}

// Per-project cost summary -- the single call both the Cost Control list
// page and detail page use (B3, B7).
export async function getProjectCostSummary(projectId) {
  const [transactions, planned] = await Promise.all([getCostTransactions(projectId), getPlannedCost(projectId)]);
  const actualCost = round0(calculateActualCost(transactions));
  const { variance, status } = calculateBudgetStatus(actualCost, planned?.amount ?? 0);
  return { plannedCost: planned?.amount ?? 0, currency: planned?.currency ?? 'IDR', actualCost, variance: round0(variance), status };
}

// Portfolio-wide Cost Control list (B3) -- reads the same per-project
// summary the detail page uses, never a separate calculation.
export async function getPortfolioCostSummary() {
  const projects = await getProjects();
  const rows = await Promise.all(
    projects.map(async (p) => ({ project: p, summary: await getProjectCostSummary(p.id) }))
  );
  return rows;
}
