import { LISTING_STATUS_LABELS, MARKETPLACE_LABELS, type ItemStatus, type Listing } from "@jf/shared";

const STATUS_LABELS: Record<ItemStatus, string> = {
  draft: "Draft",
  in_stock: "In stock",
  sold: "Sold",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: ItemStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function ListingBadges({ listings }: { listings: Listing[] }) {
  const shown = listings.filter((l) => ["listed", "pending", "ending", "sold"].includes(l.status));
  if (!shown.length) return null;
  return (
    <span className="listing-badges">
      {shown.map((l) => (
        <span key={l.marketplace} className={`badge mk-${l.marketplace} ls-${l.status}`} title={LISTING_STATUS_LABELS[l.status]}>
          {MARKETPLACE_LABELS[l.marketplace]}
          {l.status === "listed" ? "" : ` · ${LISTING_STATUS_LABELS[l.status].toLowerCase()}`}
        </span>
      ))}
    </span>
  );
}

export { STATUS_LABELS };
