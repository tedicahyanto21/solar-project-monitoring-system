import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { Box, Stack, Typography, Paper, Chip, Button, Tabs, Tab } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { getPortfolioCostSummary, getProjectCostSummary } from '../../services/repositories/costRepository';
import { getProjectById } from '../../services/repositories/projectRepository';
import CostOverviewTab from './detail/CostOverviewTab';
import PaymentProjectionTab from './detail/PaymentProjectionTab';
import CostLedgerTab from './detail/CostLedgerTab';

// Project Cost Control (Project Blueprint SPMS-DOC-05, Section 13; Sprint
// FT-5 Part B). List view when no :projectId, detail view (with tabs) when
// a project is selected -- same pattern as Project Master.
function CostControlList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);

  useEffect(() => {
    let cancelled = false;
    getPortfolioCostSummary().then((data) => { if (!cancelled) setRows(data); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" fontWeight={700}>Project Cost Control</Typography>
        <Typography variant="body2" color="text.secondary">Planned vs. Actual Cost across the portfolio</Typography>
      </Box>
      <Paper sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { textAlign: 'left', p: 1.5, borderBottom: '1px solid', borderColor: 'divider', fontSize: 14 }, '& th': { color: 'text.secondary', fontSize: 12, textTransform: 'uppercase' }, '& tbody tr': { cursor: 'pointer' }, '& tbody tr:hover': { bgcolor: 'action.hover' } }}>
          <thead>
            <tr><th>Project Code</th><th>Project Name</th><th>Planned Cost</th><th>Actual Cost</th><th>Budget Variance</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map(({ project, summary }) => (
              <tr key={project.id} onClick={() => navigate(`/cost-control/${project.id}`)}>
                <td style={{ fontFamily: 'JetBrains Mono, monospace' }}>{project.projectCode}</td>
                <td>{project.projectName}</td>
                <td>{summary.currency} {summary.plannedCost.toLocaleString()}</td>
                <td>{summary.currency} {summary.actualCost.toLocaleString()}</td>
                <td>{summary.currency} {summary.variance.toLocaleString()}</td>
                <td><Chip size="small" label={summary.status} color={summary.status === 'ON_BUDGET' ? 'success' : 'error'} /></td>
              </tr>
            ))}
          </tbody>
        </Box>
      </Paper>
    </Stack>
  );
}

const TABS = ['Overview', 'Cost Transaction Ledger', 'Payment Projection'];

function CostControlDetail({ projectId }) {
  const navigate = useNavigate();
  const [project, setProject] = useState(undefined);
  const [summary, setSummary] = useState(null);
  const [tab, setTab] = useState(0);

  async function load() {
    const [p, s] = await Promise.all([getProjectById(projectId), getProjectCostSummary(projectId)]);
    setProject(p);
    setSummary(s);
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return (
    <Stack spacing={3}>
      <Button component={RouterLink} to="/cost-control" startIcon={<ArrowBackRoundedIcon />} size="small" sx={{ alignSelf: 'flex-start' }}>
        Back to Project Cost Control
      </Button>

      {project === undefined && <Typography color="text.secondary">Loading&hellip;</Typography>}
      {project === null && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6" fontWeight={700}>Project not found</Typography>
          <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/cost-control')}>Return to Project Cost Control</Button>
        </Paper>
      )}

      {project && summary && (
        <>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <Box>
              <Typography variant="h5" fontWeight={700}>{project.projectName}</Typography>
              <Typography variant="body2" color="text.secondary">{project.projectCode}</Typography>
            </Box>
            <Chip label={summary.status} color={summary.status === 'ON_BUDGET' ? 'success' : 'error'} size="small" sx={{ ml: { sm: 'auto' } }} />
          </Stack>
          <Paper sx={{ px: 1 }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
              {TABS.map((label) => <Tab key={label} label={label} />)}
            </Tabs>
          </Paper>
          <Box>
            {tab === 0 && <CostOverviewTab projectId={projectId} summary={summary} onChanged={load} />}
            {tab === 1 && <CostLedgerTab projectId={projectId} onDataChanged={load} />}
            {tab === 2 && <PaymentProjectionTab projectId={projectId} />}
          </Box>
        </>
      )}
    </Stack>
  );
}

export default function CostControlPage() {
  const { projectId } = useParams();
  return projectId ? <CostControlDetail projectId={projectId} /> : <CostControlList />;
}
