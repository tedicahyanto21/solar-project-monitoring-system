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
  markPaymentProjectionPaid as storeMarkPaymentProjectionPaid,
  getCostTransactions as storeGetCostTransactions,
  checkDuplicateTransaction as storeCheckDuplicate,
  createCostTransaction as storeCreateCostTransaction,
  postCostTransaction as storePostCostTransaction,
  voidCostTransaction as storeVoidCostTransaction,
} from '../../data/mockOperationalData';
import { isLocalMode } from '../firebase/config';
import * as fb from '../firebase/costService';
import { getProjects, getProjectById } from './projectRepository';
import { getAllocatedTransactions, calculateProjectionTotal, isPaymentBatchProjection } from '../paymentAllocation';

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

// C-01D.1 R2: derived-state helpers live in ONE pure module shared with the
// mock store, the Firebase service and the UI; re-exported here so callers
// keep going through the repository.
export { isEligibleForPayment, getAllocatedTransactions, calculateProjectionTotal, isPaymentBatchProjection } from '../paymentAllocation';

export async function getPaymentProjections(projectId) {
  return isLocalMode ? storeGetPaymentProjections(projectId) : fb.getPaymentProjections(projectId);
}

// B5: Payment Projection is never counted as Actual Cost -- it has its own
// store/collection and is never read by calculateActualCost above.
//
// C-01D.1 R2: SCM-owned. `projection` is {costTransactionIds, createdBy} --
// the SELECTION of existing, eligible Cost Transactions. Nothing about the
// batch composition or amount is stored on the projection: the authoritative
// relationship is CostTransaction.projectionId, set atomically by this call,
// and the total is derived (calculateProjectionTotal below).
export async function createPaymentProjection(projectId, projection) {
  return isLocalMode ? storeCreatePaymentProjection(projectId, projection) : fb.createPaymentProjection(projectId, projection);
}

// C-01D.1 R2: Finance-owned. The only write path from PENDING to PAID;
// touches settlement fields only, never composition or amount.
export async function markPaymentProjectionPaid(projectId, projectionId, settlement) {
  return isLocalMode ? storeMarkPaymentProjectionPaid(projectId, projectionId, settlement) : fb.markPaymentProjectionPaid(projectId, projectionId, settlement);
}

