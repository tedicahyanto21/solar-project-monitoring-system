import { Box, Stack, Typography, LinearProgress } from '@mui/material';

function barColor(value) {
  if (value >= 70) return 'success';
  if (value >= 40) return 'warning';
  return 'error';
}

/**
 * Section 5 — Progress by Discipline. One horizontal bar per discipline;
 * color reflects completion band (green/amber/red), not a fixed palette.
 */
export default function DisciplineProgressBars({ items }) {
  return (
    <Stack spacing={1.75}>
      {items.map((item) => (
        <Box key={item.label}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="body2" fontWeight={600}>{item.label}</Typography>
            <Typography variant="body2" color="text.secondary" fontWeight={700}>{item.value}%</Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={item.value}
            color={barColor(item.value)}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(231,233,238,0.10)' : 'rgba(0,0,0,0.06)'),
            }}
          />
        </Box>
      ))}
    </Stack>
  );
}
