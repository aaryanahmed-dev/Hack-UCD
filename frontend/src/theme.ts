export const colors = {
  bg: '#F4EFE6',
  surface: '#FFFCF6',
  surfaceAlt: '#EFE8DB',
  ink: '#17231C',
  inkSoft: '#3E4A42',
  muted: '#7A8178',
  line: '#E2DACB',
  lineStrong: '#CFC5B3',

  primary: '#1E4D33',
  primaryPressed: '#163B27',
  primarySoft: '#DCE8DE',
  onPrimary: '#F6F2E9',
  onPrimaryMuted: '#B9CDBF',

  accent: '#E39B2F',
  accentSoft: '#FBEBD0',
  accentInk: '#8A5512',

  danger: '#B3402F',
  dangerSoft: '#F6DED9',
  live: '#3DBE6C',
} as const;

export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

export const shadow = {
  card: { boxShadow: '0px 1px 2px rgba(23, 35, 28, 0.06), 0px 8px 24px rgba(23, 35, 28, 0.07)' },
  raised: { boxShadow: '0px 2px 4px rgba(23, 35, 28, 0.08), 0px 16px 40px rgba(23, 35, 28, 0.14)' },
} as const;

/** Content never gets wider than this (web / tablets). */
export const MAX_CONTENT_WIDTH = 560;

const avatarPalette = ['#1E4D33', '#8A5512', '#3B5B8C', '#7A3B5C', '#2F6F6A', '#6B4E2E', '#4A5A2A'];

export function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return avatarPalette[Math.abs(hash) % avatarPalette.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
