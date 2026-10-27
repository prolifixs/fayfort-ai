import { useEffect, useState } from "react";
import type { CategoryBarItem, CategoryTile, FindItResult, Giveaway, Rail, ShopCard, StoreSectionTile, TrendCard } from "./commerceApi";
import { isTrend, money, timeLeft } from "./commerceApi";
import { SaveProductButton } from "./accountExtras";

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
    return <span className="shop-price muted">{card.source === "shopify" ? "" : "Contact our team for a price"}</span>;
  }
  if (card.price_guide) {
    return (
      <span className="shop-price is-guide">
        <strong>From {money(card.price, card.currency)}</strong>
        <small className="shop-price-est"> est.</small>
        {card.min_order ? <small> · min {card.min_order}</small> : null}
      </span>
    );
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
  accessToken,
  onSavedChange,
}: {
  card: ShopCard;
  onOpen: (card: ShopCard) => void;
  onRequest?: (card: ShopCard) => void;
  compact?: boolean;
  /** When given, the tile shows a heart to save the product. */
  accessToken?: string | null;
  onSavedChange?: (card: ShopCard, saved: boolean) => void;
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
        <TileBadges card={card} />
      </button>
      {accessToken && (
        <SaveProductButton
          accessToken={accessToken}
          productId={card.id}
          initial={card.saved}
          compact
          onChange={(saved) => onSavedChange?.(card, saved)}
        />
      )}
      <div className="shop-tile-copy">
        <small>{card.category_label || card.group_name || (card.source === "shopify" ? "FayFort store" : "Sourcing")}</small>
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

/** Everything about one giveaway: prize, rules, dates, entries and, after the draw, the winners and your code. */
export function GiveawaySheet({
  giveaway,
  onEnter,
  busy,
  onClose,
}: {
  giveaway: Giveaway;
  onEnter: (giveaway: Giveaway) => void;
  busy?: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const day = (value?: string) =>
    value ? new Date(value).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const open = giveaway.status === "open";
  return (
    <div className="giveaway-sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section className="giveaway-sheet" role="dialog" aria-modal="true" aria-labelledby="giveaway-sheet-title">
        <button type="button" className="giveaway-sheet-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <span className="giveaway-sheet-art" aria-hidden="true">
          🎁
        </span>
        <small className="giveaway-sheet-kicker">{open ? "Giveaway · free to enter" : "Giveaway · winners drawn"}</small>
        <h2 id="giveaway-sheet-title">{giveaway.title}</h2>
        <p className="giveaway-sheet-prize">
          <strong>Prize:</strong> {giveaway.prize_text}
        </p>
        {giveaway.description && <p className="giveaway-sheet-copy">{giveaway.description}</p>}
        <dl className="giveaway-sheet-facts">
          {giveaway.starts_at && (
            <div>
              <dt>Opened</dt>
              <dd>{day(giveaway.starts_at)}</dd>
            </div>
          )}
          <div>
            <dt>{open ? "Ends" : "Ended"}</dt>
            <dd>{open ? <Countdown endsAt={giveaway.ends_at} /> : day(giveaway.ends_at)}</dd>
          </div>
          <div>
            <dt>Winners</dt>
            <dd>{giveaway.winner_count ?? 1}</dd>
          </div>
          <div>
            <dt>Entries so far</dt>
            <dd>{giveaway.entry_count ?? 0}</dd>
          </div>
        </dl>
        <ul className="giveaway-sheet-rules">
          <li>One free entry per member. No purchase needed.</li>
          <li>Winners are drawn at random when it ends, and emailed straight away.</li>
          <li>A store prize comes as a code that makes it free at checkout, valid for 60 days.</li>
        </ul>
        {giveaway.won ? (
          <p className="giveaway-sheet-won" role="status">
            You won!{giveaway.prize_code ? <> Your code: <strong>{giveaway.prize_code}</strong></> : " We'll contact you about your prize."}
          </p>
        ) : !open && giveaway.winners?.length ? (
          <p className="giveaway-sheet-winners">Winner{giveaway.winners.length === 1 ? "" : "s"}: {giveaway.winners.join(", ")}</p>
        ) : null}
        {open && (
          <button type="button" className={giveaway.entered ? "secondary-button" : "primary-button"} disabled={busy || giveaway.entered} onClick={() => onEnter(giveaway)}>
            {giveaway.entered ? "You're in. Good luck!" : "Enter free"}
          </button>
        )}
      </section>
    </div>
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
  const [details, setDetails] = useState(false);
  return (
    <article className="shop-tile giveaway" aria-label={giveaway.title}>
      <button type="button" className="shop-tile-media giveaway-open" onClick={() => setDetails(true)} aria-label={`About ${giveaway.title}`}>
        <span aria-hidden="true">🎁</span>
        <b className="shop-badge">Giveaway</b>
      </button>
      {details && <GiveawaySheet giveaway={giveaway} onEnter={onEnter} busy={busy} onClose={() => setDetails(false)} />}
      <div className="shop-tile-copy">
        <small>{giveaway.status === "open" ? <Countdown endsAt={giveaway.ends_at} /> : "Winners drawn"}</small>
        <button type="button" className="giveaway-title-button" onClick={() => setDetails(true)}>
          <strong>{giveaway.title}</strong>
        </button>
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

/** Badges worked out by the shop (discount, ships now, sourced on request, new...). At most two on a tile. */
export function TileBadges({ card }: { card: ShopCard }) {
  const badges = card.badges?.length
    ? card.badges.filter((badge) => badge.key !== "sourced" && badge.key !== "ships").slice(0, 2)
    : card.sale
      ? [{ key: "discount" as const, label: "Sale" }]
      : [];
  if (card.low_stock && badges.length < 2) badges.push({ key: "ending" as const, label: "Few left" });
  if (!badges.length) return null;
  return (
    <span className="shop-badges">
      {badges.map((badge) => (
        <b key={badge.key + badge.label} className={`shop-badge is-${badge.key}${badge.key === "discount" ? " sale" : ""}`}>
          {badge.label}
        </b>
      ))}
    </span>
  );
}

/** The category bar at the top of Browse: groups first, then the busiest categories. */
export function CategoryBar({
  items,
  group,
  category,
  onGroup,
  onCategory,
}: {
  items: CategoryBarItem[];
  group: string;
  category: string;
  onGroup: (value: string) => void;
  onCategory: (value: string) => void;
}) {
  if (!items.length) return null;
  return (
    <nav className="shop-category-bar" aria-label="Shop by category">
      <button type="button" aria-pressed={!group && !category} onClick={() => onGroup("")}>
        All
      </button>
      {items.map((item) => (
        <button
          key={`${item.kind}-${item.key}`}
          type="button"
          className={item.kind === "group" ? "is-group" : ""}
          aria-pressed={item.kind === "group" ? group === item.key && !category : category === item.key}
          onClick={() => (item.kind === "group" ? onGroup(item.key) : onCategory(item.key))}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

/** Store section tiles, AliExpress style: a title, a hook and three products. Tapping opens the whole section. */
export function SectionTiles({
  sections,
  giveaways,
  onOpenSection,
  onOpenProduct,
  onEnter,
  busyId,
}: {
  sections: StoreSectionTile[];
  giveaways: Giveaway[];
  onOpenSection: (section: StoreSectionTile) => void;
  onOpenProduct: (card: ShopCard) => void;
  onEnter: (giveaway: Giveaway) => void;
  busyId?: string;
}) {
  const live = giveaways.filter((giveaway) => giveaway.status === "open");
  const [openGiveaway, setOpenGiveaway] = useState<Giveaway | null>(null);
  if (!sections.length && !live.length) return null;
  const shown = openGiveaway ? giveaways.find((g) => g.id === openGiveaway.id) || openGiveaway : null;
  return (
    <div className="shop-sections" aria-label="Store sections">
      {shown && <GiveawaySheet giveaway={shown} onEnter={onEnter} busy={busyId === shown.id} onClose={() => setOpenGiveaway(null)} />}
      {live.slice(0, 1).map((giveaway) => (
        <section key={giveaway.id} className="shop-section-tile accent-gold is-giveaway" aria-label={`Giveaway: ${giveaway.title}`}>
          <header>
            <h3>Giveaway</h3>
            <span className="shop-section-hook">
              <Countdown endsAt={giveaway.ends_at} />
            </span>
          </header>
          <button type="button" className="shop-section-giveaway" onClick={() => setOpenGiveaway(giveaway)}>
            <strong>{giveaway.title}</strong>
            <span>{giveaway.prize_text}</span>
            <small>Details and rules ›</small>
          </button>
          <button type="button" className="primary-button" disabled={giveaway.entered || busyId === giveaway.id} onClick={() => onEnter(giveaway)}>
            {giveaway.entered ? "You're in" : "Enter free"}
          </button>
        </section>
      ))}
      {sections.map((section) => (
        <section key={section.id} className={`shop-section-tile accent-${section.accent}`} aria-label={section.title}>
          <header>
            <button type="button" className="shop-section-title" onClick={() => onOpenSection(section)}>
              <h3>{section.title}</h3>
              <span aria-hidden="true">›</span>
            </button>
            {section.hook && <span className="shop-section-hook">{section.hook}</span>}
          </header>
          <div className="shop-section-items">
            {section.items.slice(0, 3).map((card) => {
              const sale = card.sale?.sale_price ?? null;
              const now = sale ?? card.price;
              const discount = card.badges?.find((badge) => badge.key === "discount");
              return (
                <button key={card.id} type="button" className="shop-section-item" onClick={() => onOpenProduct(card)} aria-label={`Open ${card.name}`}>
                  <span className="shop-section-media">
                    {card.media_url && card.media_type !== "video" ? (
                      <img src={card.media_url} alt="" loading="lazy" />
                    ) : card.media_url ? (
                      <video src={card.media_url} muted playsInline preload="metadata" />
                    ) : (
                      <span aria-hidden="true">{card.name.slice(0, 1)}</span>
                    )}
                    {discount && <b>{discount.label}</b>}
                  </span>
                  <strong>
                    {now !== null && now !== undefined ? `${card.price_guide ? "From " : ""}${money(now, card.currency)}` : "On request"}
                  </strong>
                  {sale !== null ? <s>{money(card.price, card.currency)}</s> : card.compare_at_price ? <s>{money(card.compare_at_price, card.currency)}</s> : null}
                </button>
              );
            })}
          </div>
          {section.ends_at && (
            <small className="shop-section-ends">
              <Countdown endsAt={section.ends_at} />
            </small>
          )}
        </section>
      ))}
    </div>
  );
}

/** Shop by category: a photo tile per top-level category (Browse). */
export function CategoryTiles({ tiles, onChoose }: { tiles: CategoryTile[]; onChoose: (key: string) => void }) {
  if (!tiles.length) return null;
  return (
    <section className="shop-cat-tiles" aria-label="Category tiles">
      <h3>Shop by category</h3>
      <div className="shop-cat-track">
        {tiles.map((tile) => (
          <button type="button" key={tile.key} className="shop-cat-tile" onClick={() => onChoose(tile.key)}>
            <img src={tile.image_url} alt="" loading="lazy" />
            <span>
              <strong>{tile.label}</strong>
              <small>
                {tile.count} {tile.count === 1 ? "item" : "items"}
              </small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Chat welcome: a grid of pictured products from the rails, category buttons and a Browse button. */
export function ChatPicks({
  rails,
  tiles,
  onOpen,
  browseHref,
  limit = 8,
}: {
  rails: Rail[];
  tiles: CategoryTile[];
  onOpen: (card: ShopCard) => void;
  browseHref: string;
  limit?: number;
}) {
  const seen = new Set<string>();
  const picks: ShopCard[] = [];
  // Take from each product rail in turn so the grid mixes categories.
  const lists = rails.filter((rail) => rail.kind !== "trend").map((rail) => rail.items.filter((item): item is ShopCard => !isTrend(item)));
  for (let round = 0; picks.length < limit && lists.some((list) => list.length > round); round += 1) {
    for (const list of lists) {
      const card = list[round];
      if (card && card.media_url && !seen.has(card.id) && picks.length < limit) {
        seen.add(card.id);
        picks.push(card);
      }
    }
  }
  if (!picks.length && !tiles.length) return null;
  return (
    <section className="shop-chat-picks" aria-label="Popular picks">
      {picks.length > 0 && (
        <>
          <h3>Popular picks</h3>
          <div className="shop-chat-grid">
            {picks.map((card) => (
              <button type="button" key={card.id} className="shop-chat-pick" onClick={() => onOpen(card)} aria-label={`Open ${card.name}`}>
                {card.media_type === "video" ? <video src={card.media_url || undefined} muted playsInline preload="metadata" /> : <img src={card.media_url || undefined} alt="" loading="lazy" />}
                <span>
                  <strong>{card.name}</strong>
                  <PriceLine card={card} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {tiles.length > 0 && (
        <nav className="shop-chat-cats" aria-label="Shop by category">
          {tiles.slice(0, 5).map((tile) => (
            <a key={tile.key} href={`${browseHref}${browseHref.includes("?") ? "&" : "?"}top=${encodeURIComponent(tile.key)}`}>
              {tile.label}
            </a>
          ))}
        </nav>
      )}
      <a className="primary-button shop-chat-browse" href={browseHref}>
        Browse all products
      </a>
    </section>
  );
}

export function HotRails({
  rails,
  giveaways,
  onOpen,
  onWant,
  onEnter,
  busyId,
  accessToken,
}: {
  rails: Rail[];
  giveaways: Giveaway[];
  onOpen: (card: ShopCard) => void;
  onWant: (trend: TrendCard) => void;
  onEnter: (giveaway: Giveaway) => void;
  busyId?: string;
  accessToken?: string | null;
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
                <ProductTile key={item.id} card={item} onOpen={onOpen} compact accessToken={accessToken} />
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
