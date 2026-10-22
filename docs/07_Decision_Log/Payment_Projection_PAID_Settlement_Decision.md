# Decision: marking a Payment Projection PAID does not create a PAYMENT_ONLY settlement transaction

| | |
|---|---|
| **Status** | Approved by the technical lead — **Option A**. Scope: documentation and test alignment only. |
| **Recorded** | 2026-10-19, against `main` at `d81ddde4af816550cfcddf461fc0a5e7d58b3a5d` (*SPMS : C01D2_PaymentProjectionPDF*, parent `3633d97`). The date of the approval itself is not recorded in the repository and is not asserted here. |
| **Applies to** | Payment Projection (`projects/{projectId}/paymentProjections`) and Cost Transactions (`projects/{projectId}/costTransactions`), in both Local Mode and Firebase mode. |
| **Not decided here** | See "What this decision does not decide". The overall C-01D.1 / C-01D.2 work is **not** declared frozen or production-ready by this entry. |

## Decision

Marking a Payment Projection `PENDING -> PAID` **must not** automatically create a `PAYMENT_ONLY` settlement Cost Transaction.

The Payment Projection remains the payment-batch record. That a batch was paid is recorded on the projection itself, through the existing fields:

- `status` (`PENDING -> PAID`)
- `paidDate`
- `paymentReference`
- `paidBy`

The canonical financial model is unchanged:

- Cost Transactions are the source of truth for amounts.
- `CostTransaction.projectionId` is the authoritative allocation relationship.
- A projection's total (and its list of transactions) is derived from the Cost Transactions allocated to it. `totalAmount` and `costTransactionIds` are not stored on the projection.
- No settlement transaction, duplicate financial record, additional collection or alternative calculation model is introduced.

## Context

- The first C-01D.1 batch model (commit `3919aa0`, 2026-10-02) stored `totalAmount` and `costTransactionIds` on the projection and generated one `PAYMENT_ONLY` settlement record when a projection was marked PAID. `src/services/repositories/paymentProjectionBatch.test.js` was written for that model and described it as the locked business model.
- C-01D.1 R2 (commit `20beb39`, 2026-10-05) removed the stored fields and the generated settlement record from both implementations (`mockOperationalData.js`, `firebase/costService.js`), and the README recorded this. That commit did not touch `paymentProjectionBatch.test.js`.
- As a result, at `d81ddde` eight of that file's sixteen tests failed against the canonical model (and the repository held two conflicting descriptions of what happens on PAID: the test file's header versus the README). A read-only diagnostic bisected the failures: the version of that test file at `d81ddde` passes 16/16 against the implementation of `3919aa0` and `f86ff3e` and first fails against `20beb39`.
- Four of the failures asserted the stored `totalAmount` / `costTransactionIds`; they are classified obsolete (contradicted by `paymentProjectionAllocation.test.js`, which asserts their absence). Four depended on the generated settlement record or on the validation path that existed only for it; two of those were classified as a specification conflict pending this decision.
- None of the approved design documents under `docs/` (SPMS-DOC-02 through 07, all marked Draft) mentions `PAYMENT_ONLY` or a generated settlement record, so no approved document required the behaviour.

## Rationale

- Preserve the existing canonical batch/allocation model, in which Cost Transactions carry the amounts and `projectionId` carries the relationship.
- Avoid automatically creating duplicate financial records for money that is already represented by the allocated Cost Transactions.

## Consequences

- **Audit trail:** the projection's `status`, `paidDate`, `paymentReference` and `paidBy` are the record that a batch was paid. There is no separate ledger entry for the payment event.
- **Ledger and Actual Cost:** marking PAID changes no Cost Transaction (amounts, status, type, `projectionId`) and adds none. Actual Cost does not change when a projection becomes PAID. The derived projection total is unchanged.
- **Legacy `PAYMENT_ONLY` records** (the `relatedTransactionId` settle-a-cost path, and any legacy record that carries a `projectionId`) are preserved. They remain excluded from Actual Cost and from derived projection totals, and cannot be selected into a projection.
- **Finance** can still only move a projection `PENDING -> PAID` and record the settlement fields; it cannot alter composition or amounts.
- The PDF export (C-01D.2) reads the PAID projection as stored and never writes.

## What this decision does not decide

- Whether a **real payment must be represented as an independently recorded financial transaction** (for example for reconciliation against bank or cash records) is a separate question. This decision neither requires nor forbids it. If it is required later, it needs its own decision and design (including how its amount would be verified against the allocated transactions).
- It does not amend the approved documents. `SPMS_Database_Design_v1.0` §14 and the `paymentProjections` row of `SPMS_Firestore_Security_Design_v1.0` still describe a planned-payment model and different write authority than the implemented batch model; that discrepancy remains open.
- It does not change Firestore Rules, which are unchanged by this entry (the repository ruleset has not been verified at runtime, and the README records that the Firebase project ran a temporary permissive ruleset, expiring 2026-12-30, that must be replaced before production).
- It does not resolve the Cost Transaction duplicate-warning finding, which remains deferred to Final UAT.

## Tests updated for this decision

- `src/services/repositories/paymentProjectionBatch.test.js` — rewritten. The eight tests that still passed are unchanged. The eight obsolete or conflicting ones now assert the approved behaviour; the still-valid invariant behind each one is kept (derived total and CT list, caller-supplied `totalAmount` / `amount` / `allocatedAmount` ignored, `PAYMENT_ONLY` cannot be selected, fabricated references rejected, PAID records the settlement fields on the projection, Actual Cost unchanged). Added: total follows the canonical amounts; PAID creates no `PAYMENT_ONLY` record and leaves the whole ledger byte-identical; PAID ignores composition/amount/status arguments; invalid PAID transitions (unknown projection or project, legacy plan, repeated PAID that leaves the first settlement data intact); an existing `PAYMENT_ONLY` record is still excluded from Actual Cost; a PAID projection's PDF export stays read-only.
- `src/services/firebase/costService.paymentProjection.test.js` — new. Firebase-mode `markPaymentProjectionPaid`, with the Firestore SDK mocked: exactly one write (the projection document, the four fields), no reference to any Cost Transaction, composition arguments ignored, repeated/legacy/unknown cases write nothing.

## Remaining verification limitations

- All tests run in Local Mode or against a mocked Firestore SDK. **Nothing was verified against real Firestore, the Firestore Emulator, or Firestore Rules.** The emulator suites under `tests/rules/` have never been executed.
- No manual UAT is recorded in the repository for Payment Projection batching, PAID, or the PDF export.
