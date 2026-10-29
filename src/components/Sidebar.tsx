import { useState } from 'react';
import {
  LayoutDashboard,
  Calendar,
  ListChecks,
  ShoppingCart,
  ClipboardList,
  Trophy,
  Music,
  Image,
  Settings,
  Timer as TimerIcon,
  CloudSun,
  ShieldCheck,
  MoreHorizontal,
  X,
} from 'lucide-react';
import beaconIcon from '../assets/beacon-app-icon.svg';
import { useTranslation, type TranslationKey } from '../i18n';

export type SidebarView = 'dashboard' | 'calendar' | 'chores' | 'grocery' | 'tasks' | 'leaderboard' | 'music' | 'photos' | 'timer' | 'weather' | 'alarm' | 'settings';

interface SidebarProps {
  activeView: SidebarView;
  onChangeView: (view: SidebarView) => void;
  position?: 'left' | 'right' | 'bottom';
  /** Tab order from Settings → General → Sidebar tabs. Missing views are appended. */
  navOrder?: SidebarView[];
  /** Tabs removed from the nav. */
  hiddenViews?: SidebarView[];
}

const ICON_SIZE = 24;
const STROKE_WIDTH = 1.5;

export interface NavItem {
  id: SidebarView;
  icon: React.ReactNode;
  labelKey: TranslationKey;
}

/** Every main-nav view in Beacon's default order (Settings lives in the bottom group). */
export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', icon: <LayoutDashboard size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.dashboard' },
  { id: 'calendar', icon: <Calendar size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.calendar' },
  { id: 'chores', icon: <ListChecks size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.chores' },
  { id: 'grocery', icon: <ShoppingCart size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.grocery' },
  { id: 'tasks', icon: <ClipboardList size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.tasks' },
  { id: 'leaderboard', icon: <Trophy size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.leaderboard' },
  { id: 'music', icon: <Music size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.music' },
  { id: 'photos', icon: <Image size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.photos' },
  { id: 'timer', icon: <TimerIcon size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.timer' },
  { id: 'weather', icon: <CloudSun size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.weather' },
  { id: 'alarm', icon: <ShieldCheck size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />, labelKey: 'nav.alarm' },
];

export const DEFAULT_NAV_ORDER: SidebarView[] = NAV_ITEMS.map((item) => item.id);

/**
 * Full tab order: the saved order (unknown ids dropped) followed by any
 * view the saved order does not mention, so views added in a later
 * release still show up for users with an older saved order.
 */
export function resolveNavOrder(order: SidebarView[] | undefined): SidebarView[] {
  const known = new Set(DEFAULT_NAV_ORDER);
  const seen = new Set<SidebarView>();
  const result: SidebarView[] = [];
  for (const id of order ?? []) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  for (const id of DEFAULT_NAV_ORDER) {
    if (!seen.has(id)) result.push(id);
  }
  return result;
}

/** Ordered nav items minus the hidden ones — what the sidebar and digit shortcuts use. */
export function resolveVisibleNav(order: SidebarView[] | undefined, hidden: SidebarView[] | undefined): NavItem[] {
  const hiddenSet = new Set(hidden ?? []);
  const byId = new Map(NAV_ITEMS.map((item) => [item.id, item]));
  return resolveNavOrder(order)
    .filter((id) => !hiddenSet.has(id))
    .map((id) => byId.get(id)!)
    .filter(Boolean);
}

/** Items shown directly in the mobile bottom tab bar */
const MOBILE_TAB_IDS: SidebarView[] = ['dashboard', 'calendar', 'chores', 'music'];

export function Sidebar({
  activeView,
  onChangeView,
  position = 'left',
  navOrder,
  hiddenViews,
}: SidebarProps) {
  const { t } = useTranslation();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const navItems = resolveVisibleNav(navOrder, hiddenViews);
  const mobileTabItems = navItems.filter((item) => MOBILE_TAB_IDS.includes(item.id));
  const mobileOverflowItems = navItems.filter((item) => !MOBILE_TAB_IDS.includes(item.id));

  const handleMobileNav = (view: SidebarView) => {
    onChangeView(view);
    setMobileMoreOpen(false);
  };

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        className={`sidebar sidebar--desktop sidebar--${position}`}
        aria-label={t('nav.mainNavigation')}
        style={position === 'bottom' ? { display: 'none' } : undefined}
      >
        {/* Beacon logo */}
        <div className="sidebar-logo">
          <img src={beaconIcon} alt="Beacon" width={32} height={32} />
        </div>

        {/* Main nav icons */}
        <div className="sidebar-nav-group">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-icon ${activeView === item.id ? 'sidebar-icon--active' : ''}`}
              onClick={() => onChangeView(item.id)}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="sidebar-divider" />

        {/* Bottom utility icons */}
        <div className="sidebar-nav-group sidebar-nav-group--bottom">
          <button
            type="button"
            className={`sidebar-icon ${activeView === 'settings' ? 'sidebar-icon--active' : ''}`}
            onClick={() => onChangeView('settings')}
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
          >
            <Settings size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
          </button>
        </div>
      </nav>

      {/* Mobile bottom tab bar (hidden on desktop via CSS) */}
      <nav className="mobile-tab-bar" aria-label={t('nav.mainNavigation')}>
        {mobileTabItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobile-tab ${activeView === item.id ? 'mobile-tab--active' : ''}`}
            onClick={() => handleMobileNav(item.id)}
            aria-label={t(item.labelKey)}
          >
            {item.icon}
            <span className="mobile-tab-label">{t(item.labelKey)}</span>
          </button>
        ))}
        {/* More button */}
        <button
          type="button"
          className={`mobile-tab ${mobileMoreOpen ? 'mobile-tab--active' : ''}`}
          onClick={() => setMobileMoreOpen((prev) => !prev)}
          aria-label={t('nav.more')}
        >
          <MoreHorizontal size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
          <span className="mobile-tab-label">{t('nav.more')}</span>
        </button>

        {/* Overflow menu */}
        {mobileMoreOpen && (
          <>
            <div
              className="mobile-more-backdrop"
              onClick={() => setMobileMoreOpen(false)}
            />
            <div className="mobile-more-menu">
              <div className="mobile-more-header">
                <span className="mobile-more-title">{t('nav.more')}</span>
                <button
                  type="button"
                  className="mobile-more-close"
                  onClick={() => setMobileMoreOpen(false)}
                  aria-label={t('nav.closeMenu')}
                >
                  <X size={20} strokeWidth={2} />
                </button>
              </div>
              {mobileOverflowItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-more-item ${activeView === item.id ? 'mobile-more-item--active' : ''}`}
                  onClick={() => handleMobileNav(item.id)}
                >
                  {item.icon}
                  <span>{t(item.labelKey)}</span>
                </button>
              ))}
              <button
                type="button"
                className={`mobile-more-item ${activeView === 'settings' ? 'mobile-more-item--active' : ''}`}
                onClick={() => handleMobileNav('settings')}
              >
                <Settings size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
                <span>{t('nav.settings')}</span>
              </button>
            </div>
          </>
        )}
      </nav>
    </>
  );
}
