import { Box, Typography, Paper } from '@mui/material';

export default function SettingsPage() {
  return (
    <Box
      sx={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Paper sx={{ p: 6, textAlign: 'center' }}>
        <Typography variant="h5" fontWeight={700}>
          Settings Coming Soon
        </Typography>
      </Paper>
    </Box>
  );
}
