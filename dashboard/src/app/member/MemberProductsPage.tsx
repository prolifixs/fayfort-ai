import { MemberNotificationsBar } from "../MemberNotifications";
import { dashboardAuthConfigured, supabaseClient } from "../../lib/supabase";
import { apiRequest } from "../../lib/api";
import { FormEvent, useCallback, useEffect, useState } from "react";
import type { MemberCatalog, MemberCatalogProduct } from "./memberShared";
import type { ProductCategory } from "../workspace/types";
import { SetupScreen } from "../SetupScreen";
import { ProductMediaPreview } from "../workspace/DirectoryPages";
import { MemberRequestsPanel } from "./MemberRequestsPanel";

export function MemberProductsPage() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [products, setProducts] = useState<MemberCatalogProduct[]>([]);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [search, setSearch] = useState("");
  const [categoryRef, setCategoryRef] = useState("");
  const [savedOnly, setSavedOnly] = useState(() => new URLSearchParams(window.location.search).get("saved") === "true");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const loadCatalog = useCallback(async (token: string, term: string, category: string, onlySaved: boolean) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (term.trim()) params.set("q", term.trim());
      if (category) params.set("category_ref", category);
      if (onlySaved) params.set("saved_only", "true");
      const suffix = params.size ? `?${params.toString()}` : "";
      const result = await apiRequest<MemberCatalog>(`/members/products${suffix}`, token);
      setProducts(result.products || []);
      setSavedIds(result.saved_product_ids || []);
      setCategories(result.categories || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Products could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!supabaseClient) {
      setAuthLoading(false);
      return;
    }
    let mounted = true;
    supabaseClient.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      const token = data.session?.access_token || null;
      setAccessToken(token);
      setAuthLoading(false);
      if (!token) return;
      try {
        await apiRequest("/members/me", token);
        if (mounted) {
          setVerified(true);
          void loadCatalog(token, "", "", new URLSearchParams(window.location.search).get("saved") === "true");
        }
      } catch (reason) {
        if (mounted) setError(reason instanceof Error ? reason.message : "Verify your email to browse products.");
      }
    });
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, session) => {
      if (!mounted || event === "INITIAL_SESSION") return;
      const token = session?.access_token || null;
      setAccessToken(token);
      setVerified(false);
      setProducts([]);
      setSavedIds([]);
      setError("");
      if (token) {
        apiRequest("/members/me", token)
          .then(() => {
            if (mounted) {
              setVerified(true);
              void loadCatalog(token, "", "", new URLSearchParams(window.location.search).get("saved") === "true");
            }
          })
          .catch((reason) => {
            if (mounted) setError(reason instanceof Error ? reason.message : "Verify your email to browse products.");
          });
      }
    });
    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [loadCatalog]);
  async function searchProducts(event: FormEvent) {
    event.preventDefault();
    if (accessToken) await loadCatalog(accessToken, search, categoryRef, savedOnly);
  }
  async function toggleSaved(product: MemberCatalogProduct) {
    if (!accessToken) return;
    setBusyId(product.id);
    setError("");
    const wasSaved = savedIds.includes(product.id);
    try {
      await apiRequest(`/members/products/${product.id}/saved`, accessToken, { method: wasSaved ? "DELETE" : "POST" });
      await loadCatalog(accessToken, search, categoryRef, savedOnly);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Saved products could not be updated.");
    } finally {
      setBusyId("");
    }
  }
  if (!dashboardAuthConfigured) return <SetupScreen />;
  return (
    <div className="auth-page member-catalog-page">
      <section className="auth-card member-catalog-card">
        <b className="brand-mark">F</b>
        <label>FAYFORT MEMBER CATALOG</label>
        <h1>Products</h1>
        <p>Browse active products and save items you want to find again.</p>
        <MemberNotificationsBar accessToken={verified ? accessToken : null} />
        {authLoading ? (
          <p role="status">Checking your member sign-in…</p>
        ) : !accessToken ? (
          <p role="status">
            Sign in to a verified member account to browse and save products.{" "}
            <a href="/member/account">Member sign in</a>
          </p>
        ) : !verified ? (
          <p role="status">{error || "Checking verified member access…"}</p>
        ) : (
          <>
            <form className="member-product-filters" onSubmit={searchProducts}>
              <label>
                Search products
                <input
                  aria-label="Search products"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Product name"
                  maxLength={100}
                />
              </label>
              <label>
                Category
                <select
                  aria-label="Category"
                  value={categoryRef}
                  onChange={(event) => setCategoryRef(event.target.value)}
                >
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.source_ref} value={category.source_ref}>
                      {category.category} · {category.product_type}
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" disabled={loading}>
                Search
              </button>
              <button
                type="button"
                className={savedOnly ? "primary-button" : "secondary-button"}
                aria-pressed={savedOnly}
                onClick={() => {
                  const next = !savedOnly;
                  setSavedOnly(next);
                  if (accessToken) void loadCatalog(accessToken, search, categoryRef, next);
                }}
                disabled={loading}
              >
                {savedOnly ? "Showing saved" : "Show saved"}
              </button>
            </form>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {loading ? (
              <p role="status">Loading products…</p>
            ) : products.length === 0 ? (
              <p className="empty-copy">
                {savedOnly ? "You have no saved products yet." : "No active products match your search."}
              </p>
            ) : (
              <section className="member-product-grid" aria-label={savedOnly ? "Saved products" : "Available products"}>
                {products.map((product) => (
                  <article className="member-product-card" key={product.id}>
                    <ProductMediaPreview product={{ ...product, active: true, updated_at: "" }} />
                    <div className="member-product-copy">
                      <small>
                        {categories.find((item) => item.source_ref === product.category_ref)?.category || "Product"} ·{" "}
                        {product.availability_status.replaceAll("_", " ")}
                      </small>
                      <h2>{product.name}</h2>
                      {product.description && <p>{product.description}</p>}
                      <button
                        type="button"
                        className={savedIds.includes(product.id) ? "secondary-button" : "primary-button"}
                        disabled={busyId === product.id}
                        onClick={() => void toggleSaved(product)}
                      >
                        {busyId === product.id
                          ? "Saving…"
                          : savedIds.includes(product.id)
                            ? "Remove saved product"
                            : "Save product"}
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            )}
            <MemberRequestsPanel accessToken={accessToken} />
          </>
        )}
        <a href="/member/account">Member account</a>
      </section>
    </div>
  );
}
