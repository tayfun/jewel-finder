// Plain constants, kept apart from the zod schemas so bundles that only need
// these (content scripts, side panel) don't pull in zod.

export const MARKETPLACES = ["vinted", "ebay"] as const;

/** Vinted's condition scale; mapped to eBay's at fill time. */
export const CONDITIONS = ["new_with_tags", "new_without_tags", "very_good", "good", "satisfactory"] as const;

export const ITEM_STATUSES = ["draft", "in_stock", "sold", "archived"] as const;

/** `ending`: the item sold elsewhere but this listing is still live and needs ending (cross-delisting). */
export const LISTING_STATUSES = ["pending", "listed", "ending", "sold", "ended", "failed"] as const;

export const BOOK_FORMATS = ["hardback", "paperback", "mass_market_paperback", "leather", "spiral", "other"] as const;

/** How hard a book is to find, as estimated by the AI or the seller. */
export const RARITIES = ["common", "uncommon", "scarce", "rare", "very_rare"] as const;

/** Postage size of the packed item. Mapped to each marketplace's own bands (with the weight) at fill time. */
export const PACKAGE_SIZES = ["large_letter", "small", "medium", "large"] as const;

/** What kind of thing an item is, as the AI auto-fill reports it. Only "book" changes the form (book fields). */
export const ITEM_TYPES = ["book", "clothing", "shoes", "accessories", "electronics", "media", "toys_games", "home", "other"] as const;
export const ITEM_TYPE_LABELS: Record<(typeof ITEM_TYPES)[number], string> = {
  book: "Book",
  clothing: "Clothing",
  shoes: "Shoes",
  accessories: "Bags & accessories",
  electronics: "Electronics",
  media: "Music, films & games",
  toys_games: "Toys",
  home: "Home & garden",
  other: "Something else",
};
