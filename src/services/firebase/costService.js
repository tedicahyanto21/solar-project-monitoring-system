// Firestore-backed Cost Control service.
// projects/{projectId}/costTransactions/{transactionId}
// projects/{projectId}/paymentProjections/{projectionId}
// plannedCost is stored as a field group on the project document itself
// (Database Design SPMS-DOC-06, Section 5 -- Cost Configuration).
import { getAllDocs, getOneDoc, createDoc, updateDocById } from './firestoreHelpers';
import { COLLECTIONS, PROJECT_SUBCOLLECTIONS } from './firestorePaths';
import { checkDuplicateTransaction as sharedCheckDuplicate } from '../duplicateDetection';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
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

export async function createPaymentProjection(projectId, projection) {
  return createDoc(ppPath(projectId), { projectId, status: 'PLANNED', createdAt: new Date().toISOString(), currency: 'IDR', ...projection });
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
  if (transaction.transactionType === 'PAYMENT_ONLY') {
    if (!transaction.relatedTransactionId) {
      throw new Error('A PAYMENT_ONLY transaction must reference the existing Cost Transaction it settles (relatedTransactionId).');
    }
    if (!existing.some((t) => t.id === transaction.relatedTransactionId)) {
      throw new Error(`Related transaction "${transaction.relatedTransactionId}" was not found on this project.`);
    }
  }
  const transactionId = `CST-${new Date().getFullYear()}-${String(existing.length + 1).padStart(6, '0')}`;
  return createDoc(txPath(projectId), {
    projectId, status: 'DRAFT', currency: 'IDR', transactionType: 'COST', relatedTransactionId: null,
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
