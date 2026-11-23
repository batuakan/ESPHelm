# ADR-0047: Mute all sound

Status: **Accepted** (2026-11-23)

## Context
- **The request:** the people aboard want a display that stays quiet. Its alarm tones and clicks (ADR-0033) bother them.
- **Until now** an alarm tone stopped only when the alarm was acknowledged, cleared or the server went offline. The volume can't go below 10 % on purpose, so no setting silences alarms (ADR-0033).
- **The trade-off:** a boat display that can't be heard can miss an alarm. But a display people find annoying gets unplugged, which loses the banner too. Other displays, phones and the server's own alarms remain, and the owner decides.

## Decision
- **One switch, `settings.sound.mute`** (default false): no sound at all until it's switched back on.
  - **Alarm tones:** none, emergencies included. The owner chose this over letting emergencies through.
  - **Touch clicks:** none, whatever `touch` says.
  - **The alarm banner** and the `alarms` tile are unchanged: alarms show and can be acknowledged.
- **Set in two places**, like volume and touch (ADR-0033):
  - **In the editor:** *Display settings → Sound → Mute all sound*.
  - **On the display:** *Settings → Sound: on / off*. Saved in the display's choices: record `v=4` with `mu` and its base `Bm`; v1–v3 still read. The choice is dropped when the layout brings another value.
  - **While muted:** *Volume* and *Touch sounds* are greyed in both places.
- **Mitigations:**
  - **The footer** shows a crossed-out speaker in the warn colour while muted. It's drawn by the renderer, not a glyph. The editor's footer preview shows it too.
  - **Switching the sound back on** plays the worst alarm still asking for sound at once, even one that already sounded (`SoundPlayer::set_muted()` resets the played generation).
  - **The editor says** plainly that alarms make no sound while muted.
- **One rule:** `alarmSound()` (`packages/schema/src/sound.ts`) and `esphelm_sound.h` take a `muted` input that acts like offline: a playing tune stops, nothing starts. Cases are in `fixtures/sound.cases.json`.
- **Older firmware** refuses a layout with `sound.mute` (`UNKNOWN_FIELD`) and keeps its last good layout. Hence:
  - the firmware reports `capabilities.mute` in `hello`;
  - the editor offers the switch only to displays that report it;
  - the editor writes the field only while it's on.

## Consequences
- **Memory:** nothing per update; two bytes in the display's choices; the footer icon is one LVGL object, made only while muted.
- **Displays without touch** (the RLCD) have no settings panel and no footer: they're muted from the editor only, with no icon.
- **The host build** has no speaker; `ESPHELM_TEST_SOUND=1` shows the sound rows and the icon for the e2e screenshots.
- **Not done:** a timed mute, quiet hours, and letting emergencies through while muted.
