import { describe, expect, it } from "vitest";

const SANDBOX_BASE_URL = "https://api.sandbox.yengapay.com/api/v1";

function configured(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} est requis pour valider le projet YengaPay Sandbox.`);
  return value;
}

const hasSandboxCredentials = Boolean(
  process.env.YENGAPAY_API_KEY
  && process.env.YENGAPAY_ORG_ID
  && process.env.YENGAPAY_PROJECT_ID,
);

describe("identifiants du projet YengaPay Sandbox", () => {
  it.skipIf(!hasSandboxCredentials)("authentifie une lecture non transactionnelle d’intention", async () => {
    const apiKey = configured("YENGAPAY_API_KEY");
    const organizationId = configured("YENGAPAY_ORG_ID");
    const projectId = configured("YENGAPAY_PROJECT_ID");
    const baseUrl = (process.env.YENGAPAY_BASE_URL ?? SANDBOX_BASE_URL).replace(/\/$/, "");
    const sentinelIntentId = "tikis-sandbox-health-check-does-not-exist";
    const response = await fetch(`${baseUrl}/groups/${encodeURIComponent(organizationId)}/payment-intent/project/${encodeURIComponent(projectId)}/intent/${sentinelIntentId}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });

    // L'intention est volontairement inexistante. Un 400/404 confirme néanmoins que la clé a atteint
    // la ressource protégée; 401/403 révèle une clé, un projet ou une portée incorrects.
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
    expect(response.status).toBeLessThan(500);
  }, 20_000);
});
