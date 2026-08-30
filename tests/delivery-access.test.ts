import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import type { SelectableVehicleType } from "../shared/tikis-domain";

const dbMock = vi.hoisted(() => ({
  getTikisProfileByPhone: vi.fn(),
  saveTikisPlace: vi.fn(),
  createTikisDelivery: vi.fn(),
  getTikisDeliveryById: vi.fn(),
  getTikisDeliveryRecordById: vi.fn(),
  listTikisDeliveriesForProfile: vi.fn(),
  listTikisDeliveryCandidateStatesForDriver: vi.fn(),
  countTikisDeliveryCandidates: vi.fn(),
  listTikisDeliveryCandidates: vi.fn(),
  applyForTikisDelivery: vi.fn(),
  saveTikisDeliveryLiveLocation: vi.fn(),
  getTikisDeliveryLiveLocation: vi.fn(),
  withdrawTikisDeliveryCandidateWithWallet: vi.fn(),
  selectTikisDeliveryCandidateWithWallet: vi.fn(),
  confirmTikisDeliveryWithEvents: vi.fn(),
  completeTikisDeliveryWithEvents: vi.fn(),
  updateTikisDeliveryFromSender: vi.fn(),
  disableTikisDeliveryFromSender: vi.fn(),
  reactivateTikisDeliveryFromSender: vi.fn(),
  cancelTikisDeliveryFromSender: vi.fn(),
  getTikisWalletSnapshot: vi.fn(),
  listTikisWalletLedger: vi.fn(),
  getTikisCommissionRate: vi.fn(),
  requestTikisWalletOperation: vi.fn(),
  listTikisDeliveryEvents: vi.fn(),
  markTikisDeliveryEventsRead: vi.fn(),
  getTikisDeliveryReview: vi.fn(),
  saveTikisDeliveryReview: vi.fn(),
  deliveryReviewToView: vi.fn(),
  listTikisDeliveryReviewsForProfile: vi.fn(),
}));

vi.mock("../server/db", () => dbMock);

import { appRouter } from "../server/routers";

const sender = { phone: "+22670000000", fullName: "Aïcha Traoré", accountType: "sender" as const, vehicles: "[]" };
const driver = { phone: "+22676000000", fullName: "Moussa Kaboré", accountType: "driver" as const, vehicles: '["Moto"]' };
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
  return { user: null, tikisProfilePhone: phone, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as unknown as TrpcContext["res"] };
}

