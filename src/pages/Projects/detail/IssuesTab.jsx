import { useEffect, useState } from 'react';
import {
  Box, Stack, Typography, Paper, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, MenuItem,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { getIssues, createIssue, updateIssueRecord, closeIssueRecord, reopenIssueRecord } from '../../../services/repositories/issueRepository';
import { getUsers } from '../../../services/repositories/userRepository';
import { ISSUE_SEVERITIES } from '../../../data/mockOperationalData';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

// FT-6 A2: Create/Edit/Close/Reopen authority.
const CAN_MANAGE_ISSUES = [ROLES.PROJECT_MANAGER, ROLES.SITE_MANAGER, ROLES.SUPER_ADMIN];
const EMPTY = { title: '', description: '', category: 'Construction', priority: 'Medium', responsibleUserId: '' };
const PRIORITY_COLOR = { Critical: 'error', High: 'warning', Medium: 'default', Low: 'success' };

function formatDate(iso) {
  return iso || '\u2014';
}

export default function IssuesTab({ projectId }) {
  const { profile } = useAuth();
  const canManage = CAN_MANAGE_ISSUES.includes(profile?.role);
  const [issues, setIssues] = useState([]);
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY);

  function load() {
    getIssues(projectId).then(setIssues);
  }
  useEffect(() => {
    load();
    getUsers().then(setUsers);
  }, [projectId]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY);
    setOpen(true);
  }

  // FT-6 A3: Edit Issue -- authorized roles can edit an existing issue's
  // details (not just create/close).
  function openEdit(issue) {
    setEditingId(issue.issueId);
    setForm({
      title: issue.title,
      description: issue.description,
      category: issue.category,
      priority: issue.priority,
      responsibleUserId: issue.responsibleUserId || '',
    });
    setOpen(true);
  }

  async function handleSubmit() {
    if (!form.title.trim()) return;
    const responsibleUser = users.find((u) => u.userId === form.responsibleUserId);
    const payload = {
      ...form,
      responsibleUserId: responsibleUser?.userId || null,
      responsibleUserName: responsibleUser?.name || '',
    };
    if (editingId) {
      await updateIssueRecord(projectId, editingId, payload);
    } else {
      await createIssue(projectId, { ...payload, createdBy: profile?.displayName ?? profile?.name ?? 'Unknown' });
    }
    setOpen(false);
    setForm(EMPTY);
    setEditingId(null);
    load();
  }

  async function handleClose(issueId) {
    await closeIssueRecord(projectId, issueId, profile?.displayName ?? profile?.name);
    load();
  }

  // FT-6 A2/A4/A5: Reopen -- status back to OPEN, closedAt/closedBy cleared,
  // openedAt/createdAt untouched (validated in mockOperationalData.reopenIssue).
  async function handleReopen(issueId) {
    await reopenIssueRecord(projectId, issueId);
    load();
  }

  const openIssues = issues.filter((i) => i.status === 'OPEN');
  const closedIssues = issues.filter((i) => i.status === 'CLOSED');

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {openIssues.length} open &middot; {closedIssues.length} closed
        </Typography>
        {canManage && (
          <Button size="small" startIcon={<AddRoundedIcon />} onClick={openCreate}>
            New Issue
          </Button>
        )}
      </Stack>

      {[...openIssues, ...closedIssues].map((issue) => (
        <Paper key={issue.issueId} sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2" fontWeight={700}>{issue.title}</Typography>
                <Chip size="small" label={issue.status} color={issue.status === 'OPEN' ? 'error' : 'success'} variant="outlined" />
                <Chip size="small" label={issue.priority} color={PRIORITY_COLOR[issue.priority]} variant="outlined" />
                <Chip size="small" label={issue.category} variant="outlined" />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{issue.description}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                Opened {formatDate(issue.openedAt)} by {issue.createdBy}
                {issue.closedAt ? ` \u00b7 Closed ${formatDate(issue.closedAt)} by ${issue.closedBy || '\u2014'}` : ''}
                {' '}&middot; Responsible: {issue.responsibleUserName || '\u2014'}
              </Typography>
            </Box>
            {canManage && (
              <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
                <Button size="small" onClick={() => openEdit(issue)}>Edit</Button>
                {issue.status === 'OPEN' ? (
                  <Button size="small" variant="outlined" onClick={() => handleClose(issue.issueId)}>Close</Button>
                ) : (
                  <Button size="small" variant="outlined" onClick={() => handleReopen(issue.issueId)}>Reopen</Button>
                )}
              </Stack>
            )}
          </Stack>
        </Paper>
      ))}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{editingId ? 'Edit Issue' : 'New Issue'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} fullWidth />
            <TextField label="Description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} fullWidth multiline minRows={2} />
            <Stack direction="row" spacing={2}>
              <TextField label="Category" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} fullWidth />
              <TextField select label="Priority" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} fullWidth>
                {ISSUE_SEVERITIES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
              </TextField>
            </Stack>
            <TextField select label="Responsible Person" value={form.responsibleUserId} onChange={(e) => setForm((f) => ({ ...f, responsibleUserId: e.target.value }))} fullWidth>
              {users.filter((u) => u.status === 'ACTIVE').map((u) => <MenuItem key={u.userId} value={u.userId}>{u.name}</MenuItem>)}
            </TextField>
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
