import { Chip } from '@mui/material';

// Maps project health to the theme's semantic colors — success (green),
// warning (amber), error (red) — the only three status colors allowed.
const HEALTH_MAP = {
  green: { label: 'On Track', color: 'success' },
  yellow: { label: 'At Risk', color: 'warning' },
  red: { label: 'Delayed', color: 'error' },
};

/**
 * Reusable status pill for project health. Pass `health` as 'green' |
 * 'yellow' | 'red'; optionally override the label (e.g. with the
 * project's own status string) while keeping the semantic color.
 */
export default function StatusBadge({ health = 'green', label }) {
  const { label: defaultLabel, color } = HEALTH_MAP[health] || HEALTH_MAP.green;

  return (
    <Chip
      size="small"
      label={label || defaultLabel}
      color={color}
      variant="outlined"
      sx={{
        fontWeight: 700,
        fontSize: 12,
        borderRadius: 1.5,
        bgcolor: (t) => (t.palette.mode === 'dark' ? `${t.palette[color].main}1F` : `${t.palette[color].main}14`),
      }}
    />
  );
}
