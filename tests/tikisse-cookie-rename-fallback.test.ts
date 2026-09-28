/**
 * Renommage Tikis → Tikisse : un navigateur déjà connecté avant le déploiement porte encore les anciens
 * cookies (`tikis-profile-session`, `tikis_admin_session`). Le serveur doit continuer à les lire pour ne
 * déconnecter personne au déploiement ; le nouveau nom est toujours prioritaire quand les deux existent.
 */
import { describe, expect, it } from "vitest";
import { adminSessionCookieValue, pickAdminSessionToken, pickTikisseSessionToken } from "../server/_core/context";
import { ADMIN_CONSOLE_HEADER } from "../server/admin-auth";

function reqWith(cookie: string, headers: Record<string, string> = {}) {
  return { headers: { cookie, ...headers } } as never;
}

describe("cookie de profil : repli sur l'ancien nom", () => {
  it("lit le nouveau cookie quand il est présent", () => {
    expect(pickTikisseSessionToken({ req: reqWith("tikisse-profile-session=jeton-neuf") } as never)).toBe("jeton-neuf");
  });

  it("lit l'ancien cookie quand seul lui est présent", () => {
    expect(pickTikisseSessionToken({ req: reqWith("tikis-profile-session=jeton-avant-renommage") } as never)).toBe("jeton-avant-renommage");
  });

  it("priorise le nouveau cookie quand les deux sont présents", () => {
    expect(pickTikisseSessionToken({ req: reqWith("tikisse-profile-session=jeton-neuf; tikis-profile-session=jeton-avant-renommage") } as never)).toBe("jeton-neuf");
  });
});

describe("cookie admin : repli sur l'ancien nom", () => {
  it("adminSessionCookieValue lit l'ancien cookie en secours", () => {
    expect(adminSessionCookieValue(reqWith("tikis_admin_session=jeton-admin-avant-renommage"))).toBe("jeton-admin-avant-renommage");
  });

  it("pickAdminSessionToken exige toujours l'en-tête de la console, ancien cookie ou pas", () => {
    expect(pickAdminSessionToken({ req: reqWith("tikis_admin_session=jeton-admin-avant-renommage") } as never)).toBeUndefined();
    expect(pickAdminSessionToken({ req: reqWith("tikis_admin_session=jeton-admin-avant-renommage", { [ADMIN_CONSOLE_HEADER]: "1" }) } as never)).toBe("jeton-admin-avant-renommage");
  });

  it("priorise le nouveau cookie admin quand les deux sont présents", () => {
    expect(pickAdminSessionToken({ req: reqWith("tikisse_admin_session=jeton-neuf; tikis_admin_session=jeton-avant-renommage", { [ADMIN_CONSOLE_HEADER]: "1" }) } as never)).toBe("jeton-neuf");
  });
});
