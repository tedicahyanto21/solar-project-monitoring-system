import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import SolarPowerRoundedIcon from '@mui/icons-material/SolarPowerRounded';
import PaidRoundedIcon from '@mui/icons-material/PaidRounded';
import PeopleAltRoundedIcon from '@mui/icons-material/PeopleAltRounded';
import { ROLES } from './roles';

// The four approved primary modules (Project Blueprint SPMS-DOC-05, Section 8).
// Do not add a fifth primary module here without updating the Blueprint first.
//
// `roles` controls SIDEBAR VISIBILITY ONLY, derived from the role/module
// associations in the Project Blueprint (Section 9) and the Collection
// Access Matrix in the Firestore Security Design (Section 6). Hiding a nav
// item is a UX convenience, not a security boundary -- real enforcement
// happens in Firestore rules against role + project assignment, not here.
export const NAV_ITEMS = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    icon: DashboardRoundedIcon,
    roles: null, // visible to all roles
  },
  {
    label: 'Project Master',
    path: '/projects',
    icon: SolarPowerRoundedIcon,
    roles: [
      ROLES.SUPER_ADMIN,
      ROLES.HEAD_PM,
      ROLES.PROJECT_MANAGER,
      ROLES.SITE_MANAGER,
      ROLES.ENGINEERING,
      ROLES.HSE,
    ],
  },
  {
    label: 'Project Cost Control',
    path: '/cost-control',
    icon: PaidRoundedIcon,
    roles: [
      ROLES.SUPER_ADMIN,
      ROLES.HEAD_PM,
      ROLES.PROJECT_MANAGER,
      ROLES.SCM,
      ROLES.HC,
      ROLES.FINANCE,
    ],
  },
  {
    label: 'User Management',
    path: '/users',
    icon: PeopleAltRoundedIcon,
    roles: [ROLES.SUPER_ADMIN],
  },
];

// Returns the nav items a given role is allowed to see. `role` may be
// undefined while auth is still initializing; in that case show nothing
// extra beyond items with no role restriction.
export function getNavItemsForRole(role) {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

// Centralized route -> allowed-roles lookup (FT-4.1 Correction 1). Reuses
// the SAME NAV_ITEMS.roles config as sidebar visibility so route
// authorization and nav visibility can never drift apart into two
// different permission lists. Matches a path or any of its sub-routes,
// e.g. '/projects/proj-001' resolves to the '/projects' nav item's roles.
// Returns null for an unrestricted route (or one not in NAV_ITEMS, such as
// /login or the 404 page, which ProtectedRoute never gates anyway).
export function getRouteAllowedRoles(pathname) {
  const item = NAV_ITEMS.find((n) => pathname === n.path || pathname.startsWith(`${n.path}/`));
  return item ? item.roles : null;
}
