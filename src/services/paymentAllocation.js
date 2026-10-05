// C-01D.1 R2 -- Authoritative Cost Transaction allocation (pure functions).
//
// Business model (locked): `CostTransaction.projectionId` is the ONE
// authoritative Cost Transaction -> Payment Projection relationship. A
// Payment Projection is batch metadata + settlement information only; the
// set of Cost Transactions in a batch and the batch total are always
// DERIVED from the Cost Transactions, never stored on the projection.
//
// This module is the single home for those rules so the mock store, the
// Firebase service, the repository and the UI cannot drift apart. It has
// no I/O and no Firebase/mock imports.

// A Cost Transaction is unallocated when `projectionId` is absent (legacy
// records, created before allocation existed) or null/empty. Legacy
// records are therefore never rewritten -- "no field" simply means
// "unallocated".
export function isUnallocated(transaction) {
  return transaction.projectionId === undefined || transaction.projectionId === null || transaction.projectionId === '';
}

// Section 8: eligible only when POSTED, not PAYMENT_ONLY, and unallocated.
export function isEligibleForPayment(transaction) {
  return transaction.status === 'POSTED' && transaction.transactionType !== 'PAYMENT_ONLY' && isUnallocated(transaction);
}

// Human-readable reason a transaction is NOT eligible, or null if it is.
export function getIneligibilityReason(transaction) {
  const id = transaction.transactionId ?? transaction.id;
  if (transaction.transactionType === 'PAYMENT_ONLY') {
    return `Cost Transaction "${id}" is a PAYMENT_ONLY record and cannot be included in a Payment Projection.`;
  }
  if (transaction.status !== 'POSTED') {
    return `Cost Transaction "${id}" must be POSTED before it can be included in a Payment Projection (current status: ${transaction.status}).`;
  }
  if (!isUnallocated(transaction)) {
    return `Cost Transaction "${id}" is already allocated to Payment Projection "${transaction.projectionId}".`;
  }
  return null;
}

// Selection sanity: at least one transaction, none listed twice. There is
// deliberately NO upper bound here -- any batch size is a business-valid
// request (Section 4); only Firestore's own operational limits apply.
export function assertValidSelection(costTransactionIds) {
  if (!Array.isArray(costTransactionIds) || costTransactionIds.length === 0) {
    throw new Error('A Payment Projection must include at least one Cost Transaction.');
  }
  if (new Set(costTransactionIds).size !== costTransactionIds.length) {
    throw new Error('The same Cost Transaction cannot be selected more than once in a single Payment Projection.');
  }
}

// The Cost Transactions allocated to a projection, recovered through the
// authoritative relationship. PAYMENT_ONLY records are excluded: a legacy
// settlement record may carry a projectionId as a *reference*, but it is a
// settlement, not an allocated cost, and must never count toward a total.
export function getAllocatedTransactions(transactions, projectionId) {
  return transactions.filter((t) => t.projectionId === projectionId && t.transactionType !== 'PAYMENT_ONLY');
}

// Section 6: projectionTotal = SUM(amount of allocated Cost Transactions).
// Derived on every read; never persisted, so it cannot become a second
// source of truth. Each transaction contributes its FULL amount.
export function calculateProjectionTotal(transactions, projectionId) {
  return getAllocatedTransactions(transactions, projectionId).reduce((sum, t) => sum + Number(t.amount || 0), 0);
}
