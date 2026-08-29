import { Stack, Typography } from '@mui/material';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';

/**
 * Small inline trend chip: an arrow + value, colored by whether the
 * movement is favorable (`good`) rather than by direction alone — e.g. a
 * drop in open issues is a favorable "down" trend.
 */
export default function TrendIndicator({ direction = 'flat', value, good = true, size = 'small' }) {
  const Icon = direction === 'up' ? ArrowUpwardRoundedIcon : direction === 'down' ? ArrowDownwardRoundedIcon : RemoveRoundedIcon;
  const color = direction === 'flat' ? 'text.secondary' : good ? 'success.main' : 'error.main';
  const fontSize = size === 'small' ? 12 : 13;

  return (
    <Stack direction="row" alignItems="center" spacing={0.25} sx={{ color }}>
      <Icon sx={{ fontSize: fontSize + 4 }} />
      <Typography variant="caption" fontWeight={700} sx={{ fontSize, color: 'inherit' }}>
        {value}
      </Typography>
    </Stack>
  );
}
