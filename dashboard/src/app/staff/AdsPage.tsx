import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiRequestError, API_BASE, apiRequest } from "../../lib/api";
import { CustomAd, type AdCreative, type AdShape } from "../member/ads";
import { FayfortLoader } from "../brand/FayfortLogo";

/** Control Center → Ads (docs/ADS_PLAN.md): Google AdSense, placements, FayFort's own ads and their results. */

type Tab = "settings" | "placements" | "creatives" | "results";
const TABS: [Tab, string][] = [
  ["settings", "Settings"],
  ["placements", "Placements"],
  ["creatives", "Custom ads"],
  ["results", "Results"],
];

type Settings = {
  enabled: boolean;
  google_enabled: boolean;
  google_client: string | null;
  google_test_mode: boolean;
  max_per_screen: number;
  updated_at?: string;
};
type Placement = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  source: "google" | "custom" | "google_then_custom";
  google_slot_id: string | null;
  google_format: "auto" | "fluid" | "rectangle" | "horizontal";
  google_layout_key: string | null;
  shape: AdShape;
  priority: number;
};
type Creative = AdCreative & {
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  placements: string[];
  weight: number;
  starts_at: string | null;
  ends_at: string | null;
  is_placeholder?: boolean;
};
type Counts = { impressions: number; clicks: number; google_impressions?: number; custom_impressions?: number };
type Overview = {
  settings: Settings;
  placements: Placement[];
  creatives: Creative[];
  stats: { days: number; placements: Record<string, Counts>; creatives: Record<string, Counts> };
  ads_txt: string | null;
};

const SOURCE_LABELS: Record<Placement["source"], string> = {
  google_then_custom: "Google, then custom",
  google: "Google only",
  custom: "Custom only",
};
const FORMAT_LABELS: Record<Placement["google_format"], string> = {
  auto: "Responsive display",
  horizontal: "Horizontal banner",
  rectangle: "Rectangle",
  fluid: "In-feed (fluid)",
};

function rate(counts?: Counts) {
  if (!counts || !counts.impressions) return "—";
  return `${((counts.clicks / counts.impressions) * 100).toFixed(1)}%`;
}

export function AdsPage({ accessToken }: { accessToken: string }) {
  const [tab, setTab] = useState<Tab>("settings");
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Overview>("/platform/ads", accessToken));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError && reason.status === 404
          ? "The API server is still running the previous version, so Ads aren't available yet. Update the API on the VPS, then refresh this page."
          : reason instanceof Error
            ? reason.message
            : "Ads could not be loaded.",
      );
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="email-center ads-center">
      <div className="email-tabs" role="tablist" aria-label="Ads sections">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        !error && <FayfortLoader label="Loading ads…" />
      ) : tab === "settings" ? (
        <SettingsPanel accessToken={accessToken} data={data} onSaved={load} />
      ) : tab === "placements" ? (
        <PlacementsPanel accessToken={accessToken} data={data} onSaved={load} />
      ) : tab === "creatives" ? (
        <CreativesPanel accessToken={accessToken} data={data} onSaved={load} />
      ) : (
        <ResultsPanel data={data} />
      )}
    </div>
  );
}

