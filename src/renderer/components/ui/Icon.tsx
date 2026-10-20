const ICON_PATHS = {
  search: ['M9 16a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm14 14 6 6'],
  refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M6 6a8 8 0 0 1 13 3l1 3M4 12l1 3a8 8 0 0 0 13 3'],
  left: ['m14 5-7 7 7 7'],
  right: ['m10 5 7 7-7 7'],
  layers: ['m12 3 10 5-10 5L2 8l10-5Z', 'm2 12 10 5 10-5M2 16l10 5 10-5'],
  check: ['m5 12 4 4L19 6'],
  play: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z', 'm10 8 6 4-6 4V8Z'],
  palette: ['M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.6-3.2 1.5 1.5 0 0 1 1.2-2.4H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z', 'M7 10h.01M10 6.5h.01M15 6.5h.01M17.5 10h.01'],
  shield: ['m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z', 'm8 12 3 3 5-6'],
  keyboard: ['M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z', 'M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10'],
  key: ['M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'm12 12 9 9M17 17l3-3M14 14l3-3'],
  storage: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z', 'M3 14h18M7 17h.01M11 17h.01'],
  globe: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M2 12h20M12 2a20 20 0 0 1 0 20 20 20 0 0 1 0-20Z'],
  plug: ['M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5'],
  archive: ['M3 3h18v5H3V3Z', 'M5 8v13h14V8M10 12h4'],
  folder: ['M3 6h6l2 2h10v11H3V6Z'],
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICON_PATHS[name].map(path => <path key={path} d={path} />)}
  </svg>;
}
