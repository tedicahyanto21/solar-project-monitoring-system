import { Box } from '@mui/material';
import KpiCard from './KpiCard';

/**
 * Section 1 — Executive KPI Cards. Purely a responsive layout + map over
 * the given data; each card's rendering lives in KpiCard.
 */
export default function KpiGrid({ items }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: 'repeat(2, 1fr)',
          sm: 'repeat(3, 1fr)',
          lg: 'repeat(6, 1fr)',
        },
      }}
    >
      {items.map((item) => (
        <KpiCard key={item.key} {...item} />
      ))}
    </Box>
  );
}
