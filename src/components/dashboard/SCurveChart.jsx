import { Box, useTheme } from '@mui/material';
import { Line } from 'react-chartjs-2';
import './chartSetup';

/**
 * Section 4 — S-Curve. Smooth Plan vs Actual line chart with Variance as
 * a thin reference line. Dummy data only, shape supplied by the caller.
 */
export default function SCurveChart({ labels, plan, actual, variance, height = 280 }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const gridColor = isDark ? 'rgba(231,233,238,0.06)' : 'rgba(14,17,22,0.06)';
  const tickColor = theme.palette.text.secondary;

  const data = {
    labels,
    datasets: [
      {
        label: 'Plan',
        data: plan,
        borderColor: theme.palette.text.secondary,
        backgroundColor: 'transparent',
        borderDash: [5, 4],
        borderWidth: 2,
        tension: 0.4,
        pointRadius: 0,
      },
      {
        label: 'Actual',
        data: actual,
        borderColor: theme.palette.primary.main,
        backgroundColor: isDark ? 'rgba(214,146,46,0.14)' : 'rgba(214,146,46,0.10)',
        borderWidth: 2.5,
        tension: 0.4,
        fill: true,
        pointRadius: 0,
      },
      {
        label: 'Variance',
        data: variance,
        borderColor: theme.palette.error.main,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        tension: 0.4,
        pointRadius: 0,
        yAxisID: 'variance',
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: { color: tickColor, usePointStyle: true, pointStyle: 'circle', boxWidth: 7, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: isDark ? '#1B202B' : '#FFFFFF',
        titleColor: theme.palette.text.primary,
        bodyColor: theme.palette.text.secondary,
        borderColor: theme.palette.divider,
        borderWidth: 1,
        padding: 10,
      },
    },
    scales: {
      x: { grid: { color: gridColor }, ticks: { color: tickColor, font: { size: 11 } } },
      y: {
        grid: { color: gridColor },
        ticks: { color: tickColor, font: { size: 11 }, callback: (v) => `${v}%` },
        min: 0,
        max: 100,
      },
      variance: {
        display: false,
        min: -20,
        max: 20,
      },
    },
  };

  return (
    <Box sx={{ height }}>
      <Line data={data} options={options} />
    </Box>
  );
}
