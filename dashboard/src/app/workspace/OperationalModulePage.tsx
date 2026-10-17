import { apiRequest } from "../../lib/api";
import { useCallback, useEffect, useState } from "react";
import type { OperationalRecord } from "./types";
import { FayfortLoader } from "../brand/FayfortLogo";

export const operationalRoutes: Record<string, { path: string; collection?: string }> = {
  "Directory & Tools": { path: "directory/tools", collection: "tools" },
  Channels: { path: "channels", collection: "events" },
  Entitlements: { path: "entitlements", collection: "entitlements" },
  Verification: { path: "verification", collection: "decisions" },
  Settings: { path: "settings" },
};

export function OperationalModulePage({
  module,
  accessToken,
  businessId,
}: {
  module: string;
  accessToken: string;
  businessId: string;
}) {
  const [rows, setRows] = useState<OperationalRecord[]>([]);
  const [summary, setSummary] = useState<OperationalRecord>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const route = operationalRoutes[module];
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<Record<string, unknown>>(`/businesses/${businessId}/${route.path}`, accessToken);
      const values = route.collection ? data[route.collection] : undefined;
      setRows(Array.isArray(values) ? (values as OperationalRecord[]) : []);
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : `${module} could not be loaded.`);
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId, module, route]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const settingsBusiness = summary.business as OperationalRecord | undefined;
  return (
    <section className="control-panel" aria-label={`${module} workspace`}>
      <div className="panel-heading">
        <div>
          <h2>{module === "Channels" ? "Inbound activity" : module}</h2>
          <p>
            {module === "Directory & Tools"
              ? "Available directory tools and their access rules."
              : module === "Channels"
                ? "What each connected channel has received recently, so you can spot a channel that has gone quiet."
                : module === "Entitlements"
                  ? "Business-level access grants. No subscription tiers or prices are inferred."
                  : module === "Verification"
                    ? "Directory access decisions and verification outcomes recorded for this business."
                    : module === "Analytics"
                      ? "Counts and recent activity derived from saved business events."
                      : "Workspace identity and configuration status."}
          </p>
        </div>
        <button onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <FayfortLoader label={`Loading ${module.toLowerCase()}…`} />
      ) : (
        <>
          {module === "Settings" && settingsBusiness && (
            <>
              <div className="record-list">
                <div className="record">
                  <div>
                    <strong>{String(settingsBusiness.name || "Business")}</strong>
                    <small>Business ID: {String(settingsBusiness.id)}</small>
                    <small>Created: {String(settingsBusiness.created_at || "—")}</small>
                    <small>Updated: {String(settingsBusiness.updated_at || "—")}</small>
                  </div>
                </div>
              </div>
              <p className="quiet-note">
                Workspace settings are read-only. Editable settings aren’t available because the API does not yet define
                a safe settings allowlist.
              </p>
            </>
          )}
          {module === "Verification" && (
            <p className="quiet-note">
              This is an audit history view. Field-level approval and reviewer history are not yet implemented, so this
              page does not change verification status.
            </p>
          )}
          {rows.length === 0 ? (
            module === "Settings" ? null : (
              <p className="empty-copy">
                {module === "Directory & Tools"
                  ? "No directory tools are currently registered."
                  : module === "Channels"
                    ? "No inbound channel events have been recorded yet."
                    : module === "Entitlements"
                      ? "No access grants are recorded for this business."
                      : module === "Verification"
                        ? "No directory access decisions have been recorded yet."
                        : "No business activity events have been recorded yet."}
              </p>
            )
          ) : (
            <div className="record-list">
              {rows.map((row, index) => (
                <div className="record" key={String(row.id || row.entity_id || row.tool_id || index)}>
                  <div>
                    {Object.entries(row).map(([key, value]) => (
                      <small key={key}>
                        <strong>{key.replaceAll("_", " ")}: </strong>
                        {value === null || value === undefined
                          ? "—"
                          : typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value)}
                      </small>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