describe("livraisons persistées Tikis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.saveTikisPlace.mockResolvedValue(place);
    dbMock.createTikisDelivery.mockResolvedValue({ id: deliveryId });
    dbMock.getTikisWalletSnapshot.mockResolvedValue({ total: 12_000, blocked: 500 });
    dbMock.listTikisWalletLedger.mockResolvedValue([]);
    dbMock.getTikisCommissionRate.mockResolvedValue(0.1);
    dbMock.listTikisDeliveryEvents.mockResolvedValue([]);
  });

  it("refuse la création sans session Tikis", async () => {
    const caller = appRouter.createCaller(contextFor(null));
    await expect(caller.deliveries.create(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("enregistre une livraison au nom de l’expéditeur de la session", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(sender);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    const created = await caller.deliveries.create(input);
    expect(created).toEqual({ id: deliveryId });
    expect(dbMock.createTikisDelivery).toHaveBeenCalledWith(expect.objectContaining({ senderPhone: sender.phone, pickupPlaceId: place.id, dropoffPlaceId: place.id, status: "open", vehicleTypes: '["Moto"]' }));
  });

  it("interdit à un livreur de publier une livraison", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.create(input)).rejects.toThrow("Seul un expéditeur");
  });

  it("empêche un livreur de se proposer à sa propre livraison", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    dbMock.applyForTikisDelivery.mockRejectedValue(new Error("Vous ne pouvez pas candidater à votre propre livraison."));
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.submitApplication({ deliveryId, confirmedCommission: 250 })).rejects.toThrow("propre livraison");
    expect(dbMock.applyForTikisDelivery).toHaveBeenCalledWith(expect.objectContaining({ deliveryId, driverPhone: driver.phone, confirmedCommission: 250 }));
  });

  it("refuse une candidature sans montant de commission explicitement confirmé", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    dbMock.applyForTikisDelivery.mockClear();
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.submitApplication({ deliveryId } as never)).rejects.toThrow();
    expect(dbMock.applyForTikisDelivery).not.toHaveBeenCalled();
  });

  it("autorise seulement le livreur assigné à publier une position GPS pour une course active", async () => {
    const position = { latitude: 12.3714, longitude: -1.5197, heading: 48, recordedAt: "2026-08-30T16:40:00.000Z" };
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    dbMock.saveTikisDeliveryLiveLocation.mockResolvedValue(position);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.updateLivePosition({ deliveryId, latitude: position.latitude, longitude: position.longitude, heading: position.heading })).resolves.toEqual(position);
    expect(dbMock.saveTikisDeliveryLiveLocation).toHaveBeenCalledWith(expect.objectContaining({ deliveryId, driverPhone: driver.phone, latitude: position.latitude, longitude: position.longitude }));
  });

  it("retourne la dernière position uniquement à l’expéditeur ou au livreur d’une course active", async () => {
    const position = { latitude: 12.3714, longitude: -1.5197, heading: 48, recordedAt: "2026-08-30T16:40:00.000Z" };
    dbMock.getTikisProfileByPhone.mockResolvedValue(sender);
    dbMock.getTikisDeliveryRecordById.mockResolvedValue({ id: deliveryId, status: "active", senderPhone: sender.phone, driverPhone: driver.phone });
    dbMock.getTikisDeliveryLiveLocation.mockResolvedValue(position);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    await expect(caller.deliveries.livePosition({ deliveryId })).resolves.toEqual(position);
    expect(dbMock.getTikisDeliveryLiveLocation).toHaveBeenCalledWith(deliveryId);
  });

  it("retourne le Wallet crédité lorsque le livreur clôture une course active", async () => {
    const completed = { id: deliveryId, status: "completed" };
    const wallet = { total: 14_500, blocked: 0 };
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    dbMock.completeTikisDeliveryWithEvents.mockResolvedValue({ delivery: completed, wallet });
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.complete({ deliveryId })).resolves.toEqual({ delivery: completed, wallet });
    expect(dbMock.completeTikisDeliveryWithEvents).toHaveBeenCalledWith(deliveryId, driver.phone);
  });

  it("refuse la lecture d’une position live à un autre livreur", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue({ ...driver, phone: "+22677000000" });
    dbMock.getTikisDeliveryRecordById.mockResolvedValue({ id: deliveryId, status: "active", senderPhone: sender.phone, driverPhone: driver.phone });
    const caller = appRouter.createCaller(contextFor("+22677000000"));
    await expect(caller.deliveries.livePosition({ deliveryId })).rejects.toThrow("n’est pas accessible");
  });

  it("sélectionne un livreur sans consulter le Wallet de l’expéditeur", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(sender);
    dbMock.selectTikisDeliveryCandidateWithWallet.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    await expect(caller.deliveries.selectCandidate({ deliveryId, candidateId: "3d487499-19e9-4f5e-a9c8-8777af588997" })).resolves.toBeUndefined();
    expect(dbMock.selectTikisDeliveryCandidateWithWallet).toHaveBeenCalledWith(deliveryId, "3d487499-19e9-4f5e-a9c8-8777af588997", sender.phone);
    expect(dbMock.getTikisWalletSnapshot).not.toHaveBeenCalled();
  });

  it("réserve la modification d’une livraison à son expéditeur connecté", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(sender);
    dbMock.updateTikisDeliveryFromSender.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    await expect(caller.deliveries.update({ ...input, deliveryId })).resolves.toBeUndefined();
    expect(dbMock.updateTikisDeliveryFromSender).toHaveBeenCalledWith(expect.objectContaining({ deliveryId, senderPhone: sender.phone, title: input.title }));
  });

  it("interdit au livreur de modifier, désactiver, activer ou annuler une livraison", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.update({ ...input, deliveryId })).rejects.toThrow("Seul l’expéditeur");
    await expect(caller.deliveries.disable({ deliveryId })).rejects.toThrow("Seul l’expéditeur");
    await expect(caller.deliveries.reactivate({ deliveryId })).rejects.toThrow("Seul l’expéditeur");
    await expect(caller.deliveries.cancel({ deliveryId })).rejects.toThrow("Seul l’expéditeur");
  });

  it("transmet toujours l’identité de l’expéditeur aux transitions de statut", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(sender);
    dbMock.disableTikisDeliveryFromSender.mockResolvedValue(undefined);
    dbMock.reactivateTikisDeliveryFromSender.mockResolvedValue(undefined);
    dbMock.cancelTikisDeliveryFromSender.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(contextFor(sender.phone));
    await caller.deliveries.disable({ deliveryId });
    await caller.deliveries.reactivate({ deliveryId });
    await caller.deliveries.cancel({ deliveryId });
    expect(dbMock.disableTikisDeliveryFromSender).toHaveBeenCalledWith(deliveryId, sender.phone);
    expect(dbMock.reactivateTikisDeliveryFromSender).toHaveBeenCalledWith(deliveryId, sender.phone);
    expect(dbMock.cancelTikisDeliveryFromSender).toHaveBeenCalledWith(deliveryId, sender.phone);
  });

  it("retourne uniquement le Wallet et le journal du profil connecté", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.wallet.snapshot()).resolves.toMatchObject({ wallet: { total: 12_000, blocked: 500 }, commissionRate: 0.1 });
    expect(dbMock.getTikisWalletSnapshot).toHaveBeenCalledWith(driver.phone);
    expect(dbMock.listTikisWalletLedger).toHaveBeenCalledWith(driver.phone);
  });

  it("enregistre une demande Wallet pour le profil connecté uniquement", async () => {
    dbMock.getTikisProfileByPhone.mockResolvedValue(driver);
    dbMock.requestTikisWalletOperation.mockResolvedValue({ success: true });
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.wallet.requestOperation({ type: "withdrawal", amount: 1_500 })).resolves.toEqual({ success: true });
    expect(dbMock.requestTikisWalletOperation).toHaveBeenCalledWith(driver.phone, "withdrawal", 1_500);
  });
});
