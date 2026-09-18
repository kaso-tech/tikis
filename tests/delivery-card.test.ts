import { describe, expect, it } from "vitest";
import {
  deliveryCardContext,
  deliveryCardSignal,
  deliveryCardStateLabel,
  deliveryCardTone,
} from "../lib/delivery-card";

/**
 * Ces trois décisions — l'état, le contexte, le signal — étaient prises dans
 * chaque variante de plateforme. Les deux formes de carte validées sur maquette
 * (« Trajet » côté expéditeur, « Registre » côté livreur) les partagent : elles
 * ne peuvent plus dire deux choses différentes de la même course.
 */
describe("état d’une carte de livraison", () => {
  it("nomme chaque statut en toutes lettres", () => {
    expect(deliveryCardStateLabel("open")).toBe("Publiée");
    expect(deliveryCardStateLabel("pending_confirmation")).toBe("Attribuée");
    expect(deliveryCardStateLabel("active")).toBe("En transit");
    expect(deliveryCardStateLabel("completed")).toBe("Livrée");
    expect(deliveryCardStateLabel("cancelled")).toBe("Annulée");
  });

  it("donne un ton distinct aux états qui appellent une action différente", () => {
    expect(deliveryCardTone("open")).toBe("open");
    expect(deliveryCardTone("pending_confirmation")).toBe("assigned");
    expect(deliveryCardTone("active")).toBe("active");
    expect(deliveryCardTone("completed")).toBe("done");
    expect(deliveryCardTone("expired")).toBe("idle");
  });
});

describe("contexte d’une carte", () => {
  it("garde le titre saisi et la mesure qui compte pour le type", () => {
    expect(deliveryCardContext({ title: "Déplacement", type: "Personne", passengers: 2 })).toBe("Déplacement, 2 passagers");
    expect(deliveryCardContext({ title: "Déplacement", type: "Personne", passengers: 1 })).toBe("Déplacement, 1 passager");
    expect(deliveryCardContext({ title: "Colis atelier", type: "Autre", weightKg: 12 })).toBe("Colis atelier, 12 kg");
  });

  it("ne répète pas le type quand il n’ajoute rien", () => {
    // « Personne · 1 pers. » disait deux fois la même chose sur l'ancienne carte.
    expect(deliveryCardContext({ title: "Document de bureau", type: "Plis" })).toBe("Document de bureau");
  });

  it("retombe sur le type quand l’expéditeur n’a rien saisi", () => {
    expect(deliveryCardContext({ title: "   ", type: "Plis" })).toBe("Plis");
  });
});

describe("signal d’une carte", () => {
  it("annonce les candidats à comparer sur une course publiée", () => {
    expect(deliveryCardSignal({ status: "open", candidateCount: 2 })).toEqual({ kind: "candidates", text: "2 candidats à comparer" });
    expect(deliveryCardSignal({ status: "open", candidateCount: 1 })?.text).toBe("1 candidat à comparer");
  });

  it("se tait quand personne ne s’est proposé", () => {
    // La bande ne réserve pas de place pour du vide.
    expect(deliveryCardSignal({ status: "open", candidateCount: 0 })).toBeNull();
    expect(deliveryCardSignal({ status: "open" })).toBeNull();
  });

  it("nomme le livreur selon ce qu’on attend de lui", () => {
    expect(deliveryCardSignal({ status: "pending_confirmation", driverName: "Aboubacar Soré" })?.text).toBe("Aboubacar Soré doit confirmer");
    expect(deliveryCardSignal({ status: "active", driverName: "Aboubacar Soré" })?.text).toBe("Aboubacar Soré est en route");
  });

  it("se tait sur une course livrée ou sans livreur", () => {
    expect(deliveryCardSignal({ status: "completed", driverName: "Aboubacar Soré" })).toBeNull();
    expect(deliveryCardSignal({ status: "active" })).toBeNull();
  });
});
