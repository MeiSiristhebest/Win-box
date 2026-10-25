import type { ComponentType, ReactNode } from 'react';
import { Nav, NavItem, NavSectionHeader } from '@fluentui/react-components';
import {
  Clock20Regular,
  HardDrive20Regular,
  Home20Regular,
  Info20Regular,
  PlayCircle20Regular,
  Settings20Regular,
  Star20Regular,
  Trophy20Regular,
  Wifi120Regular,
} from '@fluentui/react-icons';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import WindowTitleBar from './WindowTitleBar';
import AppAmbient from '../components/AppAmbient';
import SearchPanel from '../components/SearchPanel';
import SourcePicker from '../components/SourcePicker';
import { ProfileSwitcher } from '../features/subscriptions/ProfileSwitcher';
import { profileSwitcherAdapter } from '../features/subscriptions/adapters/profileSwitcherAdapter';
import { sourcePickerAdapter } from '../features/subscriptions/adapters/sourcePickerAdapter';
import type { Theme } from '../lib/themeTokens';
import type { ShellPresentation } from '../lib/themeTokens';

export interface AppNavItem {
  to: string;
  label: string;
  ico: string;
  end?: boolean;
}

export interface AppNavGroup {
  label: string;
  items: AppNavItem[];
}

export const NAV: AppNavItem[] = [
  { to: '/', label: '发现', ico: '🧭', end: true },
  { to: '/boards', label: '榜单', ico: '☷' },
  { to: '/home', label: '点播', ico: '▶' },
  { to: '/history', label: '历史', ico: '🕘' },
  { to: '/favorites', label: '收藏', ico: '⭐' },
  { to: '/live', label: '直播', ico: '📡' },
  { to: '/storage', label: '存储', ico: '🗄' },
  { to: '/config', label: '设置', ico: '⚙' },
  { to: '/about', label: '关于', ico: 'ℹ' },
];

const APP_ICONS: Record<string, ReactNode> = {
  '/boards': <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 12.5V9M8 12.5V3.5M13 12.5V6M1.5 14h13" /></svg>,
  '/': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.6 7.1 8 2.8l5.4 4.3v5.2a.9.9 0 0 1-.9.9H3.5a.9.9 0 0 1-.9-.9V7.1Z" />
    </svg>
  ),
  '/home': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.9" y="3.3" width="12.2" height="9.4" rx="2.3" />
      <path d="M6.7 6.2v3.6l3.2-1.8-3.2-1.8Z" fill="currentColor" stroke="none" />
    </svg>
  ),
  '/history': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5.1V8l2.1 1.4" />
    </svg>
  ),
  '/live': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="10.6" r="1.5" fill="currentColor" stroke="none" />
      <path d="M5.1 8.1a4.3 4.3 0 0 1 5.8 0M3 5.9a7.1 7.1 0 0 1 10 0" />
    </svg>
  ),
  '/config': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.9v1.5M8 12.6v1.5M1.9 8h1.5M12.6 8h1.5M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1" />
    </svg>
  ),
  '/storage': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.1" y="3.4" width="11.8" height="9.2" rx="2.2" />
      <path d="M2.1 9.6h11.8" />
      <path d="M5.1 11.8h1.6" />
    </svg>
  ),
  '/favorites': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  ),
  '/about': (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" />
      <path d="M8 7.3v3.4M8 5.2h.01" />
    </svg>
  ),
};

const DESKTOP_NAV_ICONS: Record<string, ReactNode> = {
  '/': <Home20Regular />,
  '/boards': <Trophy20Regular />,
  '/home': <PlayCircle20Regular />,
  '/history': <Clock20Regular />,
  '/favorites': <Star20Regular />,
  '/live': <Wifi120Regular />,
  '/storage': <HardDrive20Regular />,
  '/config': <Settings20Regular />,
  '/about': <Info20Regular />,
};

export const APP_NAV_GROUPS: AppNavGroup[] = [
  { label: '媒体', items: NAV.filter((item) => ['/', '/boards', '/home', '/history', '/favorites', '/live', '/storage'].includes(item.to)) },
  { label: '其他', items: NAV.filter((item) => ['/config', '/about'].includes(item.to)) },
];

export interface ShellLayoutProps {
  theme: Theme;
  navItems: AppNavItem[];
  appleGroups: AppNavGroup[];
  appIcon: string;
  pageTitle: string;
  onBack: () => void;
  backDisabled: boolean;
  disclaimer: ReactNode;
  children: ReactNode;
}

type ShellChromeProps = Omit<ShellLayoutProps, 'children'>;

export interface ShellFrameProps extends ShellChromeProps {
  presentation: ShellPresentation;
  children: ReactNode;
}

