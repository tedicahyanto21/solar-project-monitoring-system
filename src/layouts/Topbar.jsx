import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Box,
  Toolbar,
  Typography,
  IconButton,
  InputBase,
  Avatar,
  Menu,
  MenuItem,
  ListItemIcon,
  Divider,
  Tooltip,
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { useThemeMode } from '../context/ThemeModeContext';
import { useAuth } from '../context/AuthContext';
import { layout } from '../theme/tokens';

const PATH_LABELS = {
  dashboard: 'Dashboard',
  projects: 'Project Master',
  'cost-control': 'Project Cost Control',
  users: 'User Management',
};

export default function Topbar() {
  const { mode, toggleMode } = useThemeMode();
  const { profile, user, logout } = useAuth();
  const location = useLocation();
  const [anchorEl, setAnchorEl] = useState(null);

  const segment = location.pathname.split('/').filter(Boolean)[0];
  const label = PATH_LABELS[segment] || 'Dashboard';

  const displayName = profile?.displayName || user?.email?.split('@')[0] || 'Account';
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <Toolbar
      sx={{
        height: layout.topbarHeight,
        minHeight: `${layout.topbarHeight}px !important`,
        px: 3,
        display: 'flex',
        gap: 2,
      }}
    >
      <Box sx={{ flex: '0 0 auto' }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.06em' }}>
          SPMS
        </Typography>
        <Typography variant="subtitle1" fontWeight={600} lineHeight={1.2}>
          {label}
        </Typography>
      </Box>

      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'background.default',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          px: 1.5,
          height: 36,
          maxWidth: 380,
        }}
      >
        <SearchRoundedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <InputBase placeholder="Search projects…" fullWidth sx={{ fontSize: 14 }} />
      </Box>

      <Box sx={{ flex: 1 }} />

      <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        <IconButton onClick={toggleMode} size="small">
          {mode === 'dark' ? <LightModeRoundedIcon fontSize="small" /> : <DarkModeRoundedIcon fontSize="small" />}
        </IconButton>
      </Tooltip>

      <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small" sx={{ p: 0, ml: 0.5 }}>
        <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: 'primary.main', color: '#161A22', fontWeight: 700 }}>
          {initials}
        </Avatar>
      </IconButton>
      <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)} transformOrigin={{ horizontal: 'right', vertical: 'top' }} anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="body2" fontWeight={600}>{displayName}</Typography>
          <Typography variant="caption" color="text.secondary">{user?.email}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={logout}>
          <ListItemIcon><LogoutRoundedIcon fontSize="small" /></ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </Toolbar>
  );
}
