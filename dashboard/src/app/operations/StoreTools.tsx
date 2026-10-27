import { useEffect, useState } from "react";
import { apiRequest } from "../../lib/api";
import { ToolCard } from "./Desks";

/** The Store team desk's cards (docs/OPERATIONS_RESTRUCTURE_PLAN.md, R6): the next Finds drop, listings in progress
 * and what's coming up in the shop. */

type Drop = { id: string; title: string; early_at: string; release_at: string; catalog_at: string; target_count: number; count?: number; state: string };
type Entry = { id: string; type: string; title: string; at: string; status: string; detail?: string };
export type StoreOverview = {
  next_drop: Drop | null;
  finds_in_research: { scouted: number; checked: number; in_review: number };
  listings: { draft: number; in_review: number; changes_requested: number; failed: number; published_this_week: number };
  unmapped_products: number;
  coming_up: Entry[];
};

const TYPE_LABEL: Record<string, string> = { giveaway: "Giveaway", sale: "Sale", section: "Section", drop: "Finds drop", launch: "Launch" };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function useStoreOverview(token: string | null, enabled: boolean, reloadKey: unknown) {
  const [data, setData] = useState<StoreOverview | null>(null);
  useEffect(() => {
    if (!token || !enabled) return;
    let alive = true;
    apiRequest<StoreOverview>("/operations/store/overview", token)
      .then((found) => {
        if (alive && found && "listings" in found) setData(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token, enabled, reloadKey]);
  return data;
}

export function NextDropCard({ data, onOpen }: { data: StoreOverview | null; onOpen: () => void }) {
  const drop = data?.next_drop;
  const count = drop?.count ?? 0;
  const target = drop?.target_count || 10;
  const research = data?.finds_in_research;
  const short = drop ? Math.max(0, target - count) : 0;
  return (
    <ToolCard title="Next Finds drop" line={drop ? `${drop.title}: Pro sees it ${when(drop.early_at)}, Standard ${when(drop.release_at)}.` : "No drop planned yet. An administrator plans drops in Finds."} count={drop ? count : undefined} countLabel={drop ? `of ${target} finds` : undefined} onOpen={onOpen} openLabel="Open Finds">
      {drop && (
        <>
          <span className="ops-trend-bar" role="progressbar" aria-label="How full the next drop is" aria-valuemin={0} aria-valuemax={target} aria-valuenow={count}>
            <i style={{ width: `${Math.min(100, Math.round((count / target) * 100))}%` }} />
          </span>
          <p className={short ? "ops-tool-warn" : "operations-muted"}>{short ? `${short} more to fill it.` : "Full. Anything else goes to the next one."}</p>
        </>
      )}
      {research && (
        <p className="operations-muted">
          In research: {research.scouted} scouted · {research.checked} checked in China · {research.in_review} with an administrator
        </p>
      )}
    </ToolCard>
  );
}

export function ListingsCard({ data, onOpen }: { data: StoreOverview | null; onOpen: () => void }) {
  const listings = data?.listings;
  const rows: [string, number, boolean][] = listings
    ? [
        ["Changes asked for", listings.changes_requested, listings.changes_requested > 0],
        ["Didn't publish", listings.failed, listings.failed > 0],
        ["Drafts", listings.draft, false],
        ["Waiting for an administrator", listings.in_review, false],
        ["Products with no category", data?.unmapped_products || 0, (data?.unmapped_products || 0) > 0],
      ]
    : [];
  return (
    <ToolCard title="Listings" line={listings ? `Products on their way into the store. ${listings.published_this_week} went live this week.` : "Products on their way into the store."} onOpen={onOpen} openLabel="Open listings">
      {listings && (
        <dl className="ops-store-counts">
          {rows.map(([label, value, warn]) => (
            <div key={label} className={warn ? "is-warn" : undefined}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </ToolCard>
  );
}

export function ComingUpCard({ data, onOpen }: { data: StoreOverview | null; onOpen: () => void }) {
  const entries = data?.coming_up || [];
  return (
    <ToolCard title="Coming up" line="Sales, giveaways, sections and drops in the next two weeks." count={data ? entries.length : undefined} countLabel="planned" onOpen={onOpen} openLabel="Open the schedule">
      {data && entries.length === 0 && <p className="operations-muted">Nothing planned for the next two weeks.</p>}
      {entries.length > 0 && (
        <ul className="ops-tool-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.title}</strong>
                <small>
                  {TYPE_LABEL[entry.type] || entry.type} · {when(entry.at)}
                </small>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ToolCard>
  );
}
