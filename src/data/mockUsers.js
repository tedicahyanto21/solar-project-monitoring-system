// In-memory mock "backend" for User Management (Sprint FT-7, Part A).
//
// Separate from mockOperationalData.js because users are a GLOBAL entity
// (users/{userId}), not scoped to a project. Shape matches Database
// Design SPMS-DOC-06, Section 4. State is mutable and resets on page
// reload -- there is no persistence, same as the rest of the mock layer.
import { ROLES } from '../constants/roles';

export const USER_STATUSES = ['ACTIVE', 'INACTIVE'];

let seedIdCounter = 0;
function seedUser(name, email, role, department) {
  seedIdCounter += 1;
  const now = '2026-08-02T00:00:00.000Z';
  return {
    userId: `demo-${seedIdCounter}`,
    name,
    email,
    role,
    department,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
}

const users = [
  seedUser('Development User', 'developer@localhost', ROLES.SUPER_ADMIN, 'IT'),
  seedUser('Andi Wijaya', 'andi.wijaya@example.com', ROLES.PROJECT_MANAGER, 'Project Management'),
  seedUser('Rina Kartika', 'rina.kartika@example.com', ROLES.PROJECT_MANAGER, 'Project Management'),
  seedUser('Budi Santoso', 'budi.santoso@example.com', ROLES.SITE_MANAGER, 'Site Operations'),
  seedUser('Siti Nurhaliza', 'siti.nurhaliza@example.com', ROLES.SITE_MANAGER, 'Site Operations'),
  seedUser('Dewi Lestari', 'dewi.lestari@example.com', ROLES.ENGINEERING, 'Engineering'),
  seedUser('Hendra Gunawan', 'hendra.gunawan@example.com', ROLES.HSE, 'HSE'),
  seedUser('Yusuf Maulana', 'yusuf.maulana@example.com', ROLES.SCM, 'Supply Chain'),
  seedUser('Maya Anggraini', 'maya.anggraini@example.com', ROLES.HC, 'Human Capital'),
  seedUser('Fajar Ramadhan', 'fajar.ramadhan@example.com', ROLES.FINANCE, 'Finance'),
  seedUser('Ir. Sutrisno', 'sutrisno@example.com', ROLES.HEAD_PM, 'Project Management'),
  seedUser('Ratna Kusuma', 'ratna.kusuma@example.com', ROLES.BOD, 'Board'),
  // One INACTIVE seed user so FT-7 A2/C validation has something real to
  // exercise against (cannot be assigned, cannot log in, etc.).
  { ...seedUser('Former Employee', 'former.employee@example.com', ROLES.SITE_MANAGER, 'Site Operations'), status: 'INACTIVE' },
];

// Returns a shallow copy, never the live array reference -- callers (e.g.
// React state) must see a NEW array identity after any mutation below, or
// state updates that pass this straight into setState will be silently
// skipped (React bails out on reference-equal state).
export function getUsers() {
  return [...users];
}

export function getUserById(userId) {
  return users.find((u) => u.userId === userId) ?? null;
}

export function getUserByEmail(email) {
  return users.find((u) => u.email.toLowerCase() === (email || '').toLowerCase()) ?? null;
}

// A1: SUPER_ADMIN only -- enforced by the caller (UI + repository action
// check), not by this store function itself.
export function createUser({ name, email, role, department }) {
  if (getUserByEmail(email)) {
    throw new Error(`A user with email "${email}" already exists.`);
  }
  const now = new Date().toISOString();
  const record = {
    userId: `usr-${Date.now()}`,
    name, email, role, department: department || '',
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
  };
  users.push(record);
  return record;
}

export function updateUser(userId, patch) {
  const idx = users.findIndex((u) => u.userId === userId);
  if (idx === -1) return null;
  users[idx] = { ...users[idx], ...patch, userId, updatedAt: new Date().toISOString() };
  return users[idx];
}

// A2: normal workflow is deactivate, never physical delete.
export function setUserStatus(userId, status) {
  return updateUser(userId, { status });
}
