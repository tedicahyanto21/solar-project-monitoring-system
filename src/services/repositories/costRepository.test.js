import { describe, it, expect } from 'vitest';
import { calculateActualCost, calculateBudgetStatus } from './costRepository';
import { isIssueRelevantToPeriod } from './reportRepository';

describe('calculateActualCost (ledger-based: only POSTED counts)', () => {
  it('sums only POSTED transactions', () => {
    const txns = [
      { status: 'POSTED', amount: 1000 },
      { status: 'DRAFT', amount: 5000 },
      { status: 'VOID', amount: 9000 },
      { status: 'POSTED', amount: 500 },
    ];
    expect(calculateActualCost(txns)).toBe(1500);
  });

  it('DRAFT transactions never affect Actual Cost', () => {
    expect(calculateActualCost([{ status: 'DRAFT', amount: 999999 }])).toBe(0);
  });

  it('VOID transactions never affect Actual Cost, even after having been POSTED', () => {
    expect(calculateActualCost([{ status: 'VOID', amount: 999999 }])).toBe(0);
  });

  it('returns 0 for an empty ledger', () => {
    expect(calculateActualCost([])).toBe(0);
  });
});

describe('calculateActualCost -- HC/Finance double-counting prevention (CRITICAL, mandatory)', () => {
  it('counts a POSTED transactionType=COST transaction (the normal case)', () => {
    expect(calculateActualCost([{ status: 'POSTED', amount: 1000, transactionType: 'COST' }])).toBe(1000);
  });

  it('does NOT count a POSTED transactionType=PAYMENT_ONLY transaction, even though it is POSTED', () => {
    expect(calculateActualCost([{ status: 'POSTED', amount: 1000, transactionType: 'PAYMENT_ONLY' }])).toBe(0);
  });

  it('the classic double-counting scenario: HC records an accommodation COST, Finance later records the PAYMENT settling it -- Actual Cost reflects the expense once, not twice', () => {
    const txns = [
      { status: 'POSTED', amount: 5_000_000, transactionType: 'COST', sourceRole: 'HC', description: 'Site accommodation invoice' },
      { status: 'POSTED', amount: 5_000_000, transactionType: 'PAYMENT_ONLY', sourceRole: 'FINANCE', relatedTransactionId: 'CST-2026-000001', description: 'Payment of accommodation invoice' },
    ];
    expect(calculateActualCost(txns)).toBe(5_000_000); // not 10,000,000
  });

  it('a legacy transaction with no transactionType field still counts (backward compatible with pre-existing ledger data)', () => {
    expect(calculateActualCost([{ status: 'POSTED', amount: 750 }])).toBe(750);
  });

  it('a Finance transactionType=COST entry (direct owner payment with no prior SCM/HC record) counts normally', () => {
    expect(calculateActualCost([{ status: 'POSTED', amount: 2000, transactionType: 'COST', sourceRole: 'FINANCE' }])).toBe(2000);
  });
});

describe('calculateBudgetStatus (ON_BUDGET / OVER_BUDGET)', () => {
  it('is ON_BUDGET when Actual Cost equals Planned Cost exactly', () => {
    expect(calculateBudgetStatus(1000, 1000).status).toBe('ON_BUDGET');
  });

  it('is ON_BUDGET when Actual Cost is under Planned Cost', () => {
    const r = calculateBudgetStatus(800, 1000);
    expect(r.status).toBe('ON_BUDGET');
    expect(r.variance).toBe(-200);
  });

  it('is OVER_BUDGET when Actual Cost exceeds Planned Cost', () => {
    const r = calculateBudgetStatus(1200, 1000);
    expect(r.status).toBe('OVER_BUDGET');
    expect(r.variance).toBe(200);
  });
});

describe('isIssueRelevantToPeriod (Weekly/Monthly Report centralized period-overlap rule)', () => {
  it('CASE 1: opened during the period, still open -> included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-09-12', closedAt: null }, '2026-09-10', '2026-09-14')).toBe(true);
  });

  it('CASE 2: opened before the period, remains open -> included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-08-01', closedAt: null }, '2026-09-10', '2026-09-14')).toBe(true);
  });

  it('CASE 3: closed during the period -> included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-09-01', closedAt: '2026-09-16' }, '2026-09-15', '2026-09-21')).toBe(true);
  });

  it('CASE 4: closed before the period -> NOT included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-09-01', closedAt: '2026-09-15' }, '2026-09-22', '2026-09-28')).toBe(false);
  });

  it('spec example: open 10 Sep, period 10-14 Sep -> included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-09-10', closedAt: null }, '2026-09-10', '2026-09-14')).toBe(true);
  });

  it('spec example: closed 15 Sep, period 15-21 Sep -> included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-09-01', closedAt: '2026-09-15' }, '2026-09-15', '2026-09-21')).toBe(true);
  });

  it('spec example: closed 15 Sep, period 22-28 Sep -> NOT included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-09-01', closedAt: '2026-09-15' }, '2026-09-22', '2026-09-28')).toBe(false);
  });

  it('an issue opened and closed entirely after the period is not included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-10-01', closedAt: '2026-10-05' }, '2026-09-01', '2026-09-30')).toBe(false);
  });

  it('an issue spanning the entire period is included', () => {
    expect(isIssueRelevantToPeriod({ openedAt: '2026-01-01', closedAt: '2026-12-31' }, '2026-06-01', '2026-06-30')).toBe(true);
  });
});
