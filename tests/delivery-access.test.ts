import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import type { SelectableVehicleType } from "../shared/tikisse-domain";

const dbMock = vi.hoisted(() => ({
  getTikisseProfileByPhone: vi.fn(),
  saveTikissePlace: vi.fn(),
  createTikisseDelivery: vi.fn(),
  getTikisseDeliveryById: vi.fn(),
  getTikisseDeliveryRecordById: vi.fn(),
  listTikisseDeliveriesForProfile: vi.fn(),
  listTikisseDeliveryCandidateStatesForDriver: vi.fn(),
  countTikisseDeliveryCandidates: vi.fn(),
  listTikisseDeliveryCandidates: vi.fn(),
  getLatestKycSubmission: vi.fn(),
  applyForTikisseDelivery: vi.fn(),
  saveTikisseDeliveryLiveLocation: vi.fn(),
  getTikisseDeliveryLiveLocation: vi.fn(),
  withdrawTikisseDeliveryCandidateWithWallet: vi.fn(),
  selectTikisseDeliveryCandidateWithWallet: vi.fn(),
  confirmTikisseDeliveryWithEvents: vi.fn(),
  completeTikisseDeliveryWithEvents: vi.fn(),
  updateTikisseDeliveryFromSender: vi.fn(),
  disableTikisseDeliveryFromSender: vi.fn(),
  reactivateTikisseDeliveryFromSender: vi.fn(),
  cancelTikisseDeliveryFromSender: vi.fn(),
  getTikisseWalletSnapshot: vi.fn(),
  listTikisseWalletLedger: vi.fn(),
  getTikisseCommissionRate: vi.fn(),
  requestTikisseWalletOperation: vi.fn(),
  listTikisseDeliveryEvents: vi.fn(),
  markTikisseDeliveryEventsRead: vi.fn(),
  getTikisseDeliveryReview: vi.fn(),
  saveTikisseDeliveryReview: vi.fn(),
  deliveryReviewToView: vi.fn(),
  listTikisseDeliveryReviewsForProfile: vi.fn(),
}));

vi.mock("../server/db", () => dbMock);

import { appRouter } from "../server/routers";

const sender = { phone: "+22670000000", fullName: "Aïcha Traoré", accountType: "sender" as const, vehicles: "[]" };
const driver = { phone: "+22676000000", fullName: "Moussa Kaboré", accountType: "driver" as const, vehicles: '["Moto"]', photoKey: "driver-photo-key" };
const deliveryId = "2d487499-19e9-4f5e-a9c8-8777af588997";
const place = { id: 4 };
const input = {
  title: "Documents de bureau",
  details: "À remettre contre signature",
  type: "Plis" as const,
  pickup: { name: "Maison du Peuple", district: "Koulouba", city: "Ouagadougou", latitude: 12.3714, longitude: -1.5197 },
  dropoff: { name: "Stade du 4 Août", district: "Ouaga 2000", city: "Ouagadougou", latitude: 12.356, longitude: -1.53 },
  distanceKm: 4.2,
  routeSource: "routes" as const,
  estimatedPrice: 3200,
  vehicleTypes: ["Moto"] as SelectableVehicleType[],
};

function contextFor(phone: string | null): TrpcContext {
  return { tikisseProfilePhone: phone, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as unknown as TrpcContext["res"] };
}

