// Centralized, backend-agnostic Cost Transaction duplicate detection
// (Progress Engine Design SPMS-DOC-04; Database Design SPMS-DOC-06,
// Section 15; Sprint FT-5 B8/B9).
//
// This is pure logic over an already-fetched array of existing
// transactions -- it does not know or care whether that array came from
// the in-memory mock store or a Firestore query. Both
// src/data/mockOperationalData.js and src/services/firebase/costService.js
// call this SAME function, so the matching rule is defined in exactly one
// place (Sprint FT-5→FT-8 consolidation: "centralize business rules where
// practical").
export function normalizeRef(value) {
  return (value ?? '').toString().trim().toLowerCase();
}

// Returns { level: 'STRONG'|'POSSIBLE'|null, reasons: [...] } so the UI can
// show a human-readable explanation, not just an opaque flag.
export function checkDuplicateTransaction(projectId, candidate, existingTransactions) {
  const candidateRef = normalizeRef(candidate.referenceNumber) || normalizeRef(candidate.invoiceNumber);

  // Layer 1: strong reference match (invoice/reference number, within project).
  if (candidateRef) {
    const refMatch = existingTransactions.find((t) => {
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
  const fpMatch = existingTransactions.find((t) => {
    if (t.status === 'VOID') return false;
    const tFp = [projectId, t.transactionDate, Number(t.amount), normalizeRef(t.category), normalizeRef(t.referenceNumber) || normalizeRef(t.invoiceNumber)].join('|');
    return tFp === fingerprint;
  });
  if (fpMatch) {
    return { level: 'STRONG', reasons: [`Identical Project, Date, Amount, Category, and Reference as existing transaction ${fpMatch.transactionId}.`] };
  }

  // Layer 3: possible duplicate (same project/amount, nearby date, similar category).
  const possible = existingTransactions.find((t) => {
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
