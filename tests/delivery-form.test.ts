import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publicationBlocker, suggestVehicle } from "../lib/delivery-form";

const ready = {
  pickup: true,
  dropoff: true,
  route: true,
  title: "Documents de bureau",
  titleReady: true,
  deliveryType: "Plis" as const,
  passengers: "",
  measurementIssue: "",
  offeredPrice: "3500",
  priceError: "",
};

describe("ce qui empêche de publier", () => {
  it("ne dit rien quand la course est prête", () => {
    expect(publicationBlocker(ready)).toBeNull();
  });

  it("réclame les lieux avant tout le reste", () => {
    expect(publicationBlocker({ ...ready, pickup: false, title: "", offeredPrice: "" })).toBe("Choisissez le lieu de récupération.");
    expect(publicationBlocker({ ...ready, dropoff: false, title: "" })).toBe("Choisissez la destination.");
  });

  it("réclame le prix en dernier, une fois le reste rempli", () => {
    expect(publicationBlocker({ ...ready, offeredPrice: "" })).toBe("Fixez le prix que vous proposez.");
    expect(publicationBlocker({ ...ready, offeredPrice: "  " })).toBe("Fixez le prix que vous proposez.");
  });

  it("ignore les consignes, qui sont facultatives", () => {
    // La barre de progression les comptait : elle restait sous 100 % sur une
    // course publiable, et atteignait 100 % sur une course qui ne l'était pas.
    // Le calcul ne les reçoit plus du tout, ce que dit sa signature.
    const keys = Object.keys(ready);
    expect(keys).not.toContain("details");
    expect(publicationBlocker(ready)).toBeNull();
  });

  it("compte les passagers seulement pour un transport de personnes", () => {
    expect(publicationBlocker({ ...ready, deliveryType: "Personne", passengers: "" })).toBe("Indiquez entre 1 et 4 personnes.");
    expect(publicationBlocker({ ...ready, deliveryType: "Personne", passengers: "5" })).toBe("Indiquez entre 1 et 4 personnes.");
    expect(publicationBlocker({ ...ready, deliveryType: "Personne", passengers: "2" })).toBeNull();
    expect(publicationBlocker({ ...ready, deliveryType: "Plis", passengers: "" })).toBeNull();
  });
});

describe("l'engin suggéré par le colis", () => {
  it("reste la moto par défaut", () => {
    expect(suggestVehicle({ deliveryType: "Plis", weightKg: "", passengers: "" })).toBe("Moto");
    expect(suggestVehicle({ deliveryType: "Autre", weightKg: "8", passengers: "" })).toBe("Moto");
  });

  it("monte en gamme avec le poids", () => {
    expect(suggestVehicle({ deliveryType: "Autre", weightKg: "40", passengers: "" })).toBe("Tricycle");
    expect(suggestVehicle({ deliveryType: "Autre", weightKg: "120", passengers: "" })).toBe("Voiture");
  });

  it("passe à la voiture au-delà de deux passagers", () => {
    expect(suggestVehicle({ deliveryType: "Personne", weightKg: "", passengers: "2" })).toBe("Moto");
    expect(suggestVehicle({ deliveryType: "Personne", weightKg: "", passengers: "3" })).toBe("Voiture");
  });

  it("ne suggère jamais le vélo : c'est un choix, pas une conséquence du poids", () => {
    const suggestions = new Set<string>();
    for (const weight of ["", "1", "10", "26", "81", "500"]) {
      for (const type of ["Plis", "Personne", "Autre"] as const) {
        for (const passengers of ["", "1", "4"]) suggestions.add(suggestVehicle({ deliveryType: type, weightKg: weight, passengers }));
      }
    }
    expect(suggestions.has("Vélo")).toBe(false);
  });
});

describe("l'écran de publication", () => {
  const source = readFileSync(join(process.cwd(), "app/create-delivery.tsx"), "utf8");

  it("mène de l'itinéraire à l'offre, puis au colis, puis à l'engin", () => {
    const order = ["Votre offre", "Ce que vous envoyez", "L’engin"].map((title) => source.indexOf(title));
    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // L'offre passe avant le colis : c'est la question à laquelle l'expéditeur veut une réponse.
    expect(source.indexOf("Votre offre")).toBeLessThan(source.indexOf("Ce que vous envoyez"));
  });

  it("a renoncé à la barre de progression et à son pourcentage", () => {
    expect(source).not.toContain("progressFill");
    expect(source).not.toContain("totalFields");
    expect(source).toContain("publicationBlocker");
  });

  it("branche les raccourcis de prix sur le champ", () => {
    expect(source).toContain("priceSuggestions(estimate)");
    expect(source).toContain("setOfferedPriceInput(String(suggestion.amount))");
  });

  it("n'offre qu'un seul chemin vers les brouillons en haut, et un seul en bas", () => {
    expect((source.match(/router\.push\("\/delivery-drafts"/g) ?? []).length).toBe(1);
    expect((source.match(/void saveDraft\(\)/g) ?? []).length).toBe(1);
  });
});
