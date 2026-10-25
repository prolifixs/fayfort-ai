import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { API_BASE, apiRequest } from "../../lib/api";
import "./ads.css";
import { readConsent } from "../../lib/consent";

/**
 * Ads on the member dashboard (docs/ADS_PLAN.md).
 *
 * The API decides who sees ads: free members do, Standard and Pro members get {show: false} and the Google script is
 * never loaded. Each <AdSlot> is a fixed placement staff manage in Control Center → Ads. At most `max_per_screen`
 * slots render at once (lowest priority number wins); slots load only when they come near the screen, collapse when
 * Google has nothing to show, and fall back to a custom ad when the placement allows it.
 */

export type AdShape = "banner" | "feed" | "square";
export type AdCreative = {
  id: string;
  advertiser?: string | null;
  headline: string;
  body?: string | null;
  cta_label: string;
  target_url: string;
  image_url?: string | null;
  tone: "brand" | "light" | "dark" | "accent";
  weight?: number;
};
export type AdPlacement = {
  key: string;
  shape: AdShape;
  priority: number;
  google: { slot: string; format: "auto" | "fluid" | "rectangle" | "horizontal"; layout_key?: string | null } | null;
  creatives: AdCreative[];
};
export type MemberAdsConfig =
  | { show: false; reason?: string }
  | {
      show: true;
      max_per_screen: number;
      google: { client: string; test: boolean } | null;
      placements: AdPlacement[];
    };

type AdEvent = { placement: string; creative_id?: string | null; source: "google" | "custom"; kind: "impression" | "click" };

type AdsContextValue = {
  config: Extract<MemberAdsConfig, { show: true }> | null;
  allowed: (id: string) => boolean;
  register: (id: string, priority: number) => () => void;
  report: (event: AdEvent) => void;
  onUpgrade?: () => void;
};

const AdsContext = createContext<AdsContextValue | null>(null);

const GOOGLE_SCRIPT_ID = "fayfort-adsbygoogle";

/** Personalised Google ads only with the visitor's marketing consent (lib/consent.ts); otherwise non-personalised. */
function applyAdConsent() {
  const queue = (window.adsbygoogle = window.adsbygoogle || []) as unknown[] & { requestNonPersonalizedAds?: number };
  queue.requestNonPersonalizedAds = readConsent()?.marketing ? 0 : 1;
}

function loadGoogleScript(client: string) {
  if (typeof document === "undefined") return;
  applyAdConsent();
  if (document.getElementById(GOOGLE_SCRIPT_ID)) return;
  const script = document.createElement("script");
  script.id = GOOGLE_SCRIPT_ID;
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(script);
}

/** Loads the member's ad settings and keeps the on-screen limit. Re-fetches when the plan changes. */
export function AdsProvider({
  accessToken,
  planKey,
  onUpgrade,
  children,
}: {
  accessToken: string | null;
  planKey?: string | null;
  onUpgrade?: () => void;
  children: ReactNode;
}) {
  const [config, setConfig] = useState<AdsContextValue["config"]>(null);
  const [slots, setSlots] = useState<{ id: string; priority: number; order: number }[]>([]);
  const order = useRef(0);
  const queue = useRef<AdEvent[]>([]);
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  useEffect(() => {
    if (!accessToken) {
      setConfig(null);
      return;
    }
    let alive = true;
    apiRequest<MemberAdsConfig>("/members/ads", accessToken)
      .then((result) => alive && setConfig(result && result.show === true && Array.isArray(result.placements) ? result : null))
      .catch(() => alive && setConfig(null));
    return () => {
      alive = false;
    };
  }, [accessToken, planKey]);

  const flush = useCallback((keepalive = false) => {
    const token = tokenRef.current;
    const events = queue.current.splice(0, 30);
    if (!token || !events.length) return;
    void fetch(API_BASE + "/members/ads/events", {
      method: "POST",
      keepalive,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ events }),
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!config) return;
    const timer = window.setInterval(() => flush(), 8000);
    const leave = () => flush(true);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      flush(true);
    };
  }, [config, flush]);

  const register = useCallback((id: string, priority: number) => {
    order.current += 1;
    const entry = { id, priority, order: order.current };
    setSlots((current) => [...current.filter((slot) => slot.id !== id), entry]);
    return () => setSlots((current) => current.filter((slot) => slot.id !== id));
  }, []);

  const allowedIds = useMemo(() => {
    const limit = config?.max_per_screen ?? 0;
    return new Set(
      [...slots]
        .sort((a, b) => a.priority - b.priority || a.order - b.order)
        .slice(0, limit)
        .map((slot) => slot.id),
    );
  }, [slots, config]);

  const report = useCallback(
    (event: AdEvent) => {
      queue.current.push(event);
      if (event.kind === "click" || queue.current.length >= 20) flush(event.kind === "click");
    },
    [flush],
  );

  const value = useMemo<AdsContextValue>(
    () => ({ config, allowed: (id) => allowedIds.has(id), register, report, onUpgrade }),
    [config, allowedIds, register, report, onUpgrade],
  );
  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}

