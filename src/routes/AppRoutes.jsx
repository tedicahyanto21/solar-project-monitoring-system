import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import MainLayout from '../layouts/MainLayout';
import LoginPage from '../pages/Login/LoginPage';
import DashboardPage from '../pages/Dashboard/DashboardPage';
import ProjectsPage from '../pages/Projects/ProjectsPage';
import ProjectDetailPage from '../pages/Projects/ProjectDetailPage';
import CostControlPage from '../pages/CostControl/CostControlPage';
import UsersPage from '../pages/Users/UsersPage';
import NotFoundPage from '../pages/NotFound/NotFoundPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:projectId" element={<ProjectDetailPage />} />
        <Route path="cost-control" element={<CostControlPage />} />
        <Route path="cost-control/:projectId" element={<CostControlPage />} />
        <Route path="users" element={<UsersPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
