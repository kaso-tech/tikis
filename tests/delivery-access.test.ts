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
  getTikisDeliveryCandidateForDriver: vi.fn(),
  listTikisDeliveryCandidates: vi.fn(),
  createOrUpdateCandidate: vi.fn(),
  withdrawTikisDeliveryCandidate: vi.fn(),
  selectTikisDeliveryCandidate: vi.fn(),
  confirmTikisDelivery: vi.fn(),
  completeTikisDelivery: vi.fn(),
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
    dbMock.getTikisDeliveryRecordById.mockResolvedValue({ id: deliveryId, status: "open", senderPhone: driver.phone });
    dbMock.getTikisDeliveryById.mockResolvedValue({ id: deliveryId, status: "open", estimatedPrice: 3200 });
    const caller = appRouter.createCaller(contextFor(driver.phone));
    await expect(caller.deliveries.submitApplication({ deliveryId })).rejects.toThrow("propre livraison");
  });
});
