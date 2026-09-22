import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const routers = read("server/routers.ts");
const db = read("server/db.ts");
const realtime = read("server/supabase-realtime.ts");
const provider = read("components/tikis/delivery-realtime-provider.tsx");
const homeNative = read("components/tikis/screens/home-screen.native.tsx");
const homeWeb = read("components/tikis/screens/home-screen.web.tsx");
const appChrome = read("components/tikis/app-chrome.tsx");
const notificationsScreen = read("app/notifications.tsx");

describe("pont d'authentification Realtime — profil sans Supabase Phone Auth", () => {
  it("expose une procédure protégée qui établit la session Supabase du profil courant, jamais d'un numéro arbitraire", () => {
    expect(routers).toContain("ensureRealtimeSession: tikisProtectedProcedure.mutation(async ({ ctx }) => {");
    const slice = routers.slice(routers.indexOf("ensureRealtimeSession: tikisProtectedProcedure"));
    const body = slice.slice(0, slice.indexOf("}),"));
    expect(body).toContain("ensureSupabaseRealtimeSession(ctx.tikisProfilePhone)");
  });

  it("chaque mouvement de Wallet signale le changement sur le canal Realtime privé du profil", () => {
    const slice = db.slice(db.indexOf("export async function applyWalletMovement"));
    const body = slice.slice(0, slice.indexOf("\nasync function notifyWalletChanged"));
    expect(body).toContain("notifyWalletChanged(movement.profilePhone)");
  });

  it("le signal Wallet ne part que si le profil a une session Supabase liée, et n'échoue jamais la transaction", () => {
    const slice = db.slice(db.indexOf("async function notifyWalletChanged"));
    const body = slice.slice(0, slice.indexOf("\n}", slice.indexOf("catch")));
    expect(body).toContain("profile?.supabaseUserId");
    expect(body).toContain("publishWalletBroadcast(profile.supabaseUserId)");
    expect(body).toContain("catch");
  });

  it("le canal Wallet est propre à l'utilisateur, sans données financières dans la charge utile", () => {
    const slice = realtime.slice(realtime.indexOf("export async function publishWalletBroadcast"));
    expect(slice).toContain("events/changed?private=true");
    expect(slice.slice(0, slice.indexOf("return response.ok"))).not.toMatch(/amount|balance|solde/i);
  });
});

describe("le fournisseur Realtime établit sa propre session Supabase avant de s'abonner au canal Wallet", () => {
  it("ne tente qu'une fois par numéro de profil", () => {
    expect(provider).toContain("attemptedRealtimeSessionFor.current === profile.phone");
  });

  it("réutilise une session déjà posée par Supabase Phone Auth plutôt que de la remplacer", () => {
    expect(provider).toContain("supabase.auth.getSession()");
    expect(provider).toContain("if (existing.data.session)");
  });

  it("applique la session obtenue du serveur via setSession, jamais de bidouille de stockage direct", () => {
    expect(provider).toContain("ensureRealtimeSessionMutation.mutateAsync()");
    expect(provider).toContain("supabase.auth.setSession({ access_token: session.accessToken, refresh_token: session.refreshToken })");
  });

  it("un échec d'établissement de session reste silencieux : le polling existant reste la source de fraîcheur", () => {
    const slice = provider.slice(provider.indexOf("void (async () => {"));
    const body = slice.slice(0, slice.indexOf("})();"));
    expect(body).toContain("catch");
  });

  it("s'abonne au canal Wallet seulement une fois la session Supabase connue, et invalide les requêtes de solde", () => {
    expect(provider).toContain("subscribeToWalletChannel(supabaseUserId,");
    expect(provider).toContain("utilities.wallet.snapshot.invalidate()");
    expect(provider).toContain("utilities.wallet.driverEarningsHistory.invalidate()");
  });
});

describe("le polling redevient un filet, pas la source principale de fraîcheur", () => {
  it("les écrans d'accueil espacent leurs requêtes à 60 s désormais que Realtime couvre livraisons et Wallet", () => {
    for (const source of [homeNative, homeWeb]) {
      const occurrences = source.match(/refetchInterval: 60_000/g) ?? [];
      expect(occurrences.length).toBeGreaterThanOrEqual(3);
      expect(source).not.toMatch(/refetchInterval: (5_000|8_000|12_000)/);
    }
  });

  it("les notifications et le chrome applicatif suivent le même filet de 60 s", () => {
    expect(appChrome).toContain("refetchInterval: 60_000");
    expect(notificationsScreen).toContain("refetchInterval: 60_000");
  });

  it("la position live pendant une course active garde son intervalle serré : Realtime-primaire, polling en secours rapproché", () => {
    // Volontairement non touché par cette réduction : hooks/use-live-delivery-position.ts,
    // déjà scopé à la seule fenêtre de la course active.
    const liveTracking = read("hooks/use-live-delivery-position.ts");
    expect(liveTracking).toContain("refetchInterval: 2_000");
  });
});
