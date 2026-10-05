// Firestore-backed Cost Control service.
// projects/{projectId}/costTransactions/{transactionId}
// projects/{projectId}/paymentProjections/{projectionId}
// plannedCost is stored as a field group on the project document itself
// (Database Design SPMS-DOC-06, Section 5 -- Cost Configuration).
import { getAllDocs, getOneDoc, createDoc, updateDocById } from './firestoreHelpers';
import { COLLECTIONS, PROJECT_SUBCOLLECTIONS } from './firestorePaths';
import { checkDuplicateTransaction as sharedCheckDuplicate } from '../duplicateDetection';
import { assertValidSelection, getIneligibilityReason, isUnallocated } from '../paymentAllocation';
import { doc, getDoc, updateDoc, runTransaction } from 'firebase/firestore';
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

// Legacy projection documents (created before the stable projectionId field
// existed) only carry the Firestore document id -- expose it as projectionId
// so every consumer can rely on one identity field, in both modes. Stored
// data is never rewritten.
export async function getPaymentProjections(projectId) {
  const docs = await getAllDocs(ppPath(projectId));
  return docs.map((d) => ({ ...d, projectionId: d.projectionId ?? d.id }));
}

// C-01D.1 R2 -- Authoritative Cost Transaction allocation (Firebase mode).
// See the mock store's createPaymentProjection for the business-model
// rationale. The projection document stores metadata only; the batch
// composition and total are derived from `CostTransaction.projectionId`.
//
// Atomicity / concurrency: this is one Firestore TRANSACTION. Every
// selected Cost Transaction is READ inside it, validated, and then the new
// projection and every allocation are written together. If another writer
// allocates one of the selected transactions after we read it, Firestore
// detects the conflict, retries this function, and the re-read now sees the
// transaction allocated -- so the validation fails and nothing is written.
// The `costTransactions` update rule independently requires the prior
// projectionId to be empty (a per-document check), so a client that
// bypasses this function cannot allocate an already-allocated transaction
// either. There is no cap on selection size.
//
// KNOWN BOUNDARY (not verified here -- no Emulator/Firebase available):
// Firestore Rules allow at most 20 document-access calls per
// transaction/batched request, and the rules' role helpers also read the
// user profile. Whether very large selections stay inside that budget has
// not been measured; if a request exceeds it Firestore rejects it
// (fail-closed, nothing is written) rather than accepting it unchecked.
export async function createPaymentProjection(projectId, { costTransactionIds, createdBy }) {
  assertValidSelection(costTransactionIds);
  const projectionId = `${projectId}-pp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    projectId, projectionId, status: 'PENDING', currency: 'IDR',
    createdAt: new Date().toISOString(), createdBy, paidDate: null, paymentReference: null, paidBy: null,
  };
  const txBase = txPath(projectId).split('/');
  try {
    await runTransaction(db, async (transaction) => {
      const refs = costTransactionIds.map((id) => doc(db, ...txBase, id));
      const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
      snaps.forEach((snap, i) => {
        if (!snap.exists()) throw new Error(`Cost Transaction(s) not found on this project: ${costTransactionIds[i]}.`);
        const reason = getIneligibilityReason({ ...snap.data(), transactionId: costTransactionIds[i] });
        if (reason) throw new Error(reason);
      });
      transaction.set(doc(db, ...ppPath(projectId).split('/'), projectionId), record);
      refs.forEach((ref) => transaction.update(ref, { projectionId }));
    });
  } catch (err) {
    if (err?.code === 'permission-denied') {
      throw new Error('The Payment Projection could not be created. A selected Cost Transaction may have just been allocated by another user, or you may not have permission. Nothing was changed -- please reload and try again.');
    }
    throw err;
  }
  return record;
}

// C-01D.1 R2: Finance's only write path for a Payment Projection (see the
// mock store's function for why no PAYMENT_ONLY record is generated).
// Read-check-write inside one transaction, so two Finance users cannot both
// settle the same projection.
export async function markPaymentProjectionPaid(projectId, projectionId, { paidDate, paymentReference, paidBy }) {
  const ref = doc(db, ...ppPath(projectId).split('/'), projectionId);
  const fields = { status: 'PAID', paidDate: paidDate ?? null, paymentReference: paymentReference ?? null, paidBy: paidBy ?? null };
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists()) return null;
    const projection = snap.data();
    if (projection.status !== 'PENDING') {
      throw new Error(`Only a PENDING Payment Projection can be marked PAID (current status: ${projection.status}).`);
    }
    transaction.update(ref, fields);
    return { ...projection, projectionId: projection.projectionId ?? projectionId, ...fields };
  });
}

// Transaction documents only carry the Firestore document id (the stored data
// has no transactionId field); expose it as transactionId so every consumer
// -- the UI, the allocation rules -- sees the same identity field in both
// modes. Stored data is never rewritten.
export async function getCostTransactions(projectId) {
  const docs = await getAllDocs(txPath(projectId));
  return docs.map((d) => ({ ...d, transactionId: d.id }));
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
  // C-01D.1 R2: same validation as the mock store -- a PAYMENT_ONLY
  // transaction settles an existing Cost Transaction (relatedTransactionId,
  // the original rule), and a new Cost Transaction can never be created
  // already allocated to a Payment Projection (Section 9).
  if (transaction.transactionType === 'PAYMENT_ONLY') {
    if (!transaction.relatedTransactionId) {
      throw new Error('A PAYMENT_ONLY transaction must reference the existing Cost Transaction it settles (relatedTransactionId).');
    }
    if (!existing.some((t) => t.id === transaction.relatedTransactionId)) {
      throw new Error(`Related transaction "${transaction.relatedTransactionId}" was not found on this project.`);
    }
  }
  if (!isUnallocated(transaction)) {
    throw new Error('A new Cost Transaction cannot be created already allocated to a Payment Projection (projectionId must be empty).');
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
  // C-01D.1 R2, Section 13: an allocated Cost Transaction is frozen (no
  // cancellation/reversal workflow yet), so it cannot be voided.
  const current = await getOneDoc(txPath(projectId), transactionId);
  if (current && !isUnallocated(current)) {
    throw new Error('This Cost Transaction is allocated to a Payment Projection and can no longer be voided.');
  }
  return updateDocById(txPath(projectId), transactionId, { status: 'VOID', voidedBy, voidedAt: new Date().toISOString(), voidReason });
}
