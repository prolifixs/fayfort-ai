import { supabaseClient } from "../../lib/supabase";
import { apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type {
  ConversationRow,
  DirectoryProduct,
  DirectorySearchResult,
  DirectoryToolRow,
  EntitlementRow,
  ProductCategory,
} from "./types";
import { FayfortLoader } from "../brand/FayfortLogo";

export function DirectoryToolsPage({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [tools, setTools] = useState<DirectoryToolRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [toolId, setToolId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DirectorySearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [toolData, conversationData] = await Promise.all([
        apiRequest<{ tools: DirectoryToolRow[] }>(`/businesses/${businessId}/directory/tools`, accessToken),
        apiRequest<{ conversations: ConversationRow[] }>(`/businesses/${businessId}/conversations`, accessToken),
      ]);
      const activeTools = toolData.tools.filter((item) => item.active);
      setTools(activeTools);
      setConversations(conversationData.conversations);
      setToolId((previous) =>
        activeTools.some((item) => item.tool_id === previous) ? previous : activeTools[0]?.tool_id || "",
      );
      setConversationId((previous) =>
        conversationData.conversations.some((item) => item.id === previous)
          ? previous
          : conversationData.conversations[0]?.id || "",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Directory tools could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const data = await apiRequest<DirectorySearchResult>(`/businesses/${businessId}/directory/search`, accessToken, {
        method: "POST",
        body: JSON.stringify({ tool_id: toolId, conversation_id: conversationId, query: query.trim() }),
      });
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Directory search could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="control-panel" aria-label="Directory search and access controls">
      <div className="panel-heading">
        <div>
          <h2>Directory &amp; Tools</h2>
          <p>
            Search with a recorded conversation as context. FayFort checks access, verification rules, and records each
            decision before showing any matching fields.
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
        <FayfortLoader label="Loading directory tools and conversations…" />
      ) : (
        <>
          {!tools.length ? (
            <p className="empty-copy">No active directory tools are currently registered.</p>
          ) : !conversations.length ? (
            <p className="empty-copy">Record a conversation first to provide an auditable search context.</p>
          ) : (
            <form className="inline-form directory-search-form" onSubmit={search}>
              <label>
                Directory tool
                <select required value={toolId} onChange={(e) => setToolId(e.target.value)}>
                  {tools.map((item) => (
                    <option key={item.tool_id} value={item.tool_id}>
                      {item.tool_id} · {item.family}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Conversation
                <select required value={conversationId} onChange={(e) => setConversationId(e.target.value)}>
                  {conversations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.customer_name || item.customer_external_id || "Customer"} ·{" "}
                      {item.channel || item.platform || "channel"} · {item.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Search query
                <input
                  required
                  minLength={1}
                  maxLength={1000}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="What should FayFort look up?"
                />
              </label>
              <button className="primary-button" disabled={busy || !toolId || !conversationId}>
                {busy ? "Checking access…" : "Search directory"}
              </button>
            </form>
          )}
          {tools.length > 0 && (
            <div className="record-list directory-tool-list">
              {tools.map((item) => (
                <div className="record" key={item.tool_id}>
                  <div>
                    <strong>
                      {item.tool_id} · {item.family}
                    </strong>
                    <small>{item.description}</small>
                    <small>Verification policy: {item.verification_policy}</small>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DirectoryProductsPanel accessToken={accessToken} businessId={businessId} />
          {result && (
            <section className="directory-result" aria-live="polite">
              <h3>Search decision: {result.outcome.replaceAll("_", " ")}</h3>
              <p>{result.message}</p>
              {result.verification_state && (
                <p>
                  <strong>Record verification:</strong> {result.verification_state.replaceAll("_", " ")}
                </p>
              )}
              {result.allowed_fields?.length ? (
                <p>
                  <strong>Fields returned:</strong> {result.allowed_fields.join(", ")}
                </p>
              ) : null}
              {result.requires_human && (
                <p className="quiet-note">This result requires a human review before it can be used.</p>
              )}
              {result.records?.length ? (
                <div className="record-list">
                  {result.records.map((record, index) => (
                    <div className="record" key={index}>
                      <div>
                        {Object.entries(record).map(([key, value]) => (
                          <small key={key}>
                            <strong>{key.replaceAll("_", " ")}: </strong>
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </small>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          )}
        </>
      )}
    </section>
  );
}

export function ProductMediaPreview({ product }: { product: DirectoryProduct }) {
  const [embedScriptReady, setEmbedScriptReady] = useState(false);
  useEffect(() => {
    if (product.media_source !== "instagram" || !product.media_url) return;
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://www.instagram.com/embed.js"]');
    if (existing) {
      setEmbedScriptReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    script.onload = () => setEmbedScriptReady(true);
    document.body.appendChild(script);
    return () => {
      script.onload = null;
    };
  }, [product.media_source, product.media_url]);
  useEffect(() => {
    if (embedScriptReady)
      (window as Window & { instgrm?: { Embeds?: { process?: () => void } } }).instgrm?.Embeds?.process?.();
  }, [embedScriptReady, product.media_url]);
  if (!product.media_url) return null;
  if (product.media_source === "instagram")
    return (
      <div className="product-media-preview">
        <blockquote className="instagram-media" data-instgrm-permalink={product.media_url} data-instgrm-version="14">
          <a href={product.media_url} target="_blank" rel="noreferrer">
            View product on Instagram
          </a>
        </blockquote>
      </div>
    );
  return (
    <div className="product-media-preview">
      {product.media_type === "video" ? (
        <video src={product.media_url} controls preload="metadata" aria-label={`${product.name} video preview`} />
      ) : (
        <img src={product.media_url} alt={`${product.name} preview`} />
      )}
    </div>
  );
}

export function DirectoryProductsPanel({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [products, setProducts] = useState<DirectoryProduct[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [categoryRef, setCategoryRef] = useState("");
  const [description, setDescription] = useState("");
  const [availability, setAvailability] = useState<DirectoryProduct["availability_status"]>("sourcing");
  const [mediaSource, setMediaSource] = useState<"url" | "instagram" | "upload">("url");
  const [mediaType, setMediaType] = useState<"image" | "video">("image");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<{
        products?: DirectoryProduct[];
        categories?: ProductCategory[];
        can_manage?: boolean;
      }>(`/businesses/${businessId}/directory/products`, accessToken);
      const rows = data.products || [];
      const categoryRows = data.categories || [];
      setProducts(rows);
      setCategories(categoryRows);
      setCanManage(data.can_manage === true);
      setCategoryRef((previous) =>
        categoryRows.some((item) => item.source_ref === previous) ? previous : categoryRows[0]?.source_ref || "",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Product catalog could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  function edit(product: DirectoryProduct) {
    setEditing(product.id);
    setName(product.name);
    setCategoryRef(product.category_ref);
    setDescription(product.description);
    setAvailability(product.availability_status);
    setMediaSource(product.media_source || "url");
    setMediaType(product.media_type || "image");
    setMediaUrl(product.media_url || "");
    setMediaFile(null);
    setNotice("");
  }
  function clearForm() {
    setEditing(null);
    setName("");
    setDescription("");
    setAvailability("sourcing");
    setCategoryRef(categories[0]?.source_ref || "");
    setMediaSource("url");
    setMediaType("image");
    setMediaUrl("");
    setMediaFile(null);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    let uploadedPath: string | undefined;
    try {
      let nextMediaUrl = mediaUrl.trim();
      let nextMediaSource: DirectoryProduct["media_source"] = nextMediaUrl ? mediaSource : null;
      let nextMediaType: DirectoryProduct["media_type"] = nextMediaUrl ? mediaType : null;
      if (mediaSource === "upload" && mediaFile) {
        if (!supabaseClient) throw new Error("File upload is not configured.");
        const maxSize = mediaType === "image" ? 15 * 1024 * 1024 : 100 * 1024 * 1024;
        if (mediaFile.size > maxSize)
          throw new Error(
            mediaType === "image" ? "Images must be 15 MB or smaller." : "Videos must be 100 MB or smaller.",
          );
        const ext = mediaFile.name.split(".").pop()?.toLowerCase() || "bin";
        uploadedPath = `products/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabaseClient.storage
          .from("product-media")
          .upload(uploadedPath, mediaFile, { contentType: mediaFile.type, upsert: false });
        if (uploadError) throw uploadError;
        nextMediaUrl = supabaseClient.storage.from("product-media").getPublicUrl(uploadedPath).data.publicUrl;
        nextMediaSource = "upload";
        nextMediaType = mediaType;
      } else if (mediaSource === "upload") {
        if (!editing) throw new Error("Choose a file to upload.");
        const old = products.find((item) => item.id === editing);
        nextMediaUrl = old?.media_url || "";
        nextMediaSource = old?.media_source || null;
        nextMediaType = old?.media_type || null;
      } else if (!nextMediaUrl) {
        nextMediaSource = null;
        nextMediaType = null;
      }
      const body = {
        name: name.trim(),
        category_ref: categoryRef,
        description: description.trim(),
        availability_status: availability,
        media_url: nextMediaUrl || null,
        media_type: nextMediaType,
        media_source: nextMediaSource,
        media_storage_path:
          uploadedPath ||
          (mediaSource === "upload" ? products.find((item) => item.id === editing)?.media_storage_path || null : null),
      };
      const result = await apiRequest<{ product: DirectoryProduct }>(
        `/businesses/${businessId}/directory/products${editing ? `/${editing}` : ""}`,
        accessToken,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      const prior = editing ? products.find((item) => item.id === editing) : undefined;
      if (
        prior?.media_source === "upload" &&
        prior.media_storage_path &&
        prior.media_storage_path !== uploadedPath &&
        supabaseClient
      ) {
        const { error: removeError } = await supabaseClient.storage
          .from("product-media")
          .remove([prior.media_storage_path]);
        if (removeError) console.warn("Old product media could not be removed after replacement.");
      }
      setNotice(editing ? "Product updated." : "Product added.");
      clearForm();
      await refresh();
    } catch (e) {
      if (uploadedPath && supabaseClient) await supabaseClient.storage.from("product-media").remove([uploadedPath]);
      setError(e instanceof Error ? e.message : "Product could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  async function setActive(product: DirectoryProduct) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/businesses/${businessId}/directory/products/${product.id}`, accessToken, {
        method: "PATCH",
        body: JSON.stringify({ active: !product.active }),
      });
      setNotice(product.active ? "Product hidden from member discovery." : "Product made active.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Product status could not be changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="customer-history-section directory-products" aria-label="Products catalog">
      <div className="panel-heading">
        <div>
          <h3>Products</h3>
          <p>
            What the AI and members can find. Read-only here.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setNotice("");
            void refresh();
          }}
          disabled={loading}
        >
          Refresh products
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="quiet-note" role="status">
          {notice}
        </p>
      )}
      <p className="quiet-note directory-products-moved">
        Products are added and edited by the Store team in{" "}
        <a href="/operations?view=products&tab=sourcing">Operations Center → Products</a>, where an administrator reviews and publishes them.
      </p>
      {loading ? (
        <FayfortLoader label="Loading products…" />
      ) : products.length === 0 ? (
        <p className="empty-copy">No products have been added yet.</p>
      ) : (
        <div className="record-list">
          {products.map((product) => (
            <article className="record" key={product.id}>
              <div>
                <strong>
                  {product.name}
                  {!product.active ? " · hidden" : ""}
                </strong>
                <small>
                  {categories.find((category) => category.source_ref === product.category_ref)?.category || "Category"}{" "}
                  · {product.availability_status.replaceAll("_", " ")}
                </small>
                {product.description && <small>{product.description}</small>}
                <ProductMediaPreview product={product} />
                <small>Updated {new Date(product.updated_at).toLocaleString()}</small>
              </div>
              {canManage && (
                <div className="record-actions">
                  <a className="secondary-button" href="/operations?view=products&tab=sourcing">
                    Edit in Products
                  </a>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export function EntitlementsPage({ accessToken, businessId }: { accessToken: string; businessId: string }) {
  const [rows, setRows] = useState<EntitlementRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [tools, setTools] = useState<DirectoryToolRow[]>([]);
  const [toolId, setToolId] = useState("");
  const [accessLevel, setAccessLevel] = useState("premium");
  const [reason, setReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [ent, registry] = await Promise.all([
        apiRequest<{ entitlements: EntitlementRow[]; can_manage: boolean }>(
          `/businesses/${businessId}/entitlements`,
          accessToken,
        ),
        apiRequest<{ tools: DirectoryToolRow[] }>(`/businesses/${businessId}/directory/tools`, accessToken),
      ]);
      setRows(ent.entitlements);
      setCanManage(ent.can_manage);
      setTools(registry.tools);
      setToolId((previous) =>
        registry.tools.some((t) => t.tool_id === previous) ? previous : registry.tools[0]?.tool_id || "",
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Entitlements could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, businessId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function grant(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/entitlements`, accessToken, {
        method: "POST",
        body: JSON.stringify({
          tool_id: toolId,
          access_level: accessLevel,
          reason: reason.trim(),
          ...(expiresAt ? { expires_at: new Date(expiresAt).toISOString() } : {}),
        }),
      });
      setReason("");
      setExpiresAt("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Entitlement could not be granted.");
    } finally {
      setBusy(false);
    }
  }
  async function revoke(item: EntitlementRow) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(`/businesses/${businessId}/entitlements/${item.id}/revoke`, accessToken, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Entitlement could not be revoked.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="control-panel" aria-label="Business entitlements">
      <div className="panel-heading">
        <div>
          <h2>Business access grants</h2>
          <p>
            Manual grants are recorded with a reason and appear in the activity feed. This does not represent a
            subscription or payment.
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
      {canManage ? (
        <form className="inline-form" onSubmit={grant}>
          <label>
            Tool
            <select required value={toolId} onChange={(e) => setToolId(e.target.value)}>
              {tools.map((t) => (
                <option key={t.tool_id} value={t.tool_id}>
                  {t.tool_id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Access level
            <select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)}>
              <option value="registered">Registered</option>
              <option value="premium">Premium</option>
            </select>
          </label>
          <label>
            Reason for manual grant
            <input
              required
              minLength={5}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Approved by business owner"
            />
          </label>
          <label>
            Optional expiry
            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </label>
          <button className="primary-button" disabled={busy || !toolId}>
            {busy ? "Saving…" : "Grant access"}
          </button>
        </form>
      ) : (
        <p className="quiet-note">Only a FayFort platform administrator can manage access grants.</p>
      )}
      {loading ? (
        <p>Loading grants…</p>
      ) : rows.length === 0 ? (
        <p className="empty-copy">No access grants are recorded for this business.</p>
      ) : (
        <div className="record-list">
          {rows.map((row) => (
            <div className="record" key={row.id}>
              <div>
                <strong>
                  {row.tool_id} · {row.access_level} · {row.status}
                </strong>
                <small>
                  Source: {row.entitlement_source || "—"} · Starts: {row.starts_at || "—"} · Expires:{" "}
                  {row.expires_at || "Never"}
                </small>
                {row.source_reference && <small>Reason: {row.source_reference}</small>}
              </div>
              {canManage && row.status === "active" && (
                <button disabled={busy} onClick={() => void revoke(row)}>
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
