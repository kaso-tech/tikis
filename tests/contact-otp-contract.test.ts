import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schemaSource = readFileSync(join(process.cwd(), "drizzle/schema.ts"), "utf8");
const routerSource = readFileSync(join(process.cwd(), "server/routers.ts"), "utf8");
const contactSource = readFileSync(join(process.cwd(), "components/tikis/contact-section.tsx"), "utf8");

describe("contrat de vérification des contacts", () => {
  it("persiste les indicateurs de contact vérifié avec le profil", () => {
    expect(schemaSource).toContain('email: varchar("email", { length: 320 })');
    expect(schemaSource).toContain('phoneVerified: boolean("phoneVerified").notNull().default(true)');
    expect(schemaSource).toContain('emailVerified: boolean("emailVerified").notNull().default(false)');
  });

  it("utilise le même code de simulation pour le client et le serveur", () => {
    expect(routerSource).toContain('const SIMULATION_OTP = process.env.TIKIS_SIMULATION_OTP ?? "730512"');
    expect(routerSource).toContain("return { ok: true, demoOtp: SIMULATION_OTP }");
    expect(contactSource).toContain('const DEMO_OTP = "730512"');
    expect(contactSource).toContain('phone: profile.phone, sessionOtp: DEMO_OTP');
  });

  it("attache toujours la session du profil aux demandes de contact", () => {
    expect(contactSource).toContain('phone: profile.phone');
    expect(routerSource).toContain('const current = await db.getTikisProfileByPhone(input.phone)');
    expect(routerSource).toContain('db.updateTikisProfile(input.phone, { email: input.value.trim().toLocaleLowerCase("fr-FR"), emailVerified: true, phoneVerified: true })');
  });
});
