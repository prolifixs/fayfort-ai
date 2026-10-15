import { useEffect, useState } from "react";
import type { FindItResult, Giveaway, Rail, ShopCard, TrendCard } from "./commerceApi";
import { isTrend, money, timeLeft } from "./commerceApi";

export function Countdown({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="shop-countdown">{timeLeft(endsAt, now)}</span>;
}

export function PriceLine({ card }: { card: ShopCard }) {
  if (card.price === null || card.price === undefined) {
    return <span className="shop-price muted">{card.source === "shopify" ? "" : "Sourced on request"}</span>;
  }
  const salePrice = card.sale?.sale_price ?? null;
  const was = salePrice !== null ? card.price : card.compare_at_price;
  const now = salePrice !== null ? salePrice : card.price;
  return (
    <span className="shop-price">
      <strong>
        {money(now, card.currency)}
        {card.price_max && card.price_max > card.price ? "+" : ""}
      </strong>
      {was ? <s>{money(was, card.currency)}</s> : null}
    </span>
  );
}

export function ProductTile({
  card,
  onOpen,
  onRequest,
  compact = false,
}: {
  card: ShopCard;
  onOpen: (card: ShopCard) => void;
  onRequest?: (card: ShopCard) => void;
  compact?: boolean;
}) {
  return (
    <article className={compact ? "shop-tile compact" : "shop-tile"} aria-label={card.name}>
      <button type="button" className="shop-tile-media" onClick={() => onOpen(card)} aria-label={`Open ${card.name}`}>
        {card.media_url && card.media_type !== "video" ? (
          <img src={card.media_url} alt="" loading="lazy" />
        ) : card.media_url ? (
          <video src={card.media_url} muted playsInline preload="metadata" />
        ) : (
          <span aria-hidden="true">{card.name.slice(0, 1)}</span>
        )}
        {card.sale ? <b className="shop-badge sale">Sale</b> : card.low_stock ? <b className="shop-badge">Few left</b> : null}
      </button>
      <div className="shop-tile-copy">
        <small>{card.group_name || card.category_ref || (card.source === "shopify" ? "FayFort store" : "Sourcing")}</small>
        <strong>{card.name}</strong>
        <PriceLine card={card} />
        {card.sale ? <Countdown endsAt={card.sale.ends_at} /> : null}
        {card.source === "shopify" && card.in_stock === false ? <small className="shop-stock">Sold out</small> : null}
      </div>
      <div className="shop-tile-actions">
        {card.buyable ? (
          <button type="button" className="primary-button" onClick={() => onOpen(card)}>
            View
          </button>
        ) : onRequest ? (
          <button type="button" className="secondary-button" onClick={() => onRequest(card)}>
            Request this item
          </button>
        ) : (
          <button type="button" className="secondary-button" onClick={() => onOpen(card)}>
            View
          </button>
        )}
      </div>
    </article>
  );
}

function platformLabel(trend: TrendCard) {
  return trend.platform === "tiktok" ? "TikTok" : trend.platform === "instagram" ? "Instagram" : trend.site_name || "Link";
}

export function TrendTile({
  trend,
  onWant,
  onOpenProduct,
  busy,
}: {
  trend: TrendCard;
  onWant?: (trend: TrendCard) => void;
  onOpenProduct?: (card: ShopCard) => void;
  busy?: boolean;
}) {
  const progress = trend.pool?.progress ?? null;
  return (
    <article className="shop-tile trend" aria-label={trend.title}>
      <a className="shop-tile-media" href={trend.url} target="_blank" rel="noreferrer noopener">
        {trend.image_url ? <img src={trend.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">↗</span>}
        <b className={`shop-badge platform ${trend.platform}`}>{platformLabel(trend)}</b>
      </a>
      <div className="shop-tile-copy">
        <small>
          {trend.author_name ? `${trend.author_name} · ` : ""}
          {trend.want_count > 1 ? `${trend.want_count} want this` : trend.share_count > 1 ? `Shared ${trend.share_count} times` : "Shared on FayFort"}
        </small>
        <strong>{trend.title}</strong>
        {trend.pool && trend.pool.target ? (
          <div className="shop-pool">
            <span
              className="shop-pool-bar"
              role="progressbar"
              aria-label="Pool progress"
              aria-valuemin={0}
              aria-valuemax={trend.pool.target}
              aria-valuenow={trend.want_count}
            >
              <i style={{ width: `${Math.round((progress || 0) * 100)}%` }} />
            </span>
            <small>
              {trend.want_count} of {trend.pool.target} · group price {money(trend.pool.price, trend.pool.currency || "USD")}
            </small>
          </div>
        ) : null}
      </div>
      <div className="shop-tile-actions">
        {trend.linked_product && onOpenProduct ? (
          <button type="button" className="primary-button" onClick={() => onOpenProduct(trend.linked_product as ShopCard)}>
            In the store
          </button>
        ) : onWant ? (
          <button
            type="button"
            className={trend.member_wants ? "secondary-button" : "primary-button"}
            disabled={busy || !!trend.member_wants}
            onClick={() => onWant(trend)}
          >
            {trend.member_wants ? "You want this" : trend.pool ? "Join the pool" : "Source it"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function GiveawayTile({
  giveaway,
  onEnter,
  busy,
}: {
  giveaway: Giveaway;
  onEnter: (giveaway: Giveaway) => void;
  busy?: boolean;
}) {
  return (
    <article className="shop-tile giveaway" aria-label={giveaway.title}>
      <div className="shop-tile-media" aria-hidden="true">
        <span>🎁</span>
        <b className="shop-badge">Giveaway</b>
      </div>
      <div className="shop-tile-copy">
        <small>{giveaway.status === "open" ? <Countdown endsAt={giveaway.ends_at} /> : "Winners drawn"}</small>
        <strong>{giveaway.title}</strong>
        <span className="shop-price muted">Prize: {giveaway.prize_text}</span>
        {giveaway.won ? (
          <small className="shop-won">
            You won!{giveaway.prize_code ? ` Your code: ${giveaway.prize_code}` : " We'll be in touch."}
          </small>
        ) : null}
      </div>
      <div className="shop-tile-actions">
        {giveaway.status === "open" ? (
          <button
            type="button"
            className={giveaway.entered ? "secondary-button" : "primary-button"}
            disabled={busy || giveaway.entered}
            onClick={() => onEnter(giveaway)}
          >
            {giveaway.entered ? "You're in" : "Enter"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function HotRails({
  rails,
  giveaways,
  onOpen,
  onWant,
  onEnter,
  busyId,
}: {
  rails: Rail[];
  giveaways: Giveaway[];
  onOpen: (card: ShopCard) => void;
  onWant: (trend: TrendCard) => void;
  onEnter: (giveaway: Giveaway) => void;
  busyId?: string;
}) {
  if (!rails.length && !giveaways.length) return null;
  return (
    <div className="shop-rails">
      {giveaways.length ? (
        <section className="shop-rail" aria-label="Giveaways">
          <h3>Giveaways</h3>
          <div className="shop-rail-track">
            {giveaways.map((giveaway) => (
              <GiveawayTile key={giveaway.id} giveaway={giveaway} onEnter={onEnter} busy={busyId === giveaway.id} />
            ))}
          </div>
        </section>
      ) : null}
      {rails.map((rail) => (
        <section className="shop-rail" key={rail.key} aria-label={rail.title}>
          <h3>{rail.title}</h3>
          <div className="shop-rail-track">
            {rail.items.map((item) =>
              isTrend(item) ? (
                <TrendTile key={item.id} trend={item} onWant={onWant} onOpenProduct={onOpen} busy={busyId === item.id} />
              ) : (
                <ProductTile key={item.id} card={item} onOpen={onOpen} compact />
              ),
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export function FindItBlock({
  result,
  onOpen,
  onWant,
  onRequest,
  busy,
}: {
  result: FindItResult;
  onOpen: (card: ShopCard) => void;
  onWant: (trend: TrendCard) => void;
  onRequest: (title: string) => void;
  busy?: boolean;
}) {
  const sourceTitle = result.source_it.title_hint || result.query || "this item";
  return (
    <section className="shop-findit" aria-label="Find It results">
      {result.link ? (
        <div className="shop-findit-link">
          <TrendTile trend={result.link} />
        </div>
      ) : null}
      <div className="shop-findit-tiers">
        <div>
          <h4>Exact match</h4>
          {result.exact ? (
            <ProductTile card={result.exact} onOpen={onOpen} compact />
          ) : (
            <p className="shop-findit-empty">Not in the FayFort store yet.</p>
          )}
        </div>
        {result.alternatives.length ? (
          <div>
            <h4>{result.kind === "link" ? "Get something similar today" : "Closest alternatives"}</h4>
            <div className="shop-findit-row">
              {result.alternatives.map((card) => (
                <ProductTile key={card.id} card={card} onOpen={onOpen} compact />
              ))}
            </div>
          </div>
        ) : null}
        <div className="shop-findit-source">
          <h4>Source it</h4>
          <p>
            {result.link && result.link.want_count > 0
              ? `${result.link.want_count} ${result.link.want_count === 1 ? "person wants" : "people want"} this. `
              : ""}
            FayFort's team can find it for you and send you a price.
          </p>
          {result.link ? (
            <button
              type="button"
              className="primary-button"
              disabled={busy || !!result.link.member_wants}
              onClick={() => onWant(result.link as TrendCard)}
            >
              {result.link.member_wants ? "You want this" : "Source it"}
            </button>
          ) : (
            <button type="button" className="secondary-button" onClick={() => onRequest(sourceTitle)}>
              Source it
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