function SettingsPanel({ accessToken, data, onSaved }: { accessToken: string; data: Overview; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<Settings>(data.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => setForm(data.settings), [data.settings]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest("/platform/ads/settings", accessToken, {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled,
          google_enabled: form.google_enabled,
          google_client: form.google_client || null,
          google_test_mode: form.google_test_mode,
          max_per_screen: Number(form.max_per_screen) || 3,
        }),
      });
      setNotice("Saved. Members see the change on their next page load.");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const googlePlacements = data.placements.filter((p) => p.enabled && p.source !== "custom");
  const missingUnits = googlePlacements.filter((p) => !p.google_slot_id).length;
  return (
    <section className="control-panel" aria-label="Ad settings">
      <div className="panel-heading">
        <h2>Ad settings</h2>
        <p>Free members see ads in the member dashboard. Standard and Pro members never see ads, and the Google script isn't loaded for them.</p>
      </div>
      <p className={data.settings.enabled ? "email-delivery ok" : "email-delivery off"} role="status">
        {!data.settings.enabled
          ? "Ads are off for everyone."
          : data.settings.google_enabled && data.settings.google_client
            ? `Google AdSense is on (${data.settings.google_client})${data.settings.google_test_mode ? " in test mode" : ""}.${missingUnits ? ` ${missingUnits} Google placement${missingUnits === 1 ? " needs" : "s need"} an ad unit ID; they show custom ads until then.` : ""}`
            : "Ads are on. Google isn't set up yet, so placements show your custom ads."}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-delivery ok" role="status">
          {notice}
        </p>
      )}
      <form className="knowledge-form ads-form" onSubmit={save} aria-label="Ad settings">
        <label className="ads-toggle">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Show ads to free members
        </label>
        <div className="knowledge-form-row">
          <label>
            AdSense publisher ID
            <input
              value={form.google_client || ""}
              placeholder="ca-pub-1234567890123456"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setForm({ ...form, google_client: e.target.value })}
            />
          </label>
          <label>
            Most ads on one page
            <select value={form.max_per_screen} onChange={(e) => setForm({ ...form, max_per_screen: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="ads-toggle">
          <input type="checkbox" checked={form.google_enabled} onChange={(e) => setForm({ ...form, google_enabled: e.target.checked })} />
          Show Google ads
        </label>
        <label className="ads-toggle">
          <input type="checkbox" checked={form.google_test_mode} onChange={(e) => setForm({ ...form, google_test_mode: e.target.checked })} />
          Google test mode (test ads, no earnings; use while checking the layout)
        </label>
        <div className="newsletter-actions">
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
      <div className="panel-heading ads-steps">
        <h3>Connecting Google AdSense</h3>
        <ol>
          <li>In AdSense, add the site fayfort.com and copy your publisher ID (ca-pub-…) into the field above.</li>
          <li>
            In AdSense → Ads → By ad unit, create display units for the banners and the menu, and in-feed units for Browse and the
            supplier directory. Paste each unit ID in Placements.
          </li>
          <li>
            ads.txt is served at app.fayfort.com/ads.txt from your publisher ID
            {data.ads_txt ? (
              <>
                : <code>{data.ads_txt.trim()}</code>
              </>
            ) : (
              " once it's saved"
            )}
            . In Shopify (Navigation → URL redirects) add <code>/ads.txt</code> → <code>https://app.fayfort.com/ads.txt</code> so Google finds it on
            fayfort.com.
          </li>
          <li>If you have visitors from Europe or the UK, turn on the consent message in AdSense → Privacy &amp; messaging.</li>
        </ol>
      </div>
    </section>
  );
}

function PlacementsPanel({ accessToken, data, onSaved }: { accessToken: string; data: Overview; onSaved: () => Promise<void> }) {
  return (
    <section className="control-panel" aria-label="Ad placements">
      <div className="panel-heading">
        <h2>Placements</h2>
        <p>
          Where ads can appear in the member dashboard. Lower priority numbers win when a page has more placements than the page limit.
          Ads never appear inside chats, pop-ups, checkout or next to Pay, Add to cart or Unlock buttons.
        </p>
      </div>
      <ul className="ads-placement-list">
        {data.placements.map((placement) => (
          <PlacementRow
            key={placement.key}
            accessToken={accessToken}
            placement={placement}
            counts={data.stats.placements[placement.key]}
            customCount={data.creatives.filter((c) => c.status === "active" && c.placements.includes(placement.key)).length}
            onSaved={onSaved}
          />
        ))}
      </ul>
    </section>
  );
}

function PlacementRow({
  accessToken,
  placement,
  counts,
  customCount,
  onSaved,
}: {
  accessToken: string;
  placement: Placement;
  counts?: Counts;
  customCount: number;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState(placement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(placement), [placement]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await apiRequest(`/platform/ads/placements/${placement.key}`, accessToken, {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.enabled,
          source: form.source,
          google_slot_id: form.google_slot_id || null,
          google_format: form.google_format,
          google_layout_key: form.google_layout_key || null,
          priority: Number(form.priority) || 0,
        }),
      });
      setSaved(true);
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The placement could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={placement.enabled ? "ads-placement" : "ads-placement off"}>
      <div className="ads-placement-head">
        <div>
          <strong>{placement.label}</strong>
          <small>{placement.description}</small>
        </div>
        <span className={placement.enabled ? "status-pill is-good" : "status-pill"}>{placement.enabled ? "On" : "Off"}</span>
      </div>
      <p className="muted">
        {SOURCE_LABELS[placement.source]} · {customCount} active custom ad{customCount === 1 ? "" : "s"} · last 30 days:{" "}
        {counts?.impressions || 0} views, {counts?.clicks || 0} clicks on custom ads
      </p>
      <form className="inline-form" onSubmit={save} aria-label={`Placement ${placement.label}`}>
        <label className="ads-toggle">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          On
        </label>
        <label>
          Source
          <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as Placement["source"] })}>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Google ad unit ID
          <input
            value={form.google_slot_id || ""}
            inputMode="numeric"
            placeholder="1234567890"
            disabled={form.source === "custom"}
            onChange={(e) => setForm({ ...form, google_slot_id: e.target.value })}
          />
        </label>
        <label>
          Google format
          <select
            value={form.google_format}
            disabled={form.source === "custom"}
            onChange={(e) => setForm({ ...form, google_format: e.target.value as Placement["google_format"] })}
          >
            {Object.entries(FORMAT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {form.google_format === "fluid" && form.source !== "custom" && (
          <label>
            In-feed layout key
            <input
              value={form.google_layout_key || ""}
              placeholder="-6t+ed+2i-1n-4w"
              onChange={(e) => setForm({ ...form, google_layout_key: e.target.value })}
            />
          </label>
        )}
        <label className="ads-narrow">
          Priority
          <input type="number" min={0} max={999} value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
        </label>
        <button className="primary-button" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && <span role="status">Saved.</span>}
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

const EMPTY_CREATIVE: Omit<Creative, "id"> = {
  name: "",
  status: "draft",
  advertiser: "",
  headline: "",
  body: "",
  cta_label: "Learn more",
  target_url: "",
  image_url: "",
  tone: "brand",
  placements: [],
  weight: 1,
  starts_at: null,
  ends_at: null,
};

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CreativesPanel({ accessToken, data, onSaved }: { accessToken: string; data: Overview; onSaved: () => Promise<void> }) {
  const [editing, setEditing] = useState<Creative | null>(null);
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const list = data.creatives.filter((c) => showArchived || c.status !== "archived");
  async function setStatus(creative: Creative, status: Creative["status"]) {
    setError("");
    setNotice("");
    try {
      if (status === "archived") {
        await apiRequest(`/platform/ads/creatives/${creative.id}`, accessToken, { method: "DELETE" });
      } else {
        await apiRequest(`/platform/ads/creatives/${creative.id}`, accessToken, {
          method: "PUT",
          body: JSON.stringify(creativeBody({ ...creative, status })),
        });
      }
      setNotice(status === "active" ? "Ad is live." : status === "paused" ? "Ad paused." : "Ad archived.");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The ad could not be updated.");
    }
  }
  return (
    <section className="control-panel" aria-label="Custom ads">
      <div className="panel-heading">
        <h2>Custom ads</h2>
        <p>
          FayFort's own ads: house promotions or ads you sell to partners. They show where a placement uses custom ads, and in
          place of Google when Google has nothing to show. The placeholders are examples; edit or archive them.
        </p>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-delivery ok" role="status">
          {notice}
        </p>
      )}
      <div className="newsletter-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          Add custom ad
        </button>
        <label className="ads-toggle">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      {(creating || editing) && (
        <CreativeForm
          accessToken={accessToken}
          placements={data.placements}
          creative={editing}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async (message) => {
            setCreating(false);
            setEditing(null);
            setNotice(message);
            await onSaved();
          }}
        />
      )}
      <ul className="ads-creative-list">
        {list.map((creative) => {
          const counts = data.stats.creatives[creative.id];
          return (
            <li key={creative.id} className={`ads-creative ${creative.status}`}>
              <div className="ads-creative-preview">
                <CustomAd creative={creative} shape="banner" />
              </div>
              <div className="ads-creative-meta">
                <strong>{creative.name}</strong>
                <small>
                  <span className={creative.status === "active" ? "status-pill is-good" : "status-pill"}>{creative.status}</span>
                  {creative.is_placeholder ? " · placeholder" : ""} · weight {creative.weight} ·{" "}
                  {creative.placements.length
                    ? creative.placements.map((key) => data.placements.find((p) => p.key === key)?.label || key).join(", ")
                    : "no placements"}
                </small>
                <small>
                  Last 30 days: {counts?.impressions || 0} views · {counts?.clicks || 0} clicks · {rate(counts)} click rate
                  {creative.starts_at || creative.ends_at
                    ? ` · runs ${creative.starts_at ? new Date(creative.starts_at).toLocaleDateString() : "now"} to ${creative.ends_at ? new Date(creative.ends_at).toLocaleDateString() : "no end"}`
                    : ""}
                </small>
                <div className="ads-creative-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setCreating(false);
                      setEditing(creative);
                    }}
                  >
                    Edit
                  </button>
                  {creative.status === "active" ? (
                    <button type="button" className="secondary-button" onClick={() => void setStatus(creative, "paused")}>
                      Pause
                    </button>
                  ) : creative.status !== "archived" ? (
                    <button type="button" className="secondary-button" onClick={() => void setStatus(creative, "active")}>
                      Make live
                    </button>
                  ) : null}
                  {creative.status !== "archived" && (
                    <button type="button" className="secondary-button" onClick={() => void setStatus(creative, "archived")}>
                      Archive
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {!list.length && <p className="muted">No custom ads yet.</p>}
    </section>
  );
}

function creativeBody(form: Omit<Creative, "id"> & { id?: string }) {
  return {
    name: form.name,
    status: form.status,
    advertiser: form.advertiser || null,
    headline: form.headline,
    body: form.body || null,
    cta_label: form.cta_label,
    target_url: form.target_url,
    image_url: form.image_url || null,
    tone: form.tone,
    placements: form.placements,
    weight: Number(form.weight) || 1,
    starts_at: form.starts_at || null,
    ends_at: form.ends_at || null,
  };
}

function CreativeForm({
  accessToken,
  placements,
  creative,
  onCancel,
  onSaved,
}: {
  accessToken: string;
  placements: Placement[];
  creative: Creative | null;
  onCancel: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<Omit<Creative, "id">>(creative ? { ...creative } : { ...EMPTY_CREATIVE });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [previewShape, setPreviewShape] = useState<AdShape>("banner");
  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const response = await fetch(API_BASE + "/platform/ads/images", {
        method: "POST",
        headers: { Authorization: "Bearer " + accessToken, "Content-Type": file.type },
        body: file,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : "The image could not be uploaded.");
      setForm((current) => ({ ...current, image_url: body.image_url }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The image could not be uploaded.");
    } finally {
      setUploading(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = JSON.stringify(
        creativeBody({
          ...form,
          starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
          ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
        }),
      );
      if (creative) await apiRequest(`/platform/ads/creatives/${creative.id}`, accessToken, { method: "PUT", body });
      else await apiRequest("/platform/ads/creatives", accessToken, { method: "POST", body });
      await onSaved(creative ? "Ad saved." : "Ad added.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The ad could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  const togglePlacement = (key: string, on: boolean) =>
    setForm((current) => ({
      ...current,
      placements: on ? [...current.placements, key] : current.placements.filter((item) => item !== key),
    }));
  const preview: AdCreative = {
    id: "preview",
    headline: form.headline || "Headline",
    body: form.body,
    cta_label: form.cta_label || "Learn more",
    target_url: "#",
    image_url: form.image_url || null,
    tone: form.tone,
    advertiser: form.advertiser,
  };
  return (
    <form className="knowledge-form ads-form" onSubmit={save} aria-label={creative ? "Edit custom ad" : "New custom ad"}>
      <div className="knowledge-form-row">
        <label>
          Name (staff only)
          <input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>
          Status
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Creative["status"] })}>
            <option value="draft">Draft</option>
            <option value="active">Live</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>
      <div className="knowledge-form-row">
        <label>
          Headline
          <input required maxLength={80} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
        </label>
        <label>
          Advertiser (shown as "Ad · name")
          <input maxLength={80} value={form.advertiser || ""} onChange={(e) => setForm({ ...form, advertiser: e.target.value })} />
        </label>
      </div>
      <label>
        Text
        <textarea maxLength={200} rows={2} value={form.body || ""} onChange={(e) => setForm({ ...form, body: e.target.value })} />
      </label>
      <div className="knowledge-form-row">
        <label>
          Link
          <input
            required
            maxLength={500}
            value={form.target_url}
            placeholder="https://… or /member/chat?panel=directory or action:plans"
            onChange={(e) => setForm({ ...form, target_url: e.target.value })}
          />
        </label>
        <label>
          Button text
          <input required maxLength={30} value={form.cta_label} onChange={(e) => setForm({ ...form, cta_label: e.target.value })} />
        </label>
      </div>
      <div className="knowledge-form-row">
        <label>
          Image (optional)
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(e) => void upload(e.target.files?.[0])} />
          {uploading && <small role="status">Uploading…</small>}
          {form.image_url && (
            <button type="button" className="text-button" onClick={() => setForm({ ...form, image_url: "" })}>
              Remove image
            </button>
          )}
        </label>
        <label>
          Colours
          <select value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value as AdCreative["tone"] })}>
            <option value="brand">Brand (soft)</option>
            <option value="accent">Brand (bold)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>
      <fieldset className="ads-placement-choices">
        <legend>Placements</legend>
        {placements.map((placement) => (
          <label key={placement.key} className="ads-toggle">
            <input
              type="checkbox"
              checked={form.placements.includes(placement.key)}
              onChange={(e) => togglePlacement(placement.key, e.target.checked)}
            />
            {placement.label}
          </label>
        ))}
      </fieldset>
      <div className="knowledge-form-row ads-three">
        <label>
          Weight (higher shows more often)
          <input type="number" min={1} max={100} value={form.weight} onChange={(e) => setForm({ ...form, weight: Number(e.target.value) })} />
        </label>
        <label>
          Starts
          <input type="datetime-local" value={toLocalInput(form.starts_at)} onChange={(e) => setForm({ ...form, starts_at: e.target.value || null })} />
        </label>
        <label>
          Ends
          <input type="datetime-local" value={toLocalInput(form.ends_at)} onChange={(e) => setForm({ ...form, ends_at: e.target.value || null })} />
        </label>
      </div>
      <div className="ads-preview">
        <div className="email-tabs" role="group" aria-label="Preview shape">
          {(["banner", "feed", "square"] as AdShape[]).map((shape) => (
            <button key={shape} type="button" className={previewShape === shape ? "active" : ""} aria-pressed={previewShape === shape} onClick={() => setPreviewShape(shape)}>
              {shape === "banner" ? "Banner" : shape === "feed" ? "In the grid" : "Menu"}
            </button>
          ))}
        </div>
        <div className={`ads-preview-frame shape-${previewShape}`}>
          <CustomAd creative={preview} shape={previewShape} />
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="newsletter-actions">
        <button className="primary-button" disabled={busy || uploading}>
          {busy ? "Saving…" : creative ? "Save ad" : "Add ad"}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ResultsPanel({ data }: { data: Overview }) {
  const total = Object.values(data.stats.placements).reduce(
    (sum, item) => ({ impressions: sum.impressions + item.impressions, clicks: sum.clicks + item.clicks }),
    { impressions: 0, clicks: 0 },
  );
  return (
    <section className="control-panel" aria-label="Ad results">
      <div className="panel-heading">
        <h2>Results, last {data.stats.days} days</h2>
        <p>Views count when at least half an ad is on screen. Clicks are counted for custom ads; Google clicks and earnings are in AdSense.</p>
      </div>
      <dl className="commerce-stats">
        <div>
          <dt>Ad views</dt>
          <dd>{total.impressions}</dd>
        </div>
        <div>
          <dt>Custom ad clicks</dt>
          <dd>{total.clicks}</dd>
        </div>
      </dl>
      <table className="workforce-table" aria-label="Results by placement">
        <thead>
          <tr>
            <th>Placement</th>
            <th>Google views</th>
            <th>Custom views</th>
            <th>Custom clicks</th>
          </tr>
        </thead>
        <tbody>
          {data.placements.map((placement) => {
            const counts = data.stats.placements[placement.key];
            return (
              <tr key={placement.key}>
                <td>{placement.label}</td>
                <td>{counts?.google_impressions || 0}</td>
                <td>{counts?.custom_impressions || 0}</td>
                <td>{counts?.clicks || 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <table className="workforce-table" aria-label="Results by custom ad">
        <thead>
          <tr>
            <th>Custom ad</th>
            <th>Views</th>
            <th>Clicks</th>
            <th>Click rate</th>
          </tr>
        </thead>
        <tbody>
          {data.creatives
            .filter((creative) => data.stats.creatives[creative.id])
            .map((creative) => {
              const counts = data.stats.creatives[creative.id];
              return (
                <tr key={creative.id}>
                  <td>{creative.name}</td>
                  <td>{counts.impressions}</td>
                  <td>{counts.clicks}</td>
                  <td>{rate(counts)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </section>
  );
}
