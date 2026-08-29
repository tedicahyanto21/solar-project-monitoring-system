import { Box, Typography, Button } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import ProgressArc from '../../components/common/ProgressArc';

export default function NotFoundPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        textAlign: 'center',
        px: 3,
      }}
    >
      <ProgressArc size={48} strokeWidth={3.5} progress={0} />
      <Typography variant="h4" fontWeight={700}>
        404
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 380 }}>
        The page you're looking for doesn't exist or has been moved.
      </Typography>
      <Button component={RouterLink} to="/dashboard" variant="contained" sx={{ mt: 1 }}>
        Back to Dashboard
      </Button>
    </Box>
  );
}
