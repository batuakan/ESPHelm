# ADR-0026: Setup without configuration

Status: **Accepted** (2026-11-05)

## Context
Building firmware meant writing `secrets.yaml` first: the Wi-Fi network, its password and the SignalK server's address. To flash a display, people had to edit YAML. Prebuilt firmware was impossible, because every boat's values were compiled in.

What ESPHome and ESPHomeSignalK already offer:
- **Wi-Fi setup:** ESPHome's captive portal. A device with no network opens its own access point, and a page there saves the boat's network in flash.
- **Finding the server:** mDNS discovery of SignalK servers. It is on ESPHomeSignalK's `main`, and is used when no `host` is set.

A test build that removed the secrets showed four gaps:
1. **Token tied to no server:** the access token was saved under a fixed key. After a restart, it went to whichever server mDNS found first, and a 401 from that server erased it.
2. **Firmware upload:** the captive portal also accepts a firmware upload, so whoever joins the access point can flash the display. Its password was in the public repo.
3. **Lockout:** a mistyped Wi-Fi password, with the access point kept off once a network was saved, could only be undone by erasing the flash over USB.
4. **Setup screens:** there was nothing on the screen to say what to do.

Your choices:
- **Password:** random per display, shown on the screen with a QR code.
- **Access point:** only after a power-up, plus a *Forget* action.
- **Server:** a list and *Forget* on the display.

## Decision
- **No network and no server in the YAML** (`firmware/wifi.yaml`, `esphelm_p4.yaml`, the C3 check). Names get the MAC suffix (`esphelm-p4-a1b2c3`), so displays don't clash.
- **The setup network** is ESPHome's access point, named after the device.
  - **Password:** `esphelm_runtime` makes one per display, of 10 characters from 56 that can't be mistaken for each other (no 0/O/o, 1/l/I).
    - **Randomness:** the hardware RNG, with its entropy source enabled for that moment. The radio isn't on yet, and on the P4 it is on the network coprocessor.
    - **Storage:** it is made once and saved (LayoutStore slot `ap`).
    - **Before Wi-Fi starts:** it is set on the access point (the runtime's setup runs first).
    - **YAML:** a password in `wifi: ap:` is refused at config time.
    - **Not saved:** if saving fails, the password is still random, just a new one after every restart. The network is never open.
  - **When it opens:**
    - **No network saved:** at once.
    - **A network saved:** only when a power-up finds no Wi-Fi for 2 minutes (`ap_timeout: 2min`), so a typo is fixed with a power cycle.
    - **It closes** 10 minutes after power-up (`provisioning: timeout: 10min`).
    - **Never once connected:** the runtime turns the fallback off. The boat's router being off is no reason to open firmware upload.
- **Setup screens** (status page, only while no layout is shown; a cached layout stays up):
  - **Set up Wi-Fi:** the network's name, its password, and a QR code that phone cameras join from (`WIFI:T:WPA;S:..;P:..;;`). Then "choose the boat's network on the page that opens".
  - **Joining Wi-Fi.**
  - **Looking for a SignalK server.**
  - **Menu:** the status page has the menu button, so the Network tab is reachable before any layout exists.
- **The token belongs to one server** (ESPHomeSignalK):
  - **Binding:** the first server found, or the one chosen, is saved next to the token: host name, address, port and vessel id (pref 10001, bounded and checked on load).
  - **After a restart:** only that server is accepted, recognised as before by vessel id, or by host name and port. Its saved address is the fallback after 10 seconds, which also covers networks that block multicast.
  - **Never on its own:** the device doesn't move to another server.
  - **Old firmware:** a token without a saved server binds to the first server found, so nobody has to approve their display again.
  - **Unreachable server:** an HTTP request with no response starts a new search for the same server.
- **Settings panel: a third tab, *Network*** (between *Settings* and *Info*; the old Info section *Network* moves here):
  - **Wi-Fi:**
    - It shows the network, signal, IP and whether the setup network is on. While it is on, the panel shows its name, password and QR code.
  - **SignalK server:**
    - It shows the address and host name, and the stream state.
    - *Change server* searches with mDNS and lists up to 6 servers. Picking the same server keeps the token. Another one drops it, and the display asks that server for access.
    - *Forget server*, confirmed, drops the token and the server and searches again.
    - With `host:` in the YAML, it says "Set in the firmware" and offers nothing.
  - **Factory reset**, at the bottom of the tab under its own heading, apart from the Wi-Fi and server controls: it erases everything, not only the network. Confirmed with *Yes*, it is ESPHome's factory reset (`global_preferences->reset()`, as its `factory_reset` button does) and restarts into the setup network.
    - **Why not only the Wi-Fi network:** ESPHome can't forget one network (an empty one still counts as set). The first version erased ESPHome's NVS record by its key (`88491487`), which depends on ESPHome internals.
    - **What it erases:** ESPHome's reset erases the whole NVS partition: Wi-Fi, the SignalK token and server, the cached layouts, the display's choices and the setup password. The display then starts like a new one; the plugin still knows its id and gives it its layout back once it is approved again.
    - **Changed** 2026-11-06 from *Forget Wi-Fi* under the Wi-Fi section, to use what ESPHome provides; 2026-11-07 named *Factory reset* and moved to the bottom.

## Consequences
- **Building:** P4 and C3 builds no longer need `secrets.yaml`. The SDL builds still set their host and port, and the e2e passes them with `-s`.
- **First flash:** a display flashed from scratch (or after an erase) needs approval in SignalK, as before.
- **Upgrading from a build with compiled-in Wi-Fi:** the saved network isn't carried over, because ESPHome keys it by the build's config hash. The display opens its setup network once.
- **Who can flash it:** firmware can be uploaded by anyone who can read the screen while the setup network is open. That is the person in front of it, and only in the first minutes after a power-up without Wi-Fi.
- **Touch:** displays without touch can't use *Forget* or *Change server*. They rely on the power-up window and mDNS.
- **Build cost** (against `main` after ADR-0025):
  - **P4:** flash +74.3 KB (3,368,618 → 3,442,920 B, 20.8 %), RAM +724 B.
  - **C3:** flash +125.8 KB (1,480,876 → 1,606,628 B, 80.7 → 87.6 %), RAM +694 B. Its image is 1.61 MB of the 1.75 MB OTA slot, so the C3 has little room left for features.
  - **What it is:** the captive portal (with its web server and web OTA), `provisioning`, LVGL's QR code and canvas, and the Network tab.
- **Memory:** the Network tab is about 30 LVGL objects. The QR code is a 1-bit canvas of size² / 8 bytes while it shows (about 7 KB at 240 px), and nothing when closed.
- **Test hooks:**
  - `@settings tab-network`, `reset`, `forget-server`, `change-server`, `server=N`, `confirm`, `cancel`.
  - `ESPHELM_TEST_SERVERS=fixed`: two made-up servers, so the e2e never searches the LAN, where it would find a real server.
  - `ESPHELM_TEST_SETUP=ap|joining`: the setup screens on the host build, which has no Wi-Fi.
- **Not done:**
  - typing a server address on the display
  - prebuilt firmware per board in CI
  - firmware updates from the plugin
