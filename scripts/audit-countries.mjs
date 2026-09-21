#!/usr/bin/env node
/**
 * pnpm db:audit-countries
 *
 * Confronte la table `tikis_supported_countries` aux codes ISO réels et imprime,
 * pour chaque ligne incohérente, la correction et le SQL qui la réalise.
 *
 * Cette vérification n'existait pas au moment où les pays ont été ajoutés : le
 * formulaire d'administration acceptait n'importe quelles deux lettres. « Bénin »
 * enregistré sous BN affiche donc le drapeau du Brunei et cherche des villes
 * bruneiennes. Le script ne modifie rien : il constate et propose.
 *
 * Sans DATABASE_URL : rien à auditer, le script le dit et sort.
 * Exit code 0 = aucune incohérence, 1 = au moins une ligne à corriger.
 */

import process from "node:process";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const { ISO_COUNTRIES, countryDraftIssue, isoCountryByName } = await import(
  url.pathToFileURL(path.join(__dirname, "..", "shared", "iso-countries.ts")).href
).catch(async () => {
  // Le script tourne en JS pur : on relit la table depuis le source TypeScript
  // plutôt que d'en garder une copie qui divergerait.
  const fs = await import("node:fs");
  const source = fs.readFileSync(path.join(__dirname, "..", "shared", "iso-countries.ts"), "utf8");
  const entries = [...source.matchAll(/\{ id: "([A-Z]{2})", name: "([^"]+)", dialCode: "(\+\d+)"/g)]
    .map(([, id, name, dialCode]) => ({ id, name, dialCode }));
  const normalize = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z]+/g, " ").trim().toLowerCase();
  const byName = (name) => entries.find((entry) => normalize(entry.name) === normalize(name));
  return {
    ISO_COUNTRIES: entries,
    isoCountryByName: byName,
    countryDraftIssue: ({ id, name, dialCode }) => {
      const known = entries.find((entry) => entry.id === id.toUpperCase());
      const named = byName(name);
      if (!known) return named ? `Le code ISO de « ${named.name} » est ${named.id}, pas ${id}.` : `Le code ISO ${id} n’est pas un pays desservi par Tikis.`;
      if (named && named.id !== known.id) return `${known.id} est le code de « ${known.name} », pas de « ${named.name} » — dont le code est ${named.id}.`;
      if (dialCode && dialCode !== known.dialCode) return `L’indicatif de « ${known.name} » est ${known.dialCode}, pas ${dialCode}.`;
      return null;
    },
  };
});

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL absente : rien à auditer.");
  console.log(`Référence chargée : ${ISO_COUNTRIES.length} pays.`);
  process.exit(0);
}

const mysql = await import("mysql2/promise");
const conn = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [rows] = await conn.query("SELECT id, name, dialCode, enabled FROM tikis_supported_countries ORDER BY sortOrder");
  const broken = [];
  for (const row of rows) {
    const issue = countryDraftIssue({ id: row.id, name: row.name, dialCode: row.dialCode });
    if (issue) broken.push({ row, issue, suggestion: isoCountryByName(row.name) });
  }

  console.log(`${rows.length} pays en base, ${broken.length} à corriger.\n`);
  for (const { row, issue, suggestion } of broken) {
    const [[used]] = await conn.query("SELECT COUNT(*) AS n FROM tikis_profiles WHERE country = ?", [row.id]);
    console.log(`✖ ${row.name} (${row.id}) — ${issue}`);
    console.log(`  Profils rattachés à ce code : ${used.n}`);
    if (suggestion) {
      console.log("  Le code étant la clé primaire, la correction se fait en trois temps :");
      console.log(`    1. INSERT INTO tikis_supported_countries (id, name, dialCode, digits, \`groups\`, timeZones, enabled, sortOrder)`);
      console.log(`         SELECT '${suggestion.id}', name, '${suggestion.dialCode}', digits, \`groups\`, timeZones, enabled, sortOrder`);
      console.log(`         FROM tikis_supported_countries WHERE id = '${row.id}';`);
      console.log(`    2. UPDATE tikis_profiles SET country = '${suggestion.id}' WHERE country = '${row.id}';`);
      console.log(`    3. DELETE FROM tikis_supported_countries WHERE id = '${row.id}';`);
      console.log("  Vérifiez aussi le nombre de chiffres et les fuseaux horaires, que ce script ne contrôle pas.");
    }
    console.log("");
  }
  process.exit(broken.length > 0 ? 1 : 0);
} finally {
  await conn.end();
}
