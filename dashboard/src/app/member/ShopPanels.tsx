import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import type { Cart, ProductDetail, Rail, ShopCard, TrendCard, Giveaway } from "./commerceApi";
import { money, shopSessionId, trackIntent } from "./commerceApi";
import { Countdown, HotRails, PriceLine, ProductTile, TrendTile } from "./ShopComponents";
import { MemberRequestsPanel } from "./MemberRequestsPanel";

/** Product page that opens beside the chat (the familiar side panel), so the member can keep asking. */
export function ProductPanel({
  accessToken,
  productId,
  onOpen,
  onCartChange,
  onClose,
}: {
  accessToken: string;
  productId: string;
  onOpen: (card: ShopCard) => void;
  onCartChange: (cart: Cart) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [variantId, setVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let mounted = true;
    setDetail(null);
    setError("");
    setNotice("");
    setMediaIndex(0);
    apiRequest<ProductDetail>(`/members/shop/products/${productId}`, accessToken)
      .then((result) => {
        if (!mounted) return;
        setDetail(result);
        setVariantId(result.variants.find((variant) => variant.available)?.id || result.variants[0]?.id || "");
        trackIntent(accessToken, [{ event_type: "view", product_id: productId }]);
      })
      .catch((reason) => mounted && setError(reason instanceof Error ? reason.message : "This product could not be loaded."));
    return () => {
      mounted = false;
    };
  }, [accessToken, productId]);
  async function addToCart() {
    if (!variantId || busy) return;
    setBusy(true);
    setError("");
    try {
      const cart = await apiRequest<Cart>("/members/cart/lines", accessToken, {
        method: "PUT",
        body: JSON.stringify({ variant_id: variantId, quantity, session_id: shopSessionId() }),
      });
      onCartChange(cart);
      setNotice("Added to your cart.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This item could not be added.");
    } finally {
      setBusy(false);
    }
  }
  const variant = detail?.variants.find((item) => item.id === variantId);
  const media = detail?.media[mediaIndex];
  return (
    <section className="member-workspace-panel shop-product-panel" aria-label="Product details">
      <header className="shop-panel-header">
        <small>{detail?.product.group_name || "PRODUCT"}</small>
        <button type="button" className="shop-close" aria-label="Close product" onClick={onClose}>
          ×
        </button>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!detail ? (
        !error && <p role="status">Loading product…</p>
      ) : (
        <>
          <div className="shop-gallery">
            {media ? (
              media.media_type === "video" ? (
                <video src={media.url} poster={media.preview_url || undefined} controls playsInline />
              ) : (
                <img src={media.url} alt={media.alt || detail.product.name} />
              )
            ) : null}
            {detail.media.length > 1 && (
              <div className="shop-thumbs" role="list" aria-label="Product photos and videos">
                {detail.media.map((item, index) => (
                  <button
                    type="button"
                    role="listitem"
                    key={item.url}
                    aria-label={`Show ${item.media_type} ${index + 1}`}
                    className={index === mediaIndex ? "active" : ""}
                    onClick={() => setMediaIndex(index)}
                  >
                    <img src={item.preview_url || item.url} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <h2>{detail.product.name}</h2>
          <PriceLine card={{ ...detail.product, price: variant?.price ?? detail.product.price, sale: detail.product.sale && variant ? { ...detail.product.sale, sale_price: variant.sale_price } : detail.product.sale }} />
          {detail.product.sale ? (
            <p className="shop-sale-note">
              {detail.product.sale.title} · <Countdown endsAt={detail.product.sale.ends_at} />
            </p>
          ) : null}
          {detail.product.buyable || detail.variants.length ? (
            <div className="shop-buy">
              {detail.variants.length > 1 && (
                <label>
                  Option
                  <select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                    {detail.variants.map((item) => (
                      <option key={item.id} value={item.id} disabled={!item.available}>
                        {item.title}
                        {item.available ? "" : " — sold out"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Quantity
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Math.min(99, Number(event.target.value) || 1)))}
                />
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={busy || !variant || !variant.available}
                onClick={() => void addToCart()}
              >
                {busy ? "Adding…" : variant && !variant.available ? "Sold out" : "Add to cart"}
              </button>
            </div>
          ) : (
            <p className="shop-sale-note">This listing is sourced on request. Ask about it in the chat or use Source it.</p>
          )}
          {notice && <p role="status">{notice}</p>}
          {detail.product.description && <p className="shop-description">{detail.product.description}</p>}
          {detail.pairs_with.length ? (
            <section className="shop-rail" aria-label="Goes well with">
              <h3>Goes well with</h3>
              <div className="shop-rail-track">
                {detail.pairs_with.map((card) => (
                  <ProductTile key={card.id} card={card} onOpen={onOpen} compact />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Cart lives in a header drawer, not a page. Checkout hands over to Shopify. */
export function CartButton({
  accessToken,
  cart,
  onCartChange,
  onOpen,
}: {
  accessToken: string;
  cart: Cart | null;
  onCartChange: (cart: Cart) => void;
  onOpen: (card: ShopCard) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const count = cart?.lines.reduce((total, line) => total + line.quantity, 0) || 0;
  async function setQuantity(variantId: string, quantity: number) {
    setBusy(variantId);
    setError("");
    try {
      onCartChange(
        await apiRequest<Cart>("/members/cart/lines", accessToken, {
          method: "PUT",
          body: JSON.stringify({ variant_id: variantId, quantity, session_id: shopSessionId() }),
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your cart could not be updated.");
    } finally {
      setBusy("");
    }
  }
  async function checkout() {
    setBusy("checkout");
    setError("");
    try {
      const result = await apiRequest<{ checkout_url: string }>("/members/cart/checkout", accessToken, { method: "POST" });
      window.location.assign(result.checkout_url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout could not start.");
      setBusy("");
    }
  }
  return (
    <div className="shop-cart-control">
      <button
        type="button"
        className="member-notification-bell shop-cart-button"
        aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2" />
          <circle cx="10" cy="20" r="1.3" />
          <circle cx="17" cy="20" r="1.3" />
        </svg>
        {count ? <b>{count > 99 ? "99+" : count}</b> : null}
      </button>
      {open && (
        <section className="shop-cart-drawer" role="dialog" aria-label="Your cart">
          <header>
            <h2>Your cart</h2>
            <button type="button" className="shop-close" aria-label="Close cart" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          {!cart || !cart.lines.length ? (
            <p className="empty-copy">Your cart is empty. Ask the chat or paste a link to find something.</p>
          ) : (
            <>
              <ul className="shop-cart-lines">
                {cart.lines.map((line) => (
                  <li key={line.variant_id}>
                    {line.image_url ? <img src={line.image_url} alt="" /> : <span />}
                    <div>
                      <strong>{line.product.name}</strong>
                      <small>
                        {line.variant_title && line.variant_title !== "Default Title" ? `${line.variant_title} · ` : ""}
                        {money(line.unit_price, cart.currency)}
                        {line.available ? "" : " · sold out"}
                      </small>
                    </div>
                    <div className="shop-qty">
                      <button
                        type="button"
                        aria-label={`Fewer ${line.product.name}`}
                        disabled={!!busy}
                        onClick={() => void setQuantity(line.variant_id, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span>{line.quantity}</span>
                      <button
                        type="button"
                        aria-label={`More ${line.product.name}`}
                        disabled={!!busy || !line.available}
                        onClick={() => void setQuantity(line.variant_id, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {cart.impulse.pairs_with.length || cart.impulse.ending_soon.length ? (
                <section className="shop-impulse" aria-label="You might also like">
                  <h3>{cart.impulse.ending_soon.length ? "Before you go" : "Goes well with your cart"}</h3>
                  <div className="shop-rail-track">
                    {[...cart.impulse.ending_soon, ...cart.impulse.pairs_with].slice(0, 3).map((card) => (
                      <ProductTile
                        key={card.id}
                        card={card}
                        compact
                        onOpen={(item) => {
                          setOpen(false);
                          onOpen(item);
                        }}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
              <footer className="shop-cart-footer">
                <span>
                  Subtotal <strong>{money(cart.subtotal, cart.currency)}</strong>
                </span>
                <button type="button" className="primary-button" disabled={!!busy} onClick={() => void checkout()}>
                  {busy === "checkout" ? "Opening checkout…" : "Checkout"}
                </button>
                <small>Secure checkout by Shopify. Shipping and tax are added there.</small>
              </footer>
            </>
          )}
        </section>
      )}
    </div>
  );
}

type MemberOrder = {
  id: string;
  order_name: string | null;
  source: string;
  financial_status: string | null;
  fulfillment_status: string | null;
  cancelled_at: string | null;
  total: number | null;
  currency: string | null;
  line_items: { title: string; quantity: number; variant_title?: string | null }[];
  tracking: { company?: string | null; number: string; url?: string | null }[];
  status_url: string | null;
  placed_at: string | null;
};
type MemberInvoice = {
  id: string;
  title: string;
  amount: number;
  currency: string;
  quantity: number;
  invoice_url: string | null;
  status: "sent" | "paid";
  sent_at: string | null;
  paid_at: string | null;
};
type OrdersResponse = { orders: MemberOrder[]; invoices: MemberInvoice[]; wanted: (TrendCard & { joined_at: string })[] };

function orderStatus(order: MemberOrder) {
  if (order.cancelled_at) return "Cancelled";
  if (order.fulfillment_status === "fulfilled") return "Shipped";
  if (order.fulfillment_status === "partial") return "Partly shipped";
  if (order.financial_status === "paid") return "Paid · preparing";
  return (order.financial_status || "Placed").replaceAll("_", " ");
}

/** One timeline for everything a member is waiting on: store orders, invoices to pay, items they want sourced, requests. */
export function OrdersPanel({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    apiRequest<OrdersResponse>("/members/orders", accessToken)
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Your orders could not be loaded."));
  }, [accessToken]);
  const due = data?.invoices.filter((invoice) => invoice.status === "sent") || [];
  return (
    <section className="member-workspace-panel member-workspace-requests">
      <header>
        <small>YOUR ACCOUNT</small>
        <h2>Orders & requests</h2>
        <p>Store orders, invoices to pay, items you want sourced, and request progress in one place.</p>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {due.length ? (
        <section className="shop-orders" aria-label="Invoices to pay">
          <h3>Ready to pay</h3>
          {due.map((invoice) => (
            <article key={invoice.id} className="shop-order due">
              <div>
                <strong>{invoice.title}</strong>
                <small>
                  {invoice.quantity > 1 ? `${invoice.quantity} × ` : ""}
                  {money(invoice.amount, invoice.currency)}
                </small>
              </div>
              {invoice.invoice_url ? (
                <a className="primary-button" href={invoice.invoice_url} target="_blank" rel="noreferrer noopener">
                  Pay invoice
                </a>
              ) : (
                <small>We emailed your invoice.</small>
              )}
            </article>
          ))}
        </section>
      ) : null}
      {data?.orders.length ? (
        <section className="shop-orders" aria-label="Store orders">
          <h3>Orders</h3>
          {data.orders.map((order) => (
            <article key={order.id} className="shop-order">
              <div>
                <strong>
                  {order.order_name || "Order"} · {orderStatus(order)}
                </strong>
                <small>
                  {order.line_items.map((item) => `${item.quantity} × ${item.title}`).join(", ")}
                  {order.total !== null ? ` · ${money(Number(order.total), order.currency || "USD")}` : ""}
                </small>
                {order.tracking.map((track) => (
                  <small key={track.number}>
                    {track.company ? `${track.company} ` : ""}
                    {track.url ? (
                      <a href={track.url} target="_blank" rel="noreferrer noopener">
                        {track.number}
                      </a>
                    ) : (
                      track.number
                    )}
                  </small>
                ))}
              </div>
              {order.status_url ? (
                <a href={order.status_url} target="_blank" rel="noreferrer noopener">
                  Order status
                </a>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {data?.wanted.length ? (
        <section className="shop-rail" aria-label="Items you want sourced">
          <h3>Items you want sourced</h3>
          <div className="shop-rail-track">
            {data.wanted.map((trend) => (
              <TrendTile key={trend.id} trend={trend} />
            ))}
          </div>
        </section>
      ) : null}
      <h3 className="shop-section-title">Sourcing requests</h3>
      <MemberRequestsPanel accessToken={accessToken} />
    </section>
  );
}

type BrowseResponse = {
  products: ShopCard[];
  total: number;
  groups: { name: string; count: number }[];
  categories: { source_ref: string; category: string; group_name?: string | null; product_type: string }[];
};

/** Browse: Hot rails on top, then the 968-category catalog with group chips, search and sort. */
export function BrowsePanel({
  accessToken,
  onOpen,
  onWant,
  onEnter,
  busyId,
  home,
}: {
  accessToken: string;
  onOpen: (card: ShopCard) => void;
  onWant: (trend: TrendCard) => void;
  onEnter: (giveaway: Giveaway) => void;
  busyId?: string;
  home: { rails: Rail[]; giveaways: Giveaway[] } | null;
}) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("for_you");
  const [inStock, setInStock] = useState(false);
  const [result, setResult] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    async (q: string, g: string, c: string, s: string, stock: boolean) => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams({ sort: s });
        if (q.trim()) params.set("q", q.trim());
        if (g) params.set("group", g);
        if (c) params.set("category_ref", c);
        if (stock) params.set("in_stock", "true");
        setResult(await apiRequest<BrowseResponse>(`/members/shop/products?${params}`, accessToken));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Products could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [accessToken],
  );
  useEffect(() => {
    void load("", "", "", "for_you", false);
  }, [load]);
  function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim()) trackIntent(accessToken, [{ event_type: "search", query: query.trim().slice(0, 200) }]);
    void load(query, group, category, sort, inStock);
  }
  function chooseGroup(value: string) {
    setGroup(value);
    setCategory("");
    void load(query, value, "", sort, inStock);
  }
  function chooseCategory(value: string) {
    setCategory(value);
    if (value) trackIntent(accessToken, [{ event_type: "category", category_ref: value }]);
    void load(query, group, value, sort, inStock);
  }
  const filtering = !!(query.trim() || group || category || inStock);
  return (
    <section className="member-workspace-panel shop-browse">
      <header>
        <small>FAYFORT STORE</small>
        <h2>Browse</h2>
        <p>What's moving right now, then everything by category.</p>
      </header>
      {!filtering && home ? (
        <HotRails rails={home.rails} giveaways={home.giveaways} onOpen={onOpen} onWant={onWant} onEnter={onEnter} busyId={busyId} />
      ) : null}
      <form className="member-product-filters member-workspace-filters shop-filters" onSubmit={search}>
        <label>
          Search products
          <input
            aria-label="Search products"
            value={query}
            maxLength={100}
            placeholder="Wig, ankara, lace…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          Category
          <select aria-label="Category" value={category} onChange={(event) => chooseCategory(event.target.value)}>
            <option value="">All categories</option>
            {(result?.categories || []).map((item) => (
              <option key={item.source_ref} value={item.source_ref}>
                {item.category} · {item.product_type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            aria-label="Sort"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              void load(query, group, category, event.target.value, inStock);
            }}
          >
            <option value="for_you">For you</option>
            <option value="newest">Newest</option>
            <option value="price_low">Price: low to high</option>
            <option value="price_high">Price: high to low</option>
          </select>
        </label>
        <label className="shop-check">
          <input
            type="checkbox"
            checked={inStock}
            onChange={(event) => {
              setInStock(event.target.checked);
              void load(query, group, category, sort, event.target.checked);
            }}
          />
          Ships now
        </label>
        <button className="primary-button" disabled={loading}>
          Search
        </button>
      </form>
      <div className="shop-chips" role="group" aria-label="Category groups">
        <button type="button" className={!group ? "active" : ""} aria-pressed={!group} onClick={() => chooseGroup("")}>
          All
        </button>
        {(result?.groups || []).map((item) => (
          <button
            type="button"
            key={item.name}
            className={group === item.name ? "active" : ""}
            aria-pressed={group === item.name}
            onClick={() => chooseGroup(item.name)}
          >
            {item.name}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {loading && !result ? (
        <p role="status">Loading products…</p>
      ) : result && !result.products.length ? (
        <p className="empty-copy">Nothing matches yet. Ask in the chat or paste a link and FayFort will source it.</p>
      ) : (
        <section className="shop-grid" aria-label="Available products">
          {(result?.products || []).map((card) => (
            <ProductTile key={card.id} card={card} onOpen={onOpen} />
          ))}
        </section>
      )}
    </section>
  );
}
