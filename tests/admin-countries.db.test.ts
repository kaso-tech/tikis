/**
 * Pays de la console : ajout en fin de liste, suppression protégée, ordre d'affichage. Exécuté contre une
 * vraie base MySQL/MariaDB :
 *
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/admin-countries.db.test.ts
 *
 * Aucun compte admin n'est créé ici (tests/admin-governance.db.test.ts compte les super-admins) : les
 * fonctions de server/admin-db.ts sont appelées directement, les droits sont vérifiés par contrat plus bas.
 * La Gambie (GM) et Sao Tomé (ST) servent de pays de test : l'état d'origine est restauré à la fin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB = process.env.TIKISSE_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

let db: typeof import("../server/db");
let adminDb: typeof import("../server/admin-db");
let schema: typeof import("../drizzle/schema");
let orm: typeof import("drizzle-orm");
let originalOrder: string[] = [];
let originalRows: Array<typeof import("../drizzle/schema").tikisseSupportedCountries.$inferSelect> = [];
const TEST_IDS = ["GM", "ST"];

beforeAll(async () => {
  if (!TEST_DB) return;
  db = await import("../server/db");
  adminDb = await import("../server/admin-db");
  schema = await import("../drizzle/schema");
  orm = await import("drizzle-orm");
  const handle = (await db.getDb())!;
  originalRows = await handle.select().from(schema.tikisseSupportedCountries).where(orm.inArray(schema.tikisseSupportedCountries.id, TEST_IDS));
  await handle.delete(schema.tikisseSupportedCountries).where(orm.inArray(schema.tikisseSupportedCountries.id, TEST_IDS));
  originalOrder = (await adminDb.adminListCountries()).map((country) => country.id);
});

afterAll(async () => {
  if (!TEST_DB) return;
  const handle = (await db.getDb())!;
  await handle.delete(schema.tikisseProfiles).where(orm.like(schema.tikisseProfiles.phone, "+220%"));
  await handle.delete(schema.tikisseSupportedCountries).where(orm.inArray(schema.tikisseSupportedCountries.id, TEST_IDS));
  if (originalRows.length) await handle.insert(schema.tikisseSupportedCountries).values(originalRows);
  const current = (await adminDb.adminListCountries()).map((country) => country.id);
  await adminDb.adminReorderCountries([...originalOrder.filter((id) => current.includes(id)), ...current.filter((id) => !originalOrder.includes(id))]);
});

const gambia = { id: "GM", name: "Gambie", dialCode: "+220", digits: 7, groups: [3, 4], timeZones: ["Africa/Banjul"], enabled: false };

describe.skipIf(!TEST_DB)("pays — ajout et suppression", () => {
  it("un nouveau pays se range en fin de liste", async () => {
    await adminDb.adminUpsertCountry(gambia);
    const list = await adminDb.adminListCountries();
    expect(list.at(-1)).toMatchObject({ id: "GM", accountCount: 0, enabled: false });
  });

  it("une modification garde la place du pays", async () => {
    await adminDb.adminUpsertCountry({ id: "ST", name: "Sao Tomé-et-Principe", dialCode: "+239", digits: 7, groups: [3, 4], timeZones: ["Africa/Sao_Tome"], enabled: false });
    const before = (await adminDb.adminListCountries()).map((country) => country.id);
    await adminDb.adminUpsertCountry({ ...gambia, name: "Gambie (test)" });
    expect((await adminDb.adminListCountries()).map((country) => country.id)).toEqual(before);
    await adminDb.adminDeleteCountry("ST");
  });

  it("refuse un fuseau horaire inconnu", async () => {
    await expect(adminDb.adminUpsertCountry({ ...gambia, timeZones: ["Afrique/Banjul"] })).rejects.toThrow("Fuseau horaire inconnu : Afrique/Banjul");
  });

  it("refuse de supprimer un pays où des comptes sont inscrits, et les compte", async () => {
    const handle = (await db.getDb())!;
    const phone = `+220${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    await handle.insert(schema.tikisseProfiles).values({ phone, fullName: "Compte gambien", accountType: "sender", vehicles: "[]" });
    expect((await adminDb.adminListCountries()).find((country) => country.id === "GM")?.accountCount).toBe(1);
    await expect(adminDb.adminDeleteCountry("GM")).rejects.toThrow(/1 compte inscrit : il ne peut pas être supprimé/);
    await handle.delete(schema.tikisseProfiles).where(orm.eq(schema.tikisseProfiles.phone, phone));
  });

  it("un compte déclaré dans ce pays compte aussi, quel que soit son numéro", async () => {
    const handle = (await db.getDb())!;
    const phone = `+220${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    await handle.insert(schema.tikisseProfiles).values({ phone, fullName: "Compte déclaré", accountType: "sender", vehicles: "[]", country: "GM" });
    expect((await adminDb.adminListCountries()).find((country) => country.id === "GM")?.accountCount).toBe(1);
    await handle.delete(schema.tikisseProfiles).where(orm.eq(schema.tikisseProfiles.phone, phone));
  });

  it("supprime un pays sans compte", async () => {
    await adminDb.adminDeleteCountry("GM");
    expect((await adminDb.adminListCountries()).some((country) => country.id === "GM")).toBe(false);
    await expect(adminDb.adminDeleteCountry("GM")).rejects.toThrow("Pays introuvable.");
  });
});

describe.skipIf(!TEST_DB)("pays — ordre d'affichage", () => {
  let order: string[] = [];

  beforeAll(async () => {
    if (!TEST_DB) return;
    await adminDb.adminUpsertCountry(gambia);
    await adminDb.adminUpsertCountry({ id: "ST", name: "Sao Tomé-et-Principe", dialCode: "+239", digits: 7, groups: [3, 4], timeZones: ["Africa/Sao_Tome"], enabled: false });
    order = (await adminDb.adminListCountries()).map((country) => country.id);
  });

  it("enregistre l'ordre donné", async () => {
    const reversed = [...order].reverse();
    await adminDb.adminReorderCountries(reversed);
    expect((await adminDb.adminListCountries()).map((country) => country.id)).toEqual(reversed);
    expect((await adminDb.adminListCountries()).map((country) => country.sortOrder)).toEqual(reversed.map((_, index) => index + 1));
  });

  it("refuse une liste incomplète ou en double : elle a changé entre-temps", async () => {
    await expect(adminDb.adminReorderCountries(order.slice(1))).rejects.toThrow("La liste des pays a changé entre-temps");
    await expect(adminDb.adminReorderCountries([order[0]!, ...order.slice(0, -1)])).rejects.toThrow("La liste des pays a changé entre-temps");
  });
});

describe("pays — droits", () => {
  const router = readFileSync(join(process.cwd(), "server/admin-router.ts"), "utf8");
  const countries = router.slice(router.indexOf("  countries: router({"), router.indexOf("  maintenance: router({"));

  it("supprimer et réordonner sont réservés au super-admin et journalisés", () => {
    expect(countries).toMatch(/remove: adminProcedure\.use\(requireTikisseAdminRole\("super_admin"\)\)/);
    expect(countries).toMatch(/reorder: adminProcedure\.use\(requireTikisseAdminRole\("super_admin"\)\)/);
    expect(countries).toContain('audit(ctx, "country_deleted"');
    expect(countries).toContain('audit(ctx, "countries_reordered"');
  });
});
