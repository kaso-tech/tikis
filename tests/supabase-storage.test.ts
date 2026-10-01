/**
 * Stockage Supabase (server/storage.ts) contre un faux Supabase Storage : les appels REST sont capturés et
 * vérifiés (chemin, en-têtes, corps), et la route publique `/api/files/*` est testée sur un vrai serveur Express.
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerStorageProxy } from "../server/_core/storageProxy";
import { publicFileUrl, resetStorageStateForTests, storageErase, storageGetSignedUrl, storagePut, storageReadObject } from "../server/storage";

const SUPABASE = "https://projet.supabase.co";
type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];
let bucket: { exists: boolean; public: boolean } = { exists: true, public: false };
const realFetch = globalThis.fetch;

function fakeStorage(input: RequestInfo | URL, init: RequestInit = {}) {
  const url = String(input);
  if (!url.startsWith(SUPABASE)) return realFetch(input, init);
  const method = init.method ?? "GET";
  const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
  const rawBody = init.body;
  const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  calls.push({ method, url, headers, body });
  const path = url.slice(`${SUPABASE}/storage/v1`.length);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (method === "GET" && path.startsWith("/bucket/")) return Promise.resolve(bucket.exists ? json({ id: "tikisse-files", public: bucket.public }) : json({ error: "Bucket not found" }, 400));
  if (method === "POST" && path === "/bucket") { bucket.exists = true; return Promise.resolve(json({ name: "tikisse-files" })); }
  if (method === "POST" && path.startsWith("/object/sign/")) return Promise.resolve(json({ signedURL: `${path.replace("/object/sign", "/object/sign")}?token=jeton` }));
  if (method === "POST" && path.startsWith("/object/")) return Promise.resolve(json({ Key: path }));
  if (method === "GET" && path.startsWith("/object/")) return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } }));
  if (method === "DELETE" && path.startsWith("/object/")) return Promise.resolve(json([]));
  return Promise.resolve(json({ error: "inattendu" }, 500));
}

beforeEach(() => {
  calls = [];
  bucket = { exists: true, public: false };
  resetStorageStateForTests();
  vi.stubEnv("SUPABASE_URL", SUPABASE);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle-service");
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", "");
  vi.stubGlobal("fetch", vi.fn(fakeStorage));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("dépôt", () => {
  it("dépose dans le bucket privé, avec la clé service_role, sans écraser un fichier existant", async () => {
    const stored = await storagePut("tikisse-profiles/22670123456/avatar.jpg", Buffer.from([1, 2]), "image/jpeg");
    expect(stored.key).toMatch(/^tikisse-profiles\/22670123456\/avatar_[0-9a-f]{8}\.jpg$/);
    expect(stored.url).toBe(`/api/files/${stored.key}`);
    const upload = calls.find((call) => call.method === "POST" && call.url.includes("/object/tikisse-files/"))!;
    expect(upload.url).toBe(`${SUPABASE}/storage/v1/object/tikisse-files/${stored.key}`);
    expect(upload.headers.authorization).toBe("Bearer cle-service");
    expect(upload.headers["x-upsert"]).toBe("false");
    expect(upload.headers["content-type"]).toBe("image/jpeg");
  });

  it("crée le bucket, privé et limité aux images, s'il n'existe pas — une seule fois", async () => {
    bucket.exists = false;
    await storagePut("a/b.png", Buffer.from([1]), "image/png");
    await storagePut("a/c.png", Buffer.from([1]), "image/png");
    const creations = calls.filter((call) => call.method === "POST" && call.url.endsWith("/bucket"));
    expect(creations).toHaveLength(1);
    expect(creations[0]!.body).toMatchObject({ id: "tikisse-files", public: false, allowed_mime_types: ["image/jpeg", "image/png", "image/webp"] });
    expect(calls.filter((call) => call.method === "GET" && call.url.includes("/bucket/"))).toHaveLength(1);
  });

  it("refuse de déposer dans un bucket public", async () => {
    bucket.public = true;
    await expect(storagePut("a/b.png", Buffer.from([1]), "image/png")).rejects.toThrow("est public");
    expect(calls.some((call) => call.url.includes("/object/"))).toBe(false);
  });

  it("sans configuration, un message clair plutôt qu'un appel au hasard", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(storagePut("a/b.png", Buffer.from([1]))).rejects.toThrow("SUPABASE_SERVICE_ROLE_KEY");
  });
});

describe("lecture, lien signé, suppression", () => {
  it("lien signé de 5 minutes, adresse complète", async () => {
    const url = await storageGetSignedUrl("tikisse-profiles/1/avatar_ab.jpg");
    expect(url).toBe(`${SUPABASE}/storage/v1/object/sign/tikisse-files/tikisse-profiles/1/avatar_ab.jpg?token=jeton`);
    expect(calls[0]!.body).toEqual({ expiresIn: 300 });
  });

  it("lit un fichier côté serveur", async () => {
    const object = await storageReadObject("tikisse-kyc/1/selfie.jpg");
    expect([...object.body]).toEqual([1, 2, 3]);
    expect(object.contentType).toBe("image/jpeg");
    expect(calls[0]!.url).toBe(`${SUPABASE}/storage/v1/object/tikisse-files/tikisse-kyc/1/selfie.jpg`);
  });

  it("supprime vraiment le fichier (l'ancien stockage ne savait que le vider)", async () => {
    await storageErase("/tikisse-kyc/1/selfie.jpg");
    expect(calls[0]).toMatchObject({ method: "DELETE", url: `${SUPABASE}/storage/v1/object/tikisse-files`, body: { prefixes: ["tikisse-kyc/1/selfie.jpg"] } });
  });

  it("encode chaque segment de la clé", () => {
    expect(publicFileUrl("tikisse-profiles/1/a b#c.jpg")).toBe("/api/files/tikisse-profiles/1/a%20b%23c.jpg");
  });
});

describe("route publique /api/files", () => {
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

  it("redirige une photo de profil vers un lien signé, sans cache", async () => {
    const response = await realFetch(`${base}/api/files/tikisse-profiles/22670123456/avatar_ab12cd34.jpg`, { redirect: "manual" });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${SUPABASE}/storage/v1/object/sign/tikisse-files/tikisse-profiles/22670123456/avatar_ab12cd34.jpg?token=jeton`);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("l'ancienne adresse /manus-storage reste servie pour une application pas encore mise à jour", async () => {
    const response = await realFetch(`${base}/manus-storage/tikisse-profiles/1/avatar_ab.jpg`, { redirect: "manual" });
    expect(response.status).toBe(307);
  });

  it.each([
    "/api/files/tikisse-kyc/22670123456/1700000000000-selfie_ab12cd34.jpg",
    "/api/files//tikisse-kyc/a.jpg",
    "/api/files/tikisse-kyc%2Fa.jpg",
    "/api/files/tikisse-reports/22670123456/a.png",
    "/api/files/tikisse-profiles/..%2Ftikisse-kyc/a.jpg",
  ])("répond 404 pour %s, sans jamais interroger le stockage", async (path) => {
    const response = await realFetch(`${base}${path}`, { redirect: "manual" });
    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
