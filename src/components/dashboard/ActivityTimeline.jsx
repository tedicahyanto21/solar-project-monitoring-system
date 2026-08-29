import { Box, Stack, Typography } from '@mui/material';

/**
 * Section 7 — Today's Activities. Lightweight vertical timeline built
 * from Box/Stack (no extra timeline library) — a dot-and-line rail with
 * time, title and site for each entry.
 */
export default function ActivityTimeline({ items }) {
  return (
    <Stack spacing={0}>
      {items.map((item, i) => (
        <Stack key={`${item.time}-${item.title}`} direction="row" spacing={2}>
          <Box sx={{ width: 52, flexShrink: 0, textAlign: 'right', pt: 0.25 }}>
            <Typography variant="caption" fontWeight={700} sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {item.time}
            </Typography>
          </Box>

          <Stack alignItems="center" sx={{ width: 16, flexShrink: 0 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                mt: 0.5,
                flexShrink: 0,
              }}
            />
            {i < items.length - 1 && (
              <Box sx={{ flex: 1, width: '1px', bgcolor: 'divider', minHeight: 28, my: 0.5 }} />
            )}
          </Stack>

          <Box sx={{ pb: i < items.length - 1 ? 2.5 : 0, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} noWrap>{item.title}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{item.site}</Typography>
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}
