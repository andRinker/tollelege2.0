// Allowed values for text columns that behave like enums. Each is enforced by a
// CHECK constraint in the table definition and by Zod at the action boundary.

export const readingLevelSystems = [
  "none",
  "lexile",
  "guided_reading",
  "atos",
  "grade_level",
  "other",
] as const;
export type ReadingLevelSystem = (typeof readingLevelSystems)[number];

export const themeModes = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof themeModes)[number];

export const themeContrasts = ["standard", "medium", "high"] as const;
export type ThemeContrast = (typeof themeContrasts)[number];

export const metadataSources = ["openlibrary", "google_books", "manual"] as const;
export type MetadataSource = (typeof metadataSources)[number];

export const copyStatuses = ["in_circulation", "lent_out", "lost", "damaged", "withdrawn"] as const;
export type CopyStatus = (typeof copyStatuses)[number];

/** The statuses a teacher sets by hand. `lent_out` is owned by the lending library. */
export const manualCopyStatuses = ["in_circulation", "lost", "damaged", "withdrawn"] as const;
export type ManualCopyStatus = (typeof manualCopyStatuses)[number];

export const connectionStatuses = ["pending", "accepted"] as const;
export type ConnectionStatus = (typeof connectionStatuses)[number];

export const shelfLoanStatuses = ["requested", "declined", "cancelled", "active", "returned"] as const;
export type ShelfLoanStatus = (typeof shelfLoanStatuses)[number];

export const handoverStatuses = ["pending", "accepted", "declined", "withdrawn"] as const;
export type HandoverStatus = (typeof handoverStatuses)[number];

/** What a paired phone sent back for the signed-in browser to pick up. */
export const scanEventKinds = ["book_added", "lookup_failed", "shelf_proposed"] as const;
export type ScanEventKind = (typeof scanEventKinds)[number];

export const closeReasons = ["returned", "lost"] as const;
export type CloseReason = (typeof closeReasons)[number];

/** Renders `('a','b')` for use inside CHECK constraints. */
export function sqlList(values: readonly string[]): string {
  return `(${values.map((value) => `'${value}'`).join(",")})`;
}

/** What an admin did to or with a teacher's account. Recorded in `admin_audit`. */
export const adminActions = ["created_account", "viewed_account", "started_acting", "stopped_acting", "signed_out", "deleted_account"] as const;
export type AdminAction = (typeof adminActions)[number];
