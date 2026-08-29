import { Box, Stack, Typography, LinearProgress } from '@mui/material';

const ROWS = [
  { key: 'approved', label: 'Approved', color: 'success.main' },
  { key: 'commented', label: 'Commented', color: 'warning.main' },
  { key: 'rejected', label: 'Rejected', color: 'error.main' },
];

// Portfolio-wide aggregate, computed once by progressRepository.getPortfolioSummary()
// and passed in as `data` -- this component renders only, it does not
// recompute anything (Dashboard architecture rule).
export default function EngineeringStatusCard({ data }) {
  const total = data?.total || 1;
  return (
    <Stack spacing={1.25} sx={{ height: '100%', justifyContent: 'center', width: '100%' }}>
      {ROWS.map((row) => {
        const count = data?.[row.key] ?? 0;
        const pct = Math.round((count / total) * 100);
        return (
          <Box key={row.key} sx={{ width: '100%' }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 0.4, width: '100%' }}>
              <Typography variant="caption" color="text.secondary">{row.label}</Typography>
              <Typography variant="caption" fontWeight={700}>{count}</Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={pct}
              sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: row.color, borderRadius: 3 } }}
            />
          </Box>
        );
      })}
    </Stack>
  );
}
