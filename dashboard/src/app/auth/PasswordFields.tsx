import { useId, useState } from "react";
import { PASSWORD_MIN_LENGTH, passwordProblems } from "./authLinks";

export interface PasswordPair {
  password: string;
  confirm: string;
}

/** Returns an error message for a new password pair, or "" when it can be submitted. */
export function passwordPairError({ password, confirm }: PasswordPair): string {
  if (password !== confirm) return "The passwords do not match.";
  const problems = passwordProblems(password);
  if (problems.length) return `Your password needs: ${problems.join(", ").toLowerCase()}.`;
  return "";
}

/** New + confirm password inputs with the policy shown as the person types. */
export function PasswordFields({
  value,
  onChange,
  newLabel = "New password",
  confirmLabel = "Confirm password",
}: {
  value: PasswordPair;
  onChange: (next: PasswordPair) => void;
  newLabel?: string;
  confirmLabel?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const problems = passwordProblems(value.password);
  const rules = [
    { label: `${PASSWORD_MIN_LENGTH}+ characters`, met: value.password.length >= PASSWORD_MIN_LENGTH },
    { label: "a letter", met: /[A-Za-z]/.test(value.password) },
    { label: "a number", met: /[0-9]/.test(value.password) },
  ];
  return (
    <>
      <label htmlFor={`${id}-new`}>{newLabel}</label>
      <input
        id={`${id}-new`}
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
        value={value.password}
        aria-describedby={`${id}-rules`}
        onChange={(event) => onChange({ ...value, password: event.target.value })}
      />
      <ul id={`${id}-rules`} className="password-rules" aria-label="Password requirements">
        {rules.map((rule) => (
          <li key={rule.label} className={rule.met ? "met" : ""}>
            {rule.met ? "✓" : "•"} {rule.label}
          </li>
        ))}
      </ul>
      <label htmlFor={`${id}-confirm`}>{confirmLabel}</label>
      <input
        id={`${id}-confirm`}
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
        value={value.confirm}
        onChange={(event) => onChange({ ...value, confirm: event.target.value })}
      />
      <label className="password-visibility">
        <input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /> Show
        passwords
      </label>
      {problems.length === 0 && value.confirm.length > 0 && value.confirm !== value.password && (
        <small className="password-mismatch">The passwords don't match yet.</small>
      )}
    </>
  );
}
