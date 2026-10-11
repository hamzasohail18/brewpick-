// Shared by the submission forms (browser) and the server. Keep this file free of database code.

export const SUBMISSION_TYPES = ["price_correction", "new_item", "new_deal", "hours_correction", "other"] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

/** These need a photo of the menu / offer / hours sign (the database enforces it for price and deal changes). */
export const PROOF_REQUIRED: Record<SubmissionType, boolean> = {
  price_correction: true,
  new_item: true,
  new_deal: true,
  hours_correction: true,
  other: false,
};

export const SUBMISSION_TYPE_LABELS: Record<SubmissionType, string> = {
  price_correction: "Price change",
  new_item: "Missing drink",
  new_deal: "New deal",
  hours_correction: "Opening hours",
  other: "Other",
};

export const REPORT_REASONS = {
  closed_permanently: "Closed permanently",
  wrong_hours: "Opening hours are wrong",
  wrong_location: "Wrong location on the map",
  wrong_price: "A price is wrong",
  deal_not_honoured: "A deal wasn't honoured",
  duplicate: "Listed twice",
  other: "Something else",
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;
