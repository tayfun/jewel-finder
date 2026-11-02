import { MARKETPLACE_LABELS, type ItemStatus, type Listing } from "@jf/shared";

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
  const shown = listings.filter((l) => l.status === "listed" || l.status === "pending" || l.status === "sold");
  if (!shown.length) return null;
  return (
    <span className="listing-badges">
      {shown.map((l) => (
        <span key={l.marketplace} className={`badge mk-${l.marketplace} ls-${l.status}`} title={l.status}>
          {MARKETPLACE_LABELS[l.marketplace]}
          {l.status === "pending" ? " · pending" : l.status === "sold" ? " · sold" : ""}
        </span>
      ))}
    </span>
  );
}

export { STATUS_LABELS };
