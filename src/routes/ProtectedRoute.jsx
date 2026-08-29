import { Navigate, useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import { getRouteAllowedRoles } from '../constants/nav';
import ProgressArc from '../components/common/ProgressArc';

// FT-4.1 Correction 1: authentication alone is not authorization. Route
// access requires:
//   Authenticated User + Authorized Role = Route Access
// Role permissions come from the single centralized config in
// constants/nav.js (getRouteAllowedRoles), the same source the sidebar
// uses for nav visibility -- there is only one permission list, not two.
// This is an application/UX-level guard; it does not replace Firebase/
// Firestore Security Rules, which remain the real enforcement layer once
// implemented.
export default function ProtectedRoute({ children }) {
  const { isAuthenticated, initializing, profile } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <Box sx={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
        <ProgressArc size={40} strokeWidth={3} spin />
      </Box>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // FT-7 A2: an INACTIVE user must not access protected application
  // functionality -- treated the same as not being authenticated, rather
  // than as a role-authorization case, since it applies regardless of role.
  if (profile?.status === 'INACTIVE') {
    return <Navigate to="/login" replace state={{ from: location, deactivated: true }} />;
  }

  const allowedRoles = getRouteAllowedRoles(location.pathname);
  const isAuthorized = !allowedRoles || allowedRoles.includes(profile?.role);
  if (!isAuthorized) {
    // Do not expose restricted functionality -- redirect rather than
    // render anything from the unauthorized route.
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
