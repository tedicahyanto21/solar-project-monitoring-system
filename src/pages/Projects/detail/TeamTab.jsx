import { useEffect, useState } from 'react';
import { Stack, Typography, Paper, Avatar, TextField, Button, MenuItem, Alert, IconButton, Tooltip } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { getAssignments, assignUser, removeAssignment } from '../../../services/repositories/projectDetailRepository';
import { getUsers } from '../../../services/repositories/userRepository';
import { useAuth } from '../../../context/AuthContext';
import { ROLES, ROLE_LABELS } from '../../../constants/roles';

// Assignment authority (Sprint FT-4, Part B.5):
//   HEAD_PM         -> may assign PROJECT_MANAGER
//   PROJECT_MANAGER -> may assign SITE_MANAGER / ENGINEERING / HSE
//   SUPER_ADMIN     -> may assign any of the above
const ASSIGNABLE_BY = {
  [ROLES.PROJECT_MANAGER]: [ROLES.HEAD_PM, ROLES.SUPER_ADMIN],
  [ROLES.SITE_MANAGER]: [ROLES.PROJECT_MANAGER, ROLES.SUPER_ADMIN],
  [ROLES.ENGINEERING]: [ROLES.PROJECT_MANAGER, ROLES.SUPER_ADMIN],
  [ROLES.HSE]: [ROLES.PROJECT_MANAGER, ROLES.SUPER_ADMIN],
};

// C-01A: PROJECT_MANAGER remains exactly one holder per project (via
// setProjectManager, unchanged). SITE_MANAGER/ENGINEERING/HSE now support
// multiple simultaneous holders -- this list controls which roles render
// as a single-slot "Reassign to" control versus a multi-holder list with
// an "Add" affordance.
const MULTI_HOLDER_ROLES = [ROLES.SITE_MANAGER, ROLES.ENGINEERING, ROLES.HSE];
const ROLE_ORDER = [ROLES.PROJECT_MANAGER, ROLES.SITE_MANAGER, ROLES.ENGINEERING, ROLES.HSE];

function initialsOf(name) {
  return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function TeamTab({ projectId }) {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});

  function load() {
    getAssignments(projectId).then(setAssignments);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getAssignments(projectId), getUsers()]).then(([a, u]) => {
      if (cancelled) return;
      setAssignments(a);
      setUsers(u);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  // FT-7 Part C: the picker only ever OFFERS eligible users (ACTIVE, correct
  // role) -- but this is a UX convenience, not the enforcement. The real
  // check happens in projectDetailRepository.assignUser, which validates
  // independently and would reject an ineligible userId even if it somehow
  // reached this function another way.
  function eligibleUsersFor(role) {
    return users.filter((u) => u.role === role && u.status === 'ACTIVE');
  }

  async function handleAssign(role) {
    const userId = draft[role];
    if (!userId) return;
    const user = users.find((u) => u.userId === userId);
    if (!user) return;
    setErrors((e) => ({ ...e, [role]: null }));
    try {
      // FT-4.1 Correction 2: the stored/assigned value is userId, not name.
      // Name is looked up only for the denormalized display copy.
      await assignUser(projectId, role, { userId: user.userId, name: user.name }, profile?.userId ?? profile?.uid ?? profile?.id);
      load();
      setDraft((d) => ({ ...d, [role]: '' }));
    } catch (err) {
      setErrors((e) => ({ ...e, [role]: err.message }));
    }
  }

  // C-01A: the counterpart to the additive assignUser above -- removes one
  // specific holder from a multi-holder role. Never offered for
  // PROJECT_MANAGER (always exactly one; reassigning replaces, never
  // removes to zero).
  async function handleRemove(role, userId) {
    setErrors((e) => ({ ...e, [role]: null }));
    try {
      await removeAssignment(projectId, role, userId);
      load();
    } catch (err) {
      setErrors((e) => ({ ...e, [role]: err.message }));
    }
  }

  const grouped = ROLE_ORDER.map((role) => ({
    role,
    holders: assignments.filter((a) => a.role === role),
  }));

  return (
    <Stack spacing={2}>
      {grouped.map(({ role, holders }) => {
        const canAssign = (ASSIGNABLE_BY[role] || []).includes(profile?.role);
        const eligible = eligibleUsersFor(role);
        const isMultiHolder = MULTI_HOLDER_ROLES.includes(role);
        return (
          <Paper key={role} sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>
              {ROLE_LABELS[role] ?? role}
            </Typography>

            {holders.length === 0 && (
              <Typography variant="body2" color="text.secondary">No one currently holds this role.</Typography>
            )}
            {holders.map((a) => (
              <Stack key={a.userId} direction="row" sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Avatar sx={{ bgcolor: 'divider', color: 'text.secondary' }}>{initialsOf(a.name)}</Avatar>
                <Typography variant="body2" fontWeight={600} sx={{ minWidth: 160 }}>{a.name}</Typography>
                {canAssign && isMultiHolder && holders.length > 1 && (
                  <Tooltip title={`Remove ${a.name} from ${ROLE_LABELS[role] ?? role}`}>
                    <IconButton size="small" sx={{ ml: 'auto' }} onClick={() => handleRemove(role, a.userId)}>
                      <CloseRoundedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            ))}

            {canAssign && (
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  select
                  size="small"
                  label={isMultiHolder ? 'Add' : 'Reassign to'}
                  value={draft[role] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [role]: e.target.value }))}
                  sx={{ minWidth: 220 }}
                  helperText={eligible.length === 0 ? `No ACTIVE ${ROLE_LABELS[role] ?? role} users available` : ' '}
                >
                  {eligible.map((u) => (
                    <MenuItem key={u.userId} value={u.userId}>{u.name}</MenuItem>
                  ))}
                </TextField>
                <Button size="small" variant="outlined" onClick={() => handleAssign(role)} disabled={!draft[role]}>
                  {isMultiHolder ? 'Add' : 'Assign'}
                </Button>
              </Stack>
            )}
            {errors[role] && <Alert severity="error" sx={{ py: 0 }}>{errors[role]}</Alert>}
          </Paper>
        );
      })}
      <Typography variant="caption" color="text.secondary">
        Only ACTIVE users holding the matching role can be assigned (Sprint FT-7 Part C) --
        enforced both in this picker and independently at the repository layer. Project Manager
        remains exactly one person per project; Site Manager, Engineering, and HSE support
        multiple people per project (C-01A). Assignment authority: Head PM assigns Project
        Manager; Project Manager assigns Site Manager, Engineering, and HSE; Super Admin can
        override any assignment. Data is compatible with
        projects/&#123;projectId&#125;/projectAssignments/&#123;userId&#125; (Database Design SPMS-DOC-06, Section 6).
      </Typography>
    </Stack>
  );
}
