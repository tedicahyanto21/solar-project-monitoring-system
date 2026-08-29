// Repository for Issue Management (Database Design SPMS-DOC-06, Section 12;
// Requirement Specification SPMS-DOC-02, SPMS-REQ-015/016; Sprint FT-6 Part A).
//
// Create/Edit/Close/Reopen authority (Super Admin, Project Manager, Site
// Manager) is enforced by the caller -- see pages/Projects/detail/IssuesTab.jsx.
import { getOperations, addIssue, updateIssue, closeIssue, reopenIssue } from '../../data/mockOperationalData';

export async function getIssues(projectId) {
  return getOperations(projectId)?.issues ?? [];
}

export async function createIssue(projectId, issue) {
  return addIssue(projectId, issue);
}

// FT-6 A3: Edit Issue.
export async function updateIssueRecord(projectId, issueId, patch) {
  return updateIssue(projectId, issueId, patch);
}

// Closing preserves openedAt/createdAt; only status, closedAt, and closedBy
// change (Requirement Specification SPMS-REQ-015 and Sprint FT-4/FT-6:
// "Do not delete issue history when an issue is closed.")
export async function closeIssueRecord(projectId, issueId, closedBy) {
  return closeIssue(projectId, issueId, closedBy);
}

// FT-6 A2/A3: Reopen Issue -- clears closedAt/closedBy only, openedAt and
// createdAt are never touched.
export async function reopenIssueRecord(projectId, issueId) {
  return reopenIssue(projectId, issueId);
}
