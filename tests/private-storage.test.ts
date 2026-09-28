/**
 * Lot 4 — les pièces d'identité KYC et les pièces jointes de signalement ne sortent plus par le proxy
 * public `/manus-storage/*`. Testé sur la vraie route Express (serveur HTTP éphémère), pas seulement sur
 * la fonction de filtrage.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerStorageProxy } from "../server/_core/storageProxy";
import { isPrivateStorageKey } from "../server/storage";

describe("isPrivateStorageKey", () => {
  it.each([
    "tikisse-kyc/22670123456/1700000000000-id-front_ab12cd34.jpg",
    "tikisse-reports/22670123456/1700000000000-x.png",
    "/tikisse-kyc/a.jpg",
    "//tikisse-kyc/a.jpg",
    "./tikisse-kyc/a.jpg",
    "tikisse-profiles/../tikisse-kyc/a.jpg",
    "TIKISSE-KYC/a.jpg",
    "tikisse-kyc",
    "tikisse-kyc\\a.jpg",
    // Renommage Tikis → Tikisse : les fichiers déposés avant le déploiement restent sous l'ancien préfixe
    // (jamais renommés dans le stockage lui-même) et doivent rester protégés indéfiniment.
    "tikis-kyc/22670123456/1700000000000-id-front_ab12cd34.jpg",
    "tikis-reports/22670123456/1700000000000-x.png",
  ])("refuse %s", (key) => {
    expect(isPrivateStorageKey(key)).toBe(true);
  });

  it.each(["tikisse-profiles/22670123456/avatar_ab12cd34.jpg", "generated/1700000000000.png", "tikisse-kycx/a.jpg"])("laisse passer %s", (key) => {
    expect(isPrivateStorageKey(key)).toBe(false);
  });
});

describe("proxy public /manus-storage", () => {
  let base = "";
  let close: () => void = () => {};
  beforeAll(async () => {
    const app = express();
    registerStorageProxy(app);
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it.each([
    "/manus-storage/tikisse-kyc/22670123456/1700000000000-selfie_ab12cd34.jpg",
    "/manus-storage//tikisse-kyc/a.jpg",
    "/manus-storage/tikisse-kyc%2Fa.jpg",
    "/manus-storage/tikisse-reports/22670123456/a.png",
  ])("répond 404 pour %s, sans jamais interroger le stockage", async (path) => {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
