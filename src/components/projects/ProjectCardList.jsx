import { Box, Stack, Typography, Avatar } from '@mui/material';
import ProjectStatusChip from './ProjectStatusChip';
import HealthIndicator from './HealthIndicator';
import ProjectProgressBar from './ProjectProgressBar';
import ProjectActionMenu from './ProjectActionMenu';
import StatusBadge from '../dashboard/StatusBadge';

function initialsOf(name) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

/**
 * Mobile card list — replaces ProjectTable below the 'md' breakpoint so
 * the page never forces horizontal scrolling on small screens.
 */
export default function ProjectCardList({ projects, onView, onEdit, onDuplicate, onArchive }) {
  return (
    <Stack spacing={1.5}>
      {projects.map((p) => (
        <Box key={p.id} sx={{ p: 1.5, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={700} noWrap>{p.projectName}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {p.projectCode} · {p.client}
              </Typography>
            </Box>
            <ProjectActionMenu project={p} onView={onView} onEdit={onEdit} onDuplicate={onDuplicate} onArchive={onArchive} />
          </Stack>

          <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
            <Avatar sx={{ width: 18, height: 18, fontSize: 9, bgcolor: 'divider', color: 'text.secondary' }}>
              {initialsOf(p.projectManager)}
            </Avatar>
            <Typography variant="caption" color="text.secondary">{p.projectManager}</Typography>
            <Typography variant="caption" color="text.secondary">· {p.capacity} {p.capacityUnit}</Typography>
            <Typography variant="caption" color="text.secondary">· {p.region}</Typography>
          </Stack>

          <Box sx={{ mt: 1.25 }}>
            <ProjectProgressBar value={p.progress} width="100%" />
          </Box>

          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mt: 1.25 }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <ProjectStatusChip status={p.status} />
              <StatusBadge health={p.isOnSchedule ? 'green' : 'red'} label={p.scheduleStatus} />
            </Stack>
            <HealthIndicator health={p.healthStatus} />
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
