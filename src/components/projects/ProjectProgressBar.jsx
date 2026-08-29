import { Box, Stack, Typography, LinearProgress } from '@mui/material';

function barColor(value) {
  if (value >= 70) return 'success';
  if (value >= 40) return 'warning';
  return 'error';
}

export default function ProjectProgressBar({ value, width = 120 }) {
  return (
    <Box sx={{ minWidth: width }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="caption" fontWeight={700}>{value}%</Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={value}
        color={barColor(value)}
        sx={{
          height: 6,
          borderRadius: 3,
          bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(231,233,238,0.10)' : 'rgba(0,0,0,0.06)'),
        }}
      />
    </Box>
  );
}
