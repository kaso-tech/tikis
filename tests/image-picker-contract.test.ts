import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Tous les fichiers de l'application qui ouvrent un sélecteur d'images. */
function sourcesUsing(pattern: string): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      if (text.includes(pattern)) found.push({ path: full, text });
    }
  };
  for (const dir of ["app", "components", "hooks", "lib"]) walk(join(process.cwd(), dir));
  return found;
}

describe("sélecteur d’images", () => {
  const callers = sourcesUsing("expo-image-picker");

  it("est bien utilisé quelque part, sinon ce contrat ne protège rien", () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  it("n’emploie plus `MediaTypeOptions`, déprécié depuis le SDK 52", () => {
    for (const caller of callers) expect(caller.text).not.toContain("MediaTypeOptions");
  });

  it("n’emploie pas `ImagePicker.MediaType`, qui n’existe qu’au niveau des types", () => {
    // Le message de dépréciation suggère `ImagePicker.MediaType`, mais le paquet
    // l'exporte avec `export type` : l'écrire planterait à l'exécution.
    for (const caller of callers) expect(caller.text).not.toMatch(/ImagePicker\.MediaType\b/);
  });

  it("demande explicitement des images à chaque ouverture", () => {
    for (const caller of callers) {
      const opens = caller.text.match(/launch(?:ImageLibrary|Camera)Async\(\{[^}]*\}/g) ?? [];
      for (const open of opens) expect(open, `${caller.path} : ${open}`).toContain('mediaTypes: ["images"]');
    }
  });
});
