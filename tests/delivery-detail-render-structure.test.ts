import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("structure de rendu de la fiche livraison", () => {
  it("rend le libellé de type dans un composant Text", () => {
    const source = readFileSync(resolve(process.cwd(), "app/delivery/[id].tsx"), "utf8");
    expect(source).toContain('<Text style={styles.eyebrow}>{delivery.type} · {delivery.vehicleTypes[0] ?? "Moto"}</Text>');
    expect(source).not.toContain('<View style={styles.eyebrow}>{delivery.type}');
  });
});
