import { Box, Typography, Stack, Avatar, useMediaQuery, useTheme } from '@mui/material';
import ProjectStatusChip from './ProjectStatusChip';
import HealthIndicator from './HealthIndicator';
import ProjectProgressBar from './ProjectProgressBar';
import ProjectActionMenu from './ProjectActionMenu';
import StatusBadge from '../dashboard/StatusBadge';

function initialsOf(name) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

function spiColor(spi) {
  if (spi >= 1) return 'success.main';
  if (spi >= 0.9) return 'warning.main';
  return 'error.main';
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Desktop table. On 'lg' and below (tablet) the Client, Region and
 * Target COD columns hide to keep the table compact without introducing
 * horizontal scrolling; below 'md' the page swaps this out for
 * ProjectCardList entirely.
 */
export default function ProjectTable({ projects, onView, onEdit, onDuplicate, onArchive }) {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('lg'));

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        component="table"
        sx={{
          width: '100%',
          borderCollapse: 'collapse',
          '& th': {
            textAlign: 'left',
            fontSize: 12,
            fontWeight: 700,
            color: 'text.secondary',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            pb: 1.25,
            borderBottom: '1px solid',
            borderColor: 'divider',
            whiteSpace: 'nowrap',
          },
          '& td': {
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            verticalAlign: 'middle',
          },
          '& tr:last-of-type td': { borderBottom: 'none' },
        }}
      >
        <thead>
          <tr>
            <th>Project</th>
            <th>Project Code</th>
            {!isCompact && <th>Client</th>}
            <th>PM</th>
            {!isCompact && <th>Region</th>}
            <th>Capacity</th>
            <th>Progress</th>
            <th>Schedule</th>
            <th>SPI</th>
            <th>Health</th>
            <th>Status</th>
            {!isCompact && <th>Target COD</th>}
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <Typography variant="body2" fontWeight={700} sx={{ maxWidth: 220 }}>
                  {p.projectName}
                </Typography>
              </td>
              <td>
                <Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {p.projectCode}
                </Typography>
              </td>
              {!isCompact && (
                <td>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 180 }} noWrap>
                    {p.client}
                  </Typography>
                </td>
              )}
              <td>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Avatar sx={{ width: 22, height: 22, fontSize: 10, bgcolor: 'divider', color: 'text.secondary' }}>
                    {initialsOf(p.projectManager)}
                  </Avatar>
                  <Typography variant="body2" color="text.secondary" noWrap>{p.projectManager}</Typography>
                </Stack>
              </td>
              {!isCompact && (
                <td>
                  <Typography variant="body2" color="text.secondary" noWrap>{p.region}</Typography>
                </td>
              )}
              <td>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {p.capacity} {p.capacityUnit}
                </Typography>
              </td>
              <td><ProjectProgressBar value={p.progress} /></td>
              <td><StatusBadge health={p.isOnSchedule ? 'green' : 'red'} label={p.scheduleStatus} /></td>
              <td>
                <Typography variant="body2" fontWeight={700} sx={{ color: spiColor(p.spi), fontFamily: 'JetBrains Mono, monospace' }}>
                  {p.spi.toFixed(2)}
                </Typography>
              </td>
              <td><HealthIndicator health={p.healthStatus} /></td>
              <td><ProjectStatusChip status={p.status} /></td>
              {!isCompact && (
                <td>
                  <Typography variant="body2" color="text.secondary" noWrap>{formatDate(p.targetCOD)}</Typography>
                </td>
              )}
              <td>
                <ProjectActionMenu project={p} onView={onView} onEdit={onEdit} onDuplicate={onDuplicate} onArchive={onArchive} />
              </td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