// C-01D.2 -- Payment Projection PDF: the READ-ONLY dataset that
// services/reportPdf.js lays out (the PDF layer never calculates anything).
//
// Canonical sources, all read through this repository (never Firestore
// directly from the UI) and re-read on every call so the document reflects
// what is persisted NOW, not what a screen loaded earlier:
//   * the Payment Projection  -> getPaymentProjections(projectId)
//   * its Cost Transactions   -> getCostTransactions(projectId), filtered by
//     CostTransaction.projectionId (the authoritative relationship, via the
//     shared getAllocatedTransactions -- no stored id list is consulted)
//   * the project header      -> getProjectById(projectId)
// The total is calculateProjectionTotal -- the SAME function the Payment
// Projection tab uses -- so the PDF can never show a different number than
// the screen. Nothing is written anywhere.
//
// Failures are surfaced, never turned into a false zero: a failed read throws
// (with the original error as `cause`); an inconsistency in the data throws
// instead of producing a financial document with a questionable total.
export async function buildPaymentProjectionDataset(projectId, projectionId, { now = new Date() } = {}) {
  let project; let projections; let transactions;
  try {
    [project, projections, transactions] = await Promise.all([
      getProjectById(projectId), getPaymentProjections(projectId), getCostTransactions(projectId),
    ]);
  } catch (err) {
    throw new Error(`The Payment Projection PDF could not be generated because required data could not be loaded. ${err.message}`, { cause: err });
  }
  if (!project) throw new Error(`Project "${projectId}" was not found.`);
  const projection = projections.find((p) => p.projectionId === projectionId);
  if (!projection) throw new Error(`Payment Projection "${projectionId}" was not found on this project.`);
  if (!isPaymentBatchProjection(projection)) {
    throw new Error(`"${projectionId}" is a legacy plan record (status: ${projection.status ?? 'unknown'}), not a payment batch, so it cannot be exported.`);
  }
  // C-01D.2 R3: the projection carries its own project reference (`projectId`,
  // which the Firestore rules require to equal the project in its path). If it
  // names a DIFFERENT project than the one it was read from, the link is
  // invalid: refuse, rather than print a report under the wrong project. A
  // projection with no `projectId` field is still unambiguous (it lives under
  // projects/{projectId}/paymentProjections), so it is accepted.
  const linkedProjectId = String(projection.projectId ?? '').trim();
  if (linkedProjectId && linkedProjectId !== projectId) {
    throw new Error(`Payment Projection "${projectionId}" is linked to project "${linkedProjectId}", not "${projectId}"; the PDF was not generated.`);
  }

  const allocated = getAllocatedTransactions(transactions, projectionId);
  const ids = allocated.map((t) => t.transactionId);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Data inconsistency: Payment Projection "${projectionId}" has the same Cost Transaction allocated more than once; the PDF was not generated.`);
  }
  // R2 invariant: only POSTED transactions can be allocated and an allocated
  // transaction is frozen. A different status means the data is inconsistent.
  const notPosted = allocated.filter((t) => t.status !== 'POSTED');
  if (notPosted.length > 0) {
    throw new Error(`Data inconsistency: allocated Cost Transaction(s) ${notPosted.map((t) => t.transactionId).join(', ')} are not POSTED; the PDF was not generated.`);
  }
  const badAmount = allocated.filter((t) => !Number.isFinite(Number(t.amount || 0)));
  if (badAmount.length > 0) {
    throw new Error(`Data inconsistency: Cost Transaction(s) ${badAmount.map((t) => t.transactionId).join(', ')} have a non-numeric amount; the PDF was not generated.`);
  }
  // One document cannot honestly sum amounts in different currencies.
  const currencies = [...new Set(allocated.map((t) => t.currency || projection.currency || 'IDR'))];
  if (currencies.length > 1) {
    throw new Error(`Payment Projection "${projectionId}" mixes currencies (${currencies.join(', ')}); a single total cannot be shown, so the PDF was not generated.`);
  }
  const currency = currencies[0] ?? projection.currency ?? 'IDR';

  const total = calculateProjectionTotal(transactions, projectionId);
  const rows = [...allocated]
    .sort((a, b) => String(a.transactionDate ?? '').localeCompare(String(b.transactionDate ?? '')) || String(a.transactionId).localeCompare(String(b.transactionId)))
    .map((t) => ({
      transactionId: t.transactionId,
      transactionDate: t.transactionDate ?? null,
      category: t.category ?? null,
      description: t.description ?? null,
      referenceNumber: t.referenceNumber || null,
      invoiceNumber: t.invoiceNumber || null,
      amount: Number(t.amount || 0),
      currency,
    }));
  // The displayed rows must add up to the displayed total, always.
  if (Math.abs(rows.reduce((sum, r) => sum + r.amount, 0) - total) > 0.005) {
    throw new Error(`Data inconsistency: the listed Cost Transactions do not add up to the derived total for "${projectionId}"; the PDF was not generated.`);
  }

  return {
    generatedOn: now.toISOString().slice(0, 10),
    project: {
      // C-01D.2 R3: `id` is the lookup key -- the Firestore document id, which is
      // also where the projection lives. It is NOT read back from the project
      // object: getOneDoc spreads stored data AFTER the document id, so a stored
      // `id` field (empty, or a stale copy) silently replaces it. It is internal
      // and is not shown in the report.
      id: projectId,
      // Project No. = the Project Master `projectCode` (SPMS-REQ-002, "a unique
      // project code"; labelled "Project Code" in the UI). Trimmed; blank means
      // missing. It is never substituted with the project id or the projection id.
      code: String(project.projectCode ?? '').trim() || null,
      name: project.projectName ?? null,
      manager: project.projectManager ?? null,
    },
    projection: {
      projectionId: projection.projectionId,
      status: projection.status,
      createdAt: projection.createdAt ?? null,
      createdBy: projection.createdBy ?? null,
      paidDate: projection.paidDate ?? null,
      paymentReference: projection.paymentReference ?? null,
      paidBy: projection.paidBy ?? null,
    },
    transactions: rows,
    summary: { count: rows.length, total, currency },
    // Legacy PAYMENT_ONLY settlement records may carry this projectionId as a
    // reference; they are settlements, not allocated costs (see
    // paymentAllocation.getAllocatedTransactions) and never count toward the
    // total. Counted here so the PDF can say so instead of omitting silently.
    excludedSettlementRecords: transactions.filter((t) => t.projectionId === projectionId && t.transactionType === 'PAYMENT_ONLY').length,
  };
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
