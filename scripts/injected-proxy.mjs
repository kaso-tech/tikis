/**
 * Mode --injected : les identifiants Supabase sont ajoutés par un proxy HTTPS (HTTPS_PROXY). Or le fetch de
 * Node ignore HTTPS_PROXY par défaut : la requête partirait en direct, sans identifiant (401). On relance donc
 * le script une fois avec NODE_USE_ENV_PROXY=1 (Node ≥ 22.21) pour que fetch passe par le proxy.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const injected = process.argv.includes("--injected") || /^(1|true)$/i.test(process.env.SUPABASE_CREDENTIALS_INJECTED ?? "");
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (injected && proxy && process.env.NODE_USE_ENV_PROXY !== "1") {
  const result = spawnSync(process.execPath, [...process.execArgv, "--disable-warning=UNDICI-EHPA", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  process.exit(result.status ?? 1);
}
