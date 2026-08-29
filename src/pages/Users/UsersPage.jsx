import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Paper, Table, TableHead, TableRow, TableCell, TableBody, Chip,
  Button, Dialog, DialogTitle, DialogContent, DialogActions, TextField, MenuItem, Alert,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { getUsers, createUser, updateUser, setUserStatus } from '../../services/repositories/userRepository';
import { ROLE_LABELS, ALL_ROLES } from '../../constants/roles';
import { useAuth } from '../../context/AuthContext';
import { ROLES } from '../../constants/roles';

// FT-7 A1: User CRUD authority is SUPER_ADMIN only.
const CAN_MANAGE_USERS = [ROLES.SUPER_ADMIN];
const EMPTY = { name: '', email: '', role: ROLES.SITE_MANAGER, department: '' };

export default function UsersPage() {
  const { profile } = useAuth();
  const canManage = CAN_MANAGE_USERS.includes(profile?.role);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');

  function load() {
    getUsers().then(setUsers);
  }
  useEffect(load, []);

  function openCreate() {
    if (!canManage) return; // defense in depth, not just a hidden button
    setEditingId(null);
    setForm(EMPTY);
    setError('');
    setOpen(true);
  }

  function openEdit(user) {
    if (!canManage) return;
    setEditingId(user.userId);
    setForm({ name: user.name, email: user.email, role: user.role, department: user.department || '' });
    setError('');
    setOpen(true);
  }

  async function handleSubmit() {
    if (!canManage) return;
    if (!form.name.trim() || !form.email.trim()) return;
    setError('');
    try {
      if (editingId) {
        await updateUser(editingId, form);
      } else {
        await createUser(form);
      }
      setOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleToggleStatus(user) {
    if (!canManage) return;
    await setUserStatus(user.userId, user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE');
    load();
  }

  return (
    <Stack spacing={3}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>User Management</Typography>
          <Typography variant="body2" color="text.secondary">
            User accounts, roles, and access configuration
          </Typography>
        </Box>
        {canManage && (
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreate}>
            New User
          </Button>
        )}
      </Stack>

      <Paper sx={{ p: { xs: 2, sm: 2.5 }, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Department</TableCell>
              <TableCell>Status</TableCell>
              {canManage && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.userId}>
                <TableCell>{u.name}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>{ROLE_LABELS[u.role] ?? u.role}</TableCell>
                <TableCell>{u.department || '\u2014'}</TableCell>
                <TableCell>
                  <Chip label={u.status} color={u.status === 'ACTIVE' ? 'success' : 'default'} size="small" />
                </TableCell>
                {canManage && (
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" onClick={() => openEdit(u)}>Edit</Button>
                      <Button size="small" color={u.status === 'ACTIVE' ? 'error' : 'success'} onClick={() => handleToggleStatus(u)}>
                        {u.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                      </Button>
                    </Stack>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="caption" color="text.secondary">
        Only Super Admin may create, edit, or activate/deactivate users (Firestore Security
        Design SPMS-DOC-07, Section 11). Deactivating never deletes a user -- INACTIVE users
        cannot access the application or be assigned to new project roles (Sprint FT-7 A2/Part C).
      </Typography>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{editingId ? 'Edit User' : 'New User'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} fullWidth />
            <TextField label="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} fullWidth disabled={!!editingId} helperText={editingId ? 'Email cannot be changed once created.' : ''} />
            <TextField select label="Role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} fullWidth>
              {ALL_ROLES.map((r) => <MenuItem key={r} value={r}>{ROLE_LABELS[r]}</MenuItem>)}
            </TextField>
            <TextField label="Department" value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit}>{editingId ? 'Save Changes' : 'Create'}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
