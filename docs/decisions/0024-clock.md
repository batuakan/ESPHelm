# ADR-0024: Clock tile, time zones and the clock screen saver

Status: **Accepted** (2026-11-04)

## Context
You asked for:
- **A clock tile:** the time and/or date.
- **A screen saver:** after the screen timeout, a faint time and/or date instead of a black screen (ADR-0015).

What was missing:
- **No clock on the display.** The firmware never knew the time.
- **No time zone in SignalK.** It has no standard path for one, and an ESP32 has no zone database.
- **Weather and clock came from HomeAssistant** in the legacy apps (open question 2 in CLAUDE.md).

Your choices:
- **Time source:** SignalK, with an NTP or HomeAssistant time as an option in the firmware YAML.
- **Time zone:** picked in the editor.

## Decision
- **The display keeps its own clock.**
  - **Sources:**
    - `settings.clockPath` (default `navigation.datetime`, GPS time as an ISO 8601 string).
    - Optionally the board's ESPHome `time:` component (`time_id:` in the runtime config: SNTP, HomeAssistant). It's used when SignalK hasn't sent a time for ten minutes.
  - **Offline:** between updates the clock runs on `millis()`, so it keeps time offline.
  - **Untrusted input:** a value that isn't an ISO date-time, or is before 2020 (a GPS without a fix, replayed data), is ignored.
  - **No `settimeofday`:** the SDL host build never touches the computer's clock.
- **The time zone travels as a POSIX TZ rule** in the layout: `settings.timeZone = { name, posix }`.
  - **What it holds:** the rule (`<+01>-1<+02>,M3.5.0,M10.5.0/3`) includes summer time, so the display switches offline with no zone database.
  - **Where it comes from:** the editor builds it from the browser's zone data (`posixTz()` in `clock.ts`).
    - **How:** it finds the year's two changes and writes them as `Mm.w.d/time` rules.
    - **Check:** it then checks the rule against `Intl` for the whole year. Every one of the 418 zones Node knows matches for 2026.
    - **Fallback:** a zone that changes more than twice a year gets its current fixed offset.
  - **Parsing:** `localOffset()` reads the restricted form, in TS and in C++ (`esphelm_clock.h`), so the device doesn't depend on newlib's `TZ`/`tzset` or on global state.
  - **Default:** the editor gives a layout the browser's zone when its first clock tile is added. Without a zone it's UTC.
- **The clock tile:**
  - **Fields:** `show` (`time`, `date`, `both`), `hour12`, `seconds`, `dateFormat` (`ymd`, `dmy`, `mdy`, `weekday`), `utc`, `label`.
  - **No `path`:** older firmware doesn't list `clock` in its hello, so the plugin refuses such a layout (`UNSUPPORTED_WIDGET`).
  - **Fonts:** the time uses the digits-only fonts, which gain `:`. A font without `:` (an older board YAML) is skipped for the time.
  - **Before the first time:** it shows `--`, muted.
- **The screen saver:** `settings.screenSaver` (`off`, `time`, `date`, `both`) and `screenSaverBrightness` (1–30 %, default 5).
  - **What it shows:** the time and/or date on the sleep cover, in the theme's muted colour, written like the layout's first clock tile (else 24-hour with the weekday date).
  - **Backlight:** dimmed, not turned off.
  - **Waking:** a touch wakes the screen through the cover, as before. An alarm wakes it too.
  - **Not known yet:** until the display knows the time, the screen goes dark as before.
- **Shared text:** `clockTime()`, `clockDate()`, `parseIsoUtc()` and `localOffset()` live in `packages/schema/src/clock.ts`. `esphelm_clock.h` mirrors them, and `fixtures/clock.cases.json` is checked by a TS test and a g++ test. The offsets in the cases come from `Intl`.

## Consequences
- **The P4 stays lit:** while the saver shows, the backlight is dimmed, not off, so it uses a little power, and LVGL isn't paused.
  - **Touch check:** the board YAML pauses LVGL only when the light turns off.
  - **Change:** the runtime's "touch handled by the YAML" check is skipped while the saver shows.
- **Drift:** the clock drifts with the board's crystal until the next update. GPS time arrives about once a second, so that only matters offline.
- **Rules that change:** a zone that changes its rules gets the new ones when the layout is next saved. Morocco's Ramadan pauses can't be written as a POSIX rule, so its rule is right only for the year it was built.
- **No timestamp guess:** SignalK's delta timestamps aren't used as a source. They come from the server's clock, which may be no better than the display's, and every path would need parsing.
- **Memory:** a clock tile is up to four labels and a few bytes of state. The saver adds two labels on the sleep cover, created on first use. Nothing is allocated per update.
- **Build cost** (against `main`): flash +14.8 KB on the P4 (3,338,324 → 3,353,082 B) and +11.7 KB on the C3 (1,453,392 → 1,465,140 B, 79.2 → 79.8 %): the clock code, `:` in the two digit fonts, the clock settings in the model. Static RAM +224 B on both.
