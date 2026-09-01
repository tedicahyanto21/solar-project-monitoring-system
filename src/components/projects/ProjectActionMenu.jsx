import { useState } from 'react';
import { IconButton, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import ArchiveRoundedIcon from '@mui/icons-material/ArchiveRounded';

/**
 * Per-row action menu. `onView` and `onArchive` are placeholder (dummy)
 * actions for this sprint — they surface feedback via the callback but
 * don't build out a detail page or a real archive workflow, which are
 * out of scope for M3.1. `onEdit` and `onDuplicate` are fully functional
 * against local state.
 *
 * Sprint FT-9A Section 8: `canEdit` hides the Edit item for roles other
 * than SUPER_ADMIN/HEAD_PM -- this is a UX convenience, not the
 * enforcement. openEditForm() (ProjectsPage) and the Firestore write path
 * both re-check independently, so this menu item being hidden is never
 * the only thing standing between an unauthorized role and a write.
 */
export default function ProjectActionMenu({ project, onView, onEdit, onDuplicate, onArchive, canEdit }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const open = Boolean(anchorEl);

  function close() {
    setAnchorEl(null);
  }

  function handle(action) {
    close();
    action(project);
  }

  return (
    <>
      <IconButton size="small" onClick={(e) => setAnchorEl(e.currentTarget)} aria-label={`Actions for ${project.projectName}`}>
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchorEl} open={open} onClose={close} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={() => handle(onView)}>
          <ListItemIcon><VisibilityRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>View</ListItemText>
        </MenuItem>
        {canEdit && (
          <MenuItem onClick={() => handle(onEdit)}>
            <ListItemIcon><EditRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Edit</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => handle(onDuplicate)}>
          <ListItemIcon><ContentCopyRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Duplicate</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handle(onArchive)}>
          <ListItemIcon><ArchiveRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Archive</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}
