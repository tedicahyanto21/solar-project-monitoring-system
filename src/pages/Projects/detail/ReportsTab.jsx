import { useState } from 'react';
import { Stack, Typography, Paper, TextField, Button, Alert } from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { buildWeeklyReportDataset, buildMonthlyReportDataset } from '../../../services/repositories/reportRepository';
import { generateWeeklyReportPdf, generateMonthlyReportPdf } from '../../../services/reportPdf';
import { useAuth } from '../../../context/AuthContext';
import { ROLES } from '../../../constants/roles';

// FT-6 "Role Permissions": report generation authority.
const CAN_GENERATE = [ROLES.SUPER_ADMIN, ROLES.HEAD_PM, ROLES.PROJECT_MANAGER, ROLES.SITE_MANAGER];

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

// Weekly/Monthly report generation (Sprint FT-6, Parts B/C/D). This tab is
// UI only -- it calls reportRepository to build the dataset and
// reportPdf to lay it out; it never computes progress, schedule, or issue
// relevance itself.
export default function ReportsTab({ projectId }) {
  const { profile } = useAuth();
  const canGenerate = CAN_GENERATE.includes(profile?.role);
  const [weeklyStart, setWeeklyStart] = useState(daysAgo(7));
  const [weeklyEnd, setWeeklyEnd] = useState(today());
  const now = new Date();
  const [monthlyYear, setMonthlyYear] = useState(now.getFullYear());
  const [monthlyMonth, setMonthlyMonth] = useState(now.getMonth() + 1);
  const [error, setError] = useState('');

  async function handleWeekly() {
    if (!canGenerate) return; // defense in depth, not just a hidden button
    setError('');
    try {
      const dataset = await buildWeeklyReportDataset(projectId, weeklyStart, weeklyEnd);
      if (!dataset) throw new Error('Could not build the weekly report dataset for this project.');
      const doc = generateWeeklyReportPdf(dataset);
      doc.save(`${dataset.project.code}_Weekly_${weeklyStart}_to_${weeklyEnd}.pdf`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleMonthly() {
    if (!canGenerate) return;
    setError('');
    try {
      const dataset = await buildMonthlyReportDataset(projectId, Number(monthlyYear), Number(monthlyMonth));
      if (!dataset) throw new Error('Could not build the monthly report dataset for this project.');
      const doc = generateMonthlyReportPdf(dataset);
      doc.save(`${dataset.project.code}_Monthly_${monthlyYear}-${String(monthlyMonth).padStart(2, '0')}.pdf`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!canGenerate) {
    return (
      <Paper sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Report generation is available to Super Admin, Head PM, Project Manager, and Site
          Manager only.
        </Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Weekly Project Report</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Includes any issue open during any part of the period, or closed during the period.
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField label="Period Start" type="date" size="small" value={weeklyStart} onChange={(e) => setWeeklyStart(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Period End" type="date" size="small" value={weeklyEnd} onChange={(e) => setWeeklyEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <Button variant="contained" startIcon={<DownloadRoundedIcon />} onClick={handleWeekly}>
            Generate Weekly PDF
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Monthly Project Report</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Historical -- includes any issue relevant to any part of the selected month, even if
          since closed.
        </Typography>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField label="Year" type="number" size="small" value={monthlyYear} onChange={(e) => setMonthlyYear(e.target.value)} sx={{ width: 110 }} />
          <TextField label="Month (1-12)" type="number" size="small" value={monthlyMonth} onChange={(e) => setMonthlyMonth(e.target.value)} sx={{ width: 130 }} slotProps={{ htmlInput: { min: 1, max: 12 } }} />
          <Button variant="contained" startIcon={<DownloadRoundedIcon />} onClick={handleMonthly}>
            Generate Monthly PDF
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
