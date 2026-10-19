import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";

type Product = { id: string; name: string; price_min: number | null; currency: string | null; in_stock?: boolean | null; active?: boolean | null };

/**
 * Pick shop products by name instead of pasting ids (flash sales, giveaway prizes). Searches the Shopify products
 * FayFort has copied; the chosen ids are what the form sends.
 */
export function ProductPicker({
  accessToken,
  label,
  multiple = false,
  value,
  onChange,
}: {
  accessToken: string;
  label: string;
  multiple?: boolean;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [known, setKnown] = useState<Record<string, Product>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      apiRequest<{ products: Product[] }>(`/platform/commerce/products?q=${encodeURIComponent(term)}`, accessToken)
        .then((data) => {
          if (!alive) return;
          const rows = Array.isArray(data?.products) ? data.products.slice(0, 8) : [];
          setResults(rows);
          setKnown((current) => ({ ...current, ...Object.fromEntries(rows.map((row) => [row.id, row])) }));
          setError("");
        })
        .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Products could not be searched."))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query, accessToken]);
  function choose(product: Product) {
    if (multiple) onChange(value.includes(product.id) ? value.filter((id) => id !== product.id) : [...value, product.id]);
    else onChange(value[0] === product.id ? [] : [product.id]);
    if (!multiple) setQuery("");
  }
  const price = (product: Product) =>
    product.price_min === null || product.price_min === undefined
      ? ""
      : ` · ${new Intl.NumberFormat(undefined, { style: "currency", currency: product.currency || "USD" }).format(product.price_min)}`;
  return (
    <div className="product-picker">
      <label>
        {label}
        <input
          type="search"
          value={query}
          placeholder="Type a product name"
          onChange={(event) => setQuery(event.target.value)}
          aria-label={`${label}: search products`}
        />
      </label>
      {value.length > 0 && (
        <ul className="product-picker-chosen" aria-label="Chosen products">
          {value.map((id) => (
            <li key={id}>
              <span>{known[id]?.name || `Product ${id.slice(0, 8)}…`}</span>
              <button type="button" aria-label={`Remove ${known[id]?.name || id}`} onClick={() => onChange(value.filter((item) => item !== id))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && (
        <ul className="product-picker-results" role="listbox" aria-label="Matching products" aria-multiselectable={multiple}>
          {loading && !results.length ? (
            <li className="muted">Searching…</li>
          ) : error ? (
            <li className="form-error">{error}</li>
          ) : !results.length ? (
            <li className="muted">No shop product matches “{query.trim()}”.</li>
          ) : (
            results.map((product) => (
              <li key={product.id}>
                <button type="button" role="option" aria-selected={value.includes(product.id)} onClick={() => choose(product)}>
                  <span>{value.includes(product.id) ? "✓ " : ""}{product.name}</span>
                  <small>
                    {price(product)}
                    {product.in_stock === false ? " · out of stock" : ""}
                    {product.active === false ? " · not active" : ""}
                  </small>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
