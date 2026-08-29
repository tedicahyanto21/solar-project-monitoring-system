// Centralized Firestore collection architecture (Sprint FT-8, Part E).
//
// This is the ONLY place collection names are spelled out. Every Firebase
// repository file below imports from here rather than hardcoding a string,
// so a rename never has to be hunted down across multiple files.
//
// Top-level collections:
export const COLLECTIONS = {
  USERS: 'users',
  PROJECTS: 'projects',
};

// Subcollections live under projects/{projectId}/... -- these helpers
// return the SUBCOLLECTION NAME only; callers combine it with the parent
// doc path (see firestoreHelpers.js).
export const PROJECT_SUBCOLLECTIONS = {
  ASSIGNMENTS: 'projectAssignments',
  PROGRESS_HISTORY: 'progressHistory',
  ENGINEERING_DOCUMENTS: 'engineeringDocuments',
  HSE_ITEMS: 'hseItems',
  PROCUREMENT_MILESTONES: 'procurementMilestones',
  CONSTRUCTION_ACTIVITIES: 'constructionActivities',
  COMMISSIONING_ITEMS: 'commissioningItems',
  ISSUES: 'issues',
  COST_TRANSACTIONS: 'costTransactions',
  PAYMENT_PROJECTIONS: 'paymentProjections',
};
