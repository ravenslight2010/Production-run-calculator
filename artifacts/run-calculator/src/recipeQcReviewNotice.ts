export type RecipeQcReviewAcknowledgement = {
  status: "applied-awaiting-review";
  changedCount: number;
};

export const RECIPE_QC_REVIEW_NOTICE_EVENT = "run-calculator:recipe-qc-review-acknowledged";

export function publishRecipeQcReviewAcknowledgement(value: unknown): void {
  if (typeof window === "undefined" || !value || typeof value !== "object") return;
  const acknowledgement = value as Record<string, unknown>;
  if (
    acknowledgement.status !== "applied-awaiting-review" ||
    typeof acknowledgement.changedCount !== "number" ||
    !Number.isInteger(acknowledgement.changedCount) ||
    acknowledgement.changedCount < 1 ||
    acknowledgement.changedCount > 500
  ) return;
  window.dispatchEvent(new CustomEvent<RecipeQcReviewAcknowledgement>(
    RECIPE_QC_REVIEW_NOTICE_EVENT,
    { detail: { status: "applied-awaiting-review", changedCount: acknowledgement.changedCount } },
  ));
}
