// Repository for Issue Management (Database Design SPMS-DOC-06, Section 12;
// Requirement Specification SPMS-DOC-02, SPMS-REQ-015/016; Sprint FT-6 Part A).
//
// FT-8/consolidation Part F: branches on `isLocalMode` between the mock
// store and Firestore (services/firebase/issueService.js) -- one
// authoritative source at a time. Create/Edit/Close/Reopen authority
// (Super Admin, Project Manager, Site Manager) is enforced by the caller
// -- see pages/Projects/detail/IssuesTab.jsx.
import { isLocalMode } from '../firebase/config';
import { getOperations, addIssue, updateIssue, closeIssue, reopenIssue } from '../../data/mockOperationalData';
import * as fb from '../firebase/issueService';

export async function getIssues(projectId) {
  return isLocalMode ? (getOperations(projectId)?.issues ?? []) : fb.getIssues(projectId);
}

export async function createIssue(projectId, issue) {
  return isLocalMode ? addIssue(projectId, issue) : fb.createIssue(projectId, issue);
}

// FT-6 A3: Edit Issue.
export async function updateIssueRecord(projectId, issueId, patch) {
  return isLocalMode ? updateIssue(projectId, issueId, patch) : fb.updateIssueRecord(projectId, issueId, patch);
}

// Closing preserves openedAt/createdAt; only status, closedAt, and closedBy
// change (Requirement Specification SPMS-REQ-015 and Sprint FT-4/FT-6:
// "Do not delete issue history when an issue is closed.")
export async function closeIssueRecord(projectId, issueId, closedBy) {
  return isLocalMode ? closeIssue(projectId, issueId, closedBy) : fb.closeIssueRecord(projectId, issueId, closedBy);
}

// FT-6 A2/A3: Reopen Issue -- clears closedAt/closedBy only, openedAt and
// createdAt are never touched.
export async function reopenIssueRecord(projectId, issueId) {
  return isLocalMode ? reopenIssue(projectId, issueId) : fb.reopenIssueRecord(projectId, issueId);
}
