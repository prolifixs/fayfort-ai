/** Choose a notification sound and its volume, and hear it. Saved on this device (notifySounds.ts). */
import { useState } from "react";
import {
  SOUNDS,
  playSound,
  setSoundChoice,
  setSoundVolume,
  soundChoice,
  soundVolume,
  type Audience,
  type SoundId,
} from "./notifySounds";

function Play() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2.5v11l9.5-5.5z" />
    </svg>
  );
}

export function SoundPicker({ audience, withUrgent = false, disabled = false }: { audience: Audience; withUrgent?: boolean; disabled?: boolean }) {
  const [sound, setSound] = useState<SoundId>(() => soundChoice(audience));
  const [urgent, setUrgent] = useState<SoundId>(() => soundChoice(audience, true));
  const [volume, setVolume] = useState(() => soundVolume(audience));
  return (
    <div className="sound-picker">
      <div className="sound-picker-row">
        <label>
          {withUrgent ? "Sound" : "Notification sound"}
          <select
            value={sound}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value as SoundId;
              setSound(next);
              setSoundChoice(audience, next);
              playSound(next, volume);
            }}
          >
            {SOUNDS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.note}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="sound-test" disabled={disabled} onClick={() => playSound(sound, volume)}>
          <Play /> Test
        </button>
      </div>
      {withUrgent && (
        <div className="sound-picker-row">
          <label>
            Urgent sound (overdue work, alerts)
            <select
              value={urgent}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value as SoundId;
                setUrgent(next);
                setSoundChoice(audience, next, true);
                playSound(next, volume);
              }}
            >
              {SOUNDS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.note}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="sound-test" disabled={disabled} onClick={() => playSound(urgent, volume)}>
            <Play /> Test
          </button>
        </div>
      )}
      <label>
        Volume {volume}%
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={volume}
          disabled={disabled}
          aria-label="Notification volume"
          onChange={(event) => {
            const next = Number(event.target.value);
            setVolume(next);
            setSoundVolume(audience, next);
          }}
          onPointerUp={() => playSound(sound, volume)}
        />
      </label>
    </div>
  );
}
