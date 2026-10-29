import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldOff, Delete, Home, Plane, Moon, Loader2 } from 'lucide-react';
import { haFetch, callHaService, hasToken } from '../api/ha-rest';
import { useTranslation, type TranslationKey } from '../i18n';

interface AlarmViewProps {
  /** alarm_control_panel entity (Settings → Integrations → Alarm). */
  entityId: string;
}

type ArmService = 'alarm_arm_away' | 'alarm_arm_home' | 'alarm_arm_night' | 'alarm_disarm';

interface PanelState {
  state: string;
  friendlyName: string;
  /** Alarmo publishes 'number' when a code is needed for the next transition, null otherwise. */
  codeFormat: string | null;
  codeArmRequired: boolean;
  /** Alarmo attributes — present while arming/pending/triggered. */
  delay?: number;
  openSensors?: Record<string, string> | null;
}

const POLL_MS = 3_000;
const MAX_CODE_LENGTH = 8;
/** How long we wait for the panel to react before treating the code as rejected. */
const REJECT_AFTER_MS = 2_500;

const STATE_LABEL_KEYS: Record<string, TranslationKey> = {
  disarmed: 'alarm.state.disarmed',
  armed_away: 'alarm.state.armedAway',
  armed_home: 'alarm.state.armedHome',
  armed_night: 'alarm.state.armedNight',
  armed_vacation: 'alarm.state.armedVacation',
  armed_custom_bypass: 'alarm.state.armedCustom',
  arming: 'alarm.state.arming',
  pending: 'alarm.state.pending',
  triggered: 'alarm.state.triggered',
  unavailable: 'alarm.state.unavailable',
  unknown: 'alarm.state.unknown',
};

function toneFor(state: string): 'off' | 'armed' | 'transition' | 'alert' | 'dead' {
  if (state === 'disarmed') return 'off';
  if (state === 'triggered') return 'alert';
  if (state === 'arming' || state === 'pending') return 'transition';
  if (state === 'unavailable' || state === 'unknown') return 'dead';
  return 'armed';
}

function parsePanel(entity: { state: string; attributes: Record<string, unknown> }): PanelState {
  const attrs = entity.attributes;
  return {
    state: entity.state,
    friendlyName: (attrs.friendly_name as string) || 'Alarm',
    codeFormat: (attrs.code_format as string | null) ?? null,
    codeArmRequired: !!attrs.code_arm_required,
    delay: typeof attrs.delay === 'number' ? attrs.delay : undefined,
    openSensors: (attrs.open_sensors as Record<string, string> | null) ?? null,
  };
}

