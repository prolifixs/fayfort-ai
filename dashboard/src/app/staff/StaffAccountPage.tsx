import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { AccountSecuritySection } from "../auth/MemberSecuritySection";
import { departmentLabel, relativeTime } from "./WorkforcePage";

interface OwnProfile {
  status: string;
  departments: string[];
  activated_at: string | null;
  last_sign_in_at: string | null;
  mfa_enrolled: boolean;
  current_work: { id: string; summary: string; status: string }[];
}

/** Control Center → My account: password, email and sessions for any staff member, plus a worker's own record. */
export function StaffAccountPage({
  accessToken,
  email,
  isWorker,
}: {
  accessToken: string;
  email: string;
  isWorker: boolean;
}) {
  const [profile, setProfile] = useState<OwnProfile | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isWorker) return;
    let mounted = true;
    apiRequest<{ worker: OwnProfile }>("/workers/me/profile", accessToken)
      .then((result) => mounted && setProfile(result.worker))
      .catch((reason) => mounted && setError(reason instanceof Error ? reason.message : "Your profile could not be loaded."));
    return () => {
      mounted = false;
    };
  }, [accessToken, isWorker]);

  return (
    <div className="staff-account-page">
      {isWorker && (
        <section className="control-panel" aria-label="Your worker record">
          <div className="panel-heading">
            <div>
              <h2>Your worker record</h2>
              <p>What FayFort administrators see about your account. Ask an administrator to change it.</p>
            </div>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {profile && (
            <dl className="worker-facts">
              <div>
                <dt>Status</dt>
                <dd>{profile.status}</dd>
              </div>
              <div>
                <dt>Departments</dt>
                <dd>{profile.departments.length ? profile.departments.map(departmentLabel).join(", ") : "None yet"}</dd>
              </div>
              <div>
                <dt>Open work</dt>
                <dd>{profile.current_work.length}</dd>
              </div>
              <div>
                <dt>Last sign-in</dt>
                <dd>{relativeTime(profile.last_sign_in_at)}</dd>
              </div>
              <div>
                <dt>Two-step verification</dt>
                <dd>{profile.mfa_enrolled ? "On" : "Not set up"}</dd>
              </div>
            </dl>
          )}
        </section>
      )}
      <div className="control-panel">
        <AccountSecuritySection audience="staff" email={email} hasPassword />
      </div>
    </div>
  );
}
