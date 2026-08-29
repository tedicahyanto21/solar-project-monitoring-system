import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Stack,
  TextField,
  MenuItem,
  Button,
  Divider,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { PROJECT_STATUSES, PROJECT_MANAGERS, CAPACITY_UNITS } from '../../data/mockProjects';

const EMPTY_VALUES = {
  projectName: '',
  projectCode: '',
  client: '',
  capacity: '',
  capacityUnit: 'MWp',
  location: '',
  projectManager: '',
  contractStart: '',
  targetCOD: '',
  status: 'Planning',
};

/**
 * Create/Edit form for a project. Same fields are used for both flows —
 * `project` is null when creating, or the project being edited. Only the
 * fields collected by this form are written back; operational fields
 * (progress, health, SPI, issues, manpower) are left untouched by edits.
 */
export default function ProjectFormDrawer({ open, project, onClose, onSubmit }) {
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: EMPTY_VALUES, mode: 'onBlur' });

  useEffect(() => {
    if (open) {
      reset(project ? { ...EMPTY_VALUES, ...project } : EMPTY_VALUES);
    }
  }, [open, project, reset]);

  function submit(values) {
    onSubmit({
      ...values,
      capacity: Number(values.capacity),
    });
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      <Box
        component="form"
        onSubmit={handleSubmit(submit)}
        sx={{ width: { xs: '100vw', sm: 440 }, height: '100%', display: 'flex', flexDirection: 'column' }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 2.5 }}>
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
        <Divider />

        <Box sx={{ p: 2.5, flex: 1, overflowY: 'auto' }}>
          <Stack spacing={2.25}>
            <Controller
              name="projectName"
              control={control}
              rules={{ required: 'Project name is required' }}
              render={({ field }) => (
                <TextField {...field} label="Project Name" required fullWidth error={!!errors.projectName} helperText={errors.projectName?.message} />
              )}
            />

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

            <Controller
              name="location"
              control={control}
              render={({ field }) => <TextField {...field} label="Location" fullWidth />}
            />

            <Controller
              name="projectManager"
              control={control}
              rules={{ required: 'Project manager is required' }}
              render={({ field }) => (
                <TextField {...field} select label="Project Manager" required fullWidth error={!!errors.projectManager} helperText={errors.projectManager?.message}>
                  <MenuItem value="" disabled>Select a project manager</MenuItem>
                  {PROJECT_MANAGERS.map((pm) => (
                    <MenuItem key={pm.id} value={pm.name}>{pm.name}</MenuItem>
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
          </Stack>
        </Box>

        <Divider />
        <Stack direction="row" spacing={1.5} sx={{ p: 2.5 }}>
          <Button variant="outlined" fullWidth onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" fullWidth>
            {project ? 'Save Changes' : 'Create Project'}
          </Button>
        </Stack>
      </Box>
    </Drawer>
  );
}
