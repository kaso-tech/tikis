import { createHash } from "node:crypto";

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function tokenLast4(token: string): string {
  return token.slice(-4);
}
