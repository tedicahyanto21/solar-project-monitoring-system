import { Box, InputBase, Select, MenuItem } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { PROJECT_STATUSES, PROJECT_MANAGERS, REGIONS } from '../../data/mockProjects';

/**
 * Realtime search + Status + PM + Region filter row. Fully controlled —
 * this component holds no state of its own, so the page can derive the
 * filtered list from a single source of truth.
 */
export default function ProjectFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
  pm,
  onPmChange,
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
        {PROJECT_MANAGERS.map((p) => (
          <MenuItem key={p.id} value={p.name}>{p.name}</MenuItem>
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
