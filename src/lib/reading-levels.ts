import type { ReadingLevelSystem } from "@/db/schema/enums";

/** Names for the reading level systems, as shown in Settings. */
export const READING_LEVEL_SYSTEM_LABELS: Record<ReadingLevelSystem, string> = {
  none: "Don't track reading levels",
  lexile: "Lexile",
  guided_reading: "Guided Reading (Fountas & Pinnell)",
  atos: "ATOS / Accelerated Reader",
  grade_level: "Grade level",
  other: "Other",
};

/** Field labels for a book's reading level under each system. */
export const READING_LEVEL_FIELD_LABELS: Record<ReadingLevelSystem, string> = {
  none: "Reading level",
  lexile: "Lexile level",
  guided_reading: "Guided Reading level",
  atos: "ATOS book level",
  grade_level: "Grade level",
  other: "Reading level",
};
