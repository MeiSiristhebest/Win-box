import type { CSSProperties } from 'react';
import type { Theme } from './themeTokens';
import { presentationFor } from './themeTokens';

type DiscoverPresentation = ReturnType<typeof presentationFor>['discover'];
type DetailPresentation = ReturnType<typeof presentationFor>['detail'];
type SourceBrowsePresentation = ReturnType<typeof presentationFor>['sourceBrowse'];

export interface DiscoverPresentationView {
  mode: 'rows' | 'poster-wall';
  filterMode: 'inline' | 'pills';
  spotlightLandscape: boolean;
  filters: { containerClass: string; rowClass: string; labelClass: string };
  card: { hoverPlayClass: string | null; hoverPlaySize: number; yearBadge: boolean; yearBadgeClass: string };
  row: {
    containerClass?: string;
    titleClass?: string;
    scrollClass?: string;
    containerStyle?: CSSProperties;
    titleStyle?: CSSProperties;
    scrollStyle?: CSSProperties;
    cardWidth?: number;
  };
  wall: {
    containerClass: string;
    chipListClass: string;
    chipClass: string;
    gridClass: string;
  };
}

export const DISCOVER_PRESENTATION_VIEWS = {
  'standard-grid': {
    mode: 'rows',
    filterMode: 'inline',
    spotlightLandscape: false,
    filters: { containerClass: '', rowClass: '', labelClass: '' },
    card: { hoverPlayClass: null, hoverPlaySize: 0, yearBadge: false, yearBadgeClass: '' },
    row: {
      containerStyle: { marginBottom: 22 },
      titleStyle: { margin: '0 0 10px' },
      scrollStyle: { display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 6 },
      cardWidth: 132,
    },
    wall: { containerClass: '', chipListClass: '', chipClass: '', gridClass: '' },
  },
  'netflix-rows': {
    mode: 'rows',
    filterMode: 'inline',
    spotlightLandscape: true,
    filters: { containerClass: '', rowClass: '', labelClass: '' },
    card: { hoverPlayClass: null, hoverPlaySize: 0, yearBadge: false, yearBadgeClass: '' },
    row: { containerClass: 'nf-row', titleClass: 'nf-row-title', scrollClass: 'nf-row-scroll' },
    wall: { containerClass: '', chipListClass: '', chipClass: '', gridClass: '' },
  },
  'apple-rows': {
    mode: 'rows',
    filterMode: 'inline',
    spotlightLandscape: false,
    filters: { containerClass: '', rowClass: '', labelClass: '' },
    card: { hoverPlayClass: 'ap-card-play', hoverPlaySize: 13, yearBadge: false, yearBadgeClass: '' },
    row: { containerClass: 'ap-row', titleClass: 'ap-row-title', scrollClass: 'ap-row-scroll', cardWidth: 168 },
    wall: { containerClass: '', chipListClass: '', chipClass: '', gridClass: '' },
  },
  'douban-wall': {
    mode: 'poster-wall',
    filterMode: 'pills',
    spotlightLandscape: false,
    filters: { containerClass: 'db-filters', rowClass: 'db-filter-row', labelClass: 'db-filter-label' },
    card: { hoverPlayClass: 'db-card-play', hoverPlaySize: 16, yearBadge: true, yearBadgeClass: 'db-year-badge' },
    row: {},
    wall: {
      containerClass: 'db-wall',
      chipListClass: 'db-wall-chips',
      chipClass: 'db-wall-chip',
      gridClass: 'grid db-wall-grid',
    },
  },
} as const satisfies Record<DiscoverPresentation, DiscoverPresentationView>;

export function discoverPresentationView(theme: Theme): DiscoverPresentationView {
  return DISCOVER_PRESENTATION_VIEWS[presentationFor(theme).discover];
}

export interface SourceBrowsePresentationView {
  categoryRowClass: string;
  categoryRowStyle?: CSSProperties;
  showCategoryLabel: boolean;
  categoryLabelClass: string;
  filterPanelClass: string;
  filterPanelStyle?: CSSProperties;
}

export const SOURCE_BROWSE_PRESENTATION_VIEWS = {
  standard: {
    categoryRowClass: 'row',
    categoryRowStyle: { marginBottom: 14 },
    showCategoryLabel: false,
    categoryLabelClass: '',
    filterPanelClass: 'card',
    filterPanelStyle: { padding: 10, marginBottom: 14 },
  },
  douban: {
    categoryRowClass: 'db-filter-row',
    showCategoryLabel: true,
    categoryLabelClass: 'db-filter-label',
    filterPanelClass: 'db-filters',
  },
} as const satisfies Record<SourceBrowsePresentation, SourceBrowsePresentationView>;

export function sourceBrowsePresentationView(theme: Theme): SourceBrowsePresentationView {
  return SOURCE_BROWSE_PRESENTATION_VIEWS[presentationFor(theme).sourceBrowse];
}

