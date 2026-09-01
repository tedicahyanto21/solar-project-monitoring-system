import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Box,
  Typography,
  IconButton,
  Stack,
  TextField,
  MenuItem,
  Button,
  Alert,
  CircularProgress,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { PROJECT_STATUSES, CAPACITY_UNITS, REGIONS } from '../../data/mockProjects';
import { getUsers } from '../../services/repositories/userRepository';
import { ROLES } from '../../constants/roles';

const EMPTY_VALUES = {
  projectName: '',
  projectCode: '',
  client: '',
  capacity: '',
  capacityUnit: 'MWp',
  region: '',
  location: '',
  // FT-9A-01: projectManagerId (a real userId) is now the authoritative
  // relationship field -- see the Project Manager Controller below. The
  // display name is derived from the selected user at submit time, never
  // used as the identity itself.
  projectManagerId: '',
  contractStart: '',
  targetCOD: '',
  status: 'Planning',
  description: '',
};

/**
 * Create/Edit modal for a project. Same fields are used for both flows —
 * `project` is null when creating, or the project being edited. Only the
 * fields collected by this form are written back; operational fields
 * (progress, health, SPI, issues, manpower) are left untouched by edits.
 */
export default function ProjectFormDialog({ open, project, onClose, onSubmit, error }) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: EMPTY_VALUES, mode: 'onBlur' });

  // FT-9A-01: Project Manager options come from the real user repository
  // (userRepository.getUsers(), which itself already branches mock/Firestore
  // -- this component never queries Firestore directly). Loaded fresh each
  // time the dialog opens so a PM added/deactivated in User Management
  // between openings is reflected without needing a page reload.
  const [pmUsers, setPmUsers] = useState([]);
  const [loadingPms, setLoadingPms] = useState(false);
  const [pmLoadError, setPmLoadError] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingPms(true);
    setPmLoadError('');
    getUsers()
      .then((users) => {
        if (cancelled) return;
        // NOTE: the correct role constant is ROLES.PROJECT_MANAGER
        // ('PROJECT_MANAGER'), not the literal 'PM' -- filtering on 'PM'
        // would match zero users in this codebase and silently leave the
        // dropdown empty. See final report for this discrepancy.
        const eligible = users.filter((u) => u.role === ROLES.PROJECT_MANAGER && u.status === 'ACTIVE');
        setPmUsers(eligible);
      })
      .catch((err) => {
        // AC-09: never silently fall back to a hardcoded PM list here --
        // show the failure instead.
        if (!cancelled) setPmLoadError(err.message || 'Could not load Project Managers.');
      })
      .finally(() => {
        if (!cancelled) setLoadingPms(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let defaultProjectManagerId = project?.projectManagerId || '';
    // Legacy compatibility (Section 7): the fallback below must trigger in
    // TWO cases, not just "projectManagerId is missing" -- older mock/seed
    // project records DO carry a projectManagerId, but one derived from the
    // legacy PROJECT_MANAGERS mock list (e.g. "pm-andi-wijaya"), which does
    // not match any real user's userId (e.g. "demo-2"). If the current
    // value doesn't correspond to any loaded, eligible PM user, treat it
    // the same as "missing" and fall back to matching by the denormalized
    // projectManager NAME instead. This is a display-time correction only
    // for the Edit form -- it never rewrites the underlying project record.
    const idMatchesLoadedUser = pmUsers.some((u) => u.userId === defaultProjectManagerId);
    if ((!defaultProjectManagerId || !idMatchesLoadedUser) && project?.projectManager && pmUsers.length) {
      const match = pmUsers.find((u) => u.name === project.projectManager);
      if (match) defaultProjectManagerId = match.userId;
      else if (!idMatchesLoadedUser) defaultProjectManagerId = ''; // stale legacy id, no name match either -- show unselected rather than an invalid value
    }
    reset(project ? { ...EMPTY_VALUES, ...project, projectManagerId: defaultProjectManagerId } : EMPTY_VALUES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project, pmUsers]);

  function submit(values) {
    // AC-05/AC-06: projectManagerId (a real userId) is the field that gets
    // persisted as the relationship. projectManager (the display name) is
    // derived here purely for list/table display continuity elsewhere in
    // the app -- it is never read back as an identity.
    const selectedPm = pmUsers.find((u) => u.userId === values.projectManagerId);
    onSubmit({
      ...values,
      capacity: Number(values.capacity),
      projectManager: selectedPm?.name || project?.projectManager || '',
    });
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" scroll="paper">
      <Box component="form" onSubmit={handleSubmit(submit)}>
        <DialogTitle sx={{ pb: 0.5 }}>
          <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h6" fontWeight={700}>
                {project ? 'Edit Project' : 'New Project'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {project ? 'Update project details' : 'Add a project to the portfolio'}
              </Typography>
            </Box>
            <IconButton onClick={onClose} size="small" aria-label="Close">
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </Stack>
        </DialogTitle>

        <DialogContent dividers>
          <Stack spacing={2.25} sx={{ pt: 0.5 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <Controller
              name="projectName"
              control={control}
              rules={{ required: 'Project name is required' }}
              render={({ field }) => (
                <TextField {...field} label="Project Name" required fullWidth error={!!errors.projectName} helperText={errors.projectName?.message} />
              )}
            />

            <Stack direction="row" spacing={1.5}>
              <Controller
                name="projectCode"
                control={control}
                rules={{ required: 'Project code is required' }}
                render={({ field }) => (
                  <TextField {...field} label="Project Code" required fullWidth error={!!errors.projectCode} helperText={errors.projectCode?.message} />
                )}
              />
              <Controller
                name="client"
                control={control}
                rules={{ required: 'Client is required' }}
                render={({ field }) => (
                  <TextField {...field} label="Client" required fullWidth error={!!errors.client} helperText={errors.client?.message} />
                )}
              />
            </Stack>

            <Stack direction="row" spacing={1.5}>
              <Controller
                name="capacity"
                control={control}
                rules={{ required: 'Capacity is required', min: { value: 0.01, message: 'Must be greater than 0' } }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="number"
                    label="Capacity"
                    required
                    fullWidth
                    error={!!errors.capacity}
                    helperText={errors.capacity?.message}
                    inputProps={{ step: '0.1', min: 0 }}
                  />
                )}
              />
              <Controller
                name="capacityUnit"
                control={control}
                render={({ field }) => (
                  <TextField {...field} select label="Unit" sx={{ minWidth: 110 }}>
                    {CAPACITY_UNITS.map((u) => (
                      <MenuItem key={u} value={u}>{u}</MenuItem>
                    ))}
                  </TextField>
                )}
              />
            </Stack>

            <Stack direction="row" spacing={1.5}>
              <Controller
                name="region"
                control={control}
                rules={{ required: 'Region is required' }}
                render={({ field }) => (
                  <TextField {...field} select label="Region" required fullWidth error={!!errors.region} helperText={errors.region?.message}>
                    <MenuItem value="" disabled>Select a region</MenuItem>
                    {REGIONS.map((r) => (
                      <MenuItem key={r} value={r}>{r}</MenuItem>
                    ))}
                  </TextField>
                )}
              />
              <Controller
                name="location"
                control={control}
                render={({ field }) => <TextField {...field} label="Location" fullWidth />}
              />
            </Stack>

            <Controller
              name="projectManagerId"
              control={control}
              rules={{ required: 'Project manager is required' }}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="Project Manager"
                  required
                  fullWidth
                  disabled={loadingPms || !!pmLoadError}
                  error={!!errors.projectManagerId || !!pmLoadError}
                  helperText={
                    pmLoadError
                      ? pmLoadError
                      : loadingPms
                        ? 'Loading project managers\u2026'
                        : errors.projectManagerId?.message
                          || (pmUsers.length === 0 ? 'No ACTIVE Project Manager users found. Create one in User Management first.' : ' ')
                  }
                  slotProps={{
                    input: {
                      startAdornment: loadingPms ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null,
                    },
                  }}
                >
                  <MenuItem value="" disabled>
                    {loadingPms ? 'Loading project managers\u2026' : 'Select a project manager'}
                  </MenuItem>
                  {pmUsers.map((u) => (
                    <MenuItem key={u.userId} value={u.userId}>{u.name}</MenuItem>
                  ))}
                </TextField>
              )}
            />

            <Stack direction="row" spacing={1.5}>
              <Controller
                name="contractStart"
                control={control}
                rules={{ required: 'Contract start is required' }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="date"
                    label="Contract Start"
                    required
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    error={!!errors.contractStart}
                    helperText={errors.contractStart?.message}
                  />
                )}
              />
              <Controller
                name="targetCOD"
                control={control}
                rules={{ required: 'Target COD is required' }}
                render={({ field }) => (
                  <TextField
                    {...field}
                    type="date"
                    label="Target COD"
                    required
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    error={!!errors.targetCOD}
                    helperText={errors.targetCOD?.message}
                  />
                )}
              />
            </Stack>

            <Controller
              name="status"
              control={control}
              rules={{ required: 'Status is required' }}
              render={({ field }) => (
                <TextField {...field} select label="Status" required fullWidth error={!!errors.status} helperText={errors.status?.message}>
                  {PROJECT_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>{s}</MenuItem>
                  ))}
                </TextField>
              )}
            />

            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Description" fullWidth multiline minRows={3} />
              )}
            />
          </Stack>
        </DialogContent>

        <DialogActions sx={{ p: 2.5 }}>
          <Button variant="outlined" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            {project ? 'Save Changes' : 'Create Project'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