interface ShellPresentationDefinition {
  header: ComponentType<ShellChromeProps>;
  sidebar?: ComponentType<ShellChromeProps>;
  needsAppIcon: boolean;
  appClassName: (theme: Theme) => string;
  bodyClassName: string;
  sidebarClassName: string;
  mainClassName: string;
}

function DesktopHeader({ pageTitle, onBack, backDisabled }: ShellChromeProps) {
  return (
    <header className="desktop-topbar">
      <div className="desktop-brand">
        <span className="desktop-brand-mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="2.1" fill="currentColor" /><circle cx="12" cy="6.8" r="1" fill="currentColor" /><circle cx="16.5" cy="9.4" r="1" fill="currentColor" /><circle cx="16.5" cy="14.6" r="1" fill="currentColor" /><circle cx="12" cy="17.2" r="1" fill="currentColor" /><circle cx="7.5" cy="14.6" r="1" fill="currentColor" /><circle cx="7.5" cy="9.4" r="1" fill="currentColor" /></svg></span>
        <span>Win-Box</span>
      </div>
      <button type="button" className="desktop-back" aria-label="返回" title="返回（Alt + ←）" disabled={backDisabled} onClick={onBack}>
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m11.5 5-5 5 5 5M7 10h9" /></svg>
      </button>
      <span className="desktop-location"><span>媒体库</span><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>{pageTitle === '配置' ? '设置' : pageTitle}</span>
      <SearchPanel bar />
      <span className="desktop-topbar-space" />
<WindowTitleBar />
    </header>
  );
}

function DesktopSidebar({ navItems }: ShellChromeProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const groups = [
    { label: '浏览', routes: ['/', '/boards', '/home', '/live', '/storage'] },
    { label: '资料库', routes: ['/history', '/favorites'] },
  ];
  const route = /^\/(detail|search|play)(\/|$)/.test(location.pathname) ? '/home' : location.pathname;
  const selected = navItems.find((item) => item.end ? route === item.to : route === item.to || route.startsWith(`${item.to}/`))?.to;
  const sections = groups.flatMap((group) => {
    const items = navItems.filter((item) => group.routes.includes(item.to));
    return items.length ? [
      <NavSectionHeader className="desktop-nav-section" key={`section-${group.label}`}>{group.label}</NavSectionHeader>,
      ...items.map((item) => (
        <NavItem
          key={item.to}
          value={item.to}
          icon={<>{DESKTOP_NAV_ICONS[item.to]}</>}
          className="desktop-nav-item"
          title={item.label}
        >
          {item.label}
        </NavItem>
      )),
    ] : [];
  });
  const appItems = navItems.filter((item) => ['/config', '/about'].includes(item.to));
  return (
    <>
      <Nav
        className="desktop-navigation desktop-fluent-nav"
        aria-label="主导航"
        selectedValue={selected}
        onNavItemSelect={(_event, data) => navigate(String(data.value))}
      >
        {sections}
      </Nav>
      <section className="desktop-context" aria-label="当前内容来源">
        <div className="desktop-group-label">内容来源</div>
        <ProfileSwitcher port={profileSwitcherAdapter} />
        <SourcePicker port={sourcePickerAdapter} variant="sidebar" />
      </section>
      <Nav
        className="desktop-secondary desktop-fluent-nav"
        aria-label="应用管理"
        selectedValue={selected}
        onNavItemSelect={(_event, data) => navigate(String(data.value))}
      >
        {appItems.length > 0 && <NavSectionHeader className="desktop-nav-section">应用</NavSectionHeader>}
        {appItems.map((item) => (
          <NavItem key={item.to} value={item.to} icon={<>{DESKTOP_NAV_ICONS[item.to]}</>} className="desktop-nav-item" title={item.label}>
            {item.label}
          </NavItem>
        ))}
      </Nav>
    </>
  );
}

function IntegratedNavHeader({ navItems }: ShellChromeProps) {
  return (
    <nav className="nf-nav">
      <span className="nf-logo">WIN-BOX</span>
      <div className="nf-links">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => 'nf-link' + (isActive ? ' active' : '')}>
            {item.label}
          </NavLink>
        ))}
      </div>
      <span className="nf-spacer" />
      <SearchPanel />
      <ProfileSwitcher port={profileSwitcherAdapter} />
      <SourcePicker port={sourcePickerAdapter} />
<WindowTitleBar />
    </nav>
  );
}

function BilibiliHeader({ navItems }: ShellChromeProps) {
  return (
    <header className="bb-head">
      <div className="bb-top">
        <span className="bb-brand" title="Win-Box"><span className="bb-brand-mark" aria-hidden="true">b</span>WIN-BOX</span>
        <SearchPanel bar />
        <span className="bb-spacer" />
        <ProfileSwitcher port={profileSwitcherAdapter} />
          <SourcePicker port={sourcePickerAdapter} />
        <WindowTitleBar />
      </div>
      <nav className="bb-tabs">
        {navItems.map((item) => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => 'bb-tab' + (isActive ? ' active' : '')}>{item.label}</NavLink>)}
      </nav>
    </header>
  );
}

