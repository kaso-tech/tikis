import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_VERIFICATION_NOTIFICATION } from "../shared/tikisse-domain";

const adminDb = readFileSync(join(process.cwd(), "server/admin-db.ts"), "utf8");
const notificationsScreen = readFileSync(join(process.cwd(), "app/notifications.tsx"), "utf8");

describe("décision sur l'identité d'un livreur", () => {
  const review = adminDb.slice(adminDb.indexOf("export async function adminReviewKyc"), adminDb.indexOf("// Programme de fidélité"));

  it("est notifiée dans l'application, dans la même transaction que la décision, une seule fois", () => {
    const transaction = review.slice(review.indexOf("dbc.transaction"), review.indexOf("return submission.driverPhone"));
    expect(transaction).toContain("tx.insert(tikisseDeliveryEvents)");
    expect(transaction).toContain('eventType: "kyc_decision"');
    expect(transaction).toContain("deliveryId: db.ACCOUNT_VERIFICATION_NOTIFICATION");
    expect(transaction).toContain("idempotencyKey: `kyc:${input.submissionId}:${input.decision}`");
  });

  it("garde aussi le push, et l'application ouvre l'écran « Vérification »", () => {
    expect(review).toContain("db.enqueuePushToPhone");
    expect(ACCOUNT_VERIFICATION_NOTIFICATION).toBe("account:verification");
    expect(notificationsScreen).toContain('notif.deliveryId === ACCOUNT_VERIFICATION_NOTIFICATION');
    expect(notificationsScreen).toContain('router.push("/verification"');
  });
});
