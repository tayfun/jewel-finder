import { BOOK_FORMAT_LABELS, RARITY_LABELS, type BookDetails } from "@jf/shared";

const yesNo = (v: boolean | null) => (v == null ? "" : v ? "Yes" : "No");

/** Display order and formatting for book details, shared by the item page, form and AI review. */
export const BOOK_FIELDS: { key: keyof BookDetails; label: string; show(book: BookDetails): string }[] = [
  { key: "author", label: "Author", show: (b) => b.author },
  { key: "isbn", label: "ISBN", show: (b) => b.isbn },
  { key: "publisher", label: "Publisher", show: (b) => b.publisher },
  { key: "yearPublished", label: "Year published", show: (b) => (b.yearPublished ? String(b.yearPublished) : "") },
  { key: "edition", label: "Edition", show: (b) => b.edition },
  { key: "printing", label: "Printing", show: (b) => b.printing },
  { key: "format", label: "Format", show: (b) => (b.format ? BOOK_FORMAT_LABELS[b.format] : "") },
  { key: "language", label: "Language", show: (b) => b.language },
  { key: "signed", label: "Signed", show: (b) => (b.signed ? "Yes" : "") },
  { key: "dustJacket", label: "Dust jacket", show: (b) => yesNo(b.dustJacket) },
  { key: "rarity", label: "Rarity", show: (b) => (b.rarity ? RARITY_LABELS[b.rarity] : "") },
  { key: "rarityNotes", label: "Rarity notes", show: (b) => b.rarityNotes },
];

export const EMPTY_BOOK: BookDetails = {
  author: "",
  isbn: "",
  publisher: "",
  yearPublished: null,
  edition: "",
  printing: "",
  format: null,
  language: "",
  signed: false,
  dustJacket: null,
  rarity: null,
  rarityNotes: "",
};

/** null when nothing is filled in, so non-book items don't carry an empty book record. */
export function bookOrNull(book: BookDetails): BookDetails | null {
  return BOOK_FIELDS.some((f) => f.show(book)) ? book : null;
}
