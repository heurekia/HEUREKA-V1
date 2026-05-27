/**
 * Supprime tous les utilisateurs de test et leurs données associées.
 * Conserve uniquement le compte admin (admin@heureka.fr / Evi DELETANG).
 *
 * Usage : pnpm -F @heureka-v1/api tsx src/scripts/cleanup-test-users.ts
 */
import "dotenv/config";
import { db } from "../db.js";
import { users, dossiers } from "@heureka-v1/db";
import { ne, eq } from "drizzle-orm";

const ADMIN_EMAIL = "admin@heureka.fr";

async function cleanup() {
  console.log("🧹 Nettoyage des utilisateurs de test...\n");

  // Lister les utilisateurs qui seront supprimés
  const toDelete = await db
    .select({ id: users.id, email: users.email, prenom: users.prenom, nom: users.nom, role: users.role })
    .from(users)
    .where(ne(users.email, ADMIN_EMAIL));

  if (toDelete.length === 0) {
    console.log("✅ Aucun utilisateur de test à supprimer.");
    return;
  }

  console.log(`Utilisateurs qui seront supprimés (${toDelete.length}) :`);
  for (const u of toDelete) {
    console.log(`  - ${u.email} (${u.prenom} ${u.nom}, ${u.role})`);
  }

  // Nullifier instructeur_id sur tous les dossiers (les instructeurs vont être supprimés)
  await db.update(dossiers).set({ instructeur_id: null }).where(ne(dossiers.user_id, "00000000-0000-0000-0000-000000000000"));
  console.log("\n✅ instructeur_id remis à null sur tous les dossiers");

  // Supprimer tous les utilisateurs sauf l'admin
  // → les dossiers liés par user_id seront supprimés en cascade
  const deleted = await db
    .delete(users)
    .where(ne(users.email, ADMIN_EMAIL))
    .returning({ email: users.email });

  console.log(`\n✅ ${deleted.length} utilisateur(s) supprimé(s) :`);
  for (const u of deleted) console.log(`  - ${u.email}`);

  // Vérification finale
  const remaining = await db.select({ email: users.email, role: users.role }).from(users);
  console.log("\n📋 Utilisateurs restants :");
  for (const u of remaining) console.log(`  ✓ ${u.email} (${u.role})`);

  console.log("\n✅ Nettoyage terminé.");
}

cleanup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Erreur :", err);
    process.exit(1);
  });
