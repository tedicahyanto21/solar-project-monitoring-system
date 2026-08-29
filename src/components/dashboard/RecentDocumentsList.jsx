import { Box, Stack, Typography, Chip } from '@mui/material';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import AssignmentTurnedInRoundedIcon from '@mui/icons-material/AssignmentTurnedInRounded';
import DesignServicesRoundedIcon from '@mui/icons-material/DesignServicesRounded';
import BadgeRoundedIcon from '@mui/icons-material/BadgeRounded';

const TYPE_ICON = {
  'Method Statement': DescriptionRoundedIcon,
  ITP: FactCheckRoundedIcon,
  'Inspection Report': AssignmentTurnedInRoundedIcon,
  'Drawing Revision': DesignServicesRoundedIcon,
  'Permit To Work': BadgeRoundedIcon,
};

/**
 * Section 8 — Recent Documents. Card list with a type icon, title,
 * approval status and relative date.
 */
export default function RecentDocumentsList({ items }) {
  return (
    <Stack spacing={1}>
      {items.map((doc) => {
        const Icon = TYPE_ICON[doc.type] || DescriptionRoundedIcon;
        return (
          <Stack
            key={doc.title}
            direction="row"
            alignItems="center"
            spacing={1.5}
            sx={{
              p: 1.25,
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Box
              sx={{
                width: 34,
                height: 34,
                borderRadius: 1.25,
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(231,233,238,0.06)' : 'rgba(14,17,22,0.04)'),
                color: 'text.secondary',
              }}
            >
              <Icon fontSize="small" />
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" fontWeight={600} noWrap>{doc.title}</Typography>
              <Typography variant="caption" color="text.secondary">{doc.type} · {doc.date}</Typography>
            </Box>
            <Chip
              size="small"
              label={doc.status}
              color="success"
              variant="outlined"
              sx={{ fontWeight: 700, fontSize: 11, flexShrink: 0 }}
            />
          </Stack>
        );
      })}
    </Stack>
  );
}
