# ADR-0009: Footer page navigation; only the visible page is built

Status: **Accepted** (Phase 5a, 2026-10-25)

## Context
Phase 5a brings multi-page layouts forward from Phase 6, because the legacy apps being ported (wind, speeds, energy, engine, switchboard) are separate screens. The legacy YAML apps switch screens by swiping.

You chose: "drop swiping and switch to a footer on the bottom of the display, with buttons on the left and right to move between the pages."

Boards without PSRAM (C3/C6, still in scope) can't hold several pages of LVGL objects at once. The measured cost is about 2 KB per tile on the host build, and up to 21 KB for an 8-switch page.

## Decision
- **Navigation is a footer.** When a layout has more than one page, the runtime splits its container into the page area and a footer: a `<` button on the left, a `>` button on the right, and "title n/m" between them. The buttons are disabled at the ends; there is no wrap-around and no swiping. A one-page layout has no footer.
- The footer is **display UI, not layout data.** The schema doesn't change: page order is the `pages` array, and the footer text is the page `title` (else its id).
- **Only the visible page is built.** Changing page deletes the page's LVGL objects and widgets and builds the next one. Subscriptions are re-derived from the new page; the server replays cached values, so the page fills in immediately.
- Footer presses are **deferred to `loop()`**, because the rebuild deletes the button whose event is running.
- The page index survives an update of the same layout id (clamped if pages were removed). It is not persisted: a reboot starts at page 1.

## Consequences
- Memory is bounded by the largest page, not the whole layout. Switching pages costs one rebuild (a few ms on the host) plus a resubscribe on the same socket.
- The footer takes about 11 % of the height (2.2 × small-font line height). The editor's canvas preview reserves the same strip.
- Swipe navigation, page persistence across reboots and an auto-return to a home page are not built. They can be added later without a schema change.
- Hardware feel (button size, touch accuracy on the P4 panel) is unverified until the hardware check.