export interface DetailPresentationView {
  contentClass: string;
  backdrop: { enabled: boolean; className: string; absolute: boolean };
  hero: {
    className: string;
    layoutStyle?: CSSProperties;
    posterClass: string;
    posterStyle?: CSSProperties;
    noCoverClass: string;
    noCoverStyle: CSSProperties;
    infoClass: string;
    infoStyle: CSSProperties;
    titleClass: string;
    titleStyle?: CSSProperties;
    introClass: string;
    introStyle: CSSProperties;
    remarksClass: string;
    remarksStyle?: CSSProperties;
    showSectionHeading: boolean;
    sectionHeadingClass: string;
  };
  playButtonClass: string;
}

const standardHeroLayout: CSSProperties = { alignItems: 'flex-start', gap: 16, marginBottom: 16 };
const standardPoster: CSSProperties = { width: 120, aspectRatio: '2/3', objectFit: 'cover', borderRadius: 8, background: 'var(--bg-elev2)' };
const standardNoCover: CSSProperties = {
  width: 120,
  aspectRatio: '2/3',
  borderRadius: 8,
  background: 'var(--bg-elev2)',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-dim)',
  fontSize: 11,
};
const doubanNoCover: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--text-dim)',
  fontSize: 11,
};
const standardIntro: CSSProperties = { fontSize: 12, maxHeight: 80, overflow: 'auto', marginTop: 8 };
const doubanIntro: CSSProperties = { fontSize: 13, overflow: 'auto', marginTop: 8 };

export const DETAIL_PRESENTATION_VIEWS = {
  standard: {
    contentClass: '',
    backdrop: { enabled: false, className: '', absolute: false },
    hero: {
      className: 'row', layoutStyle: standardHeroLayout, posterClass: '', posterStyle: standardPoster,
      noCoverClass: '', noCoverStyle: standardNoCover, infoClass: '', infoStyle: { flex: 1, minWidth: 0 },
      titleClass: '', titleStyle: { margin: '0 0 8px' }, introClass: 'muted', introStyle: standardIntro,
      remarksClass: '', remarksStyle: { color: 'var(--accent-2)', marginBottom: 4 },
      showSectionHeading: false, sectionHeadingClass: '',
    },
    playButtonClass: 'primary',
  },
  'netflix-cinema': {
    contentClass: 'nf-detail-wrap',
    backdrop: { enabled: true, className: 'nf-detail-backdrop', absolute: true },
    hero: {
      className: 'row', layoutStyle: standardHeroLayout, posterClass: '', posterStyle: standardPoster,
      noCoverClass: '', noCoverStyle: standardNoCover, infoClass: '', infoStyle: { flex: 1, minWidth: 0 },
      titleClass: '', titleStyle: { margin: '0 0 8px' }, introClass: 'muted', introStyle: standardIntro,
      remarksClass: '', remarksStyle: { color: 'var(--accent-2)', marginBottom: 4 },
      showSectionHeading: false, sectionHeadingClass: '',
    },
    playButtonClass: 'primary nf-play-btn',
  },
  'apple-cinema': {
    contentClass: 'ap-detail-wrap',
    backdrop: { enabled: true, className: 'ap-detail-backdrop', absolute: false },
    hero: {
      className: 'row', layoutStyle: standardHeroLayout, posterClass: '', posterStyle: standardPoster,
      noCoverClass: '', noCoverStyle: standardNoCover, infoClass: '', infoStyle: { flex: 1, minWidth: 0 },
      titleClass: '', titleStyle: { margin: '0 0 8px' }, introClass: 'muted', introStyle: standardIntro,
      remarksClass: '', remarksStyle: { color: 'var(--accent-2)', marginBottom: 4 },
      showSectionHeading: false, sectionHeadingClass: '',
    },
    playButtonClass: 'primary',
  },
  'douban-catalog': {
    contentClass: 'db-detail',
    backdrop: { enabled: false, className: '', absolute: false },
    hero: {
      className: 'db-hero',
      posterClass: 'db-hero-poster',
      noCoverClass: 'db-hero-poster db-hero-nocover',
      noCoverStyle: doubanNoCover,
      infoClass: 'db-hero-info',
      infoStyle: { flex: 1, minWidth: 0 },
      titleClass: 'db-hero-title',
      introStyle: doubanIntro,
      introClass: 'muted db-hero-intro',
      remarksClass: 'db-remark-pill',
      showSectionHeading: true,
      sectionHeadingClass: 'db-sec-title',
    },
    playButtonClass: 'primary',
  },
} as const satisfies Record<DetailPresentation, DetailPresentationView>;

export function detailPresentationView(theme: Theme): DetailPresentationView {
  return DETAIL_PRESENTATION_VIEWS[presentationFor(theme).detail];
}
