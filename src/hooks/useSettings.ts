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
  /** Display names for media players by entity_id (no UI; set in the settings file). */
  musicPlayerNames: Record<string, string>;
  /** alarm_control_panel entity driven by the Alarm view. */
  alarmEntity: string;
  /** Show the Arm Night button on the Alarm view (off when the panel has no night mode). */
  alarmShowNight: boolean;
  /** Jump to the Alarm tab while the panel is arming, pending or triggered, then return (Lafuenti fork). */
  alarmAutoSwitch: boolean;
  /** camera entities on the Cameras tab, in order. */
  cameraIds: string[];
  /** camera entity → binary_sensor whose 'on' pulls the panel to that camera. */
  cameraMotionSensors: Record<string, string>;
  /** Jump to the Cameras tab when one of those sensors fires. */
  cameraAutoSwitch: boolean;
  /** Seconds to keep the camera up after every sensor is off again. */
  cameraAutoSwitchHold: number;
  // ---- Timers tab (Lafuenti fork; settings file only, no UI) ----
  /** List Assist voice timers from every satellite (one HassTimerStatus ask per refresh). */
  timersVoiceEnabled: boolean;
  /** How old the shared voice timer list may get before the add-on asks HA again (seconds, 3-120). */
  timersVoiceRefreshSeconds: number;
  /** Kiosk Satellite device_id → ESPHome node name; those timers are paused/cancelled by id. */
  timerKioskNodes: Record<string, string>;
  /** device_id → short name shown on a timer (overrides the HA device name). */
  timerDeviceNames: Record<string, string>;
  /** HA timer helper → child name, stopped or cancelled through `tummyTimerScript`, never timer.cancel. */
  tummyTimers: Record<string, string>;
  tummyTimerScript: string;
  /** Kiosk Satellite alarm entity stems: sensor.<prefix>_next_alarm, button.<prefix>_stop_alarm, ... */
  kioskAlarmDevices: Array<{ prefix: string; name: string }>;
  /** Satellite firmware alarms: an arm switch plus a time entity. */
  satelliteAlarms: Array<{ name: string; switchEntity: string; timeEntity: string }>;
  /** Sensor whose `alarms` attribute lists pending voice alarms ('' = none). */
  voiceAlarmsEntity: string;
  /** Script that cancels one voice alarm, called with { alarm_id }. */
  voiceAlarmCancelScript: string;
  photoDirectory: string;
  photoInterval: number;
  photoTransition: 'fade' | 'slide';
  /** cover crops to fill the screen; contain keeps the whole photo with black bars. */
  photoFit: 'cover' | 'contain';
  /** HA calendar every parent-role member also shows (e.g. the shared Family Calendar). '' = none. */
  sharedAdultCalendar: string;
  /** HA calendar every child-role member also shows. '' = none. */
  sharedChildCalendar: string;

  // Dashboard
  dashboardLayout: 'default' | 'classic' | 'compact';
  advancedDashboard: boolean;

  // Display
  screenSaverEnabled: boolean;
  /** Cycle the photo album (photo_directory) behind the screensaver clock. */
  screenSaverPhotos: boolean;
  /** A tap that wakes the screensaver returns to the Default View (Lafuenti fork). */
  screenSaverWakeHome: boolean;
  dimTimeout: number;       // minutes
  screenSaverTimeout: number; // minutes
  alwaysOnDisplay: boolean;
  showSeconds: boolean;
  kioskMode: boolean;

  // Chores
  choresEnabled: boolean;
  /** Adults' chores come from Grocy via HA (sensor + per-person todo lists) instead of Beacon's store. */
  grocyChoresEnabled: boolean;
  grocyChoresSensor: string;
  /** Member name → todo entity holding that person's due chores (default todo.<name>_s_chores). */
  grocyChoreLists: Record<string, string>;
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
    musicPlayerNames: {},
    alarmEntity: '',
    alarmShowNight: false,
    alarmAutoSwitch: true,
    cameraIds: [],
    cameraMotionSensors: {},
    cameraAutoSwitch: true,
    cameraAutoSwitchHold: 60,
    timersVoiceEnabled: true,
    timersVoiceRefreshSeconds: 10,
    timerKioskNodes: {},
    timerDeviceNames: {},
    tummyTimers: {},
    tummyTimerScript: 'script.log_activity',
    kioskAlarmDevices: [],
    satelliteAlarms: [],
    voiceAlarmsEntity: '',
    voiceAlarmCancelScript: 'script.voice_alarm_cancel_one',
    photoDirectory: config.photo_directory,
    photoInterval: config.photo_interval,
    photoTransition: 'fade',
    photoFit: 'contain',
    sharedAdultCalendar: '',
    sharedChildCalendar: '',

    dashboardLayout: 'default',
    advancedDashboard: false,

    screenSaverEnabled: true,
    screenSaverPhotos: false,
    screenSaverWakeHome: true,
    dimTimeout: 5,
    screenSaverTimeout: config.screen_saver_timeout,
    alwaysOnDisplay: false,
    showSeconds: false,
    kioskMode: false,

    choresEnabled: true,
    grocyChoresEnabled: false,
    grocyChoresSensor: 'sensor.grocy_chores',
    grocyChoreLists: {},
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
