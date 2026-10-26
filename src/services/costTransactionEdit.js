// Final UAT Patch B -- pure rules shared by BOTH backends (the mock store and
// the Firestore service) and the UI, in the same way duplicateDetection.js and
// paymentAllocation.js are shared. Nothing here reads or writes data, so there
// is exactly one definition of: what a valid Amount is, which fields a Draft
// edit may change, and who may edit what.
//
// Application-level validation only. It is NOT a substitute for server-side
// authorization: Firestore Rules are unchanged by this patch (see README).
import { ROLES } from '../constants/roles';
import { isUnallocated } from './paymentAllocation';
import { checkDuplicateTransaction } from './duplicateDetection';

// ---- Amount ---------------------------------------------------------------
// One rule for creation AND editing: a number, finite, greater than zero.
// Input from a form arrives as a string, so numeric TEXT is normalised
// explicitly (and nothing else is guessed at): a plain decimal or scientific
// notation is accepted; empty text, words, thousands separators ("1,000"),
// hex ("0x10") and "Infinity" are not. Booleans, null, undefined, arrays and
// objects are rejected rather than coerced (Number(true) === 1 would otherwise
// slip through). The stored representation is unchanged: a JS number.
const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
export const AMOUNT_ERROR = 'Amount must be a number greater than zero.';

export function parseAmount(value) {
  let n = NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && NUMERIC_TEXT.test(value.trim())) n = Number(value.trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error(AMOUNT_ERROR);
  return n;
}

// ---- Which fields a DRAFT edit may change -----------------------------------
// An explicit allowlist. Everything else -- transaction identity, projectId,
// sourceRole, createdBy/createdAt, status, transactionType,
// relatedTransactionId, projectionId, the system-managed audit/duplicate
// fields -- is locked: a patch that names any of them is REJECTED (never
// silently dropped), and the update payload is always built field by field
// from this list, never by passing a form or transaction object through.
export const DRAFT_EDITABLE_FIELDS = ['category', 'description', 'amount', 'transactionDate', 'referenceNumber', 'invoiceNumber'];

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalText(value, label) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${label} must be text.`);
  return value.trim();
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// Validates the patch and returns the normalised update, built from the
// allowlist only. Throws before anything is read or written, so a rejected
// edit can never be partially applied.
export function buildDraftEdit(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    throw new Error('No changes were supplied.');
  }
  const rejected = Object.keys(patch).filter((k) => !DRAFT_EDITABLE_FIELDS.includes(k));
  if (rejected.length) {
    throw new Error(`Cannot edit ${rejected.join(', ')}. Only ${DRAFT_EDITABLE_FIELDS.join(', ')} can be changed on a Draft; if the transaction type or related transaction is wrong, create a new Draft.`);
  }
  const update = {};
  if ('category' in patch) update.category = requiredText(patch.category, 'Category');
  if ('description' in patch) update.description = requiredText(patch.description, 'Description');
  if ('amount' in patch) update.amount = parseAmount(patch.amount);
  if ('transactionDate' in patch) {
    if (!validDate(patch.transactionDate)) throw new Error('Transaction Date must be a valid date (YYYY-MM-DD).');
    update.transactionDate = patch.transactionDate;
  }
  if ('referenceNumber' in patch) update.referenceNumber = optionalText(patch.referenceNumber, 'Reference Number');
  if ('invoiceNumber' in patch) update.invoiceNumber = optionalText(patch.invoiceNumber, 'Invoice Number');
  return update;
}

// ---- Who may edit, and when -------------------------------------------------
// Role-based ownership, the same predicate the Post and Void controls already
// use: the role recorded as the transaction's `sourceRole`, or Super Admin
// (Security Design: Update = "Creator or Super Admin -- DRAFT only"). Only an
// unallocated DRAFT: POSTED and VOID stay under the existing post/void
// lifecycle, and an allocated transaction is frozen.
export function assertDraftEditable(transaction, actorRole) {
  if (!transaction) throw new Error('Cost Transaction was not found.');
  const id = transaction.transactionId ?? transaction.id;
  const isOwner = actorRole === ROLES.SUPER_ADMIN || (!!actorRole && transaction.sourceRole === actorRole);
  if (!isOwner) {
    throw new Error('Only the role that created this Draft (its source role) or a Super Admin can edit it.');
  }
  if (transaction.status !== 'DRAFT') {
    throw new Error(`Only a DRAFT Cost Transaction can be edited (current status: ${transaction.status}).`);
  }
  if (!isUnallocated(transaction)) {
    throw new Error(`Cost Transaction "${id}" is allocated to Payment Projection "${transaction.projectionId}" and cannot be edited.`);
  }
}

// Same duplicate semantics as creation (duplicateDetection.js, unchanged):
// STRONG is blocked unless a valid Super Admin override is supplied, POSSIBLE
// is recorded as a warning. The only difference is the comparison set: `others`
// must NOT contain the transaction being edited, or it would match itself.
//
// LIMITATION: the comparison set is read by the client just before the write.
// Another user posting or creating a matching transaction in the meantime is
// not seen -- this is not a race-free uniqueness guarantee and is not enforced
// server-side.
export function evaluateEditDuplicate({ projectId, candidate, others, override }) {
  const duplicate = checkDuplicateTransaction(projectId, candidate, others);
  if (duplicate.level === 'STRONG') {
    const validOverride = override && override.confirmed && override.reason && override.byRole === ROLES.SUPER_ADMIN;
    if (!validOverride) {
      const err = new Error('Strong duplicate detected -- edit blocked.');
      err.duplicate = duplicate;
      throw err;
    }
  }
  return {
    duplicateCheck: duplicate.level ? duplicate : null,
    override: duplicate.level === 'STRONG' ? { ...override, at: new Date().toISOString() } : null,
  };
}
