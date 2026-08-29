import { Box, Typography, useMediaQuery, useTheme } from '@mui/material';
import ProjectTable from './ProjectTable';
import ProjectCardList from './ProjectCardList';

/**
 * Single entry point the page uses to render the project list — decides
 * table vs. card layout so ProjectsPage doesn't need to know about
 * breakpoints at all.
 */
export default function ProjectListView({ projects, onView, onEdit, onDuplicate, onArchive }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  if (projects.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No projects match your search and filters.
        </Typography>
      </Box>
    );
  }

  const props = { projects, onView, onEdit, onDuplicate, onArchive };

  return isMobile ? <ProjectCardList {...props} /> : <ProjectTable {...props} />;
}
