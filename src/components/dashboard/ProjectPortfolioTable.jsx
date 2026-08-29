import { Box, Typography, LinearProgress, Stack, Avatar, useMediaQuery, useTheme } from '@mui/material';
import StatusBadge from './StatusBadge';

const HEALTH_COLOR = { green: 'success', yellow: 'warning', red: 'error' };

function initialsOf(name) {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function ProgressCell({ value, health }) {
  return (
    <Box sx={{ minWidth: 120 }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary">Progress</Typography>
        <Typography variant="caption" fontWeight={700}>{value}%</Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={value}
        color={HEALTH_COLOR[health]}
        sx={{ height: 6, borderRadius: 3, bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(231,233,238,0.10)' : 'rgba(0,0,0,0.06)') }}
      />
    </Box>
  );
}

function SpiValue({ spi }) {
  const color = spi >= 1 ? 'success.main' : spi >= 0.9 ? 'warning.main' : 'error.main';
  return (
    <Typography variant="body2" fontWeight={700} sx={{ color, fontFamily: 'JetBrains Mono, monospace' }}>
      {spi.toFixed(2)}
    </Typography>
  );
}

/**
 * Section 2 — Project Portfolio. Renders as a proper table on wider
 * screens and collapses into a stacked card list on small screens, so no
 * horizontal scrolling is needed on mobile.
 */
export default function ProjectPortfolioTable({ projects }) {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));

  if (isCompact) {
    return (
      <Stack spacing={1.5}>
        {projects.map((p) => (
          <Box
            key={p.id}
            sx={{
              p: 1.5,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" fontWeight={700} noWrap>{p.name}</Typography>
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5 }}>
                  <Avatar sx={{ width: 18, height: 18, fontSize: 9, bgcolor: 'divider', color: 'text.secondary' }}>
                    {initialsOf(p.pm)}
                  </Avatar>
                  <Typography variant="caption" color="text.secondary">{p.pm}</Typography>
                </Stack>
              </Box>
              <StatusBadge health={p.health} label={p.status} />
            </Stack>
            <Stack direction="row" spacing={3} alignItems="center" sx={{ mt: 1.5 }}>
              <Box sx={{ flex: 1 }}>
                <ProgressCell value={p.progress} health={p.health} />
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>SPI</Typography>
                <SpiValue spi={p.spi} />
              </Box>
            </Stack>
          </Box>
        ))}
      </Stack>
    );
  }

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
            <th>PM</th>
            <th>Progress</th>
            <th>SPI</th>
            <th>Status</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td>
                <Typography variant="body2" fontWeight={600} sx={{ maxWidth: 260 }}>
                  {p.name}
                </Typography>
              </td>
              <td>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Avatar sx={{ width: 22, height: 22, fontSize: 10, bgcolor: 'divider', color: 'text.secondary' }}>
                    {initialsOf(p.pm)}
                  </Avatar>
                  <Typography variant="body2" color="text.secondary" noWrap>{p.pm}</Typography>
                </Stack>
              </td>
              <td><ProgressCell value={p.progress} health={p.health} /></td>
              <td><SpiValue spi={p.spi} /></td>
              <td>
                <Typography variant="body2" color="text.secondary">{p.status}</Typography>
              </td>
              <td><StatusBadge health={p.health} /></td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}
