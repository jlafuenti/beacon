# Timers & Alarms tab (branch `timers-tab`)

A Beacon tab that lists every timer and alarm Home Assistant can see, with the
controls each source really supports. Built 2026-11-26. **Not shipped**: no
version bump, nothing pushed to `lafuenti`, nothing applied to `/config`.

## What it shows and how each control works

| Row | Read from | Pause / resume | Cancel / stop |
| --- | --- | --- | --- |
| Assist voice timer, Kiosk device (kitchen Echo `kitchen_jarvis`, kitchen display `kitchen_display`) | bridge: `conversation/process` "timer status" → `speech_slots.timers` | `esphome.<node>_vs_pause_timer` / `_resume_timer` `{timer_id}` | `esphome.<node>_vs_cancel_timer {timer_id}` |
| Assist voice timer, other satellite (Voice PE bedroom, Satellite1 living room, office reSpeaker) | same list | `conversation/process` "pause/resume the <name> timer" with the owner's `device_id` | "cancel the <name> timer" the same way |
| Tummy time (`timer.<child>_tummy_time`) | entity state | none (the script has no pause) | `script.log_activity {child, activity: tummy_time, activity_action: stop}` (Stop & log) or `cancel` (Discard). Never raw `timer.cancel` |
| Kiosk alarm (both kiosks) | `sensor.<p>_next_alarm`, `binary_sensor.<p>_alarm_ringing`, `sensor.<p>_alarm_snoozed_until` | Snooze: `button.<p>_snooze_alarm` while ringing | Stop: `button.<p>_stop_alarm` (ringing or snoozed); Skip next: `button.<p>_skip_next_alarm` |
| Office satellite firmware alarm | `switch.office_satellite_alarm_on` on, `time.office_satellite_alarm_time` | none | `switch.turn_off` |
| Voice alarm ("set an alarm for 7") | `sensor.voice_alarms` attribute `alarms` (needs the HA change below) | none | `script.voice_alarm_cancel_one {alarm_id}` |

Phone next-alarm sensors are deliberately left out (Jesse, 2026-11-26).

Cancel, Discard, Stop & log, Skip next and Turn off need a second tap within
3 s. Pause, Resume, Stop and Snooze on a ringing alarm act on the first tap.

### The bridge: `POST /beacon-action/timers` (server.js)

- `{op: 'list', voice, voice_max_age_ms, entity_ids}` returns the voice timers,
  device names/areas (one template render, cached 10 min) and the requested
  entity states.
- The voice list is cached in the add-on and shared by every open tab. HA is
  asked again only when the cache is older than `timersVoiceRefreshSeconds`
  (default 10 s, clamped 3-120) or right after a control. **Each ask is one
  conversation turn**, and the conversation logger is at `debug`, so with the
  tab open the log archive gets about 6 "timer status" turns a minute. Nothing
  polls while the tab is closed. The browser counts down every second between
  asks.
- `{op: 'control', action, timer_id, kiosk_node}` → the ESPHome action.
- `{op: 'control', action, text, device_id}` → `conversation/process`. The text
  must match `^(pause|resume|cancel) the .{1,80} timer$` and start with the
  action, so the bridge cannot be used to send arbitrary commands. Names that
  are not plain words fall back to the starting length ("the 45 minute timer").

### Not done, on purpose

