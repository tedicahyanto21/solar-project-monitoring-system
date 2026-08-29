import { Box, Typography, Paper } from '@mui/material';
import StatusBadge from '../../../components/dashboard/StatusBadge';
import ProjectStatusChip from '../../../components/projects/ProjectStatusChip';
import CircularStat from '../../../components/dashboard/CircularStat';

function formatDate(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Field({ label, value }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} sx={{ mt: 0.25 }}>
        {value ?? '\u2014'}
      </Typography>
    </Box>
  );
}

const fieldGrid = { display: 'grid', gap: 2.5, gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)' } };

// Fields per Sprint FT-4, Part B.4 -- do not add fields beyond this list.
export default function OverviewTab({ project, progress, schedule }) {
  return (
    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' } }}>
      <Paper sx={{ p: 3 }}>
        <Box sx={fieldGrid}>
          <Field label="Project Code" value={project.projectCode} />
          <Box sx={{ gridColumn: 'span 2' }}><Field label="Project Name" value={project.projectName} /></Box>
          <Field label="Customer" value={project.client} />
          <Field label="Location" value={project.location} />
          <Field label="Capacity" value={`${project.capacity} ${project.capacityUnit}`} />
          <Field label="Contract Date" value={formatDate(project.contractStart)} />
          <Field label="Start Date" value={formatDate(project.contractStart)} />
          <Field label="Planned COD" value={formatDate(project.targetCOD)} />
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>
              Current Status
            </Typography>
            <Box sx={{ mt: 0.5 }}><ProjectStatusChip status={project.status} /></Box>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>
              Schedule Status
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <StatusBadge health={schedule?.isOnSchedule ? 'green' : 'red'} label={schedule?.label ?? '\u2014'} />
            </Box>
          </Box>
        </Box>
      </Paper>
      <Paper sx={{ p: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
        <Typography variant="subtitle2" color="text.secondary">Overall Progress</Typography>
        <CircularStat size={140} strokeWidth={11} value={progress?.overallProgress ?? project.progress} caption="Complete" />
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
          Calculated by the Progress Engine repository -- not directly editable.
        </Typography>
      </Paper>
    </Box>
  );
}
