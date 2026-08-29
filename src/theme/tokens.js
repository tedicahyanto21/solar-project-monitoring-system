// Design tokens for SPMS — Solar Project Monitoring System
// Visual concept: "Progress Arc" — a circular progress ring used as brand
// mark and status indicator across the app.
// The palette reads as a monitoring / control-room tool for solar assets, not a generic SaaS.

export const color = {
  // Brand — desaturated solar gold, not a cheerful startup orange
  amber50: '#FDF6E8',
  amber100: '#F6E3B8',
  amber400: '#E8A33D',
  amber500: '#D6922E', // primary
  amber600: '#B87A22',

  // Signal — used for "healthy / within SLA" states, reads like telemetry, not decoration
  teal400: '#2DD4BF',
  teal600: '#0F9488',

  // Risk states
  red400: '#F0685F',
  red600: '#C6362D',
  amberWarn400: '#F0B429',

  // Dark surfaces (graphite, not pure black)
  graphite950: '#0E1116',
  graphite900: '#12151C',
  graphite800: '#1B202B',
  graphite700: '#252C3A',
  graphite600: '#333C4E',
  graphite400: '#5B667C',

  // Light surfaces
  paper0: '#FFFFFF',
  paper50: '#F6F7F9',
  paper100: '#ECEEF2',
  paper200: '#DDE1E8',

  // Text
  inkOnDark: '#E7E9EE',
  inkOnDarkMuted: '#9AA3B5',
  inkOnLight: '#161A22',
  inkOnLightMuted: '#5B6472',
};

export const font = {
  display: '"Inter", -apple-system, "Segoe UI", sans-serif',
  body: '"Inter", -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", "SFMono-Regular", Menlo, monospace',
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
};

export const shadow = {
  low: '0 1px 2px rgba(14, 17, 22, 0.06)',
  mid: '0 4px 16px rgba(14, 17, 22, 0.10)',
  high: '0 12px 32px rgba(14, 17, 22, 0.16)',
};

// Sidebar geometry — used by Layout + Sidebar to keep numbers in sync
export const layout = {
  sidebarExpanded: 248,
  sidebarCollapsed: 72,
  topbarHeight: 64,
};