export function AlarmView({ entityId }: AlarmViewProps) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<PanelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<ArmService | null>(null);
  const [notice, setNotice] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [shake, setShake] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPanel = useCallback(async (): Promise<PanelState | null> => {
    if (!entityId) return null;
    try {
      const entity = await haFetch(`/api/states/${entityId}`) as { state: string; attributes: Record<string, unknown> } | null;
      if (!entity) throw new Error('empty state');
      const next = parsePanel(entity);
      setPanel(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'fetch failed');
      return null;
    }
  }, [entityId]);

  // Poll the panel state while the view is open
  useEffect(() => {
    if (!entityId || !hasToken()) return;
    fetchPanel();
    const interval = setInterval(() => {
      if (!document.hidden) fetchPanel();
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [entityId, fetchPanel]);

  const showNotice = useCallback((kind: 'error' | 'info', text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    noticeTimer.current = setTimeout(() => setNotice(null), 4_000);
  }, []);

  const rejectCode = useCallback((text: string) => {
    setCode('');
    setShake(true);
    setTimeout(() => setShake(false), 500);
    showNotice('error', text);
  }, [showNotice]);

  const pressDigit = (digit: string) => {
    setNotice(null);
    setCode((prev) => (prev.length >= MAX_CODE_LENGTH ? prev : prev + digit));
  };
  const backspace = () => setCode((prev) => prev.slice(0, -1));
  const clearCode = () => setCode('');

  const send = useCallback(async (service: ArmService) => {
    if (!entityId || busy || !panel) return;
    const before = panel.state;
    const needsCode = service === 'alarm_disarm' ? panel.codeFormat != null : panel.codeArmRequired;
    if (needsCode && !code) {
      rejectCode(t('alarm.enterCode'));
      return;
    }

    setBusy(service);
    setNotice(null);
    try {
      const data: Record<string, unknown> = { entity_id: entityId };
      if (code) data.code = code;
      await callHaService('alarm_control_panel', service, data);
    } catch (err) {
      // HA rejected the call outright (wrong code on panels that raise, open sensors, etc.)
      console.warn('AlarmView: service call failed', err);
      setBusy(null);
      rejectCode(t('alarm.codeRejected'));
      return;
    }

    // Alarmo answers a wrong code with an event + warning, not an HTTP error,
    // so confirm the panel actually moved. Expected moves: disarm → disarmed;
    // arm → arming (exit delay) or the armed mode.
    const deadline = Date.now() + REJECT_AFTER_MS;
    let moved = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      const now = await fetchPanel();
      if (!now) continue;
      if (service === 'alarm_disarm' ? now.state === 'disarmed' : now.state !== before) {
        moved = true;
        break;
      }
    }
    setBusy(null);
    if (moved) {
      setCode('');
    } else if (service === 'alarm_disarm' && before === 'disarmed') {
      // Already disarmed: nothing to move, but a wrong code is still worth saying.
      rejectCode(t('alarm.codeRejected'));
    } else {
      rejectCode(t('alarm.codeRejected'));
    }
  }, [entityId, busy, panel, code, rejectCode, fetchPanel, t]);

  if (!entityId) {
    return (
      <div className="alarm-view">
        <div className="alarm-empty">
          <ShieldOff size={48} strokeWidth={1.25} />
          <p>{t('alarm.notConfigured')}</p>
        </div>
      </div>
    );
  }

  if (!panel) {
    return (
      <div className="alarm-view">
        <div className="alarm-empty">
          {error ? <p>{t('alarm.unreachable')}</p> : <p>{t('alarm.loading')}</p>}
        </div>
      </div>
    );
  }

  const tone = toneFor(panel.state);
  const stateLabel = t(STATE_LABEL_KEYS[panel.state] ?? 'alarm.state.unknown');
  const StateIcon = tone === 'off' ? ShieldOff : tone === 'alert' ? ShieldAlert : tone === 'transition' ? Shield : ShieldCheck;
  const isDisarmed = panel.state === 'disarmed';
  const dead = tone === 'dead';
  const openSensorNames = panel.openSensors ? Object.keys(panel.openSensors) : [];

  const armButtons: Array<{ service: ArmService; labelKey: TranslationKey; icon: React.ReactNode }> = [
    { service: 'alarm_arm_away', labelKey: 'alarm.armAway', icon: <Plane size={26} strokeWidth={1.75} /> },
    { service: 'alarm_arm_home', labelKey: 'alarm.armHome', icon: <Home size={26} strokeWidth={1.75} /> },
    { service: 'alarm_arm_night', labelKey: 'alarm.armNight', icon: <Moon size={26} strokeWidth={1.75} /> },
  ];

  return (
    <div className="alarm-view">
      <section className={`alarm-banner alarm-banner--${tone}`} aria-live="polite">
        <StateIcon size={56} strokeWidth={1.5} className="alarm-banner-icon" />
        <div className="alarm-banner-text">
          <span className="alarm-banner-name">{panel.friendlyName}</span>
          <span className="alarm-banner-state">{stateLabel}</span>
          {panel.delay != null && tone === 'transition' && (
            <span className="alarm-banner-sub">{t('alarm.delaySeconds', { seconds: panel.delay })}</span>
          )}
          {openSensorNames.length > 0 && (
            <span className="alarm-banner-sub">{t('alarm.openSensors', { count: openSensorNames.length })}</span>
          )}
        </div>
      </section>

      <div className="alarm-body">
        {/* Keypad */}
        <section className={`alarm-keypad-panel${shake ? ' alarm-keypad-panel--shake' : ''}`}>
          <div className="alarm-code" aria-label={t('alarm.codeEntered', { count: code.length })}>
            {code.length === 0 ? (
              <span className="alarm-code-hint">{t('alarm.enterCode')}</span>
            ) : (
              Array.from({ length: code.length }).map((_, i) => <span key={i} className="alarm-code-dot" />)
            )}
          </div>
          <div className={`alarm-notice${notice ? ` alarm-notice--${notice.kind}` : ''}`}>
            {notice?.text ?? ' '}
          </div>
          <div className="alarm-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <button key={d} type="button" className="alarm-key" onClick={() => pressDigit(d)} disabled={dead}>
                {d}
              </button>
            ))}
            <button type="button" className="alarm-key alarm-key--soft" onClick={clearCode} disabled={dead || !code}>
              {t('alarm.clear')}
            </button>
            <button type="button" className="alarm-key" onClick={() => pressDigit('0')} disabled={dead}>
              0
            </button>
            <button
              type="button"
              className="alarm-key alarm-key--soft"
              onClick={backspace}
              disabled={dead || !code}
              aria-label={t('alarm.backspace')}
            >
              <Delete size={28} strokeWidth={1.75} />
            </button>
          </div>
        </section>

        {/* Actions */}
        <section className="alarm-actions">
          {armButtons.map(({ service, labelKey, icon }) => (
            <button
              key={service}
              type="button"
              className={`alarm-action alarm-action--arm${busy === service ? ' alarm-action--busy' : ''}`}
              onClick={() => send(service)}
              disabled={dead || busy !== null || !isDisarmed}
            >
              {busy === service ? <Loader2 size={26} className="alarm-spin" /> : icon}
              <span>{t(labelKey)}</span>
            </button>
          ))}
          <button
            type="button"
            className={`alarm-action alarm-action--disarm${busy === 'alarm_disarm' ? ' alarm-action--busy' : ''}`}
            onClick={() => send('alarm_disarm')}
            disabled={dead || busy !== null}
          >
            {busy === 'alarm_disarm' ? <Loader2 size={26} className="alarm-spin" /> : <ShieldOff size={26} strokeWidth={1.75} />}
            <span>{t('alarm.disarm')}</span>
          </button>
        </section>
      </div>
    </div>
  );
}
