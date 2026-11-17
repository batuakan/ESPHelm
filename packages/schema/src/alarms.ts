/**
 * Alarms panel text (ADR-0038), the one definition shared by the editor preview and the firmware
 * (firmware/components/esphelm_runtime/esphelm_alarm_age.h mirrors it;
 * fixtures/alarms.cases.json proves they agree).
 */

/** How long an alarm has been in its state: "now", "12 min", "3 h 05", "2 d". */
export function alarmAge(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} d`;
}

/** Whether `path` is `prefix` or under it (a whole segment: notifications.el is not under notifications.e). */
export function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}
