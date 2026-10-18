import { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useDismiss } from "../ui/useDismiss";
import { apiRequest } from "../../lib/api";
import type { Cart, ProductDetail, ShopCard, ShopHome, StoreSectionTile, TrendCard, Giveaway } from "./commerceApi";
import { money, shopSessionId, trackIntent } from "./commerceApi";
import { CategoryBar, Countdown, HotRails, PriceLine, ProductTile, SectionTiles, TrendTile } from "./ShopComponents";
import { MemberRequestsPanel, type RequestSummary } from "./MemberRequestsPanel";
import { AddressPickerDialog, SaveProductButton, addressLine, useAddresses } from "./accountExtras";
import { AdSlot } from "./ads";
import { FayfortLoader } from "../brand/FayfortLogo";
import type { ProductRef } from "./productChat";

/** Browse grid positions (0-based) after which an in-feed ad may appear. */
const FEED_AD_AFTER = new Set([7, 23]);

/** Product page that opens beside the chat (the familiar side panel), so the member can keep asking. */
export function ProductPanel({
  accessToken,
  productId,
  onOpen,
  onCartChange,
  onClose,
  onLoaded,
  onAsk,
  askTip,
  onDismissTip,
}: {
  accessToken: string;
  productId: string;
  onOpen: (card: ShopCard) => void;
  onCartChange: (cart: Cart) => void;
  onClose: () => void;
  /** Tells the chat which product is open, so the member can ask about it. */
  onLoaded?: (product: ProductRef) => void;
  /** "Ask about this": the chat sheet on phones, the message box on desktop. */
  onAsk?: () => void;
  askTip?: boolean;
  onDismissTip?: () => void;
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
        const first = result.variants.find((variant) => variant.available) || result.variants[0];
        onLoaded?.({
          id: result.product.id,
          name: result.product.name,
          price: first ? (first.sale_price ?? first.price) : result.product.price ?? null,
          currency: result.product.currency || "USD",
          image: result.media.find((item) => item.media_type === "image")?.url || result.product.media_url || null,
        });
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
        !error && <FayfortLoader label="Loading product…" />
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
          <div className="shop-product-title">
            <h2>{detail.product.name}</h2>
            <SaveProductButton accessToken={accessToken} productId={detail.product.id} initial={detail.product.saved} />
          </div>
          <PriceLine card={{ ...detail.product, price: variant?.price ?? detail.product.price, sale: detail.product.sale && variant ? { ...detail.product.sale, sale_price: variant.sale_price } : detail.product.sale }} />
          {detail.product.sale ? (
            <p className="shop-sale-note">
              {detail.product.sale.title} · <Countdown endsAt={detail.product.sale.ends_at} />
            </p>
          ) : null}
          {(detail.product.buyable || detail.variants.length) && !detail.product.held_for_giveaway ? (
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
              {onAsk && (
                <button type="button" className="secondary-button product-ask-button" onClick={onAsk}>
                  Ask in chat
                </button>
              )}
            </div>
          ) : (
            <>
              <p className="shop-sale-note">
                {detail.product.held_for_giveaway
                  ? "This one is a giveaway prize right now, so it's held back. Ask in the chat if you'd like one."
                  : "This listing is sourced on request. Ask about it in the chat or use Source it."}
              </p>
              {detail.product.source !== "shopify" && (detail.product.min_order || detail.product.lead_time) ? (
                <dl className="shop-sourcing-facts">
                  {detail.product.price_guide && detail.product.price ? (
                    <div>
                      <dt>Price guide</dt>
                      <dd>
                        From {money(detail.product.price, detail.product.currency)}
                        {detail.product.price_max && detail.product.price_max > detail.product.price ? ` to ${money(detail.product.price_max, detail.product.currency)}` : ""}
                        <small> · your quote comes after we source it</small>
                      </dd>
                    </div>
                  ) : null}
                  {detail.product.min_order ? (
                    <div>
                      <dt>Minimum order</dt>
                      <dd>{detail.product.min_order}</dd>
                    </div>
                  ) : null}
                  {detail.product.lead_time ? (
                    <div>
                      <dt>Usually takes</dt>
                      <dd>
                        {detail.product.lead_time.max && detail.product.lead_time.max !== detail.product.lead_time.min
                          ? `${detail.product.lead_time.min ?? 0}–${detail.product.lead_time.max}`
                          : detail.product.lead_time.min ?? detail.product.lead_time.max}{" "}
                        days to source
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {onAsk && (
                <button type="button" className="secondary-button product-ask-button" onClick={onAsk}>
                  Ask in chat
                </button>
              )}
            </>
          )}
          {onAsk && (
            <button type="button" className="product-ask-fab" onClick={onAsk} aria-label="Ask about this product" data-tour="product-ask">
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.7 8.7 0 0 1-3.4-.7L4 20l1.4-3.5A7.2 7.2 0 0 1 4 12c0-4.1 3.6-7.5 8-7.5s8 3.1 8 7Z" />
              </svg>
              <span>Ask</span>
            </button>
          )}
          {onAsk && askTip && (
            <div className="product-ask-tip" role="status">
              <p>
                <strong>Ask about this product.</strong> Tap Ask (or use the card above the message box on a computer) and
                choose a new chat or one you have. FayFort AI will know which product you mean.
              </p>
              <button type="button" className="link-button" onClick={onDismissTip}>
                Got it
              </button>
            </div>
          )}
          {notice && <p role="status">{notice}</p>}
          {detail.product.description && <p className="shop-description">{detail.product.description}</p>}
          <AdSlot placement="product_detail" />
          {detail.pairs_with?.length ? (
            <section className="shop-rail" aria-label="Goes well with">
              <h3>Goes well with</h3>
              <div className="shop-rail-track">
                {detail.pairs_with.map((card) => (
                  <ProductTile key={card.id} card={card} onOpen={onOpen} compact accessToken={accessToken} />
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
  const cartRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), [cartRef]);
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
    <div className="shop-cart-control" ref={cartRef}>
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
          <div className="sheet-handle" aria-hidden="true" />
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
  /** order (goods: needs a delivery address), deposit, consultation, contact_credits */
  kind?: string;
  ship_to?: Record<string, string | null> | null;
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
export function OrdersPanel({
  accessToken,
  onAddressChange,
  onViewChat,
}: {
  accessToken: string;
  onAddressChange?: () => void;
  /** Opens the chat kept with a request (from the Archive if it's there). */
  onViewChat?: (conversationId: string) => void;
}) {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState<MemberInvoice | null>(null);
  const [cancelling, setCancelling] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [addressVersion, setAddressVersion] = useState(0);
  const book = useAddresses(accessToken, addressVersion);
  const [tab, setTab] = useState<"active" | "completed" | "recurring">("active");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  // Links like /member/chat?panel=requests#request-<id> open that request.
  const [openId, setOpenId] = useState(() =>
    window.location.hash.startsWith("#request-") ? decodeURIComponent(window.location.hash.slice("#request-".length)) : "",
  );
  const [summary, setSummary] = useState<RequestSummary>({ active: 0, completed: 0, needs: [] });
  const load = useCallback(() => {
    apiRequest<OrdersResponse>("/members/orders", accessToken)
      .then(setData)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Your orders could not be loaded."));
  }, [accessToken]);
  useEffect(() => load(), [load]);
  const due = data?.invoices.filter((invoice) => invoice.status === "sent") || [];
  const needsAddress = due.some((invoice) => invoice.kind === "order") && book.loaded && !book.addresses.length;
  async function cancelConsultation(invoice: MemberInvoice) {
    setCancelBusy(true);
    setError("");
    try {
      await apiRequest(`/members/invoices/${invoice.id}/cancel`, accessToken, { method: "POST" });
      setCancelling("");
      setNotice("Your consultation was cancelled and its invoice no longer works.");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your consultation could not be cancelled.");
    } finally {
      setCancelBusy(false);
    }
  }
  async function payDirect(invoice: MemberInvoice) {
    const tab = window.open("", "_blank");
    try {
      const result = await apiRequest<{ invoice_url: string }>(`/members/invoices/${invoice.id}/pay`, accessToken, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (tab) tab.location.href = result.invoice_url;
      else window.location.assign(result.invoice_url);
    } catch (reason) {
      tab?.close();
      setError(reason instanceof Error ? reason.message : "Your invoice could not be opened.");
    }
  }
  const orderDone = (order: MemberOrder) => Boolean(order.cancelled_at) || order.fulfillment_status === "fulfilled";
  const needle = query.trim().toLowerCase();
  const matches = (order: MemberOrder) =>
    !needle ||
    `${order.order_name || ""} ${order.line_items.map((item) => item.title).join(" ")}`.toLowerCase().includes(needle);
  const openOrders = (data?.orders || []).filter((order) => !orderDone(order));
  const doneOrders = (data?.orders || []).filter(orderDone);
  const shownOrders = (tab === "active" ? openOrders : tab === "completed" ? doneOrders : []).filter(matches);
  const needCount = due.length + summary.needs.length + (needsAddress ? 1 : 0);
  return (
    <section className="member-workspace-panel member-workspace-requests orders-hub">
      <header className="orders-hub-header">
        <div>
          <small>YOUR ACCOUNT</small>
          <h2>Orders & requests</h2>
          <p>Everything you're buying or asked us to source. Anything waiting for you is at the top.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => setCreating((value) => !value)} aria-expanded={creating}>
          {creating ? "Close the form" : "New request"}
        </button>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {notice && <p role="status" className="member-deposit-note">{notice}</p>}
      <section className={needCount ? "orders-needs has-items" : "orders-needs"} aria-label="Needs you">
        <h3>
          Needs you{needCount ? <span className="orders-count">{needCount}</span> : null}
        </h3>
        {!needCount && <p className="orders-needs-empty">Nothing needs you right now. We'll show it here when something does.</p>}
        {needsAddress && (
          <div className="member-address-needed" role="note">
            <div>
              <strong>Add a shipping address</strong>
              <span>You'll need one before paying for an order, so we know where to deliver.</span>
            </div>
            <button type="button" className="secondary-button" onClick={() => setPaying(due.find((invoice) => invoice.kind === "order") || null)}>
              Add address
            </button>
          </div>
        )}
        {due.length ? (
          <section className="shop-orders" aria-label="Invoices to pay">
          {due.map((invoice) => (
            <article key={invoice.id} className="shop-order due">
              <div>
                <strong>{invoice.title}</strong>
                <small>
                  {invoice.quantity > 1 ? `${invoice.quantity} × ` : ""}
                  {money(invoice.amount, invoice.currency)}
                </small>
                {invoice.kind === "order" && invoice.ship_to && <small>Deliver to: {addressLine(invoice.ship_to)}</small>}
                {cancelling === invoice.id && (
                  <div className="member-request-cancel" role="group" aria-label={`Cancel ${invoice.title}`}>
                    <strong>Cancel this consultation?</strong>
                    <p>Its invoice stops working. You can book again later.</p>
                    <div className="member-request-cancel-actions">
                      <button type="button" className="danger-button" disabled={cancelBusy} onClick={() => void cancelConsultation(invoice)}>
                        {cancelBusy ? "Cancelling…" : "Yes, cancel"}
                      </button>
                      <button type="button" className="secondary-button" disabled={cancelBusy} onClick={() => setCancelling("")}>
                        Keep it
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="shop-order-actions">
                {invoice.invoice_url ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => (invoice.kind === "order" ? setPaying(invoice) : void payDirect(invoice))}
                  >
                    Pay invoice
                  </button>
                ) : (
                  <small>We emailed your invoice.</small>
                )}
                {invoice.kind === "consultation" && cancelling !== invoice.id && (
                  <button type="button" className="link-danger" onClick={() => setCancelling(invoice.id)}>
                    Cancel consultation
                  </button>
                )}
              </div>
            </article>
          ))}
          </section>
        ) : null}
        {summary.needs.map((need) => (
          <article key={need.id} className="shop-order due orders-need-request">
            <div>
              <strong>{need.kind === "answer" ? "We have a question about your request" : "Your options are ready"}</strong>
              <small>{need.title}</small>
            </div>
            <div className="shop-order-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setTab("active");
                  setQuery("");
                  setOpenId(need.id);
                }}
              >
                {need.kind === "answer" ? "Answer" : "Choose an option"}
              </button>
            </div>
          </article>
        ))}
      </section>
      {paying && (
        <AddressPickerDialog
          accessToken={accessToken}
          invoice={paying}
          onClose={() => {
            setPaying(null);
            setAddressVersion((value) => value + 1);
            load();
            onAddressChange?.();
          }}
        />
      )}
      <div className="orders-tabs" role="tablist" aria-label="Orders and requests">
        {(
          [
            ["active", "In progress", summary.active + openOrders.length],
            ["completed", "Completed", summary.completed + doneOrders.length],
            ["recurring", "Recurring", null],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "is-active" : undefined}
            onClick={() => setTab(key)}
          >
            {label}
            {count !== null && <span className="orders-count">{count}</span>}
          </button>
        ))}
        {tab !== "recurring" && (
          <input
            className="orders-search"
            type="search"
            aria-label="Search orders and requests"
            placeholder="Search by name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
      </div>
      {shownOrders.length ? (
        <section className="shop-orders" aria-label={tab === "completed" ? "Completed shop orders" : "Shop orders in progress"}>
          {shownOrders.map((order) => (
            <article key={order.id} className="shop-order orders-hub-order">
              <small className="member-request-kind">Shop order</small>
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
      <MemberRequestsPanel
        accessToken={accessToken}
        compact
        view={tab === "recurring" ? "none" : tab}
        query={query}
        showCreate={creating}
        showRecurring={tab === "recurring"}
        onCreated={() => {
          setCreating(false);
          setTab("active");
          setNotice("Your request was sent. You'll find it under In progress.");
        }}
        openId={openId}
        onOpenChange={setOpenId}
        onSummary={setSummary}
        onViewChat={onViewChat}
      />
      {tab === "active" && data?.wanted.length ? (
        <section className="shop-rail" aria-label="Items you want sourced">
          <h3>Items you asked us to find</h3>
          <div className="shop-rail-track">
            {data.wanted.map((trend) => (
              <TrendTile key={trend.id} trend={trend} />
            ))}
          </div>
        </section>
      ) : null}
      <AdSlot placement="orders_footer" />
    </section>
  );
}

type BrowseResponse = {
  products: ShopCard[];
  total: number;
  has_more?: boolean;
  offset?: number;
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
  home: ShopHome | null;
}) {
  const [openSection, setOpenSection] = useState<StoreSectionTile | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
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
  // "More to explore": the grid keeps loading as the member scrolls, inside the same filters.
  const loadMore = useCallback(async () => {
    if (!result?.has_more || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ sort, offset: String(result.products.length) });
      if (query.trim()) params.set("q", query.trim());
      if (group) params.set("group", group);
      if (category) params.set("category_ref", category);
      if (inStock) params.set("in_stock", "true");
      const next = await apiRequest<BrowseResponse>(`/members/shop/products?${params}`, accessToken);
      setResult((current) =>
        current ? { ...current, products: [...current.products, ...next.products.filter((p) => !current.products.some((c) => c.id === p.id))], has_more: next.has_more } : next,
      );
    } catch {
      /* the member can scroll again to retry */
    } finally {
      setLoadingMore(false);
    }
  }, [result, loadingMore, sort, query, group, category, inStock, accessToken]);
  useEffect(() => {
    const target = moreRef.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "400px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore]);
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
      <CategoryBar items={home?.category_bar || []} group={group} category={category} onGroup={chooseGroup} onCategory={chooseCategory} />
      {!filtering && home ? (
        <>
          <SectionTiles
            sections={home.sections || []}
            giveaways={home.giveaways}
            onOpenSection={setOpenSection}
            onOpenProduct={onOpen}
            onEnter={onEnter}
            busyId={busyId}
          />
          <HotRails
            rails={home.rails}
            giveaways={home.giveaways.filter((giveaway) => giveaway.status !== "open")}
            onOpen={onOpen}
            onWant={onWant}
            onEnter={onEnter}
            busyId={busyId}
            accessToken={accessToken}
          />
        </>
      ) : null}
      {openSection && (
        <SectionSheet section={openSection} accessToken={accessToken} onOpen={(card) => { setOpenSection(null); onOpen(card); }} onClose={() => setOpenSection(null)} />
      )}
      {!filtering && <AdSlot placement="browse_top" />}
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
        <FayfortLoader label="Loading products…" />
      ) : result && !result.products.length ? (
        <p className="empty-copy">Nothing matches yet. Ask in the chat or paste a link and FayFort will source it.</p>
      ) : (
        <>
          {!filtering && <h3 className="shop-more-title">More to explore</h3>}
          <section className="shop-grid" aria-label="Available products">
            {(result?.products || []).map((card, index) => (
              <Fragment key={card.id}>
                <ProductTile card={card} onOpen={onOpen} accessToken={accessToken} />
                {FEED_AD_AFTER.has(index) && index < (result?.products.length || 0) - 1 && <AdSlot placement="browse_feed" />}
              </Fragment>
            ))}
          </section>
          {result?.has_more && (
            <div ref={moreRef} className="shop-more">
              <button type="button" className="secondary-button" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? "Loading…" : "Show more"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Every product in one store section, opened from its tile. */
function SectionSheet({
  section,
  accessToken,
  onOpen,
  onClose,
}: {
  section: StoreSectionTile;
  accessToken: string;
  onOpen: (card: ShopCard) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ShopCard[]>(section.items);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    apiRequest<{ section: StoreSectionTile }>(`/members/shop/sections/${encodeURIComponent(section.id)}`, accessToken)
      .then((data) => alive && setItems(data.section.items))
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "This section could not be loaded."));
    return () => {
      alive = false;
    };
  }, [section.id, accessToken]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return (
    <div className="shop-section-sheet-scrim" onClick={onClose}>
      <section
        className={`shop-section-sheet accent-${section.accent}`}
        role="dialog"
        aria-modal="true"
        aria-label={section.title}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2>{section.title}</h2>
            {section.hook && <span className="shop-section-hook">{section.hook}</span>}
          </div>
          <button type="button" className="shop-section-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="shop-grid">
          {items.map((card) => (
            <ProductTile key={card.id} card={card} onOpen={onOpen} accessToken={accessToken} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Saved products: the shop products the member hearted, same cards as Browse. */
export function SavedPanel({
  accessToken,
  onOpen,
  onBrowse,
}: {
  accessToken: string;
  onOpen: (card: ShopCard) => void;
  onBrowse: () => void;
}) {
  const [cards, setCards] = useState<ShopCard[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    apiRequest<BrowseResponse>("/members/shop/products?saved_only=true&sort=newest&limit=100", accessToken)
      .then((result) => alive && setCards(result.products))
      .catch((reason) => alive && setError(reason instanceof Error ? reason.message : "Saved products could not be loaded."));
    return () => {
      alive = false;
    };
  }, [accessToken]);
  return (
    <section className="member-workspace-panel" aria-label="Saved products panel">
      <header>
        <small>YOUR ACCOUNT</small>
        <h2>Saved products</h2>
        <p>Products you saved with the heart. Tap the heart again to remove one.</p>
      </header>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {!cards ? (
        !error && <FayfortLoader label="Loading saved products…" />
      ) : !cards.length ? (
        <div className="empty-copy shop-saved-empty">
          <p>You haven't saved anything yet. Tap the heart on any product to keep it here.</p>
          <button type="button" className="primary-button" onClick={onBrowse}>
            Browse products
          </button>
        </div>
      ) : (
        <section className="shop-grid" aria-label="Saved products">
          {cards.map((card) => (
            <ProductTile
              key={card.id}
              card={{ ...card, saved: true }}
              onOpen={onOpen}
              accessToken={accessToken}
              onSavedChange={(item, saved) => !saved && setCards((current) => (current || []).filter((row) => row.id !== item.id))}
            />
          ))}
        </section>
      )}
      {cards && cards.length >= 4 && <AdSlot placement="saved_footer" />}
    </section>
  );
}
