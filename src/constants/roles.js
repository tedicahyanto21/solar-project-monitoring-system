// Official SPMS user roles.
// Source of truth: SPMS Project Blueprint (SPMS-DOC-05), Section 9 — User Role
// Architecture, and SPMS Firestore Security Design (SPMS-DOC-07), Section 4.
//
// These values are expected to match the `role` field stored on
// users/{userId} in Firestore once authentication is fully wired up
// (see src/services/firebase/userService.js). Do not add roles here
// that are not in the approved architecture.
export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  HEAD_PM: 'HEAD_PM',
  PROJECT_MANAGER: 'PROJECT_MANAGER',
  SITE_MANAGER: 'SITE_MANAGER',
  ENGINEERING: 'ENGINEERING',
  HSE: 'HSE',
  SCM: 'SCM',
  HC: 'HC',
  FINANCE: 'FINANCE',
  BOD: 'BOD',
};

// Display labels for UI surfaces (Topbar menu, User Management, etc.)
export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: 'Super Admin',
  [ROLES.HEAD_PM]: 'Head PM',
  [ROLES.PROJECT_MANAGER]: 'Project Manager',
  [ROLES.SITE_MANAGER]: 'Site Manager',
  [ROLES.ENGINEERING]: 'Engineering',
  [ROLES.HSE]: 'HSE',
  [ROLES.SCM]: 'SCM',
  [ROLES.HC]: 'HC',
  [ROLES.FINANCE]: 'Finance',
  [ROLES.BOD]: 'BOD',
};

export const ALL_ROLES = Object.values(ROLES);
