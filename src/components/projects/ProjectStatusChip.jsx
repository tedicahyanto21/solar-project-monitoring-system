import { Chip } from '@mui/material';

// Workflow phase → chip color. Terminal/exception phases get a semantic
// color (success/warning/error); the in-progress phases share a neutral
// "default" treatment so the eye isn't drawn away from Health, which is
// the field that owns green/amber/red signaling.
const STATUS_COLOR = {
  Planning: 'default',
  Mobilization: 'default',
  Execution: 'default',
  Testing: 'default',
  Commissioning: 'default',
  Handover: 'default',
  Completed: 'success',
  'On Hold': 'warning',
  Delayed: 'error',
};

export default function ProjectStatusChip({ status }) {
  const color = STATUS_COLOR[status] || 'default';
  return (
    <Chip
      size="small"
      label={status}
      color={color}
      variant="outlined"
      sx={{ fontWeight: 600, fontSize: 12, borderRadius: 1.5 }}
    />
  );
}
