import type { DeliveryStatus } from "@/shared/tikis-domain";

export function sanitizeReviewText(value: string) {
  return value.replace(/[<>\[\]{}]/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

export function isValidReviewText(value: string) {
  return /^[a-zA-Z0-9\s'\-.,àâçéèêëîïôùûüÿñæœÀÂÇÉÈÊËÎÏÔÙÛÜŸÑÆŒ]*$/.test(value);
}

export function canSubmitDeliveryReview(status: DeliveryStatus, alreadyReviewed: boolean, rating: number) {
  return status === "completed" && !alreadyReviewed && Number.isInteger(rating) && rating >= 1 && rating <= 5;
}
