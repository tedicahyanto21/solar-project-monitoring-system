import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { Box, Stack, Typography, Paper, Chip, Button, Tabs, Tab } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { getProjectById } from '../../services/repositories/projectRepository';
import { getProjectProgress, getScheduleStatus, recordProgressSnapshot } from '../../services/repositories/progressRepository';
import ProgressArc from '../../components/common/ProgressArc';

import OverviewTab from './detail/OverviewTab';
import TeamTab from './detail/TeamTab';
import WorkStructureTab from './detail/WorkStructureTab';
import ProgressTab from './detail/ProgressTab';
import EngineeringTab from './detail/EngineeringTab';
import HseTab from './detail/HseTab';
import IssuesTab from './detail/IssuesTab';
import ReportsTab from './detail/ReportsTab';

// Tab structure per Sprint FT-4, Part B.3 -- do not add/remove tabs
// without updating the Project Blueprint (SPMS-DOC-05, Section 11) first.
const TABS = ['Overview', 'Team', 'Work Structure', 'Progress', 'Engineering', 'HSE / Permit', 'Issues', 'Reports'];

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(undefined); // undefined = loading, null = not found
  const [progress, setProgress] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [tab, setTab] = useState(0);

  async function loadProgress() {
    const p = await getProjectProgress(projectId);
    setProgress(p);
    if (project) setSchedule(await getScheduleStatus(project));
  }

  useEffect(() => {
    let cancelled = false;
    setTab(0);
    getProjectById(projectId).then(async (data) => {
      if (cancelled || !data) return;
      setProject(data);
      const [p, s] = await Promise.all([getProjectProgress(projectId), getScheduleStatus(data)]);
      if (cancelled) return;
      setProgress(p);
      setSchedule(s);
      // A9: record today's snapshot as soon as we know current progress --
      // safe to call on every visit, since the store de-duplicates by day.
      recordProgressSnapshot(data);
    });
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <Stack spacing={3}>
      <Button component={RouterLink} to="/projects" startIcon={<ArrowBackRoundedIcon />} size="small" sx={{ alignSelf: 'flex-start' }}>
        Back to Project Master
      </Button>

      {project === undefined && <Typography color="text.secondary">Loading project&hellip;</Typography>}

      {project === null && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" fontWeight={700}>Project not found</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            &quot;{projectId}&quot; does not match any project in the current data.
          </Typography>
          <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/projects')}>
            Return to Project Master
          </Button>
        </Paper>
      )}

      {project && (
        <>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <ProgressArc size={40} strokeWidth={4} progress={(progress?.overallProgress ?? project.progress ?? 0) / 100} />
            <Box>
              <Typography variant="h5" fontWeight={700}>{project.projectName}</Typography>
              <Typography variant="body2" color="text.secondary">{project.projectCode} &middot; {project.client}</Typography>
            </Box>
            <Chip label={project.status} size="small" sx={{ ml: { sm: 'auto' } }} />
          </Stack>

          <Paper sx={{ px: 1 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
              {TABS.map((label) => <Tab key={label} label={label} />)}
            </Tabs>
          </Paper>

          <Box>
            {tab === 0 && <OverviewTab project={project} progress={progress} schedule={schedule} />}
            {tab === 1 && <TeamTab projectId={projectId} />}
            {tab === 2 && <WorkStructureTab projectId={projectId} progress={progress} onWeightsChanged={loadProgress} />}
            {tab === 3 && <ProgressTab progress={progress} projectId={projectId} onDataChanged={loadProgress} />}
            {tab === 4 && <EngineeringTab projectId={projectId} onDataChanged={loadProgress} />}
            {tab === 5 && <HseTab projectId={projectId} onDataChanged={loadProgress} />}
            {tab === 6 && <IssuesTab projectId={projectId} />}
            {tab === 7 && <ReportsTab projectId={projectId} />}
          </Box>
        </>
      )}
    </Stack>
  );
}
