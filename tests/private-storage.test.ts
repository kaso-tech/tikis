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
    "tikis-kyc/22670123456/1700000000000-id-front_ab12cd34.jpg",
    "tikis-reports/22670123456/1700000000000-x.png",
    "/tikis-kyc/a.jpg",
    "//tikis-kyc/a.jpg",
    "./tikis-kyc/a.jpg",
    "tikis-profiles/../tikis-kyc/a.jpg",
    "TIKIS-KYC/a.jpg",
    "tikis-kyc",
    "tikis-kyc\\a.jpg",
  ])("refuse %s", (key) => {
    expect(isPrivateStorageKey(key)).toBe(true);
  });

  it.each(["tikis-profiles/22670123456/avatar_ab12cd34.jpg", "generated/1700000000000.png", "tikis-kycx/a.jpg"])("laisse passer %s", (key) => {
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
    "/manus-storage/tikis-kyc/22670123456/1700000000000-selfie_ab12cd34.jpg",
    "/manus-storage//tikis-kyc/a.jpg",
    "/manus-storage/tikis-kyc%2Fa.jpg",
    "/manus-storage/tikis-reports/22670123456/a.png",
  ])("répond 404 pour %s, sans jamais interroger le stockage", async (path) => {
    const response = await fetch(`${base}${path}`, { redirect: "manual" });
    expect(response.status).toBe(404);
    expect(response.headers.get("location")).toBeNull();
  });
});
