// Firestore-backed Cost Control service.
// projects/{projectId}/costTransactions/{transactionId}
// projects/{projectId}/paymentProjections/{projectionId}
// plannedCost is stored as a field group on the project document itself
// (Database Design SPMS-DOC-06, Section 5 -- Cost Configuration).
import { getAllDocs, getOneDoc, createDoc, updateDocById } from './firestoreHelpers';
import { COLLECTIONS, PROJECT_SUBCOLLECTIONS } from './firestorePaths';
import { checkDuplicateTransaction as sharedCheckDuplicate } from '../duplicateDetection';
import { doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from './config';

function txPath(projectId) { return `${COLLECTIONS.PROJECTS}/${projectId}/${PROJECT_SUBCOLLECTIONS.COST_TRANSACTIONS}`; }
function ppPath(projectId) { return `${COLLECTIONS.PROJECTS}/${projectId}/${PROJECT_SUBCOLLECTIONS.PAYMENT_PROJECTIONS}`; }

export async function getPlannedCost(projectId) {
  const snap = await getDoc(doc(db, COLLECTIONS.PROJECTS, projectId));
  return snap.exists() ? (snap.data().plannedCost ?? null) : null;
}

export async function setPlannedCost(projectId, { amount, currency, updatedBy }) {
  const current = await getPlannedCost(projectId);
  const plannedCost = { amount, currency: currency || current?.currency || 'IDR', updatedAt: new Date().toISOString(), updatedBy };
  await updateDoc(doc(db, COLLECTIONS.PROJECTS, projectId), { plannedCost });
  return plannedCost;
}

export async function getPaymentProjections(projectId) {
  return getAllDocs(ppPath(projectId));
}

// C-01D.1 Payment Projection Batch (replaces the prior one-payment-per-
// projection concept). See the mock store's identical function for the
// full business-rule rationale (derived total, full-payment-only,
// allocation invariant). The concurrency-safety story differs here:
//
// Section 11 (atomicity/concurrency): this performs ONE writeBatch
// committing the new projection document AND the `projectionId` update on
// every selected Cost Transaction together, atomically. The client-side
// pre-validation below (existence, POSTED, not already allocated) gives a
// clear error message in the common case, but the REAL race protection is
// the Firestore Rule on costTransactions' update -- requiring
// resource.data.projectionId == null -- which Firestore evaluates against
// each document's actual server-side state AT COMMIT TIME, per document,
// not against this function's stale client-side read. If a concurrent
// writer already claimed one of the selected transactions between this
// read and this commit, that document's update fails its rule, and
// because batch writes are all-or-nothing, the ENTIRE batch (including the
// new projection) is rejected -- no stale allocation is ever possible,
// without needing a runTransaction() re-read or any cross-document query
// in the rule itself (see firestore.rules for why this specific invariant
// -- "is MY OWN prior value null" -- needs no getAfter() or exists() scan).
export async function createPaymentProjection(projectId, { costTransactionIds, createdBy }) {
  if (!Array.isArray(costTransactionIds) || costTransactionIds.length === 0) {
    throw new Error('A Payment Projection must include at least one Cost Transaction.');
  }
  const uniqueIds = new Set(costTransactionIds);
  if (uniqueIds.size !== costTransactionIds.length) {
    throw new Error('The same Cost Transaction cannot be selected more than once in a single Payment Projection.');
  }
  const existing = await getCostTransactions(projectId);
  const selected = costTransactionIds.map((id) => existing.find((t) => t.id === id));
  const missingIds = costTransactionIds.filter((id, i) => !selected[i]);
  if (missingIds.length > 0) {
    throw new Error(`Cost Transaction(s) not found on this project: ${missingIds.join(', ')}.`);
  }
  for (const t of selected) {
    if (t.status !== 'POSTED') {
      throw new Error(`Cost Transaction "${t.id}" must be POSTED before it can be included in a Payment Projection (current status: ${t.status}).`);
    }
    if (t.transactionType === 'PAYMENT_ONLY') {
      throw new Error(`Cost Transaction "${t.id}" is itself a settlement record (PAYMENT_ONLY) and cannot be included in a Payment Projection.`);
    }
    if (t.projectionId) {
      throw new Error(`Cost Transaction "${t.id}" is already allocated to Payment Projection "${t.projectionId}".`);
    }
  }
  const totalAmount = selected.reduce((sum, t) => sum + Number(t.amount), 0);
  const projectionId = `${projectId}-pp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    projectId, projectionId, status: 'PENDING', costTransactionIds: [...costTransactionIds], totalAmount, currency: 'IDR',
    createdAt: new Date().toISOString(), createdBy, paidDate: null, paymentReference: null, paidBy: null,
  };
  const batch = writeBatch(db);
  batch.set(doc(db, ...ppPath(projectId).split('/'), projectionId), record);
  for (const id of costTransactionIds) {
    batch.update(doc(db, ...txPath(projectId).split('/'), id), { projectionId });
  }
  await batch.commit();
  return record;
}

// C-01D.1: Finance's ONLY write path for a Payment Projection, mirroring
// the mock store's function exactly (see its comment for the full
// rationale, including why Finance never calls createCostTransaction
// directly). The status transition and the settlement-record creation are
// batched together atomically: either both happen, or neither does.
export async function markPaymentProjectionPaid(projectId, projectionId, { paidDate, paymentReference, paidBy }) {
  const projection = await getOneDoc(ppPath(projectId), projectionId);
  if (!projection) return null;
  if (projection.status !== 'PENDING') {
    throw new Error(`Only a PENDING Payment Projection can be marked PAID (current status: ${projection.status}).`);
  }
  const updatedFields = { status: 'PAID', paidDate: paidDate ?? null, paymentReference: paymentReference ?? null, paidBy: paidBy ?? null };
  const existing = await getCostTransactions(projectId);
  const settlementTransactionId = `CST-${new Date().getFullYear()}-${String(existing.length + 1).padStart(6, '0')}`;
  const settlementRecord = {
    projectId, status: 'POSTED', currency: 'IDR', transactionType: 'PAYMENT_ONLY', relatedTransactionId: null,
    projectionId, category: 'Milestone Payment', amount: projection.totalAmount,
    transactionDate: paidDate ?? new Date().toISOString().slice(0, 10), referenceNumber: paymentReference ?? '',
    description: `Settlement for Payment Projection ${projectionId} (${projection.costTransactionIds.length} Cost Transaction${projection.costTransactionIds.length === 1 ? '' : 's'}).`,
    sourceRole: 'FINANCE', createdBy: paidBy, createdAt: new Date().toISOString(), postedBy: paidBy, postedAt: new Date().toISOString(),
    duplicateCheck: null, override: null,
  };
  const batch = writeBatch(db);
  batch.update(doc(db, ...ppPath(projectId).split('/'), projectionId), updatedFields);
  batch.set(doc(db, ...txPath(projectId).split('/'), settlementTransactionId), settlementRecord);
  await batch.commit();
  return { ...projection, ...updatedFields };
}

export async function getCostTransactions(projectId) {
  return getAllDocs(txPath(projectId));
}

// Same shared logic as the mock backend (services/duplicateDetection.js) --
// only the source of "existing transactions" differs.
export async function checkDuplicateTransaction(projectId, candidate) {
  const existing = await getCostTransactions(projectId);
  return sharedCheckDuplicate(projectId, candidate, existing);
}

// FT-5→FT-8 consolidation, Section 14 (CRITICAL): a PAYMENT_ONLY
// transaction must reference an existing transaction it settles, and that
// reference must actually exist on this project -- same rule as the mock
// backend, enforced independently here so the two backends behave
// identically regardless of which is active.
export async function createCostTransaction(projectId, transaction, override) {
  const existing = await getCostTransactions(projectId);
  const duplicate = sharedCheckDuplicate(projectId, transaction, existing);
  if (duplicate.level === 'STRONG') {
    const validOverride = override && override.confirmed && override.reason && override.byRole === 'SUPER_ADMIN';
    if (!validOverride) {
      const err = new Error('Strong duplicate detected -- posting blocked.');
      err.duplicate = duplicate;
      throw err;
    }
  }
  // C-01D.1 Batch: same widened validation as the mock store -- a
  // PAYMENT_ONLY transaction references EITHER relatedTransactionId
  // (unchanged HC/SCM use case) OR projectionId (the system-generated
  // settlement record). Finance never reaches this function directly
  // through the UI for the new flow (see PaymentProjectionTab.jsx) --
  // markPaymentProjectionPaid above constructs this record itself.
  if (transaction.transactionType === 'PAYMENT_ONLY') {
    if (!transaction.relatedTransactionId && !transaction.projectionId) {
      throw new Error('A PAYMENT_ONLY transaction must reference either the existing Cost Transaction it settles (relatedTransactionId) or the existing Payment Projection it settles (projectionId).');
    }
    if (transaction.relatedTransactionId && !existing.some((t) => t.id === transaction.relatedTransactionId)) {
      throw new Error(`Related transaction "${transaction.relatedTransactionId}" was not found on this project.`);
    }
    if (transaction.projectionId) {
      const projections = await getPaymentProjections(projectId);
      if (!projections.some((p) => p.projectionId === transaction.projectionId)) {
        throw new Error(`Payment Projection "${transaction.projectionId}" was not found on this project.`);
      }
    }
  }
  const transactionId = `CST-${new Date().getFullYear()}-${String(existing.length + 1).padStart(6, '0')}`;
  return createDoc(txPath(projectId), {
    projectId, status: 'DRAFT', currency: 'IDR', transactionType: 'COST', relatedTransactionId: null, projectionId: null,
    createdAt: new Date().toISOString(), ...transaction,
    duplicateCheck: duplicate.level ? duplicate : null,
    override: duplicate.level === 'STRONG' ? { ...override, at: new Date().toISOString() } : null,
  }, transactionId);
}

export async function postCostTransaction(projectId, transactionId, postedBy) {
  const tx = await getOneDoc(txPath(projectId), transactionId);
  if (!tx) return null;
  if (tx.status !== 'DRAFT') throw new Error(`Only a DRAFT transaction can be posted (current status: ${tx.status}).`);
  return updateDocById(txPath(projectId), transactionId, { status: 'POSTED', postedBy, postedAt: new Date().toISOString() });
}

// Normal workflow is VOID, never physical delete -- a voided transaction
// remains fully visible for audit.
export async function voidCostTransaction(projectId, transactionId, { voidedBy, voidReason }) {
  if (!voidReason || !voidReason.trim()) throw new Error('A void reason is required.');
  return updateDocById(txPath(projectId), transactionId, { status: 'VOID', voidedBy, voidedAt: new Date().toISOString(), voidReason });
}
