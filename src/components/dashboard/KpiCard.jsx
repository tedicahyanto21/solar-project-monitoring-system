import { Paper, Box, Typography, Stack } from '@mui/material';
import SolarPowerRoundedIcon from '@mui/icons-material/SolarPowerRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import EventAvailableRoundedIcon from '@mui/icons-material/EventAvailableRounded';
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded';
import BugReportRoundedIcon from '@mui/icons-material/BugReportRounded';
import HealthAndSafetyRoundedIcon from '@mui/icons-material/HealthAndSafetyRounded';
import TrendIndicator from './TrendIndicator';

const ICONS = {
  projects: SolarPowerRoundedIcon,
  progress: TrendingUpRoundedIcon,
  schedule: EventAvailableRoundedIcon,
  delay: ReportProblemRoundedIcon,
  issues: BugReportRoundedIcon,
  hse: HealthAndSafetyRoundedIcon,
};

/**
 * Single executive KPI card: icon + big value + subtitle + trend chip.
 * Reused six times on the dashboard with different data — no per-card
 * business logic lives here.
 */
export default function KpiCard({ label, value, subtitle, trend, icon }) {
  const Icon = ICONS[icon] || SolarPowerRoundedIcon;

  return (
    <Paper sx={{ p: 2.25, height: '100%', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Box
          sx={{
            width: 36,
            height: 36,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(214,146,46,0.14)' : 'rgba(214,146,46,0.10)'),
            color: 'primary.main',
          }}
        >
          <Icon fontSize="small" />
        </Box>
        {trend && <TrendIndicator {...trend} />}
      </Stack>

      <Box>
        <Typography variant="h4" fontWeight={700} lineHeight={1.15}>
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {label}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, opacity: 0.8 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
    </Paper>
  );
}
