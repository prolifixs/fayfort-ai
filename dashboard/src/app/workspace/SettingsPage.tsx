import { apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useState } from "react";

export function SettingsPage({
  accessToken,
  businessId,
  canManage,
}: {
  accessToken: string;
  businessId: string;
  canManage: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createdAt, setCreatedAt] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<{
        business: { name: string; description?: string | null; created_at: string; updated_at: string };
      }>(`/businesses/${businessId}/settings`, accessToken);
      setName(data.business.name);
      setDescription(data.business.description || "");
      setCreatedAt(data.business.created_at);
      setUpdatedAt(data.business.updated_at);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Workspace settings could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await apiRequest(`/businesses/${businessId}/settings`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          expected_updated_at: updatedAt,
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      setSaved(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="control-panel" aria-label="Business settings">
      <div className="panel-heading">
        <div>
          <h2>Workspace settings</h2>
          <p>
            Edit the business display name and description. Higher-risk operational settings are not exposed until their
            behavior is defined.
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
      {saved && (
        <p className="success-note" role="status">
          Settings saved.
        </p>
      )}
      {loading ? (
        <p>Loading workspace details…</p>
      ) : (
        <>
          <form className="settings-form" onSubmit={save}>
            <label>
              Business name
              <input
                required
                minLength={1}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canManage}
              />
            </label>
            <label>
              Description
              <textarea
                maxLength={500}
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!canManage}
              />
            </label>
            {canManage ? (
              <button className="primary-button" disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </button>
            ) : (
              <p className="quiet-note">Only a business owner or admin can edit workspace settings.</p>
            )}
          </form>
          <div className="record-list">
            <div className="record">
              <div>
                <small>Business ID: {businessId}</small>
                <small>Created: {createdAt}</small>
                <small>Updated: {updatedAt}</small>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
