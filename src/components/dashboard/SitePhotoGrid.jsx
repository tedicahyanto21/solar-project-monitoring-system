import { Box, Typography } from '@mui/material';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';

// Generates a lightweight inline SVG placeholder (no network image
// requests) so the prototype renders identically offline. `hue` gives
// each card a distinct, muted tone.
function placeholderDataUri(hue) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">
      <rect width="320" height="200" fill="hsl(${hue},28%,88%)" />
      <rect width="320" height="200" fill="hsl(${hue},40%,40%)" fill-opacity="0.18" />
    </svg>`
  );
  return `data:image/svg+xml,${svg}`;
}

/**
 * Section 9 — Recent Site Photos. Responsive photo grid; each tile shows
 * a caption overlay with date / location / activity. Placeholder imagery
 * only — no real site photos.
 */
export default function SitePhotoGrid({ items }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.5,
        gridTemplateColumns: {
          xs: 'repeat(2, 1fr)',
          sm: 'repeat(3, 1fr)',
          md: 'repeat(6, 1fr)',
        },
      }}
    >
      {items.map((photo, i) => (
        <Box
          key={`${photo.location}-${i}`}
          sx={{
            position: 'relative',
            borderRadius: 2,
            overflow: 'hidden',
            aspectRatio: '4 / 3',
            border: '1px solid',
            borderColor: 'divider',
            backgroundImage: `url("${placeholderDataUri(photo.hue)}")`,
            backgroundSize: 'cover',
          }}
        >
          <Box sx={{ position: 'absolute', top: 8, right: 8, color: 'rgba(255,255,255,0.85)' }}>
            <PhotoCameraRoundedIcon sx={{ fontSize: 16 }} />
          </Box>
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              p: 1,
              background: 'linear-gradient(to top, rgba(14,17,22,0.78), rgba(14,17,22,0))',
            }}
          >
            <Typography variant="caption" sx={{ color: '#fff', display: 'block', fontWeight: 700, fontSize: 11 }} noWrap>
              {photo.activity}
            </Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.75)', fontSize: 10 }} noWrap>
              {photo.location} · {photo.date}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
