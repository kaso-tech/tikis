/**
 * Crée ou met à jour un compte d'administration Tikis.
 *
 * Usage :
 *   node --import tsx scripts/create-admin-user.ts vous@kasotech.com "mot de passe" "Votre nom" super_admin
 *
 * N'existe volontairement pas comme route API : la création d'un compte admin est un acte
 * sensible qui doit rester une opération manuelle, exécutée sur le serveur par une personne
 * de confiance, jamais exposée publiquement.
 */
import "dotenv/config";
import { hashAdminPassword } from "../server/admin-auth";
import { createAdminUser, getAdminByEmail } from "../server/admin-db";

async function main() {
  const [email, password, fullName, role] = process.argv.slice(2);
  if (!email || !password || !fullName) {
    console.error("Usage: node --import tsx scripts/create-admin-user.ts <email> <password> <fullName> [role=super_admin|support|finance]");
    process.exit(1);
  }
  const safeRole = (role as "super_admin" | "support" | "finance") ?? "super_admin";
  if (!["super_admin", "support", "finance"].includes(safeRole)) {
    console.error("Rôle invalide. Utilisez super_admin, support ou finance.");
    process.exit(1);
  }

  const existing = await getAdminByEmail(email).catch(() => undefined);
  if (existing) {
    console.error(`Un compte existe déjà pour ${email}. Ce script ne met pas à jour un compte existant (utilisez la console pour suspendre/réactiver).`);
    process.exit(1);
  }

  const passwordHash = await hashAdminPassword(password);
  await createAdminUser({ email, passwordHash, fullName, role: safeRole });
  console.log(`Compte admin créé : ${email} (${safeRole}). Connectez-vous sur /admin.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
