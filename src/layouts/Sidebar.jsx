import { Box, Drawer, List, ListItemButton, ListItemIcon, ListItemText, Tooltip, IconButton, Typography, Chip } from '@mui/material';
import { NavLink } from 'react-router-dom';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { getNavItemsForRole } from '../constants/nav';
import { layout } from '../theme/tokens';
import ProgressArc from '../components/common/ProgressArc';
import { useAuth } from '../context/AuthContext';

export default function Sidebar({ collapsed, onToggle }) {
  const width = collapsed ? layout.sidebarCollapsed : layout.sidebarExpanded;
  const { profile } = useAuth();
  // Sidebar visibility only -- see constants/nav.js for why this is not a
  // security boundary.
  const navItems = getNavItemsForRole(profile?.role);

  return (
    <Drawer
      variant="permanent"
      sx={{
        width,
        flexShrink: 0,
        transition: (t) => t.transitions.create('width', { duration: 180 }),
        '& .MuiDrawer-paper': {
          width,
          boxSizing: 'border-box',
          overflowX: 'hidden',
          transition: (t) => t.transitions.create('width', { duration: 180 }),
          bgcolor: 'background.paper',
        },
      }}
    >
      {/* Brand */}
      <Box
        sx={{
          height: layout.topbarHeight,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <ProgressArc size={26} strokeWidth={3} progress={0.7} />
        {!collapsed && (
          <Box sx={{ overflow: 'hidden' }}>
            <Typography variant="subtitle2" fontWeight={700} noWrap lineHeight={1.1}>
              SPMS
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
              SOLAR PROJECT OPS
            </Typography>
          </Box>
        )}
      </Box>

      {/* Nav */}
      <List sx={{ py: 1.5, px: 1, flex: 1 }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const button = (
            <ListItemButton
              key={item.path}
              component={item.disabled ? 'div' : NavLink}
              to={item.disabled ? undefined : item.path}
              disabled={item.disabled}
              sx={{
                borderRadius: 1.5,
                mb: 0.5,
                minHeight: 42,
                justifyContent: collapsed ? 'center' : 'flex-start',
                px: collapsed ? 0 : 1.5,
                '&.active': {
                  bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(214,146,46,0.14)' : 'rgba(214,146,46,0.12)'),
                  color: 'primary.main',
                  '& .MuiListItemIcon-root': { color: 'primary.main' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 0, mr: collapsed ? 0 : 1.5, justifyContent: 'center' }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              {!collapsed && (
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{ fontSize: 14, fontWeight: 500 }}
                />
              )}
              {!collapsed && item.disabled && (
                <Chip label="Soon" size="small" sx={{ height: 18, fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }} />
              )}
            </ListItemButton>
          );
          return collapsed ? (
            <Tooltip key={item.path} title={item.label} placement="right">
              <span>{button}</span>
            </Tooltip>
          ) : (
            button
          );
        })}
      </List>

      {/* Collapse toggle */}
      <Box sx={{ p: 1, borderTop: '1px solid', borderColor: 'divider', display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
        <IconButton size="small" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronRightRoundedIcon fontSize="small" /> : <ChevronLeftRoundedIcon fontSize="small" />}
        </IconButton>
      </Box>
    </Drawer>
  );
}
