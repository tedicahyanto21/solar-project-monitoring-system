import { Box, Paper, Typography, Stack } from '@mui/material';

/**
 * Shared dashboard section wrapper. Gives every dashboard panel the same
 * header treatment (title + optional subtitle/action) and body padding,
 * so section components only need to render their own content.
 */
export default function SectionCard({ title, subtitle, action, children, sx, bodySx }) {
  return (
    <Paper
      sx={{
        p: { xs: 2, sm: 2.5 },
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        ...sx,
      }}
    >
      {(title || action) && (
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1.5} sx={{ mb: 1.5 }}>
          <Box>
            {title && (
              <Typography variant="subtitle1" fontWeight={700}>
                {title}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
      )}
      <Box sx={{ flex: 1, minHeight: 0, ...bodySx }}>{children}</Box>
    </Paper>
  );
}
