import { Stack, Typography, Box } from '@mui/material';

// Health uses only green/amber/red: Excellent and Good both read as the
// "green family" (different weight), Warning is amber, Critical is red.
const HEALTH_MAP = {
  Excellent: { color: 'success.main', label: 'Excellent' },
  Good: { color: 'success.main', label: 'Good' },
  Warning: { color: 'warning.main', label: 'Warning' },
  Critical: { color: 'error.main', label: 'Critical' },
};

export default function HealthIndicator({ health, dense = false }) {
  const { color, label } = HEALTH_MAP[health] || HEALTH_MAP.Good;
  const isStrong = health === 'Excellent' || health === 'Critical';

  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: color,
          opacity: isStrong ? 1 : 0.65,
          flexShrink: 0,
        }}
      />
      {!dense && (
        <Typography variant="body2" fontWeight={600} sx={{ color }}>
          {label}
        </Typography>
      )}
    </Stack>
  );
}
