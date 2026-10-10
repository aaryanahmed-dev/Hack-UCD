// Render data for token store cosmetics, keyed by item id (mirrors backend/app/models/shop_seed.py).

export const AVATARS: Record<string, { icon: string; color: string }> = {
  'avatar-sprout': { icon: 'leaf', color: '#2F7A4B' },
  'avatar-bookworm': { icon: 'book', color: '#3B5B8C' },
  'avatar-scholar': { icon: 'school', color: '#1E4D33' },
  'avatar-flash': { icon: 'flash', color: '#8A5512' },
  'avatar-flame': { icon: 'flame', color: '#B3402F' },
  'avatar-rocket': { icon: 'rocket', color: '#7A3B5C' },
  'avatar-planet': { icon: 'planet', color: '#2F6F6A' },
  'avatar-diamond': { icon: 'diamond', color: '#17231C' },
};

export const FRAMES: Record<string, string> = {
  'frame-emerald': '#3DBE6C',
  'frame-ocean': '#3B82C4',
  'frame-rose': '#D9467A',
  'frame-gold': '#E39B2F',
};
