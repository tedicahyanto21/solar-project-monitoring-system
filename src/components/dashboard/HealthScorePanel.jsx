import { Box, Stack, Typography, LinearProgress, useTheme } from '@mui/material';
import CircularStat from './CircularStat';

function barColor(value) {
  if (value >= 85) return 'success';
  if (value >= 60) return 'warning';
  return 'error';
}

/**
 * Section 11 — Project Health Score. Large gauge (reusing CircularStat)
 * plus a compact breakdown of the metrics that roll up into the score.
 */
export default function HealthScorePanel({ value, label, breakdown }) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 3,
        gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr' },
        alignItems: 'center',
      }}
    >
      <CircularStat size={140} strokeWidth={12} value={value} caption={label} arcColor={theme.palette.success.main} />

      <Stack spacing={1.5}>
        {breakdown.map((item) => (
          <Box key={item.label}>
            <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
              <Typography variant="body2" fontWeight={600}>{item.label}</Typography>
              <Typography variant="body2" color="text.secondary" fontWeight={700}>{item.value}</Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={item.value}
              color={barColor(item.value)}
              sx={{
                height: 6,
                borderRadius: 3,
                bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(231,233,238,0.10)' : 'rgba(0,0,0,0.06)'),
              }}
            />
          </Box>
        ))}
      </Stack>
    </Box>
  );
}