function pickCreative(creatives: AdCreative[]): AdCreative | null {
  if (!creatives.length) return null;
  const total = creatives.reduce((sum, creative) => sum + Math.max(1, creative.weight || 1), 0);
  let roll = Math.random() * total;
  for (const creative of creatives) {
    roll -= Math.max(1, creative.weight || 1);
    if (roll < 0) return creative;
  }
  return creatives[0];
}

function scrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement || null;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

/** True once the element has come within `margin` of the screen (always true where IntersectionObserver is missing). */
function useNearScreen(ref: React.RefObject<HTMLElement | null>, margin = "200px", threshold = 0) {
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (near || !ref.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      // Measure against the panel that actually scrolls, so the margin preloads ads just before they scroll in.
      { root: scrollParent(ref.current), rootMargin: margin, threshold },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, near, margin, threshold]);
  return near;
}

/**
 * One ad placement. Renders nothing for paid members, when the placement is off, when the on-screen limit is
 * reached, or when Google has nothing to show and no custom ad is set.
 */
export function AdSlot({ placement, as = "div", className }: { placement: string; as?: "div" | "li"; className?: string }) {
  const ads = useContext(AdsContext);
  const id = useId();
  const config = ads?.config;
  const spec = config?.placements.find((item) => item.key === placement) || null;
  const register = ads?.register;
  useEffect(() => {
    if (!spec || !register) return;
    return register(id, spec.priority);
  }, [spec, register, id]);
  if (!ads || !config || !spec || !ads.allowed(id)) return null;
  return (
    <AdFrame
      as={as}
      className={className}
      placement={spec}
      google={config.google}
      report={ads.report}
      onUpgrade={ads.onUpgrade}
    />
  );
}

function AdFrame({
  as,
  className,
  placement,
  google,
  report,
  onUpgrade,
}: {
  as: "div" | "li";
  className?: string;
  placement: AdPlacement;
  google: { client: string; test: boolean } | null;
  report: (event: AdEvent) => void;
  onUpgrade?: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const near = useNearScreen(ref);
  const useGoogle = !!(google && placement.google);
  const [googleState, setGoogleState] = useState<"pending" | "filled" | "unfilled">("pending");
  const creative = useMemo(() => pickCreative(placement.creatives), [placement.creatives]);
  const showCustom = !useGoogle || googleState === "unfilled";
  const collapsed = showCustom && !creative;
  const Tag = as;

  if (collapsed) return null;
  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement & HTMLLIElement>}
      className={["fayfort-ad", `fayfort-ad-${placement.shape}`, className].filter(Boolean).join(" ")}
      data-placement={placement.key}
      aria-label="Advertisement"
    >
      {near &&
        (useGoogle && googleState !== "unfilled" ? (
          <GoogleAd
            client={google!.client}
            test={google!.test}
            unit={placement.google!}
            onStatus={(status) => {
              setGoogleState(status);
              if (status === "filled") report({ placement: placement.key, source: "google", kind: "impression" });
            }}
          />
        ) : creative ? (
          <CustomAd
            creative={creative}
            shape={placement.shape}
            onImpression={() => report({ placement: placement.key, creative_id: creative.id, source: "custom", kind: "impression" })}
            onClick={() => report({ placement: placement.key, creative_id: creative.id, source: "custom", kind: "click" })}
            onUpgrade={onUpgrade}
          />
        ) : null)}
      {onUpgrade && (
        <button type="button" className="fayfort-ad-remove" onClick={onUpgrade}>
          Remove ads
        </button>
      )}
    </Tag>
  );
}

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

