import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";

const dbMock = vi.hoisted(() => ({
  getTikisProfileByPhone: vi.fn(),
  getTikisDeliveryRecordById: vi.fn(),
  getTikisDeliveryById: vi.fn(),
  listTikisDeliveryCandidates: vi.fn(),
}));

vi.mock("../server/db", () => dbMock);

import { appRouter } from "../server/routers";

const sender = { phone: "+22670000000", fullName: "Aïcha Traoré", accountType: "sender" as const, vehicles: "[]" };
const deliveryId = "2d487499-19e9-4f5e-a9c8-8777af588997";

function candidate(overrides: Partial<{ id: string; driverId: string; status: "applied" | "selected" | "confirmed" | "withdrawn" | "replaced" }>) {
  return {
    id: "candidate-1", deliveryId, driverId: "+22676000000", name: "Moussa Kaboré", initials: "MK",
    rating: 4.8, completedDeliveries: 12, vehicles: ["Moto"] as const, status: "applied" as const,
    commissionBlocked: 300, isVerified: true, isCertified: false, distanceFromPickupKm: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function contextFor(phone: string): TrpcContext {
  return { user: null, tikisProfilePhone: phone, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: { clearCookie: () => undefined } as unknown as TrpcContext["res"] };
}

async function fetchAsSender() {
  const caller = appRouter.createCaller(contextFor(sender.phone));
  return caller.deliveries.candidates({ deliveryId });
}

describe("le numéro d'un candidat n'est révélé à l'expéditeur qu'une fois attribué", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.getTikisProfileByPhone.mockResolvedValue(sender);
    dbMock.getTikisDeliveryRecordById.mockResolvedValue({ senderPhone: sender.phone });
    dbMock.getTikisDeliveryById.mockResolvedValue({ id: deliveryId });
  });

  it("masque le numéro d'un candidat encore en lice", async () => {
    dbMock.listTikisDeliveryCandidates.mockResolvedValue([candidate({ status: "applied" })]);
    const [result] = await fetchAsSender();
    expect(result.driverId).not.toBe("+22676000000");
    // L'écran de choix travaille sur `candidate.id`, jamais sur le numéro : la valeur masquée
    // reste un identifiant stable et distinct pour ne rien casser côté client.
    expect(result.driverId).toBe(result.id);
  });

  it("masque aussi un candidat retiré ou remplacé : il n'a jamais été attribué", async () => {
    dbMock.listTikisDeliveryCandidates.mockResolvedValue([candidate({ status: "withdrawn" }), candidate({ id: "candidate-2", status: "replaced" })]);
    const results = await fetchAsSender();
    for (const result of results) expect(result.driverId).toBe(result.id);
  });

  it("révèle le numéro du candidat sélectionné", async () => {
    dbMock.listTikisDeliveryCandidates.mockResolvedValue([candidate({ status: "selected" })]);
    const [result] = await fetchAsSender();
    expect(result.driverId).toBe("+22676000000");
  });

  it("révèle le numéro du candidat confirmé", async () => {
    dbMock.listTikisDeliveryCandidates.mockResolvedValue([candidate({ status: "confirmed" })]);
    const [result] = await fetchAsSender();
    expect(result.driverId).toBe("+22676000000");
  });

  it("un candidat non attribué reste masqué même si un autre a été sélectionné", async () => {
    dbMock.listTikisDeliveryCandidates.mockResolvedValue([
      candidate({ id: "candidate-1", status: "selected" }),
      candidate({ id: "candidate-2", status: "applied" }),
    ]);
    const [selected, stillApplying] = await fetchAsSender();
    expect(selected.driverId).toBe("+22676000000");
    expect(stillApplying.driverId).toBe(stillApplying.id);
  });

  it("ne change rien d'autre sur la ligne du candidat", async () => {
    dbMock.listTikisDeliveryCandidates.mockResolvedValue([candidate({ status: "applied" })]);
    const [result] = await fetchAsSender();
    expect(result.name).toBe("Moussa Kaboré");
    expect(result.rating).toBe(4.8);
    expect(result.commissionBlocked).toBe(300);
  });
});
