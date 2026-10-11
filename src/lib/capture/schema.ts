import { z } from "zod";

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_ITEMS = 80;

export const CaptureItem = z.object({
  name: z.string().trim().min(1, "Item name is required").max(80),
  size: z.string().trim().max(40).default(""),
  volume: z.string().trim().max(20).default(""),
  price: z.string().trim().min(1, "Price is required").max(20),
  temperature: z.enum(["hot", "iced", ""]).default(""),
});
export type CaptureItem = z.infer<typeof CaptureItem>;

/** What the phone sends (as the "capture" JSON field of a multipart form, photos alongside). */
export const CaptureSubmission = z.object({
  id: z.uuid(),
  place_id: z.uuid(),
  captured_at: z.iso.datetime({ offset: true }),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      accuracy_m: z.number().min(0).max(100_000),
    })
    .nullable(),
  items: z.array(CaptureItem).min(1, "Add at least one price").max(MAX_ITEMS),
  tax_inclusive: z.enum(["yes", "no", ""]).default(""),
  full_menu: z.boolean().default(false),
  notes: z.string().trim().max(500).default(""),
});
export type CaptureSubmission = z.infer<typeof CaptureSubmission>;