function GoogleAd({
  client,
  test,
  unit,
  onStatus,
}: {
  client: string;
  test: boolean;
  unit: NonNullable<AdPlacement["google"]>;
  onStatus: (status: "filled" | "unfilled") => void;
}) {
  const ref = useRef<HTMLModElement | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    loadGoogleScript(client);
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      statusRef.current("unfilled");
      return;
    }
    let reported = false;
    const check = () => {
      const status = element.getAttribute("data-ad-status");
      if (!reported && (status === "filled" || status === "unfilled")) {
        reported = true;
        statusRef.current(status);
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(element, { attributes: true, attributeFilter: ["data-ad-status"] });
    // Blocked by an ad blocker or never answered: treat as unfilled so the slot collapses or shows a custom ad.
    const timeout = window.setTimeout(() => {
      if (!reported) {
        reported = true;
        statusRef.current("unfilled");
      }
    }, 8000);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [client]);
  const formatProps =
    unit.format === "fluid"
      ? { "data-ad-format": "fluid", ...(unit.layout_key ? { "data-ad-layout-key": unit.layout_key } : {}) }
      : unit.format === "auto"
        ? { "data-ad-format": "auto", "data-full-width-responsive": "true" }
        : { "data-ad-format": unit.format };
  return (
    <>
      <small className="fayfort-ad-label">Ad</small>
      <ins
        ref={ref}
        className="adsbygoogle fayfort-ad-google"
        style={{ display: "block" }}
        data-ad-client={client}
        data-ad-slot={unit.slot}
        {...formatProps}
        {...(test ? { "data-adtest": "on" } : {})}
      />
    </>
  );
}

/** FayFort's own ad (house or partner), styled with the member theme. Also used for previews in the Control Center. */
export function CustomAd({
  creative,
  shape,
  onImpression,
  onClick,
  onUpgrade,
}: {
  creative: AdCreative;
  shape: AdShape;
  onImpression?: () => void;
  onClick?: () => void;
  onUpgrade?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seen = useNearScreen(ref, "0px", 0.5);
  const counted = useRef(false);
  useEffect(() => {
    if (seen && !counted.current) {
      counted.current = true;
      onImpression?.();
    }
  }, [seen, onImpression]);
  const external = creative.target_url.startsWith("https://");
  const action = creative.target_url === "action:plans";
  const content = (
    <>
      {creative.image_url && <img className="fayfort-ad-image" src={creative.image_url} alt="" loading="lazy" />}
      <span className="fayfort-ad-copy">
        <strong>{creative.headline}</strong>
        {creative.body && <span>{creative.body}</span>}
      </span>
      <span className="fayfort-ad-cta">{creative.cta_label}</span>
    </>
  );
  return (
    <div ref={ref} className={`fayfort-ad-custom tone-${creative.tone} shape-${shape}`}>
      <small className="fayfort-ad-label">Ad{creative.advertiser ? ` · ${creative.advertiser}` : ""}</small>
      {action ? (
        <button
          type="button"
          className="fayfort-ad-link"
          onClick={() => {
            onClick?.();
            onUpgrade?.();
          }}
        >
          {content}
        </button>
      ) : (
        <a
          className="fayfort-ad-link"
          href={creative.target_url}
          {...(external ? { target: "_blank", rel: "noopener sponsored" } : {})}
          onClick={() => onClick?.()}
        >
          {content}
        </a>
      )}
    </div>
  );
}
