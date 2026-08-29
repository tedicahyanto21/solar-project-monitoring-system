import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  InputAdornment,
  IconButton,
  Alert,
  Stack,
} from '@mui/material';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import { useAuth } from '../../context/AuthContext';
import { emailPattern } from '../../utils/validators';
import ProgressArc from '../../components/common/ProgressArc';
import { color } from '../../theme/tokens';

export default function LoginPage() {
  const { login, isAuthenticated, error: authError } = useAuth();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { email: '', password: '' }, mode: 'onBlur' });

  if (isAuthenticated) {
    const redirectTo = location.state?.from?.pathname || '/dashboard';
    return <Navigate to={redirectTo} replace />;
  }

  async function onSubmit(values) {
    setSubmitError(null);
    const result = await login(values.email, values.password);
    if (!result.success) setSubmitError(result.message);
    // Part C/H: a valid Firebase sign-in can still be rejected moments
    // later once the SPMS profile is checked (missing or INACTIVE) --
    // that surfaces asynchronously via the context's `error`, not via this
    // function's own return value. `authError` below (rendered alongside
    // submitError) is what displays that case to the person signing in.
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Brand panel — hidden on small screens */}
      <Box
        sx={{
          flex: 1,
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
          p: 6,
          color: color.inkOnDark,
          background: `radial-gradient(120% 140% at 15% 15%, ${color.amber500}22 0%, transparent 55%), linear-gradient(160deg, ${color.graphite950} 0%, ${color.graphite900} 60%, ${color.graphite800} 100%)`,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <ProgressArc size={32} strokeWidth={3.5} progress={0.7} />
          <Typography variant="subtitle1" fontWeight={700} letterSpacing="-0.01em">
            SPMS
          </Typography>
        </Stack>

        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <Box sx={{ mb: 4 }}>
            <BigArc />
          </Box>
          <Typography variant="h3" fontWeight={700} sx={{ maxWidth: 440, letterSpacing: '-0.01em' }}>
            Track every solar project from mobilization to commissioning.
          </Typography>
          <Typography variant="body1" sx={{ mt: 2, maxWidth: 420, color: color.inkOnDarkMuted }}>
            One shared view for Project Execution teams to monitor milestones,
            site progress, and status across every Solar EPC project.
          </Typography>
        </Box>

        <Typography variant="caption" sx={{ fontFamily: 'JetBrains Mono, monospace', color: color.inkOnDarkMuted, letterSpacing: '0.06em' }}>
          SOLAR PROJECT MONITORING SYSTEM
        </Typography>
      </Box>

      {/* Form panel */}
      <Box
        sx={{
          flex: { xs: 1, md: '0 0 480px' },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          px: 4,
          bgcolor: 'background.default',
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: '100%',
            maxWidth: 360,
            p: { xs: 3, sm: 0 },
            border: 'none',
            bgcolor: 'transparent',
          }}
        >
          <Box sx={{ display: { xs: 'flex', md: 'none' }, alignItems: 'center', gap: 1.5, mb: 4 }}>
            <ProgressArc size={28} strokeWidth={3} progress={0.7} />
            <Typography variant="subtitle1" fontWeight={700}>SPMS</Typography>
          </Box>

          <Typography variant="h4" fontWeight={700} sx={{ mb: 0.5 }}>
            Sign in
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            Use your company account to access project monitoring.
          </Typography>

          {(submitError || authError) && (
            <Alert severity="error" sx={{ mb: 2.5 }}>
              {submitError || authError}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <Stack spacing={2.5}>
              <TextField
                label="Work email"
                type="email"
                fullWidth
                autoComplete="email"
                error={!!errors.email}
                helperText={errors.email?.message}
                {...register('email', {
                  required: 'Email is required',
                  pattern: emailPattern,
                })}
              />
              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                fullWidth
                autoComplete="current-password"
                error={!!errors.password}
                helperText={errors.password?.message}
                {...register('password', { required: 'Password is required' })}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowPassword((s) => !s)} edge="end" size="small" tabIndex={-1}>
                        {showPassword ? <VisibilityOffRoundedIcon fontSize="small" /> : <VisibilityRoundedIcon fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={isSubmitting}
                sx={{ py: 1.2, fontWeight: 700 }}
              >
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 4 }}>
            Access is provisioned by your Project Execution admin. Contact IT if
            you don't have an account yet.
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}

// Large decorative progress-arc dial for the brand panel — several
// concentric arcs at different fractions, evoking a bank of monitored
// project sites.
function BigArc() {
  const arcs = [0.85, 0.62, 0.4];
  return (
    <Box sx={{ position: 'relative', width: 220, height: 220 }}>
      {arcs.map((p, i) => (
        <Box key={i} sx={{ position: 'absolute', inset: i * 28 }}>
          <ProgressArc
            size={220 - i * 56}
            strokeWidth={4}
            progress={p}
            trackColor="rgba(231,233,238,0.08)"
            arcColor={i === 0 ? color.amber500 : i === 1 ? color.teal400 : color.amber100}
          />
        </Box>
      ))}
    </Box>
  );
}
