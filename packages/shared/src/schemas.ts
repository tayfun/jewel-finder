import { z } from "zod";
import { BOOK_FORMATS, CONDITIONS, ITEM_STATUSES, LISTING_STATUSES, MARKETPLACES, PACKAGE_SIZES, RARITIES } from "./constants";

export const Marketplace = z.enum(MARKETPLACES);
export type Marketplace = z.infer<typeof Marketplace>;

export const Condition = z.enum(CONDITIONS);
export type Condition = z.infer<typeof Condition>;

export const ItemStatus = z.enum(ITEM_STATUSES);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const ListingStatus = z.enum(LISTING_STATUSES);
export type ListingStatus = z.infer<typeof ListingStatus>;

/** Money is always integer minor units (pence/cents). */
const Money = z.int().min(0).max(100_000_000);

export const PackageSize = z.enum(PACKAGE_SIZES);
export type PackageSize = z.infer<typeof PackageSize>;

export const BookFormat = z.enum(BOOK_FORMATS);
export type BookFormat = z.infer<typeof BookFormat>;
export const Rarity = z.enum(RARITIES);
export type Rarity = z.infer<typeof Rarity>;

/** Bibliographic details for book items. Empty strings / nulls mean "unknown". */
export const BookDetails = z.object({
  author: z.string().trim().max(200).default(""),
  isbn: z
    .string()
    .trim()
    .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
    .refine((s) => s === "" || /^(\d{9}[\dX]|\d{13})$/.test(s), "ISBN must be 10 or 13 digits")
    .default(""),
  publisher: z.string().trim().max(120).default(""),
  yearPublished: z.int().min(1400).max(2100).nullable().default(null),
  /** e.g. "First edition", "Second edition", "Book club edition". */
  edition: z.string().trim().max(120).default(""),
  /** e.g. "First printing", "12th impression". */
  printing: z.string().trim().max(120).default(""),
  format: BookFormat.nullable().default(null),
  language: z.string().trim().max(40).default(""),
  signed: z.boolean().default(false),
  dustJacket: z.boolean().nullable().default(null),
  rarity: Rarity.nullable().default(null),
  /** Why it's collectable: points of issue, provenance, limited run, etc. */
  rarityNotes: z.string().trim().max(1000).default(""),
});
export type BookDetails = z.output<typeof BookDetails>;

/** Item fields without defaults (used as-is, all optional, for PATCH). */
const itemFields = {
  sku: z.string().trim().max(64),
  title: z.string().trim().min(1, "Title is required").max(120),
  description: z.string().max(5000),
  brand: z.string().trim().max(80),
  category: z.string().trim().max(120),
  size: z.string().trim().max(40),
  colour: z.string().trim().max(40),
  condition: Condition.nullable(),
  price: Money.nullable(),
  cost: Money.nullable(),
  quantity: z.int().min(0).max(10_000),
  status: ItemStatus,
  images: z.array(z.string().max(200)).max(20),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  notes: z.string().max(2000),
  book: BookDetails.nullable(),
  packageSize: PackageSize.nullable(),
  /** Packed weight in grams, including packaging. */
  weightGrams: z.int().min(1).max(100_000).nullable(),
};

export const ItemInput = z.object({
  ...itemFields,
  sku: itemFields.sku.default(""),
  description: itemFields.description.default(""),
  brand: itemFields.brand.default(""),
  category: itemFields.category.default(""),
  size: itemFields.size.default(""),
  colour: itemFields.colour.default(""),
  condition: itemFields.condition.default(null),
  price: itemFields.price.default(null),
  cost: itemFields.cost.default(null),
  quantity: itemFields.quantity.default(1),
  status: itemFields.status.default("in_stock"),
  images: itemFields.images.default([]),
  tags: itemFields.tags.default([]),
  notes: itemFields.notes.default(""),
  book: itemFields.book.default(null),
  packageSize: itemFields.packageSize.default(null),
  weightGrams: itemFields.weightGrams.default(null),
});
export type ItemInput = z.input<typeof ItemInput>;
/** ItemInput after parsing (defaults applied). */
export type ItemData = z.output<typeof ItemInput>;

export const ItemPatch = z.object(itemFields).partial();
export type ItemPatch = z.infer<typeof ItemPatch>;

export interface Item {
  id: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  size: string;
  colour: string;
  condition: Condition | null;
  price: number | null;
  cost: number | null;
  quantity: number;
  status: ItemStatus;
  images: string[];
  tags: string[];
  notes: string;
  book: BookDetails | null;
  packageSize: PackageSize | null;
  weightGrams: number | null;
  createdAt: number;
  updatedAt: number;
}

