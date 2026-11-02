// Plain constants, kept apart from the zod schemas so bundles that only need
// these (content scripts, side panel) don't pull in zod.

export const MARKETPLACES = ["vinted", "ebay"] as const;

/** Vinted's condition scale; mapped to eBay's at fill time. */
export const CONDITIONS = ["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"] as const;

export const ITEM_STATUSES = ["draft", "in_stock", "sold", "archived"] as const;

export const LISTING_STATUSES = ["pending", "listed", "sold", "ended", "failed"] as const;