describe("livraisons persistées Tikisse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.saveTikissePlace.mockResolvedValue(place);
    dbMock.createTikisseDelivery.mockResolvedValue({ id: deliveryId });
    dbMock.getTikisseWalletSnapshot.mockResolvedValue({ total: 12_000, blocked: 500 });
    dbMock.listTikisseWalletLedger.mockResolvedValue([]);
    dbMock.getTikisseCommissionRate.mockResolvedValue(0.1);
    dbMock.listTikisseDeliveryEvents.mockResolvedValue([]);
    // Par défaut, le livreur des tests a une identité déjà vérifiée : ce fichier teste
    // l'accès aux livraisons, pas le contrôle KYC (couvert par kyc-application-gate.test.ts).
    dbMock.getLatestKycSubmission.mockResolvedValue({ status: "approved" });
  });

  it("refuse la création sans session Tikisse", async () => {
    const caller = appRouter.createCaller(contextFor(null));
    await expect(caller.deliveries.create(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("enregistre une livraison au nom de l’expéditeur de la session", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(sender);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    const created = await caller.deliveries.create(input);
    expect(created).toEqual({ id: deliveryId });
    expect(dbMock.createTikisseDelivery).toHaveBeenCalledWith(expect.objectContaining({ senderPhone: sender.phone, pickupPlaceId: place.id, dropoffPlaceId: place.id, status: "open", vehicleTypes: '["Moto"]' }));
  });

  it("interdit à un livreur de publier une livraison", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(driver);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.create(input)).rejects.toThrow("Seul un expéditeur");
  });

  it("empêche un livreur de se proposer à sa propre livraison", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(driver);
    dbMock.applyForTikisseDelivery.mockRejectedValue(new Error("Vous ne pouvez pas candidater à votre propre livraison."));
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.submitApplication({ deliveryId, confirmedCommission: 250 })).rejects.toThrow("propre livraison");
    expect(dbMock.applyForTikisseDelivery).toHaveBeenCalledWith(expect.objectContaining({ deliveryId, driverPhone: driver.phone, confirmedCommission: 250 }));
  });

  it("refuse une candidature sans montant de commission explicitement confirmé", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(driver);
    dbMock.applyForTikisseDelivery.mockClear();
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.submitApplication({ deliveryId } as never)).rejects.toThrow();
    expect(dbMock.applyForTikisseDelivery).not.toHaveBeenCalled();
  });

  it("autorise seulement le livreur assigné à publier une position GPS pour une course active", async () => {
    const position = { latitude: 12.3714, longitude: -1.5197, heading: 48, recordedAt: "2026-08-30T16:40:00.000Z" };
    dbMock.getTikisseProfileByPhone.mockResolvedValue(driver);
    dbMock.saveTikisseDeliveryLiveLocation.mockResolvedValue(position);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.updateLivePosition({ deliveryId, latitude: position.latitude, longitude: position.longitude, heading: position.heading })).resolves.toEqual(position);
    expect(dbMock.saveTikisseDeliveryLiveLocation).toHaveBeenCalledWith(expect.objectContaining({ deliveryId, driverPhone: driver.phone, latitude: position.latitude, longitude: position.longitude }));
  });

  it("retourne la dernière position uniquement à l’expéditeur ou au livreur d’une course active", async () => {
    const position = { latitude: 12.3714, longitude: -1.5197, heading: 48, recordedAt: "2026-08-30T16:40:00.000Z" };
    dbMock.getTikisseProfileByPhone.mockResolvedValue(sender);
    dbMock.getTikisseDeliveryRecordById.mockResolvedValue({ id: deliveryId, status: "active", senderPhone: sender.phone, driverPhone: driver.phone });
    dbMock.getTikisseDeliveryLiveLocation.mockResolvedValue(position);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    await expect(caller.deliveries.livePosition({ deliveryId })).resolves.toEqual(position);
    expect(dbMock.getTikisseDeliveryLiveLocation).toHaveBeenCalledWith(deliveryId);
  });

  it("retourne le Wallet crédité lorsque le livreur clôture une course active", async () => {
    const completed = { id: deliveryId, status: "completed" };
    const wallet = { total: 14_500, blocked: 0 };
    dbMock.getTikisseProfileByPhone.mockResolvedValue(driver);
    dbMock.completeTikisseDeliveryWithEvents.mockResolvedValue({ delivery: completed, wallet });
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.complete({ deliveryId })).resolves.toEqual({ delivery: completed, wallet });
    expect(dbMock.completeTikisseDeliveryWithEvents).toHaveBeenCalledWith(deliveryId, driver.phone);
  });

  it("refuse la lecture d’une position live à un autre livreur", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue({ ...driver, phone: "+22677000000" });
    dbMock.getTikisseDeliveryRecordById.mockResolvedValue({ id: deliveryId, status: "active", senderPhone: sender.phone, driverPhone: driver.phone });
    const caller = appRouter.createCaller(contextFor("+22677000000"));
    await expect(caller.deliveries.livePosition({ deliveryId })).rejects.toThrow("n’est pas accessible");
  });

  it("sélectionne un livreur sans consulter le Wallet de l’expéditeur", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(sender);
    dbMock.selectTikisseDeliveryCandidateWithWallet.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    await expect(caller.deliveries.selectCandidate({ deliveryId, candidateId: "3d487499-19e9-4f5e-a9c8-8777af588997" })).resolves.toBeUndefined();
    expect(dbMock.selectTikisseDeliveryCandidateWithWallet).toHaveBeenCalledWith(deliveryId, "3d487499-19e9-4f5e-a9c8-8777af588997", sender.phone);
    expect(dbMock.getTikisseWalletSnapshot).not.toHaveBeenCalled();
  });

  it("réserve la modification d’une livraison à son expéditeur connecté", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(sender);
    dbMock.updateTikisseDeliveryFromSender.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    await expect(caller.deliveries.update({ ...input, deliveryId })).resolves.toBeUndefined();
    expect(dbMock.updateTikisseDeliveryFromSender).toHaveBeenCalledWith(expect.objectContaining({ deliveryId, senderPhone: sender.phone, title: input.title }));
  });

  it("interdit au livreur de modifier, désactiver, activer ou annuler une livraison", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(driver);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.update({ ...input, deliveryId })).rejects.toThrow("Seul l’expéditeur");
    await expect(caller.deliveries.disable({ deliveryId })).rejects.toThrow("Seul l’expéditeur");
    await expect(caller.deliveries.reactivate({ deliveryId })).rejects.toThrow("Seul l’expéditeur");
    await expect(caller.deliveries.cancel({ deliveryId })).rejects.toThrow("Seul l’expéditeur");
  });

  it("transmet toujours l’identité de l’expéditeur aux transitions de statut", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(sender);
    dbMock.disableTikisseDeliveryFromSender.mockResolvedValue(undefined);
    dbMock.reactivateTikisseDeliveryFromSender.mockResolvedValue(undefined);
    dbMock.cancelTikisseDeliveryFromSender.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    await caller.deliveries.disable({ deliveryId });
    await caller.deliveries.reactivate({ deliveryId });
    await caller.deliveries.cancel({ deliveryId });
    expect(dbMock.disableTikisseDeliveryFromSender).toHaveBeenCalledWith(deliveryId, sender.phone);
    expect(dbMock.reactivateTikisseDeliveryFromSender).toHaveBeenCalledWith(deliveryId, sender.phone);
    expect(dbMock.cancelTikisseDeliveryFromSender).toHaveBeenCalledWith(deliveryId, sender.phone);
  });

  it("retourne uniquement le Wallet et le journal du profil connecté", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(driver);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.wallet.snapshot()).resolves.toMatchObject({ wallet: { total: 12_000, blocked: 500 }, commissionRate: 0.1 });
    expect(dbMock.getTikisseWalletSnapshot).toHaveBeenCalledWith(driver.phone);
    expect(dbMock.listTikisseWalletLedger).toHaveBeenCalledWith(driver.phone);
  });

  it("refuse les retraits Wallet devenus indisponibles sans créer de mouvement", async () => {
    dbMock.getTikisseProfileByPhone.mockResolvedValue(driver);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.wallet.requestOperation({ type: "withdrawal", amount: 1_500, requestId: "3d487499-19e9-4f5e-a9c8-8777af588997" })).rejects.toThrow("Les retraits ne sont plus proposés");
    expect(dbMock.requestTikisseWalletOperation).not.toHaveBeenCalled();
  });
});
