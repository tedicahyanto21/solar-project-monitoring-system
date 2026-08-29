import { useEffect, useState } from 'react';
import { Box, Stack, Typography, Paper, Avatar, TextField, Button, MenuItem, Alert } from '@mui/material';
import { getAssignments, assignUser } from '../../../services/repositories/projectDetailRepository';
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

function initialsOf(name) {
  return (name || '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export default function TeamTab({ projectId }) {
  const { profile } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});

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
      const updated = await assignUser(projectId, role, { userId: user.userId, name: user.name }, profile?.userId ?? profile?.uid ?? profile?.id);
      setAssignments(updated);
      setDraft((d) => ({ ...d, [role]: '' }));
    } catch (err) {
      setErrors((e) => ({ ...e, [role]: err.message }));
    }
  }

  return (
    <Stack spacing={2}>
      {assignments.map((a) => {
        const canAssign = (ASSIGNABLE_BY[a.role] || []).includes(profile?.role);
        const eligible = eligibleUsersFor(a.role);
        return (
          <Paper key={a.role} sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Avatar sx={{ bgcolor: 'divider', color: 'text.secondary' }}>{initialsOf(a.name)}</Avatar>
              <Box sx={{ minWidth: 160 }}>
                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11 }}>
                  {ROLE_LABELS[a.role] ?? a.role}
                </Typography>
                <Typography variant="body2" fontWeight={600}>{a.name}</Typography>
              </Box>

              {canAssign && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', ml: 'auto' }}>
                  <TextField
                    select
                    size="small"
                    label="Reassign to"
                    value={draft[a.role] || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [a.role]: e.target.value }))}
                    sx={{ minWidth: 220 }}
                    helperText={eligible.length === 0 ? `No ACTIVE ${ROLE_LABELS[a.role] ?? a.role} users available` : ' '}
                  >
                    {eligible.map((u) => (
                      <MenuItem key={u.userId} value={u.userId}>{u.name}</MenuItem>
                    ))}
                  </TextField>
                  <Button size="small" variant="outlined" onClick={() => handleAssign(a.role)} disabled={!draft[a.role]}>
                    Assign
                  </Button>
                </Stack>
              )}
            </Stack>
            {errors[a.role] && <Alert severity="error" sx={{ py: 0 }}>{errors[a.role]}</Alert>}
          </Paper>
        );
      })}
      <Typography variant="caption" color="text.secondary">
        Only ACTIVE users holding the matching role can be assigned (Sprint FT-7 Part C) --
        enforced both in this picker and independently at the repository layer. Assignment
        authority: Head PM assigns Project Manager; Project Manager assigns Site Manager,
        Engineering, and HSE; Super Admin can override any assignment. Data is compatible with
        projects/&#123;projectId&#125;/assignments/&#123;userId&#125; (Database Design SPMS-DOC-06, Section 6).
      </Typography>
    </Stack>
  );
}