export const ListingInput = z.object({
  status: ListingStatus,
  externalId: z.string().max(100).nullable().optional(),
  url: z.url().max(500).nullable().optional(),
  price: Money.nullable().optional(),
  error: z.string().max(500).nullable().optional(),
});
export type ListingInput = z.input<typeof ListingInput>;

export interface Listing {
  id: string;
  itemId: string;
  marketplace: Marketplace;
  status: ListingStatus;
  externalId: string | null;
  url: string | null;
  price: number | null;
  error: string | null;
  /** When it last went live (published, imported, or relisted). */
  listedAt: number | null;
  /** Times it was taken down and put up again as a new listing. */
  relistedCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ItemWithListings extends Item {
  listings: Listing[];
}

export const Settings = z.object({
  currency: z.enum(["GBP", "EUR", "USD"]).default("GBP"),
  vintedDomain: z
    .string()
    .regex(/^www\.vinted\.[a-z.]+$/, "Must look like www.vinted.co.uk")
    .default("www.vinted.co.uk"),
  ebayDomain: z
    .string()
    .regex(/^www\.ebay\.[a-z.]+$/, "Must look like www.ebay.co.uk")
    .default("www.ebay.co.uk"),
  /** A live listing older than this many days is stale: relisting bumps it back to the top. */
  vintedRelistDays: z.int("Enter a whole number of days").min(1).max(365).default(21),
  ebayRelistDays: z.int("Enter a whole number of days").min(1).max(365).default(60),
});
export type Settings = z.infer<typeof Settings>;
export const SettingsPatch = z.object(Settings.shape).partial();

export interface Account {
  id: string;
  email: string;
  settings: Settings;
  createdAt: number;
}

export const Credentials = z.object({
  email: z.email().max(200).transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});
export type Credentials = z.input<typeof Credentials>;

export interface AuthResponse {
  token: string;
  account: Account;
}

export interface Stats {
  byStatus: Record<ItemStatus, number>;
  listed: Record<Marketplace, number>;
  /** Sum of price × quantity for in-stock items. */
  stockValue: number;
  /** Sum of cost × quantity for in-stock items. */
  stockCost: number;
  /** Listings still live for items that sold elsewhere. */
  toEnd: number;
  /** Pairs of items that look like the same thing entered twice (see /api/duplicates). */
  duplicates: number;
  /** Live listings older than the seller's relist interval. */
  stale: number;
}

export interface ApiError {
  error: string;
  issues?: { path: string; message: string }[];
}

/** What the AI suggests for an item, from its photos. Nothing is saved until the user applies it. */
export interface AutofillSuggestion {
  /** Marketplace-ready listing title (≤ 80 chars, fits eBay). */
  title: string;
  description: string;
  condition: Condition | null;
  category: string;
  tags: string[];
  book: BookDetails;
  packageSize: PackageSize | null;
  /** Estimated packed weight in grams. */
  weightGrams: number | null;
  /** 0–1: how sure the model is that it identified the right book/edition. */
  confidence: number;
  /** Caveats from the model, e.g. "copyright page not shown; edition unverified". */
  notes: string;
}

/** Where an imported listing stands on its marketplace. */
export const ImportState = z.enum(["listed", "sold", "ended"]);
export type ImportState = z.infer<typeof ImportState>;

/** One existing marketplace listing to bring into the inventory (photos already uploaded). */
export const ImportListing = z.object({
  externalId: z.string().trim().min(1).max(100),
  url: z.url().max(500),
  state: ImportState.default("listed"),
  item: ItemInput,
});
export type ImportListing = z.input<typeof ImportListing>;

export const ImportRequest = z.object({
  marketplace: Marketplace,
  listings: z.array(ImportListing).min(1).max(50),
});
export type ImportRequest = z.input<typeof ImportRequest>;

export interface ImportResult {
  results: {
    externalId: string;
    itemId: string;
    /** false: that listing was already in the inventory, so nothing was added. */
    created: boolean;
  }[];
  /** Newly created items that look like one already in the inventory. */
  possibleDuplicates: string[];
}

/** Merge `otherId` into the item in the URL; the other item is deleted. */
export const MergeRequest = z.object({ otherId: z.string().min(1).max(100) });

/** The seller says these two aren't the same item; stop suggesting them. */
export const DismissDuplicateRequest = z.object({ a: z.string().min(1).max(100), b: z.string().min(1).max(100) });
