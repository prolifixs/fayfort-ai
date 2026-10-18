import { playChosen } from "./notifySounds";

const MEMBER_SOUND_KEY = "fayfort-member-sounds-enabled";

export function memberSoundsEnabled(): boolean {
  try { return window.localStorage.getItem(MEMBER_SOUND_KEY) !== "off"; }
  catch { return true; }
}

export function setMemberSoundsEnabled(enabled: boolean): void {
  try { window.localStorage.setItem(MEMBER_SOUND_KEY, enabled ? "on" : "off"); }
  catch { /* Sound preference is best-effort when storage is unavailable. */ }
}

export function playMemberSound(): void {
  if (!memberSoundsEnabled()) return;
  playChosen("member");
}