- **Ringing voice timers.** A finished Assist timer leaves HA's list and rings on
  the device, so it disappears from the tab. The Kiosk API's `timerControl
  dismiss` could stop one on the display, but the add-on has no Kiosk API token
  and storing one in Beacon's settings file would expose it to the browser.
  Skipped.
- **Nav badge with the active count.** It would need the voice list polled while
  the tab is closed, which means conversation turns all day. Skipped.
- **Settings UI.** All keys are settings-file only, like `musicPlayerNames`.
- **A `sensor.kitchen_display_timers` package** (copy of `kitchen_timers.yaml`).
  Not needed: the bridge already lists the display's timers from HA core.

## Settings keys (`/beacon-data/beacon-settings`)

| Key | Default | Proposed value |
| --- | --- | --- |
| `timersVoiceEnabled` | `true` | `true` |
| `timersVoiceRefreshSeconds` | `10` | `10` |
| `timerKioskNodes` | `{}` | see below |
| `timerDeviceNames` | `{}` | see below |
| `tummyTimers` | `{}` | see below |
| `tummyTimerScript` | `script.log_activity` | default |
| `kioskAlarmDevices` | `[]` | see below |
| `satelliteAlarms` | `[]` | see below |
| `voiceAlarmsEntity` | `''` | `sensor.voice_alarms` (after the HA change) |
| `voiceAlarmCancelScript` | `script.voice_alarm_cancel_one` | default |

Merge into the settings file at ship time (read, merge, PUT; do not replace the file):

```json
{
  "timerKioskNodes": {
    "95b01e0ee2906c9d16e6075eba106954": "kitchen_jarvis",
    "8683d6b3d9af4ecdb0d5ad39aa584a69": "kitchen_display"
  },
  "timerDeviceNames": {
    "95b01e0ee2906c9d16e6075eba106954": "Kitchen Echo",
    "8683d6b3d9af4ecdb0d5ad39aa584a69": "Kitchen display",
    "bf037d6e9dd7a229d65a0e25cf14ac8c": "Living room",
    "236fca9b3ebe6566763c4e85ca057c5c": "Bedroom",
    "9192e7dafae2f780896b7d5ca1333373": "Office"
  },
  "tummyTimers": {
    "timer.cassandra_tummy_time": "Cassandra",
    "timer.seraphina_tummy_time": "Seraphina"
  },
  "kioskAlarmDevices": [
    { "prefix": "kitchen_kitchen_echo_show_5", "name": "Kitchen Echo" },
    { "prefix": "kitchen_display", "name": "Kitchen display" }
  ],
  "satelliteAlarms": [
    { "name": "Office Jarvis", "switchEntity": "switch.office_satellite_alarm_on", "timeEntity": "time.office_satellite_alarm_time" }
  ],
  "voiceAlarmsEntity": "sensor.voice_alarms"
}
```

## Proposed HA change: voice alarm store (not applied)

Files in this folder:

- `voice_alarms.yaml`: new package for `/config/packages/`. It adds
  `sensor.voice_alarms` (a trigger-based template that keeps the pending list in
  its `alarms` attribute) and `script.voice_alarm_cancel_one {alarm_id}`.
- `voice_alarm_run.yaml`: replacement for `script.voice_alarm_run`. The plain
  `delay` becomes a `wait_for_trigger` on `voice_alarm_cancel {id}` with the same
  timeout. The script fires `voice_alarm_added` when it starts and
  `voice_alarm_removed` when it fires or is cancelled.
- `backup-voice-alarm-2026-11-26.yaml`: the current `voice_alarm_set`,
  `voice_alarm_cancel` and `voice_alarm_run`, copied read-only from `/config`.

`automation.voice_alarm_set` and `automation.voice_alarm_cancel` do not change.
The voice command "cancel the alarm" still turns the whole script off. The
sensor clears whenever `script.voice_alarm_run` goes off and on HA start, so
that path needs no extra event.

The sensor's templates were rendered against simulated `this` and `trigger`
variables with `ha_eval_template`: add, remove, stale-entry pruning and the
generated id all work. The YAML itself has not been loaded into HA.

**What applying it needs:**

1. `script.voice_alarm_run` must be **off** (no pending voice alarm). Reloading
   scripts stops pending runs, so a waiting alarm would be lost.
2. Copy `voice_alarms.yaml` to `/config/packages/voice_alarms.yaml`. Packages are
   already enabled (`kitchen_timers.yaml` lives there).
3. Replace `voice_alarm_run` with `voice_alarm_run.yaml`, through the script
   editor or `ha_config_set_script`. That reloads scripts on its own.
4. Check the config, then reload **Template entities** and **Scripts** (Developer
   Tools → YAML). No restart is needed.
5. Test: say "set an alarm for <2 minutes from now>". `sensor.voice_alarms` shows
   it. Then `script.voice_alarm_cancel_one` with its id removes it, and nothing
   rings. Set one more and let it ring; it should drop off when it fires.

## Ship checklist (later, when no cooking timers are running)

1. On `timers-tab`: `npx vitest run`, `npm run build`, `bash scripts/check-beacon-sync.sh`.
2. Bump `version` in **both** `config.yaml` and `beacon/config.yaml` to the next
   `1.40.0-lafuenti.N`, and add a CHANGELOG line. Mirror again:
   `rm -rf beacon/src && cp -r src beacon/src && cp Dockerfile run.sh CHANGELOG.md server.js beacon/`.
3. Merge into `lafuenti` (PR in the fork), then push `lafuenti`.
4. `ssh ha 'ha store reload'`, then `ha_manage_app('79a953b1_beacon', action='update')`.
5. Merge the settings JSON above into `/beacon-data/beacon-settings` (leave
   `voiceAlarmsEntity` empty until the HA change is in).
6. Press `button.kitchen_display_reload_page`.
7. Live tests on a throwaway timer, never a cooking one:
   - Set a 10-minute timer on the Echo; Pause, Resume and Cancel it from the tab
     (ESPHome path).
   - Repeat on the living room Satellite1 (conversation path). Do it once with a
     named timer and once with an unnamed one.
   - Start and Discard tummy time.
8. Apply the voice alarm HA change (section above), then set `voiceAlarmsEntity`.
9. Update Atlas `Beacon Fork.md` (What the fork adds and Provenance).
