import { Box, Stack, Typography } from '@mui/material';

const SEVERITY_COLOR = { Critical: 'error.main', High: 'warning.main', Medium: 'text.secondary', Low: 'success.main' };

export default function SiteIssuesCard({ data }) {
  return (
    <Stack spacing={1.5} sx={{ height: '100%' }}>
      <Stack direction="row" spacing={3}>
        <Box>
          <Typography variant="h4" fontWeight={700} color="error.main">{data?.open ?? 0}</Typography>
          <Typography variant="caption" color="text.secondary">Open</Typography>
        </Box>
        <Box>
          <Typography variant="h4" fontWeight={700} color="success.main">{data?.closed ?? 0}</Typography>
          <Typography variant="caption" color="text.secondary">Closed</Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
        {(data?.byPriority ?? []).map((s) => (
          <Stack key={s.priority} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SEVERITY_COLOR[s.priority] }} />
            <Typography variant="caption" color="text.secondary">{s.priority} ({s.count})</Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
