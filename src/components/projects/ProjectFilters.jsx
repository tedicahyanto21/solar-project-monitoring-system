import { Box, InputBase, Select, MenuItem } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { PROJECT_STATUSES, REGIONS } from '../../data/mockProjects';

/**
 * Realtime search + Status + PM + Region filter row. Fully controlled —
 * this component holds no state of its own, so the page can derive the
 * filtered list from a single source of truth.
 *
 * FT-9A-01: the Project Manager filter options come from `pmOptions`
 * (distinct PM names already present in the loaded, real project list --
 * see ProjectsPage.jsx), not from the hardcoded mock PROJECT_MANAGERS list.
 * This keeps the filter consistent with whatever PMs actually have
 * projects, whether that data came from mock or Firestore, without this
 * component fetching users itself (avoiding a second/duplicate query).
 */
export default function ProjectFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
  pm,
  onPmChange,
  pmOptions,
  region,
  onRegionChange,
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1.5,
        alignItems: 'center',
      }}
    >
      <Box
        sx={{
          flex: '1 1 240px',
          minWidth: 200,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: 'background.default',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          px: 1.5,
          height: 40,
        }}
      >
        <SearchRoundedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <InputBase
          placeholder="Search by name, code, client or PM…"
          fullWidth
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          sx={{ fontSize: 14 }}
        />
      </Box>

      <Select
        size="small"
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        displayEmpty
        sx={{ minWidth: 150, height: 40 }}
      >
        <MenuItem value="all">All Statuses</MenuItem>
        {PROJECT_STATUSES.map((s) => (
          <MenuItem key={s} value={s}>{s}</MenuItem>
        ))}
      </Select>

      <Select
        size="small"
        value={pm}
        onChange={(e) => onPmChange(e.target.value)}
        displayEmpty
        sx={{ minWidth: 170, height: 40 }}
      >
        <MenuItem value="all">All Project Managers</MenuItem>
        {pmOptions.map((name) => (
          <MenuItem key={name} value={name}>{name}</MenuItem>
        ))}
      </Select>

      <Select
        size="small"
        value={region}
        onChange={(e) => onRegionChange(e.target.value)}
        displayEmpty
        sx={{ minWidth: 170, height: 40 }}
      >
        <MenuItem value="all">All Regions</MenuItem>
        {REGIONS.map((r) => (
          <MenuItem key={r} value={r}>{r}</MenuItem>
        ))}
      </Select>
    </Box>
  );
}
