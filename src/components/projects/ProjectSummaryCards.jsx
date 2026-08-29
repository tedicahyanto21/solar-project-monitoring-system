import { Box, Paper, Typography } from '@mui/material';

/**
 * Five portfolio summary cards, derived entirely from the current
 * `projects` array — no separate state, so counts always match the table.
 */
export default function ProjectSummaryCards({ projects }) {
  const total = projects.length;
  const active = projects.filter((p) => !['Completed', 'On Hold', 'Planning'].includes(p.status)).length;
  const completed = projects.filter((p) => p.status === 'Completed').length;
  const delayed = projects.filter((p) => p.status === 'Delayed').length;
  const planning = projects.filter((p) => p.status === 'Planning').length;

  const items = [
    { label: 'Total Projects', value: total },
    { label: 'Active Projects', value: active },
    { label: 'Completed Projects', value: completed },
    { label: 'Delayed Projects', value: delayed },
    { label: 'Planning Projects', value: planning },
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(5, 1fr)' },
      }}
    >
      {items.map((item) => (
        <Paper key={item.label} sx={{ p: 2 }}>
          <Typography variant="h4" fontWeight={700}>{item.value}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{item.label}</Typography>
        </Paper>
      ))}
    </Box>
  );
}
