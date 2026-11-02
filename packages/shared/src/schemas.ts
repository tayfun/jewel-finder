import { z } from "zod";
import { CONDITIONS, ITEM_STATUSES, LISTING_STATUSES, MARKETPLACES } from "./constants";

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
}

export interface ApiError {
  error: string;
  issues?: { path: string; message: string }[];
}
