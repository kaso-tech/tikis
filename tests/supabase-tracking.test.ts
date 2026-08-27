import { describe, expect, it } from "vitest";
import { deliveryChannelName, normalizeDeliveryPosition, normalizeDeliveryStatusEvent } from "../lib/supabase-tracking";

describe("suivi Supabase Realtime", () => {
  it("normalise exclusivement des positions GPS exploitables", () => {
    expect(normalizeDeliveryPosition({ latitude: 12.37, longitude: -1.52, heading: 400, recordedAt: "2026-08-26T20:00:00.000Z" })).toEqual({ latitude: 12.37, longitude: -1.52, heading: 360, recordedAt: "2026-08-26T20:00:00.000Z" });
    expect(normalizeDeliveryPosition({ latitude: 99, longitude: -1.52, heading: 1, recordedAt: "now" })).toBeNull();
  });

  it("crée uniquement des canaux de livraison sûrs", () => {
    expect(deliveryChannelName("delivery_1<>test")).toBe("delivery:delivery_1test");
    expect(deliveryChannelName("***")).toBeNull();
  });

  it("accepte uniquement les événements de statut complets et non sensibles", () => {
    expect(normalizeDeliveryStatusEvent({ deliveryId: "delivery_1", status: "active", title: "Livraison activée", body: "Le livreur a confirmé.", occurredAt: "2026-08-27T07:30:00.000Z" })).toEqual({ deliveryId: "delivery_1", status: "active", title: "Livraison activée", body: "Le livreur a confirmé.", occurredAt: "2026-08-27T07:30:00.000Z" });
    expect(normalizeDeliveryStatusEvent({ deliveryId: "delivery_1", status: "unknown", title: "x", body: "y", occurredAt: "2026-08-27T07:30:00.000Z" })).toBeNull();
    expect(normalizeDeliveryStatusEvent({ deliveryId: "delivery_1", status: "active", title: "x", body: "y", occurredAt: "invalide" })).toBeNull();
  });
});
