import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";

const dbMock = vi.hoisted(() => ({
  getTikisProfileByPhone: vi.fn(),
  getLatestKycSubmission: vi.fn(),
  applyForTikisDelivery: vi.fn(),
}));

vi.mock("../server/db", () => dbMock);
vi.mock("../server/supabase-realtime", () => ({ publishDeliveryStatusBroadcast: vi.fn() }));

import { appRouter } from "../server/routers";

const driver = { phone: "+22676000000", fullName: "Moussa Kaboré", accountType: "driver" as const, vehicles: '["Moto"]', photoKey: "driver-photo-key" };
const deliveryId = "2d487499-19e9-4f5e-a9c8-8777af588997";

function contextFor(phone: string): TrpcContext {
  return { user: null, tikisProfilePhone: phone, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as unknown as TrpcContext["res"] };
}

async function apply() {
  const caller = appRouter.createCaller(contextFor(driver.phone));
  return caller.deliveries.submitApplication({ deliveryId, confirmedCommission: 250 });
}

describe("candidater exige un KYC réellement approuvé, pas seulement une photo de profil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    dbMock.applyForTikisDelivery.mockResolvedValue({ success: true, wallet: {} });
  });

  it("refuse sans photo de profil, avant même de regarder le KYC", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue({ ...driver, photoKey: null });
    await expect(apply()).rejects.toThrow("photo");
    expect(dbMock.getLatestKycSubmission).not.toHaveBeenCalled();
    expect(dbMock.applyForTikisDelivery).not.toHaveBeenCalled();
  });

  it("refuse quand aucun dossier KYC n'a jamais été soumis", async () => {
    dbMock.getLatestKycSubmission.mockResolvedValue(undefined);
    await expect(apply()).rejects.toThrow("identité doit être vérifiée");
    expect(dbMock.applyForTikisDelivery).not.toHaveBeenCalled();
  });

  it("refuse un dossier encore en attente d'examen", async () => {
    // C'était exactement le trou : une photo de profil suffisait, alors même que personne
    // n'avait jamais regardé les documents d'identité soumis à `kyc.submit`.
    dbMock.getLatestKycSubmission.mockResolvedValue({ status: "submitted" });
    await expect(apply()).rejects.toThrow("identité doit être vérifiée");
    expect(dbMock.applyForTikisDelivery).not.toHaveBeenCalled();
  });

  it("refuse un dossier rejeté", async () => {
    dbMock.getLatestKycSubmission.mockResolvedValue({ status: "rejected" });
    await expect(apply()).rejects.toThrow("identité doit être vérifiée");
    expect(dbMock.applyForTikisDelivery).not.toHaveBeenCalled();
  });

  it("autorise une fois le dossier approuvé", async () => {
    dbMock.getLatestKycSubmission.mockResolvedValue({ status: "approved" });
    await expect(apply()).resolves.toEqual({ success: true, wallet: {} });
    expect(dbMock.applyForTikisDelivery).toHaveBeenCalledWith(expect.objectContaining({ driverPhone: driver.phone }));
  });
});
