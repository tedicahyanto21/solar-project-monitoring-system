import { Box, Paper, Typography, Stack } from '@mui/material';
import TrendIndicator from './TrendIndicator';

const SEVERITY_COLOR = {
  critical: 'error.main',
  high: 'warning.main',
  medium: 'text.secondary',
  low: 'success.main',
};

/**
 * Section 6 — Issue Summary. Four severity cards; color communicates
 * severity level (error/warning/neutral/success), count is the focus.
 */
export default function IssueSummaryCards({ items }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
      }}
    >
      {items.map((item) => (
        <Paper key={item.key} sx={{ p: 2, textAlign: 'left' }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SEVERITY_COLOR[item.key] }} />
            <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {item.label}
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="baseline" justifyContent="space-between">
            <Typography variant="h4" fontWeight={700}>{item.count}</Typography>
            <TrendIndicator {...item.trend} />
          </Stack>
        </Paper>
      ))}
    </Box>
  );
}
