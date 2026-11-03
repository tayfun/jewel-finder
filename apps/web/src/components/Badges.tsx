import {
  LISTING_STATUS_LABELS,
  MARKETPLACE_LABELS,
  isStale,
  listingAgeDays,
  type ItemStatus,
  type Listing,
  type Settings,
} from "@jf/shared";

const STATUS_LABELS: Record<ItemStatus, string> = {
  draft: "Draft",
  in_stock: "In stock",
  sold: "Sold",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

/** Live/pending/sold listings. Given the item's status and settings, stale ones show their age. */
export function ListingBadges({ listings, itemStatus, settings }: { listings: Listing[]; itemStatus?: ItemStatus; settings?: Settings }) {
  const shown = listings.filter((l) => ["listed", "pending", "ending", "sold"].includes(l.status));
  if (!shown.length) return null;
  return (
    <span className="listing-badges">
      {shown.map((l) => {
        const stale = itemStatus && settings ? isStale({ status: itemStatus }, l, settings) : false;
        return (
          <span
            key={l.marketplace}
            className={`badge mk-${l.marketplace} ls-${l.status}${stale ? " stale" : ""}`}
            title={stale ? `Up for ${listingAgeDays(l)} days: relist to bump it to the top` : LISTING_STATUS_LABELS[l.status]}
          >
            {MARKETPLACE_LABELS[l.marketplace]}
            {l.status === "listed" ? (stale ? ` · ${listingAgeDays(l)}d` : "") : ` · ${LISTING_STATUS_LABELS[l.status].toLowerCase()}`}
          </span>
        );
      })}
    </span>
  );
}

export { STATUS_LABELS };
