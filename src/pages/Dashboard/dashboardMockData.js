// Static dummy data for the Executive Dashboard prototype.
// No API, no Firebase, no business logic — presentation data only.

export const kpiData = [
  { key: 'active', label: 'Active Projects', value: '8', subtitle: '3 regions', trend: { direction: 'up', value: '+1', good: true }, icon: 'projects' },
  { key: 'progress', label: 'Overall Progress', value: '67.4%', subtitle: 'Portfolio average', trend: { direction: 'up', value: '+2.1%', good: true }, icon: 'progress' },
  { key: 'onSchedule', label: 'Projects On Schedule', value: '6', subtitle: 'of 8 active', trend: { direction: 'flat', value: '0', good: true }, icon: 'schedule' },
  { key: 'delayed', label: 'Delayed Projects', value: '2', subtitle: 'Needs attention', trend: { direction: 'up', value: '+1', good: false }, icon: 'delay' },
  { key: 'critical', label: 'Critical Issues', value: '11', subtitle: 'Open across sites', trend: { direction: 'down', value: '-3', good: true }, icon: 'issues' },
  { key: 'hse', label: 'HSE Score', value: '98%', subtitle: 'Trailing 30 days', trend: { direction: 'up', value: '+0.4%', good: true }, icon: 'hse' },
];

export const projects = [
  { id: 'p1', name: 'PLTS Sumbawa 25 MW + BESS', pm: 'Andi Wijaya', progress: 71, spi: 1.02, status: 'On Schedule', health: 'green' },
  { id: 'p2', name: 'PLTS Karawang Factory 5 MWp', pm: 'Rina Kartika', progress: 84, spi: 1.05, status: 'On Schedule', health: 'green' },
  { id: 'p3', name: 'PLTS Surabaya Warehouse 2 MWp', pm: 'Budi Santoso', progress: 45, spi: 0.88, status: 'At Risk', health: 'yellow' },
  { id: 'p4', name: 'PLTS Batam Industrial Park', pm: 'Siti Nurhaliza', progress: 58, spi: 0.95, status: 'On Schedule', health: 'green' },
  { id: 'p5', name: 'PLTS Bali Resort', pm: 'Made Wirawan', progress: 33, spi: 0.74, status: 'Delayed', health: 'red' },
  { id: 'p6', name: 'PLTS Semarang Factory', pm: 'Dewi Lestari', progress: 62, spi: 0.97, status: 'On Schedule', health: 'green' },
  { id: 'p7', name: 'PLTS Medan Plant', pm: 'Hendra Gunawan', progress: 27, spi: 0.79, status: 'Delayed', health: 'red' },
  { id: 'p8', name: 'PLTS Makassar Port', pm: 'Fajar Nugroho', progress: 66, spi: 0.91, status: 'At Risk', health: 'yellow' },
];

export const overallProgress = { value: 67.4, label: 'Overall' };

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const plan = [4, 10, 18, 27, 36, 45, 54, 63, 73, 83, 92, 100];
const actual = [3, 8, 15, 22, 30, 38, 47, 55, 63, 71, 78, 84];

export const sCurveData = {
  labels: months,
  plan,
  actual: actual.slice(0, 8), // "today" is roughly month 8 — no future actuals
  variance: actual.slice(0, 8).map((a, i) => Number((a - plan[i]).toFixed(1))),
};

export const disciplineProgress = [
  { label: 'Civil', value: 92 },
  { label: 'Electrical', value: 74 },
  { label: 'Mechanical', value: 68 },
  { label: 'PV Module', value: 61 },
  { label: 'Inverter', value: 55 },
  { label: 'Cable', value: 47 },
  { label: 'Testing', value: 22 },
  { label: 'Commissioning', value: 9 },
];

export const issueSummary = [
  { key: 'critical', label: 'Critical', count: 3, trend: { direction: 'up', value: '+1', good: false } },
  { key: 'high', label: 'High', count: 8, trend: { direction: 'down', value: '-2', good: true } },
  { key: 'medium', label: 'Medium', count: 17, trend: { direction: 'flat', value: '0', good: true } },
  { key: 'low', label: 'Low', count: 24, trend: { direction: 'down', value: '-5', good: true } },
];

export const todaysActivities = [
  { time: '07:30', title: 'Toolbox Meeting', site: 'PLTS Karawang Factory' },
  { time: '09:00', title: 'Module Installation', site: 'PLTS Sumbawa 25 MW + BESS' },
  { time: '11:00', title: 'Cable Pulling', site: 'PLTS Batam Industrial Park' },
  { time: '13:30', title: 'Inverter Installation', site: 'PLTS Semarang Factory' },
  { time: '15:00', title: 'Quality Inspection', site: 'PLTS Makassar Port' },
];

export const recentDocuments = [
  { title: 'Method Statement — Piling Works', type: 'Method Statement', status: 'Approved', date: '2 hours ago' },
  { title: 'ITP — Structural Steel', type: 'ITP', status: 'Approved', date: 'Yesterday' },
  { title: 'Inspection Report — Module Array B3', type: 'Inspection Report', status: 'Approved', date: 'Yesterday' },
  { title: 'Drawing Revision — SLD Rev. C', type: 'Drawing Revision', status: 'Approved', date: '2 days ago' },
  { title: 'Permit To Work — HV Termination', type: 'Permit To Work', status: 'Approved', date: '3 days ago' },
];

export const sitePhotos = [
  { date: '28 Jul 2026', location: 'Sumbawa', activity: 'Module Installation', hue: 38 },
  { date: '27 Jul 2026', location: 'Karawang', activity: 'Cable Tray Works', hue: 176 },
  { date: '27 Jul 2026', location: 'Batam', activity: 'Civil Works', hue: 210 },
  { date: '26 Jul 2026', location: 'Semarang', activity: 'Inverter Skid', hue: 20 },
  { date: '26 Jul 2026', location: 'Makassar', activity: 'Site Grading', hue: 150 },
  { date: '25 Jul 2026', location: 'Bali Resort', activity: 'Structure Assembly', hue: 45 },
];

export const weather = {
  location: 'Sumbawa Site',
  temperature: 31,
  windSpeed: 12,
  humidity: 68,
  rainProbability: 20,
};

export const healthScore = {
  value: 92,
  label: 'Excellent',
  breakdown: [
    { label: 'Schedule', value: 88 },
    { label: 'Quality', value: 95 },
    { label: 'Safety', value: 98 },
    { label: 'Documentation', value: 90 },
    { label: 'Issues', value: 84 },
  ],
};
