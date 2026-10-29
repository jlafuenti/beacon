import { useState, useCallback, useEffect, useMemo } from 'react';
import { getConfig } from '../config';
import { loadDataSync, loadServerData, saveData } from '../api/beacon-store';
import type { SidebarView } from '../components/Sidebar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Views that can be the startup screen (everything in the sidebar except Settings and the Leaderboard overlay). */
export type DefaultView = Exclude<SidebarView, 'settings' | 'leaderboard'>;

export interface BeaconSettings {
  // General
  familyName: string;
  saveConfigInBrowser: boolean;
  defaultView: DefaultView;
  timeFormat: '12h' | '24h';
  weekStartsOn: 0 | 1; // 0 = Sunday, 1 = Monday
  locale: string;
  /** Sidebar tab order. Views missing from the list are appended in default order. */
  navOrder: SidebarView[];
  /** Sidebar tabs removed from the nav (and from the digit shortcuts). */
  hiddenViews: SidebarView[];

  // Appearance
  themeId: string;
  autoDarkMode: boolean;
  darkModeStart: string; // "HH:mm"
  darkModeEnd: string;   // "HH:mm"
  fontScale: 'normal' | 'large' | 'extra-large';
  sidebarPosition: 'left' | 'right' | 'bottom';

  // Calendar
  defaultCalendar: string;
  permanentlyHiddenCalendars: string[];
  calendarColors: Record<string, string>;
  defaultEventDuration: 30 | 60 | 120;
  notificationMinutes: 5 | 10 | 15 | 30;
  /** What the week view's right-hand rail shows under Today. */
  calendarSidebarMode: 'tasks' | 'shopping';

  // Integrations
  weatherEntity: string;
  grocyEnabled: boolean;
  anylistEnabled: boolean;
  defaultGroceryList: string;
  groceryListIds: string[];
  /** HA todo entities shown on the Tasks tab (empty = every non-grocery list). */
  taskListIds: string[];
  defaultTaskList: string;
  /** Hide Beacon's built-in local To-Do and Shopping lists. */
  hideLocalLists: boolean;
  shoppingEntity: string;
  musicDefaultPlayer: string;
  /** media_player entities offered in the Music view (empty = every player). */
  musicPlayerIds: string[];
  /** alarm_control_panel entity driven by the Alarm view. */
  alarmEntity: string;
  photoDirectory: string;
  photoInterval: number;
  photoTransition: 'fade' | 'slide';

  // Dashboard
  dashboardLayout: 'default' | 'classic' | 'compact';
  advancedDashboard: boolean;

  // Display
  screenSaverEnabled: boolean;
  dimTimeout: number;       // minutes
  screenSaverTimeout: number; // minutes
  alwaysOnDisplay: boolean;
  showSeconds: boolean;
  kioskMode: boolean;

  // Chores
  choresEnabled: boolean;
  choresResetTime: string;  // "HH:mm"
  streakDays: number;
  currencySymbol: string;
  payoutSchedule: 'weekly' | 'monthly';
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'beacon-settings';

function buildDefaults(): BeaconSettings {
  const config = getConfig();

  return {
    familyName: config.family_name,
    saveConfigInBrowser: config.save_config_in_browser,
    defaultView: 'dashboard',
    timeFormat: '12h',
    weekStartsOn: 0,
    locale: 'en-US',
    navOrder: [],
    hiddenViews: [],

    themeId: config.theme,
    autoDarkMode: config.auto_dark_mode,
    darkModeStart: '19:00',
    darkModeEnd: '06:00',
    fontScale: 'normal',
    sidebarPosition: 'left',

    defaultCalendar: '',
    permanentlyHiddenCalendars: [],
    calendarColors: {},
    defaultEventDuration: 60,
    notificationMinutes: 10,
    calendarSidebarMode: 'shopping',

    weatherEntity: config.weather_entity,
    grocyEnabled: false,
    anylistEnabled: false,
    defaultGroceryList: '',
    groceryListIds: [],
    taskListIds: [],
    defaultTaskList: '',
    hideLocalLists: false,
    shoppingEntity: '',
    musicDefaultPlayer: '',
    musicPlayerIds: [],
    alarmEntity: '',
    photoDirectory: config.photo_directory,
    photoInterval: config.photo_interval,
    photoTransition: 'fade',

    dashboardLayout: 'default',
    advancedDashboard: false,

    screenSaverEnabled: true,
    dimTimeout: 5,
    screenSaverTimeout: config.screen_saver_timeout,
    alwaysOnDisplay: false,
    showSeconds: false,
    kioskMode: false,

    choresEnabled: true,
    choresResetTime: '00:00',
    streakDays: 7,
    currencySymbol: '$',
    payoutSchedule: 'weekly',
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function loadSettingsAsync(): Promise<BeaconSettings> {
  const defaults = buildDefaults();
  const configAllowsBrowserStorage = getConfig().save_config_in_browser;
  const serverStored = await loadServerData<Partial<BeaconSettings>>(STORAGE_KEY);
  const stored = serverStored ?? (configAllowsBrowserStorage
    ? loadDataSync<Partial<BeaconSettings>>(STORAGE_KEY, {})
    : {});
  return {
    ...defaults,
    ...stored,
    // The add-on configuration is authoritative: it can disable browser
    // storage, while the user preference can opt out when config allows it.
    saveConfigInBrowser: configAllowsBrowserStorage && (stored.saveConfigInBrowser ?? true),
  };
}

function persistSettings(settings: BeaconSettings): void {
  const browserStorage = getConfig().save_config_in_browser && settings.saveConfigInBrowser;
  if (!browserStorage) {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
  saveData(STORAGE_KEY, settings, { browserStorage });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSettings() {
  const [settings, setSettingsState] = useState<BeaconSettings>(buildDefaults);
  const [loaded, setLoaded] = useState(false);

  /** Re-fetch settings from server. */
  const refresh = useCallback(async () => {
    const serverSettings = await loadSettingsAsync();
    setSettingsState(serverSettings);
    setLoaded(true);
  }, []);

  // Fetch from server on mount, update if server has newer data
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-fetch when the app becomes visible (mirror ha-entity-store pattern)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  // Persist whenever settings change
  useEffect(() => {
    if (loaded) persistSettings(settings);
  }, [settings, loaded]);

  /** Update one or more settings fields. Changes apply immediately. */
  const updateSettings = useCallback(
    (patch: Partial<BeaconSettings>) => {
      setSettingsState((prev) => ({ ...prev, ...patch }));
    },
    [],
  );

  /** Reset all settings to defaults (merged with config.yaml values). */
  const resetSettings = useCallback(() => {
    const defaults = buildDefaults();
    setSettingsState(defaults);
    persistSettings(defaults);
  }, []);

  /** Export current settings as a JSON string. */
  const exportSettings = useCallback((): string => {
    return JSON.stringify(settings, null, 2);
  }, [settings]);

  /** Import settings from a JSON string. Invalid JSON is silently ignored. */
  const importSettings = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json);
      const defaults = buildDefaults();
      setSettingsState({ ...defaults, ...parsed });
    } catch {
      // invalid JSON — do nothing
    }
  }, []);

  /** Clear all Beacon data from localStorage. */
  const clearLocalStorage = useCallback(() => {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('beacon')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    } catch {
      // ignore
    }
  }, []);

  const defaults = useMemo(() => buildDefaults(), []);

  return {
    settings,
    defaults,
    /** True once the server-side (or browser) copy has been merged in. */
    loaded,
    updateSettings,
    resetSettings,
    exportSettings,
    importSettings,
    clearLocalStorage,
    refresh,
  };
}
