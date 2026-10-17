import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiRequestError, apiRequest } from "../../lib/api";

/** Control Center → Website: the Instagram posts and reels on www.fayfort.com (docs/PUBLIC_SITE_REBUILD_PLAN.md). */

type Post = { id: string; kind: "p" | "reel"; shortcode: string; label: string | null; active: boolean; sort_order: number };

const postUrl = (post: Post) => `https://www.instagram.com/${post.kind}/${post.shortcode}/`;
const embedUrl = (post: Post) => `${postUrl(post)}embed/`;

export function WebsitePage({ accessToken }: { accessToken: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPosts((await apiRequest<{ posts: Post[] }>("/platform/site/instagram", accessToken)).posts);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof ApiRequestError && reason.status === 404
          ? "The API server is still running the previous version, so Website isn't available yet. Update the API on the VPS, then refresh this page."
          : reason instanceof Error
            ? reason.message
            : "Website content could not be loaded.",
      );
    }
  }, [accessToken]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>, message: string) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That didn't work. Try again.");
    } finally {
      setBusy("");
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    void run(
      "add",
      async () => {
        await apiRequest("/platform/site/instagram", accessToken, { method: "POST", body: JSON.stringify({ url: url.trim(), label: label.trim() || null }) });
        setUrl("");
        setLabel("");
      },
      "Added. It shows on the website within 10 minutes.",
    );
  }

  function move(index: number, by: number) {
    if (!posts) return;
    const next = [...posts];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    void run(
      `move-${item.id}`,
      () => apiRequest("/platform/site/instagram-order", accessToken, { method: "PUT", body: JSON.stringify({ ids: next.map((p) => p.id) }) }),
      "Order saved.",
    );
  }

  return (
    <div className="email-center website-center">
      <section className="control-panel" aria-label="Instagram on the website">
        <div className="panel-heading">
          <h2>Instagram on the website</h2>
          <p>
            Posts and reels shown on the www.fayfort.com home page under "From the market floor", in this order (up to 12). Paste the link from
            Instagram (⋯ → Copy link). Changes appear on the site within 10 minutes. With no posts, the section is hidden.
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
        <form className="inline-form" onSubmit={add} aria-label="Add an Instagram post">
          <label>
            Post or reel link
            <input required value={url} placeholder="https://www.instagram.com/reel/…" onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label>
            Caption on the card (optional)
            <input maxLength={80} value={label} placeholder="Market day in Guangzhou" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <button className="primary-button" disabled={busy === "add"}>
            {busy === "add" ? "Adding…" : "Add"}
          </button>
        </form>
        {!posts ? (
          !error && <p role="status">Loading…</p>
        ) : !posts.length ? (
          <p className="muted">No posts yet. Add your best market, inspection and shipping posts.</p>
        ) : (
          <ul className="website-posts">
            {posts.map((post, index) => (
              <WebsitePostRow
                key={post.id}
                post={post}
                first={index === 0}
                last={index === posts.length - 1}
                busy={busy}
                previewing={preview === post.id}
                onPreview={() => setPreview((current) => (current === post.id ? null : post.id))}
                onMove={(by) => move(index, by)}
                onSave={(next) =>
                  run(
                    `save-${post.id}`,
                    () => apiRequest(`/platform/site/instagram/${post.id}`, accessToken, { method: "PUT", body: JSON.stringify(next) }),
                    next.active ? "Saved." : "Hidden from the website.",
                  )
                }
                onRemove={() =>
                  run(`remove-${post.id}`, () => apiRequest(`/platform/site/instagram/${post.id}`, accessToken, { method: "DELETE" }), "Removed.")
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function WebsitePostRow({
  post,
  first,
  last,
  busy,
  previewing,
  onPreview,
  onMove,
  onSave,
  onRemove,
}: {
  post: Post;
  first: boolean;
  last: boolean;
  busy: string;
  previewing: boolean;
  onPreview: () => void;
  onMove: (by: number) => void;
  onSave: (next: { label: string | null; active: boolean }) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(post.label || "");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setLabel(post.label || ""), [post.label]);
  return (
    <li className={post.active ? "website-post" : "website-post is-hidden"}>
      <div className="website-post-head">
        <div>
          <strong>{post.kind === "reel" ? "Reel" : "Post"} · {post.shortcode}</strong>
          <a href={postUrl(post)} target="_blank" rel="noreferrer">
            Open on Instagram
          </a>
        </div>
        <span className={post.active ? "status-pill is-good" : "status-pill"}>{post.active ? "Shown" : "Hidden"}</span>
      </div>
      <div className="website-post-actions">
        <input aria-label={`Caption for ${post.shortcode}`} maxLength={80} value={label} placeholder="Caption (optional)" onChange={(e) => setLabel(e.target.value)} />
        <button type="button" className="secondary-button" disabled={!!busy} onClick={() => onSave({ label: label.trim() || null, active: post.active })}>
          Save
        </button>
        <button type="button" className="secondary-button" disabled={!!busy} onClick={() => onSave({ label: label.trim() || null, active: !post.active })}>
          {post.active ? "Hide" : "Show"}
        </button>
        <button type="button" className="secondary-button" aria-label="Move up" disabled={!!busy || first} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="secondary-button" aria-label="Move down" disabled={!!busy || last} onClick={() => onMove(1)}>
          ↓
        </button>
        <button type="button" className="secondary-button" onClick={onPreview}>
          {previewing ? "Close preview" : "Preview"}
        </button>
        {confirming ? (
          <>
            <button type="button" className="secondary-button danger" disabled={!!busy} onClick={onRemove}>
              Yes, remove
            </button>
            <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="secondary-button" onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
      </div>
      {previewing && (
        <div className={post.kind === "reel" ? "website-preview is-reel" : "website-preview"}>
          <iframe src={embedUrl(post)} title={`Preview of ${post.shortcode}`} loading="lazy" />
        </div>
      )}
    </li>
  );
}
