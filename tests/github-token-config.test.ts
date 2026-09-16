import { describe, expect, it } from "vitest";

describe("configuration GitHub", () => {
  it("permet une vérification légère de l’API GitHub sans exposer le jeton", async () => {
    const token = process.env.GITHUB_TOKEN;
    expect(token).toBeTruthy();

    const response = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    expect(response.ok).toBe(true);
    const payload = (await response.json()) as { rate?: { limit?: number } };
    expect(payload.rate?.limit).toBeTypeOf("number");
  }, 15_000);
});
