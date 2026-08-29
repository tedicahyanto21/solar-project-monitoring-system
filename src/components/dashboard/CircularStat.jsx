import { Box, Typography } from '@mui/material';
import ProgressArc from '../common/ProgressArc';

/**
 * Large circular progress/score gauge with a centered value + caption.
 * Built on the app's existing ProgressArc brand primitive, so every gauge
 * in the app (dashboard, health score, future modules) shares one visual
 * language instead of introducing a second chart style.
 */
export default function CircularStat({ size = 180, strokeWidth = 14, value, caption, arcColor, valueSuffix = '%' }) {
  return (
    <Box sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}>
      <ProgressArc size={size} strokeWidth={strokeWidth} progress={Math.min(Math.max(value, 0), 100) / 100} arcColor={arcColor} />
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="h3" fontWeight={700} lineHeight={1}>
          {value}
          <Typography component="span" variant="h5" fontWeight={700} color="text.secondary">
            {valueSuffix}
          </Typography>
        </Typography>
        {caption && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {caption}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
