# ADR-0044: A display's SignalK access in the editor: expiry warning, Remove that revokes

Status: **Accepted** (2026-11-22)

## Context
- **How a display gets access (ADR-0003):** a SignalK access request with read/write, approved by an admin in SignalK's admin UI. That gives a device token, and the device appears under *Security → Devices* with its `clientId`, which is the display's ESPHelm id.
- **Expiry:** the approval dialog takes an expiration. With anything but NEVER, the token runs out. ESPHomeSignalK then gets 401 at its next token check, drops the token and sends a new access request. Recovery works, but the display stops showing live values until someone approves it again, and nothing in ESPHelm warned.
- **Removing:** the editor had no way to remove a display; only the plugin had `DELETE /plugins/esphelm/api/devices/:id`. Removing a display there left its SignalK token valid. A lost or stolen display kept read/write access, and said hello again within seconds, coming back as pending.
- **What signalk-server offers:**
  - `GET /skServer/security/devices` lists `{ clientId, permissions, description, tokenExpiry? }`. `tokenExpiry` is the JWT's `exp` in Unix seconds, absent for NEVER. 2.17 and 2.19 don't record it; 2.26 does.
  - `DELETE /skServer/security/devices/:uuid` deletes the device and saves the security config.
  - Both are admin REST, which its own admin UI uses, and present from 2.17.2 to 2.37. With security off they answer 401.
  - **Revoking takes effect:**
    - A device token is only accepted while its `clientId` is in `devices`.
    - An open WebSocket is checked again at most once a minute, on a delta (`verifyWS`), and closed when the token fails.
    - The plugin's own routes refuse the token at once.

## Decision
- **The editor talks to SignalK's admin REST itself.**
  - **Why that's safe:** it runs in the admin's browser on the same origin, and the admin login it needs for the plugin's API covers `/skServer/security` too.
  - **The alternative, rejected:** the plugin calling `app.securityStrategy` and saving the security config itself. That is internal to signalk-server, not plugin API.
  - **No change outside the editor:** none in the plugin, the schema or the firmware.
- **Expiry line:**
  - **Where it comes from:** the editor reads SignalK's device list with the displays (every 5 s).
  - **What a real display's row shows:**
    - a token with `tokenExpiry`: *SignalK access until …*;
    - within 30 days, a warning: *ends in N days: remove the display and approve it again with no expiration*;
    - once past: *expired …; the display has asked for access again*.
  - **No line:** for NEVER, for servers that don't record the expiry, when the list can't be read (security off), and for demo displays.
- **Remove display** (under the selected display, after an inline confirmation):
  - **Order:** first `DELETE /skServer/security/devices/:id`, then the plugin's `DELETE /devices/:id`. Removed only from the plugin, the display would come straight back.
  - **Failures:** a 404 from SignalK counts as revoked. Any other failure still removes the display from ESPHelm, and the editor says to remove it under *Security → Devices*.
  - **Security off:** SignalK's list can't be read, so nothing is revoked, and nothing needs to be.
  - **The layout stays.** Layouts are separate from displays.

## Consequences
- **Removing is also how to re-pair.** A removed display that is still powered gets 401 within about a minute and sends a new access request. Approve it in SignalK and adopt it again.
  - The same is the only way to give an expiring display a token without expiry: SignalK can't extend a token.
- **Expiry needs a newer server.** On 2.17/2.19 nothing shows, as for NEVER.
- **Leftovers:** SignalK devices with no ESPHelm display, e.g. displays removed before this change, stay in SignalK's own *Security → Devices*.
- **Testing:**
  - Editor unit tests cover the expiry line, the remove order, a refused revoke, security off and demo displays.
  - The editor e2e runs against a real signalk-server with security on. It covers a display approved for 20 days (warned on servers that record the expiry), Remove (gone from both lists, its token refused) and the other displays untouched. It passes on 2.17.2 and 2.26.0.
  - The SDL e2e (step 9o) deletes the display's device in SignalK and checks that it asks for access again by itself, then reconnects once approved.
