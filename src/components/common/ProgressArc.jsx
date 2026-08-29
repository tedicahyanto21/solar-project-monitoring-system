import { useId } from 'react';
import { Box, useTheme } from '@mui/material';

/**
 * Shared brand mark / progress indicator: a circular arc drawn from
 * 12 o'clock, representing a generic 0..1 progress fraction.
 * Used as: brand mark (sidebar/login), and as a loading spinner when
 * `spin` is set. Reusable across any feature that needs a progress ring
 * (e.g. project completion, milestone status).
 */
export default function ProgressArc({
  size = 28,
  strokeWidth = 3,
  progress = 0.7,
  spin = false,
  trackColor,
  arcColor,
}) {
  const theme = useTheme();
  const id = useId();
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const dash = circumference * progress;

  const track = trackColor || (theme.palette.mode === 'dark' ? 'rgba(231,233,238,0.12)' : theme.palette.divider);
  const arc = arcColor || theme.palette.primary.main;

  return (
    <Box
      component="svg"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      sx={{
        display: 'block',
        transform: 'rotate(-90deg)',
        animation: spin ? 'spms-arc-spin 1s linear infinite' : 'none',
        '@keyframes spms-arc-spin': {
          from: { transform: 'rotate(-90deg)' },
          to: { transform: 'rotate(270deg)' },
        },
      }}
      aria-hidden={!spin}
      role={spin ? 'status' : 'img'}
    >
      <circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={strokeWidth} />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={arc}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference - dash}`}
      />
      <defs>
        <clipPath id={id}>
          <circle cx={c} cy={c} r={r} />
        </clipPath>
      </defs>
    </Box>
  );
}
