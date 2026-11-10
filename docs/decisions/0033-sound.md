# ADR-0033: Sound: alarm tones and touch clicks

Status: **Accepted** (2026-11-10)

## Context
- **The request:** the P4 should sound SignalK alarms and click when a button on the display is touched.
- **The hardware:** the Waveshare P4-86 has:
  - an ES8311 codec on the I2C bus (0x18);
  - I2S on MCLK 13, LRCLK 10, BCLK 12 and DOUT 9;
  - an NS4150B amplifier enabled by GPIO53 (active high);
  - an MX1.25 connector for an 8 Ω 2 W speaker.

  The pins come from Waveshare's wiki and a community ESPHome config; the board's BSP calls the amplifier pin `BSP_POWER_AMP_IO`.
- **ESPHome** has every part already: `i2s_audio`, `audio_dac: es8311`, `speaker`, and `rtttl`, which plays tone melodies on a speaker (or a PWM output). The other boards (Guition, CYD, C3) have no speaker.
- **SignalK** already says which alarms should be heard: a notification's `method` lists `"visual"` and/or `"sound"`, and acknowledging one (ADR-0014) removes `"sound"`.

## Decision
**Tones, not sound files.**
- **The tunes:** short RTTTL strings, played by ESPHome's `rtttl`. Defaults are built in (`__init__.py`, `SOUND_TUNES`), and each can be replaced in the YAML.
- **Why not files:** WAV files would cost tens of KB of flash each and need a licensed source.

**The board's YAML wires the audio; the runtime decides what plays.**
- **Wiring:** `esphelm_runtime: sound: { rtttl, speaker }` names the `rtttl` component and, for the volume, its speaker. Without `sound:`, no sound code is compiled (`USE_ESPHELM_SOUND`), and `hello` reports `capabilities.sound: false`.
- **Amplifier:** the P4's hardware package turns it on at boot (a GPIO `switch`, `ALWAYS_ON`).

**Alarms follow SignalK.** Only notifications whose `method` contains `"sound"` and that aren't acknowledged count; the worst of them picks the tune.
- **Repeats** (`ALARM_REPEAT_MS`, one rule in `packages/schema/src/sound.ts`, mirrored by `esphelm_sound.h`, checked against `fixtures/sound.cases.json` in TS and g++):
  - `alert` and `warn` play once.
  - `alarm` repeats 5 s after each start.
  - `emergency` repeats back to back.
- **New tunes:** a notification that newly asks for sound (new, a new state, or `"sound"` added back; `AlarmBanner::sound_generation()`) plays at once, even over a tune that's playing.
- **Stopping:** the tune stops when its alarm is acknowledged (here, on another display or in another app) or cleared, and when the server goes offline. Offline, an alarm's state is unknown and it can't be acknowledged, so a tune that can't be stopped is worse; the banner still shows the alarm.

**Clicks:**
- **The hook:** one LVGL input-device callback (`LV_EVENT_PRESSED`) receives the pressed object. No code is needed per widget.
- **When it clicks:** when that object, or a parent its events bubble to, has an event handler (tiles that react, buttons, sliders, the footer). It doesn't click on bare backgrounds, disabled controls, or a touch that only wakes the screen.
- **Alarms first:** a click never interrupts an alarm tune.

**Controls, like brightness (ADR-0015, ADR-0025):**
- **Layout:** `settings.sound: { volume 10–100 %, touch }` (defaults 60 % and on), set in the editor's *Display settings → Sound*.
- **On the display:** the *Settings* tab's *Volume* slider and *Touch sounds* button override the layout's values, saved in the display's choices (record `v=2`; `v=1` records still read). They're dropped when the layout brings other values.
- **Volume floor:** 10 %, so a volume setting never mutes alarms.
- **How it's applied:** the speaker's volume, which goes to the ES8311; without a speaker in the config, rtttl's gain.

## Consequences
- **Any board with a speaker** (or a PWM buzzer through `rtttl: output:`) gets sound by adding `sound:`. The other boards' builds don't change.
- **Touch clicks need no widget code,** so new widgets click for free. A widget with a handler on a purely decorative object would click too.
- **The P4 needs `CONFIG_ESP_HOSTED_DFLT_TASK_FROM_SPIRAM`:** without it the audio's few KB of IRAM left the main task no early internal heap and the board boot-looped (`docs/phase6-notes.md`).
- **Codecs that pop when their clock starts** (the ES8311 does) need the speaker kept running: `rtttl` → `mixer` → an I2S speaker with `timeout: never`, plus a silent tune at boot with the amplifier off. This is per board, in its hardware YAML; see the P4's.
- **The microphone** (ES7210) is not used.
- **Not done:**
  - per-alarm tunes;
  - muting alarms for a while on the display, which acknowledging does;
  - sound while the screen is off;
  - a separate alarm volume.
