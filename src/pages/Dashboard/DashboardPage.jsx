import { useEffect, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import SectionCard from '../../components/dashboard/SectionCard';
import KpiGrid from '../../components/dashboard/KpiGrid';
import SCurveChart from '../../components/dashboard/SCurveChart';
import EngineeringStatusCard from '../../components/dashboard/executive/EngineeringStatusCard';
import ProcurementStatusCard from '../../components/dashboard/executive/ProcurementStatusCard';
import SiteIssuesCard from '../../components/dashboard/executive/SiteIssuesCard';
import ProjectSpotlight from '../../components/dashboard/executive/ProjectSpotlight';
import { getProjects } from '../../services/repositories/projectRepository';
import { getProjectProgress, getPortfolioSummary, getScheduleStatus, getPortfolioSCurve } from '../../services/repositories/progressRepository';

// 12-column responsive row helper.
const row = { display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(12, 1fr)' } };
const span = (n) => ({ gridColumn: { xs: '1 / -1', md: `span ${n}` } });

// Executive Monitoring Dashboard (Project Blueprint SPMS-DOC-05, Section
// 10). Exactly the eight approved panels -- Total Projects, Overall
// Progress, On Schedule, On Delay, S-Curve, Engineering Document Status,
// Procurement Status, Site Issues -- laid out to fit one screen at a
// typical desktop/TV viewport without scrolling. This page is a READ
// layer: every number below comes from progressRepository, never
// recomputed here (Dashboard architecture rule, Blueprint Section 10).
export default function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [projects, setProjects] = useState([]);
  const [sCurve, setSCurve] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [portfolio, projectList, curve] = await Promise.all([getPortfolioSummary(), getProjects(), getPortfolioSCurve()]);
      const enriched = await Promise.all(
        projectList.map(async (p) => {
          const progress = await getProjectProgress(p.id);
          const schedule = await getScheduleStatus(p);
          return { ...p, progress: progress?.overallProgress ?? p.progress, scheduleStatus: schedule.label, isOnSchedule: schedule.isOnSchedule };
        })
      );
      if (!cancelled) {
        setSummary(portfolio);
        setProjects(enriched);
        setSCurve(curve);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const kpiData = [
    { key: 'total', label: 'Total Projects', value: summary?.totalProjects ?? '\u2013', icon: 'projects' },
    { key: 'progress', label: 'Overall Progress', value: `${summary?.overallProgress ?? 0}%`, icon: 'progress' },
    { key: 'onSchedule', label: 'On Schedule', value: summary?.onSchedule ?? '\u2013', icon: 'schedule' },
    { key: 'onDelay', label: 'On Delay', value: summary?.onDelay ?? '\u2013', icon: 'delay' },
  ];

  return (
    <Stack spacing={1.5} sx={{ height: '100%' }}>
      <Box>
        <Typography variant="h5" fontWeight={700}>Executive Dashboard</Typography>
        <Typography variant="body2" color="text.secondary">
          Portfolio overview across all active Solar EPC projects &middot; read/monitoring layer
        </Typography>
      </Box>

      <KpiGrid items={kpiData} />

      <Box sx={row}>
        <Box sx={span(7)}>
          <SectionCard title="S-Curve" subtitle={'Plan vs. Actual \u2014 portfolio'}>
            {sCurve?.dataAvailable ? (
              <SCurveChart labels={sCurve.labels} plan={sCurve.plan} actual={sCurve.actual} variance={sCurve.variance} height={210} />
            ) : (
              <Box sx={{ height: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', px: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  No progress snapshots recorded yet. The S-Curve populates as Project Detail
                  pages are visited over time (Progress Engine history).
                </Typography>
              </Box>
            )}
          </SectionCard>
        </Box>
        <Box sx={span(5)}>
          <SectionCard title="Project Spotlight" subtitle="Auto-rotating project highlight">
            <ProjectSpotlight projects={projects} />
          </SectionCard>
        </Box>
      </Box>

      <Box sx={row}>
        <Box sx={span(4)}>
          <SectionCard title="Engineering Document Status" subtitle="Portfolio-wide review status">
            <EngineeringStatusCard data={summary?.engineeringDocStatus} />
          </SectionCard>
        </Box>
        <Box sx={span(4)}>
          <SectionCard title="Procurement Status" subtitle="Portfolio-average progress">
            <ProcurementStatusCard value={summary?.procurementStatus} />
          </SectionCard>
        </Box>
        <Box sx={span(4)}>
          <SectionCard title="Site Issues" subtitle="Open issues across active sites">
            <SiteIssuesCard data={summary?.siteIssues} />
          </SectionCard>
        </Box>
      </Box>
    </Stack>
  );
}
