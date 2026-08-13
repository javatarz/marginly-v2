"use client";

import { formatUploadDate } from "@/lib/dashboard/upload-date";

/**
 * The one piece of the dashboard row that needs a client component: which calendar day
 * an Upload's instant reads as depends on the reader's own zone, and only the browser
 * knows that zone.
 */
export function UploadDate({ value }: { value: string }) {
  return <>{formatUploadDate(value)}</>;
}
