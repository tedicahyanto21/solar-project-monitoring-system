import { Box, Stack, Typography } from '@mui/material';
import ThermostatRoundedIcon from '@mui/icons-material/ThermostatRounded';
import AirRoundedIcon from '@mui/icons-material/AirRounded';
import WaterDropRoundedIcon from '@mui/icons-material/WaterDropRounded';
import UmbrellaRoundedIcon from '@mui/icons-material/UmbrellaRounded';
import WbSunnyRoundedIcon from '@mui/icons-material/WbSunnyRounded';

const METRICS = [
  { key: 'temperature', label: 'Temperature', icon: ThermostatRoundedIcon, unit: '°C' },
  { key: 'windSpeed', label: 'Wind Speed', icon: AirRoundedIcon, unit: ' km/h' },
  { key: 'humidity', label: 'Humidity', icon: WaterDropRoundedIcon, unit: '%' },
  { key: 'rainProbability', label: 'Rain Probability', icon: UmbrellaRoundedIcon, unit: '%' },
];

/**
 * Section 10 — Weather Widget. Dummy site-weather snapshot, purely
 * presentational.
 */
export default function WeatherWidget({ data }) {
  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <WbSunnyRoundedIcon sx={{ color: 'primary.main' }} />
        <Typography variant="body2" color="text.secondary">{data.location}</Typography>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 2,
        }}
      >
        {METRICS.map((m) => {
          const Icon = m.icon;
          return (
            <Stack key={m.key} direction="row" spacing={1.25} alignItems="center">
              <Icon fontSize="small" sx={{ color: 'text.secondary' }} />
              <Box>
                <Typography variant="h6" fontWeight={700} lineHeight={1.1}>
                  {data[m.key]}{m.unit}
                </Typography>
                <Typography variant="caption" color="text.secondary">{m.label}</Typography>
              </Box>
            </Stack>
          );
        })}
      </Box>
    </Box>
  );
}
