import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignGallery } from "./gallery";

export const metadata: Metadata = { title: "Design system" };

// Living documentation for the M3 Expressive components. Development only.
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DesignGallery />;
}
