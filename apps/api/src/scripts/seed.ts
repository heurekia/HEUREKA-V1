import "dotenv/config";
import { db } from "../db.js";
import { users, communes, role_permissions } from "@heureka-v1/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

async function upsertCommune(values: { name: string; insee_code: string; zip_code: string }) {
  const [inserted] = await db.insert(communes).values(values)
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const [existing] = await db.select().from(communes).where(eq(communes.insee_code, values.insee_code));
  return existing!;
}

async function upsertUser(values: { email: string; password_hash: string; prenom: string; nom: string; role: "admin" | "mairie" | "instructeur" | "citoyen"; commune?: string }) {
  const [row] = await db.insert(users).values(values)
    .onConflictDoUpdate({ target: users.email, set: { password_hash: values.password_hash, prenom: values.prenom, nom: values.nom, role: values.role, commune: values.commune ?? null } })
    .returning();
  return row!;
}

async function seedRoles() {
  const systemRoles = [
    {
      name: "responsable_urbanisme",
      label: "Responsable urbanisme",
      base_role: "mairie",
      color: "#4F46E5",
      is_system: true,
      permissions: ["dashboard","dossiers.read","dossiers.instruct","dossiers.decision","messagerie","documents","calendrier","zones.read","zones.edit","stats","utilisateurs","parametres"],
      description: "Responsable du service urbanisme avec accès complet",
    },
    {
      name: "instructeur",
      label: "Instructeur",
      base_role: "instructeur",
      color: "#0891B2",
      is_system: true,
      permissions: ["dashboard","dossiers.read","dossiers.instruct","messagerie","documents","calendrier","zones.read","stats"],
      description: "Instructeur en charge de l'instruction des dossiers",
    },
    {
      name: "agent_administratif",
      label: "Agent administratif",
      base_role: "mairie",
      color: "#7C3AED",
      is_system: true,
      permissions: ["dashboard","dossiers.read","messagerie","documents","calendrier","stats"],
      description: "Agent administratif avec accès en lecture",
    },
  ];

  for (const r of systemRoles) {
    await db.insert(role_permissions).values(r).onConflictDoNothing();
    console.log(`✅ Role: ${r.label}`);
  }
}

async function seed() {
  console.log("🌱 Seeding HEUREKA V1 database...\n");

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("ADMIN_PASSWORD manquant dans les variables d'environnement");
  const pw = await bcrypt.hash(adminPassword, 10);

  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@heureka.fr";

  await seedRoles();

  const admin = await upsertUser({ email: adminEmail, password_hash: pw, prenom: "Evi", nom: "DELETANG", role: "admin" });
  console.log(`✅ Admin: ${admin.email}`);

  const communes_ref = [
    { name: "Tours",               insee_code: "37261", zip_code: "37000" },
    { name: "Ballan-Miré",         insee_code: "37018", zip_code: "37510" },
    { name: "Saint-Avertin",       insee_code: "37208", zip_code: "37550" },
    { name: "Joué-lès-Tours",      insee_code: "37122", zip_code: "37300" },
    { name: "La Riche",            insee_code: "37195", zip_code: "37520" },
    { name: "Rochecorbon",         insee_code: "37203", zip_code: "37210" },
    { name: "Saint-Cyr-sur-Loire", insee_code: "37214", zip_code: "37540" },
  ];
  for (const c of communes_ref) await upsertCommune(c);
  console.log(`✅ ${communes_ref.length} communes insérées`);

  console.log("\n✅✅✅ Seed terminé !");
  console.log("\n📧 Compte administrateur :");
  console.log(`  ${adminEmail} / (mot de passe défini via ADMIN_PASSWORD)`);
}

export { seed };

if (process.argv[1]?.includes("seed")) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ Seed failed:", err);
      process.exit(1);
    });
}
