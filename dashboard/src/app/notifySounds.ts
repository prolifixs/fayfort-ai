/**
 * Notification sounds for members and staff (made with Web Audio, no files to download).
 * Members pick theirs in Settings; staff pick a normal and an urgent sound in the Notifications panel.
 * Choices and volume are kept on this device.
 */
export type SoundId = "chime" | "marimba" | "bell" | "alert" | "soft";
export type Audience = "member" | "staff";

export const SOUNDS: { id: SoundId; name: string; note: string }[] = [
  { id: "marimba", name: "Marimba", note: "Three rising wooden notes" },
  { id: "chime", name: "Chime", note: "Two bright notes" },
  { id: "bell", name: "Bell", note: "One rich ring that fades slowly" },
  { id: "alert", name: "Alert", note: "Two urgent double beeps" },
  { id: "soft", name: "Soft pop", note: "Gentle and short" },
];
export const DEFAULT_SOUND: SoundId = "marimba";
export const DEFAULT_URGENT_SOUND: SoundId = "alert";
export const DEFAULT_VOLUME = 75;

const KEYS = {
  member: { sound: "fayfort-member-sound", volume: "fayfort-member-sound-volume" },
  staff: { sound: "fayfort-staff-sound", urgent: "fayfort-staff-urgent-sound", volume: "fayfort-staff-sound-volume" },
};

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Preferences are best-effort when storage is unavailable. */
  }
}
const isSound = (value: string | null): value is SoundId => SOUNDS.some((sound) => sound.id === value);

export function soundChoice(audience: Audience, urgent = false): SoundId {
  const key = audience === "staff" && urgent ? KEYS.staff.urgent : KEYS[audience].sound;
  const saved = read(key);
  return isSound(saved) ? saved : urgent ? DEFAULT_URGENT_SOUND : DEFAULT_SOUND;
}
export function setSoundChoice(audience: Audience, sound: SoundId, urgent = false) {
  write(audience === "staff" && urgent ? KEYS.staff.urgent : KEYS[audience].sound, sound);
}
export function soundVolume(audience: Audience): number {
  const saved = Number(read(KEYS[audience].volume));
  return Number.isFinite(saved) && saved >= 10 && saved <= 100 ? saved : DEFAULT_VOLUME;
}
export function setSoundVolume(audience: Audience, volume: number) {
  write(KEYS[audience].volume, String(Math.max(10, Math.min(100, Math.round(volume)))));
}

let context: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    const AudioContextType = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextType) return null;
    if (!context || context.state === "closed") context = new AudioContextType();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(c: AudioContext, out: AudioNode, freq: number, start: number, duration: number, type: OscillatorType, peak: number) {
  const oscillator = c.createOscillator();
  const gain = c.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(out);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

/** Play a sound at a volume from 10 to 100. Silently does nothing until the browser allows audio. */
export function playSound(sound: SoundId, volume = DEFAULT_VOLUME) {
  const c = audio();
  if (!c) return;
  try {
    const out = c.createGain();
    const compressor = c.createDynamicsCompressor();
    out.gain.value = 0.9 * Math.max(0.1, Math.min(1, volume / 100));
    out.connect(compressor);
    compressor.connect(c.destination);
    const t = c.currentTime + 0.02;
    switch (sound) {
      case "chime":
        tone(c, out, 880, t, 0.55, "sine", 0.6);
        tone(c, out, 1760, t, 0.3, "sine", 0.12);
        tone(c, out, 1318.5, t + 0.16, 0.65, "sine", 0.6);
        tone(c, out, 2637, t + 0.16, 0.3, "sine", 0.1);
        break;
      case "marimba":
        [523.25, 659.25, 783.99].forEach((freq, index) => {
          tone(c, out, freq, t + index * 0.12, 0.6, "sine", 0.65);
          tone(c, out, freq * 4, t + index * 0.12, 0.08, "sine", 0.18);
        });
        break;
      case "bell":
        tone(c, out, 784, t, 1.8, "sine", 0.6);
        tone(c, out, 784 * 2.76, t, 1.0, "sine", 0.2);
        tone(c, out, 784 * 5.4, t, 0.5, "sine", 0.08);
        tone(c, out, 392, t, 1.2, "sine", 0.15);
        break;
      case "alert":
        [0, 0.16, 0.55, 0.71].forEach((delay) => tone(c, out, 988, t + delay, 0.13, "triangle", 0.75));
        [0.16, 0.71].forEach((delay) => tone(c, out, 1318.5, t + delay, 0.15, "triangle", 0.55));
        break;
      case "soft":
        tone(c, out, 660, t, 0.45, "sine", 0.35);
        tone(c, out, 990, t + 0.06, 0.35, "sine", 0.12);
        break;
    }
  } catch {
    /* Audio may be unavailable until the person interacts with the page. */
  }
}

/** The audience's chosen sound at their volume. */
export function playChosen(audience: Audience, urgent = false) {
  playSound(soundChoice(audience, urgent), soundVolume(audience));
}
