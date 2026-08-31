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
import { isLocalMode } from '../firebase/config';
import * as fb from '../firebase/costService';
import { getProjects } from './projectRepository';

function round0(n) { return Math.round(n); }

// B7: Actual Cost = SUM(Amount of POSTED transactions). DRAFT and VOID are
// excluded either way.
//
// FT-5→FT-8 Consolidation Section 14 (CRITICAL, mandatory): a POSTED
// transaction is only counted if transactionType !== 'PAYMENT_ONLY'.
// PAYMENT_ONLY transactions record a cash settlement of a cost that was
// already counted once (via relatedTransactionId, see
// mockOperationalData.createCostTransaction) -- counting them too would
// double-count the same real-world expense. A transaction with no
// transactionType (legacy data) defaults to counting, matching the
// original ledger-wide behavior before this field existed.
export function calculateActualCost(costTransactions) {
  return costTransactions
    .filter((t) => t.status === 'POSTED' && t.transactionType !== 'PAYMENT_ONLY')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);
}

// B7: Budget Variance and Status, from the same two numbers every screen
// must read from here -- never recomputed inline.
export function calculateBudgetStatus(actualCost, plannedCostAmount) {
  const variance = actualCost - plannedCostAmount;
  return { variance, status: actualCost <= plannedCostAmount ? 'ON_BUDGET' : 'OVER_BUDGET' };
}

export async function getCostTransactions(projectId) {
  return isLocalMode ? storeGetCostTransactions(projectId) : fb.getCostTransactions(projectId);
}

export async function getPlannedCost(projectId) {
  return isLocalMode ? storeGetPlannedCost(projectId) : fb.getPlannedCost(projectId);
}

// B4: changing Planned Cost never overwrites transaction history -- true
// for both backends.
export async function setPlannedCost(projectId, { amount, currency, updatedBy }) {
  return isLocalMode ? storeSetPlannedCost(projectId, { amount, currency, updatedBy }) : fb.setPlannedCost(projectId, { amount, currency, updatedBy });
}

export async function getPaymentProjections(projectId) {
  return isLocalMode ? storeGetPaymentProjections(projectId) : fb.getPaymentProjections(projectId);
}

// B5: Payment Projection is never counted as Actual Cost -- it has its own
// store/collection and is never read by calculateActualCost above.
export async function createPaymentProjection(projectId, projection) {
  return isLocalMode ? storeCreatePaymentProjection(projectId, projection) : fb.createPaymentProjection(projectId, projection);
}

// B8: layered duplicate check (services/duplicateDetection.js, shared by
// both backends), exposed so the UI can show a live warning before the
// user even attempts to submit.
export async function checkDuplicateTransaction(projectId, candidate) {
  return isLocalMode ? storeCheckDuplicate(projectId, candidate) : fb.checkDuplicateTransaction(projectId, candidate);
}

// B6/B9: creates a DRAFT transaction. Throws (with `.duplicate` detail) if
// a strong duplicate is found and no valid Super Admin override is given.
// FT-5→FT-8 consolidation Section 14: also throws if a PAYMENT_ONLY
// transaction does not reference a real existing transaction -- both
// backends enforce this identically.
export async function createCostTransaction(projectId, transaction, override) {
  return isLocalMode ? storeCreateCostTransaction(projectId, transaction, override) : fb.createCostTransaction(projectId, transaction, override);
}

// B6: DRAFT -> POSTED. Only a POSTED transaction (that is not
// transactionType=PAYMENT_ONLY) affects Actual Cost.
export async function postCostTransaction(projectId, transactionId, postedBy) {
  return isLocalMode ? storePostCostTransaction(projectId, transactionId, postedBy) : fb.postCostTransaction(projectId, transactionId, postedBy);
}

// B6: normal workflow is VOID, never physical deletion. A void reason is
// required and the transaction remains visible for audit afterward.
export async function voidCostTransaction(projectId, transactionId, { voidedBy, voidReason }) {
  return isLocalMode ? storeVoidCostTransaction(projectId, transactionId, { voidedBy, voidReason }) : fb.voidCostTransaction(projectId, transactionId, { voidedBy, voidReason });
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
