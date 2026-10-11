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
  try {
    const AudioContextType = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextType) return;
    const context = new AudioContextType();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.setValueAtTime(560, context.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.09, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.23);
    oscillator.onended = () => { void context.close(); };
  } catch { /* Audio may be unavailable until the user interacts with the page. */ }
}
