import { readFile } from "node:fs/promises";

const projectUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!projectUrl || !accessToken) {
  throw new Error("La configuration Supabase nécessaire à l’application des politiques RLS est incomplète.");
}

const projectRef = new URL(projectUrl).hostname.split(".")[0];
const query = await readFile(new URL("../supabase/realtime_policies.sql", import.meta.url), "utf8");
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query }),
});

if (!response.ok) {
  const detail = (await response.text()).slice(0, 600);
  throw new Error(`L’application des politiques RLS a échoué (${response.status})${detail ? ` : ${detail}` : ""}`);
}

console.log("Politiques RLS Supabase appliquées avec succès.");
