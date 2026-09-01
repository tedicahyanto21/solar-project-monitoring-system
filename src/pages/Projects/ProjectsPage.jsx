import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Stack, Typography, Button, Paper, Snackbar, Alert, CircularProgress } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ProjectSummaryCards from '../../components/projects/ProjectSummaryCards';
import ProjectFilters from '../../components/projects/ProjectFilters';
import ProjectListView from '../../components/projects/ProjectListView';
import ProjectFormDialog from '../../components/projects/ProjectFormDialog';
import { getProjects, createProject, updateProject, duplicateProjectRecord } from '../../services/repositories/projectRepository';
import { getProjectProgress, getScheduleStatus } from '../../services/repositories/progressRepository';
import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../constants/roles';

// Project Creation/Edit authority (Sprint FT-4 Part B.2; Sprint FT-9A
// Section 8): only these roles may create OR edit a project. Checked both
// for button visibility AND inside the action handlers themselves -- a
// hidden button alone is not access control. This is also enforced
// independently in firestore.rules (projects collection).
const CAN_MANAGE_PROJECT_ROLES = [ROLES.SUPER_ADMIN, ROLES.HEAD_PM];

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canManageProject = CAN_MANAGE_PROJECT_ROLES.includes(profile?.role);
  // Loaded through the repository layer (not imported from mock data
  // directly) so swapping in a Firestore-backed projectRepository later
  // does not require changing this page. See services/repositories/projectRepository.js.
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingProjects(true);
    setLoadError('');
    getProjects()
      .then(async (data) => {
        // Overall Progress and Schedule Status are computed by
        // progressRepository, never typed or stored ad hoc here (Sprint
        // FT-4 validation item 10).
        const enriched = await Promise.all(
          data.map(async (p) => {
            const progress = await getProjectProgress(p.id);
            const schedule = await getScheduleStatus(p);
            return {
              ...p,
              progress: progress?.overallProgress ?? p.progress,
              scheduleStatus: schedule.label,
              isOnSchedule: schedule.isOnSchedule,
            };
          })
        );
        if (!cancelled) setProjects(enriched);
      })
      // FT-9B AC-B09: a failed read (Firestore permission/network error in
      // Firebase mode, etc.) must surface a clear message, never fail
      // silently with an empty list that looks like "no projects exist".
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Could not load projects. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [pmFilter, setPmFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' });
  const [formError, setFormError] = useState('');

  const filteredProjects = useMemo(() => {
    const term = search.trim().toLowerCase();
    return projects.filter((p) => {
      const matchesSearch =
        !term ||
        p.projectName.toLowerCase().includes(term) ||
        p.projectCode.toLowerCase().includes(term) ||
        p.client.toLowerCase().includes(term) ||
        p.projectManager.toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
      const matchesPm = pmFilter === 'all' || p.projectManager === pmFilter;
      const matchesRegion = regionFilter === 'all' || p.region === regionFilter;
      return matchesSearch && matchesStatus && matchesPm && matchesRegion;
    });
  }, [projects, search, statusFilter, pmFilter, regionFilter]);

  // FT-9A-01: distinct PM names actually present in the loaded project
  // list -- sourced from real data (mock or Firestore, whichever is
  // active), not the hardcoded mock PROJECT_MANAGERS list. Reuses the
  // already-loaded `projects` rather than issuing a second users query.
  const pmOptions = useMemo(
    () => [...new Set(projects.map((p) => p.projectManager).filter(Boolean))].sort(),
    [projects]
  );

  function notify(message, severity = 'success') {
    setSnackbar({ open: true, message, severity });
  }

  function openCreateForm() {
    if (!canManageProject) return; // defense in depth -- see CAN_MANAGE_PROJECT_ROLES above
    setEditingProject(null);
    setFormError('');
    setDialogOpen(true);
  }

  function openEditForm(project) {
    if (!canManageProject) return; // Sprint FT-9A Section 8: edit was previously ungated -- fixed here
    setEditingProject(project);
    setFormError('');
    setDialogOpen(true);
  }

  function closeForm() {
    setDialogOpen(false);
  }

  // Sprint FT-9A: errors (duplicate project, not found, unauthorized,
  // Firestore failure) are surfaced in the dialog, never swallowed --
  // Section 13.
  async function handleFormSubmit(values) {
    if (!canManageProject) return;
    setFormError('');
    try {
      if (editingProject) {
        const updated = await updateProject(editingProject.id, values);
        setProjects((prev) => prev.map((p) => (p.id === editingProject.id ? { ...p, ...updated } : p)));
        notify(`${values.projectName} updated successfully.`);
      } else {
        const newProject = await createProject(values);
        setProjects((prev) => [newProject, ...prev]);
        notify(`${newProject.projectName} created successfully.`);
      }
      setDialogOpen(false);
    } catch (err) {
      setFormError(err.message);
    }
  }

  // Project Detail (Project Blueprint SPMS-DOC-05, Section 11) is a
  // placeholder page for this sprint -- see src/pages/Projects/ProjectDetailPage.jsx.
  function handleView(project) {
    navigate(`/projects/${project.id}`);
  }

  async function handleDuplicate(project) {
    const copy = await duplicateProjectRecord(project);
    setProjects((prev) => {
      const index = prev.findIndex((p) => p.id === project.id);
      const next = [...prev];
      next.splice(index + 1, 0, copy);
      return next;
    });
    notify(`${project.projectName} duplicated as "${copy.projectName}".`);
  }

  // Archive is a dummy action for this sprint — no archived-state model
  // or filtering has been built yet, so this only surfaces feedback.
  function handleArchive(project) {
    notify(`${project.projectName} archived (placeholder action — no archive workflow yet).`, 'info');
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Project Master</Typography>
          <Typography variant="body2" color="text.secondary">
            Project portfolio and execution monitoring
          </Typography>
        </Box>
        {canManageProject && (
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreateForm}>
            New Project
          </Button>
        )}
      </Stack>

      <ProjectSummaryCards projects={projects} />

      {loadError && (
        <Alert severity="error" sx={{ mb: -1 }}>
          {loadError}
        </Alert>
      )}

      <Paper sx={{ p: { xs: 2, sm: 2.5 } }}>
        <Box sx={{ mb: 2.5 }}>
          <ProjectFilters
            search={search}
            onSearchChange={setSearch}
            status={statusFilter}
            onStatusChange={setStatusFilter}
            pm={pmFilter}
            onPmChange={setPmFilter}
            pmOptions={pmOptions}
            region={regionFilter}
            onRegionChange={setRegionFilter}
          />
        </Box>
        {loadingProjects ? (
          <Stack alignItems="center" sx={{ py: 6, gap: 1.5 }}>
            <CircularProgress size={28} />
            <Typography variant="body2" color="text.secondary">Loading projects&hellip;</Typography>
          </Stack>
        ) : (
          <ProjectListView
            projects={filteredProjects}
            onView={handleView}
            onEdit={openEditForm}
            onDuplicate={handleDuplicate}
            onArchive={handleArchive}
            canEdit={canManageProject}
          />
        )}
      </Paper>

      <ProjectFormDialog
        open={dialogOpen}
        project={editingProject}
        onClose={closeForm}
        onSubmit={handleFormSubmit}
        error={formError}
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3500}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ fontWeight: 600 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