function AppleToolbar({ pageTitle, onBack, backDisabled }: ShellChromeProps) {
  return (
    <header className="ap-toolbar">
<WindowTitleBar variant="mac" />
      <button className="ap-navbtn" title="返回" aria-label="返回" disabled={backDisabled} onClick={onBack}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9.8 3.4 5.2 8l4.6 4.6" />
        </svg>
      </button>
      <span className="ap-toolbar-title">{pageTitle}</span>
      <span className="ap-spacer" />
      <SearchPanel />
      <ProfileSwitcher port={profileSwitcherAdapter} />
      <SourcePicker port={sourcePickerAdapter} />
    </header>
  );
}

function AppleSidebar({ appleGroups, appIcon }: ShellChromeProps) {
  return (
    <>
      <div className="ap-brand" title="Win-Box">
        {appIcon ? <img className="ap-brand-ico" src={appIcon} alt="" draggable={false} /> : <span className="ap-brand-dot" />}
        <span className="ap-brand-name">Win-Box</span>
      </div>
      {appleGroups.map((group) => (
        <div key={group.label} className="ap-group">
          <div className="ap-group-label">{group.label}</div>
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => 'ap-nav' + (isActive ? ' active' : '')}>
              <span className="ap-nav-ico">{APP_ICONS[item.to]}</span>
              <span className="ap-nav-txt">{item.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
      <div className="ap-side-spacer" />
      <SourcePicker port={sourcePickerAdapter} variant="sidebar" />
    </>
  );
}

function DoubanHeader({ navItems, appIcon, pageTitle }: ShellChromeProps) {
  return (
    <header className="db-head">
      <div className="db-topbar">
        <span className="db-brand" title="Win-Box">
          {appIcon ? <img className="db-brand-ico" src={appIcon} alt="" draggable={false} /> : <span className="db-brand-dot" />}
          WIN-BOX
        </span>
        <span className="db-title">{pageTitle}</span>
        <SearchPanel bar />
        <span className="db-spacer" />
        <ProfileSwitcher port={profileSwitcherAdapter} />
        <SourcePicker port={sourcePickerAdapter} />
<WindowTitleBar />
      </div>
      <nav className="db-nav">
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => 'db-chip' + (isActive ? ' active' : '')}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}

export const SHELL_PRESENTATIONS: Record<ShellPresentation, ShellPresentationDefinition> = {
  desktop: {
    header: DesktopHeader,
    sidebar: DesktopSidebar,
    needsAppIcon: false,
    appClassName: () => 'app desktop-app',
    bodyClassName: 'desktop-body',
    sidebarClassName: 'desktop-sidebar',
    mainClassName: 'desktop-main',
  },
  'integrated-nav': {
    header: IntegratedNavHeader,
    needsAppIcon: false,
    appClassName: (theme) => `app nf ${theme}`.trim(),
    bodyClassName: '',
    sidebarClassName: '',
    mainClassName: 'main',
  },
  'bilibili-header': {
    header: BilibiliHeader,
    needsAppIcon: false,
    appClassName: () => 'app bb-app',
    bodyClassName: '',
    sidebarClassName: '',
    mainClassName: 'bb-main',
  },
  'apple-sidebar': {
    header: AppleToolbar,
    sidebar: AppleSidebar,
    needsAppIcon: true,
    appClassName: () => 'app ap-app',
    bodyClassName: 'ap-body',
    sidebarClassName: 'ap-sidebar',
    mainClassName: 'ap-main',
  },
  'douban-header': {
    header: DoubanHeader,
    needsAppIcon: true,
    appClassName: () => 'app db-app',
    bodyClassName: '',
    sidebarClassName: '',
    mainClassName: 'db-main',
  },
};

/**
 * Keep the route host at a fixed position while the presentation changes.
 * Replacing the shell component used to unmount every page and lose local state.
 */
export function ShellFrame({ presentation, children, ...props }: ShellFrameProps) {
  const definition = SHELL_PRESENTATIONS[presentation];
  const Header = definition.header;
  const Sidebar = definition.sidebar;

  return (
    <div className={definition.appClassName(props.theme)}>
      {presentation !== 'desktop' && <AppAmbient />}
      {props.disclaimer}
      <Header {...props} />
      <div className={`shell-body ${definition.bodyClassName}`.trim()}>
        <aside
          className={`shell-sidebar ${definition.sidebarClassName}`.trim()}
          aria-hidden={!Sidebar}
          style={Sidebar ? undefined : { display: 'none' }}
        >
          {Sidebar ? <Sidebar {...props} /> : null}
        </aside>
        <main className={definition.mainClassName}>{children}</main>
      </div>
    </div>
  );
}
