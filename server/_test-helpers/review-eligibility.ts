type DeliveryLike = {
  status: string;
  senderPhone: string;
  driverPhone: string | null;
};

type Role = "sender" | "driver";

/** Éligibilité à noter une livraison :
 *  - livraison completed
 *  - viewer = sender (pas driver)
 *  - driverPhone non null
 *  - pas déjà noté
 */
export function canReviewDelivery(delivery: DeliveryLike, viewerPhone: string, viewerRole: Role, hasNoExistingReview: boolean): boolean {
  if (delivery.status !== "completed") return false;
  if (viewerRole !== "sender") return false;
  if (delivery.senderPhone !== viewerPhone) return false;
  if (!delivery.driverPhone) return false;
  if (!hasNoExistingReview) return false;
  return true;
}
