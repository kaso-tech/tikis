/**
 * Côté application : les notifications viennent du serveur (appendDeliveryEvent → push Expo). L'app ne
 * doit pas en fabriquer d'autres en local, sinon chaque changement de statut sonnait deux fois.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const appSources = ["app", "components", "lib", "hooks"].flatMap(sources);

describe("notifications de l'application", () => {
  it("aucune notification locale : tout push vient du serveur", () => {
    const offenders = appSources.filter((path) => readFileSync(path, "utf8").includes("scheduleNotificationAsync"));
    expect(offenders).toEqual([]);
  });

  it("un seul gestionnaire d'affichage, sinon le dernier configuré écrase l'autre", () => {
    const handlers = appSources.filter((path) => readFileSync(path, "utf8").includes("setNotificationHandler("));
    expect(handlers).toEqual([join("lib", "push-notifications.ts")]);
  });

  it("le temps réel rafraîchit les écrans sans rien afficher", () => {
    const provider = read("components/tikisse/delivery-realtime-provider.tsx");
    expect(provider).toContain("utilities.notifications.list.invalidate()");
    expect(provider).not.toContain("simulated-push-notifications");
  });

  it("pas de notification « Bienvenue » à l'inscription", () => {
    expect(read("lib/tikisse-store.tsx")).not.toContain("Bienvenue sur Tikisse");
  });

  it("le bonus de fidélité parle du Wallet, pas de la console admin", () => {
    const loyalty = read("server/loyalty.ts");
    expect(loyalty).not.toContain("dans l'admin");
    expect(loyalty).toContain("crédités sur votre Wallet");
  });
});
