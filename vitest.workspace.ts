import { configDefaults, defineWorkspace } from "vitest/config";

/**
 * Les tests `*.db.test.ts` tournent contre une même base réelle (TIKISSE_TEST_DATABASE_URL) et certains
 * vérifient un état global : par exemple, « aucun compte super-admin ou finance non enrôlé à la double
 * authentification ». Exécutés en parallèle, un fichier qui crée un compte finance fait échouer celui qui
 * vérifie cette règle. Ils passent donc un fichier à la fois ; les autres tests restent en parallèle.
 */
export default defineWorkspace([
  { test: { name: "unit", exclude: [...configDefaults.exclude, "**/*.db.test.ts"] } },
  { test: { name: "db", include: ["tests/**/*.db.test.ts"], pool: "forks", poolOptions: { forks: { singleFork: true } } } },
]);
