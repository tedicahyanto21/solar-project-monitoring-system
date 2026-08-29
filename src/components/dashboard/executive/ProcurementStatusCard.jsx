import { Box, Stack, Typography } from '@mui/material';
import CircularStat from '../CircularStat';

export default function ProcurementStatusCard({ value }) {
  return (
    <Stack spacing={1} sx={{ alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <CircularStat size={92} strokeWidth={8} value={Math.round(value ?? 0)} />
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="caption" color="text.secondary">Portfolio-average procurement progress</Typography>
      </Box>
    </Stack>
  );
}
