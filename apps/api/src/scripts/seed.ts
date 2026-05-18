import "dotenv/config";
import { db } from "../db.js";
import { users, communes, zones, zone_regulatory_rules, dossiers, dossier_messages } from "@heureka-v1/db";
import bcrypt from "bcryptjs";

async function seed() {
  console.log("🌱 Seeding HEUREKA V1 database...\n");

  // ── Communes ──
  const communeTours_rows = await db.insert(communes).values({
    name: "Tours",
    insee_code: "37261",
    zip_code: "37000",
  }).returning(); const communeTours = communeTours_rows[0]!;
  console.log(`✅ Commune: ${communeTours.name}`);

  const communeRochecorbon_rows = await db.insert(communes).values({
    name: "Rochecorbon",
    insee_code: "37203",
    zip_code: "37210",
  }).returning(); const communeRochecorbon = communeRochecorbon_rows[0]!;
  console.log(`✅ Commune: ${communeRochecorbon.name}`);

  // ── Users ──
  const pw = await bcrypt.hash("password123", 10);
  const adminPw = await bcrypt.hash("admin123", 10);

  const admin_rows = await db.insert(users).values({
    email: "admin@heureka.fr", password_hash: adminPw,
    prenom: "Admin", nom: "Heureka", role: "admin",
  }).returning(); const admin = admin_rows[0]!;
  console.log(`✅ Admin: ${admin.email}`);

  const mairie_rows = await db.insert(users).values({
    email: "mairie@tours.fr", password_hash: pw,
    prenom: "Sophie", nom: "Martin", role: "mairie",
    commune: "Tours",
  }).returning(); const mairie = mairie_rows[0]!;
  console.log(`✅ Mairie: ${mairie.email}`);

  const instructeur_rows = await db.insert(users).values({
    email: "instructeur@tours.fr", password_hash: pw,
    prenom: "Lucas", nom: "Petit", role: "instructeur",
    commune: "Tours",
  }).returning(); const instructeur = instructeur_rows[0]!;
  console.log(`✅ Instructeur: ${instructeur.email}`);

  const citoyen_rows = await db.insert(users).values({
    email: "citoyen@test.fr", password_hash: pw,
    prenom: "Marie", nom: "Dupont", role: "citoyen",
    commune: "Tours",
  }).returning(); const citoyen = citoyen_rows[0]!;
  console.log(`✅ Citoyen: ${citoyen.email}`);

  // ── Zones PLU ──
  const zoneDefs = [
    { code: "UA", label: "Zone UA - Centre ancien", type: "urbaine", parent: null },
    { code: "UB", label: "Zone UB - Extension centre", type: "urbaine", parent: "U" },
    { code: "UC", label: "Zone UC - Pavillonnaire", type: "urbaine", parent: "U" },
    { code: "N", label: "Zone N - Naturelle", type: "naturelle", parent: null },
    { code: "A", label: "Zone A - Agricole", type: "agricole", parent: null },
    { code: "1AU", label: "Zone 1AU - À urbaniser", type: "a_urbaniser", parent: "AU" },
    { code: "2AU", label: "Zone 2AU - Future urbanisation", type: "a_urbaniser", parent: "AU" },
  ];

  const zoneRecords: any[] = [];
  for (const z of zoneDefs) {
    const record_rows = await db.insert(zones).values({
      commune_id: communeTours.id,
      zone_code: z.code,
      zone_label: z.label,
      zone_type: z.type,
      parent_zone_code: z.parent,
      is_active: true,
      status: "valide",
    }).returning(); const record = record_rows[0]!;
    zoneRecords.push(record);
    console.log(`✅ Zone: ${z.code} - ${z.label}`);
  }

  // ── Règles PLU ──
  const ruleSets: Record<string, Array<{
    article: number; title: string; topic: string;
    text: string; value_exact?: number; unit?: string;
    value_min?: number; value_max?: number;
  }>> = {
    UA: [
      { article: 6, title: "Implantation par rapport aux voies", topic: "recul_voie", text: "Les constructions doivent être implantées à l'alignement des voies.", value_exact: 0, unit: "m" },
      { article: 7, title: "Implantation par rapport aux limites séparatives", topic: "recul_limite", text: "Distance minimale de 4 mètres par rapport aux limites séparatives.", value_min: 4, unit: "m" },
      { article: 9, title: "Emprise au sol", topic: "emprise_sol", text: "L'emprise au sol ne doit pas excéder 60% de la superficie du terrain.", value_exact: 60, unit: "%" },
      { article: 10, title: "Hauteur maximale", topic: "hauteur", text: "La hauteur maximale des constructions est fixée à 12 mètres au faîtage.", value_exact: 12, unit: "m" },
      { article: 12, title: "Stationnement", topic: "stationnement", text: "2 places de stationnement par logement doivent être réalisées.", unit: "places" },
      { article: 13, title: "Espaces verts", topic: "espaces_verts", text: "25% minimum de la superficie du terrain doit être traité en espaces verts.", value_exact: 25, unit: "%" },
    ],
    UB: [
      { article: 6, title: "Recul par rapport aux voies", topic: "recul_voie", text: "Recul minimum de 5 mètres par rapport à l'axe des voies.", value_min: 5, unit: "m" },
      { article: 7, title: "Recul limites séparatives", topic: "recul_limite", text: "Distance minimale de 3 mètres par rapport aux limites séparatives.", value_min: 3, unit: "m" },
      { article: 9, title: "Emprise au sol", topic: "emprise_sol", text: "L'emprise au sol ne doit pas excéder 40% de la superficie du terrain.", value_exact: 40, unit: "%" },
      { article: 10, title: "Hauteur maximale", topic: "hauteur", text: "La hauteur maximale des constructions est fixée à 9 mètres au faîtage.", value_exact: 9, unit: "m" },
      { article: 12, title: "Stationnement", topic: "stationnement", text: "1 place de stationnement par logement.", unit: "places" },
      { article: 13, title: "Espaces verts", topic: "espaces_verts", text: "30% minimum de la superficie du terrain en espaces verts.", value_exact: 30, unit: "%" },
    ],
    UC: [
      { article: 6, title: "Recul par rapport aux voies", topic: "recul_voie", text: "Recul minimum de 8 mètres par rapport à l'axe des voies.", value_min: 8, unit: "m" },
      { article: 7, title: "Recul limites séparatives", topic: "recul_limite", text: "Distance minimale de 4 mètres par rapport aux limites séparatives.", value_min: 4, unit: "m" },
      { article: 9, title: "Emprise au sol", topic: "emprise_sol", text: "L'emprise au sol ne doit pas excéder 30% de la superficie du terrain.", value_exact: 30, unit: "%" },
      { article: 10, title: "Hauteur maximale", topic: "hauteur", text: "La hauteur maximale des constructions est fixée à 7 mètres au faîtage.", value_exact: 7, unit: "m" },
      { article: 12, title: "Stationnement", topic: "stationnement", text: "2 places de stationnement par logement.", unit: "places" },
      { article: 13, title: "Espaces verts", topic: "espaces_verts", text: "40% minimum de la superficie du terrain en espaces verts.", value_exact: 40, unit: "%" },
    ],
    N: [
      { article: 1, title: "Interdictions", topic: "interdictions", text: "Toute construction nouvelle est interdite, à l'exception des extensions limitées des constructions existantes." },
      { article: 9, title: "Emprise au sol", topic: "emprise_sol", text: "L'emprise au sol des extensions ne doit pas excéder 20% de la superficie du terrain.", value_exact: 20, unit: "%" },
      { article: 10, title: "Hauteur maximale", topic: "hauteur", text: "Hauteur maximale de 6 mètres pour les extensions.", value_exact: 6, unit: "m" },
    ],
    A: [
      { article: 1, title: "Interdictions", topic: "interdictions", text: "Seules les constructions nécessaires à l'exploitation agricole sont autorisées." },
      { article: 10, title: "Hauteur maximale", topic: "hauteur", text: "Hauteur maximale de 10 mètres pour les bâtiments agricoles.", value_exact: 10, unit: "m" },
    ],
    "1AU": [
      { article: 6, title: "Recul par rapport aux voies", topic: "recul_voie", text: "Recul minimum de 6 mètres par rapport aux voies.", value_min: 6, unit: "m" },
      { article: 9, title: "Emprise au sol", topic: "emprise_sol", text: "L'emprise au sol ne doit pas excéder 50% de la superficie du terrain.", value_exact: 50, unit: "%" },
      { article: 10, title: "Hauteur maximale", topic: "hauteur", text: "Hauteur maximale de 10 mètres au faîtage.", value_exact: 10, unit: "m" },
      { article: 12, title: "Stationnement", topic: "stationnement", text: "2 places de stationnement par logement.", unit: "places" },
    ],
    "2AU": [
      { article: 1, title: "Interdictions", topic: "interdictions", text: "Toute construction est interdite jusqu'à l'ouverture à l'urbanisation de la zone." },
    ],
  };

  for (const [zoneCode, rules] of Object.entries(ruleSets)) {
    const zoneRecord = zoneRecords.find((z: any) => z.zone_code === zoneCode);
    if (!zoneRecord) continue;
    for (const rule of rules) {
      await db.insert(zone_regulatory_rules).values({
        zone_id: zoneRecord.id,
        article_number: rule.article,
        article_title: rule.title,
        topic: rule.topic,
        rule_text: rule.text,
        value_exact: rule.value_exact ?? null,
        value_min: rule.value_min ?? null,
        value_max: rule.value_max ?? null,
        unit: rule.unit ?? null,
        validation_status: "valide",
      }).returning();
    }
    console.log(`  📋 ${rules.length} règles pour ${zoneCode}`);
  }

  // ── Dossiers de test ──
  const dossier1_rows = await db.insert(dossiers).values({
    numero: "PC-2024-001",
    type: "permis_de_construire",
    status: "en_instruction",
    user_id: citoyen.id,
    instructeur_id: instructeur.id,
    parcelle: "AB 123",
    adresse: "12 Rue Nationale, Tours",
    commune: "Tours",
    code_postal: "37000",
    description: "Construction d'une maison individuelle de 120m²",
    surface_plancher: "120",
    date_depot: new Date("2024-01-15"),
    date_limite_instruction: new Date("2024-03-15"),
  }).returning(); const dossier1 = dossier1_rows[0]!;
  console.log(`✅ Dossier: ${dossier1.numero}`);

  const dossier2_rows = await db.insert(dossiers).values({
    numero: "DP-2024-042",
    type: "declaration_prealable",
    status: "soumis",
    user_id: citoyen.id,
    parcelle: "CD 456",
    adresse: "5 Avenue de la République, Tours",
    commune: "Tours",
    code_postal: "37000",
    description: "Extension de 30m² et modification de façade",
    surface_plancher: "30",
    date_depot: new Date("2024-02-20"),
  }).returning(); const dossier2 = dossier2_rows[0]!;
  console.log(`✅ Dossier: ${dossier2.numero}`);

  const dossier3_rows = await db.insert(dossiers).values({
    numero: "PC-2024-003",
    type: "permis_de_construire",
    status: "accepte",
    user_id: citoyen.id,
    instructeur_id: mairie.id,
    parcelle: "EF 789",
    adresse: "8 Boulevard Tonnellé, Tours",
    commune: "Tours",
    code_postal: "37000",
    description: "Construction d'un garage et d'un abri de jardin",
    surface_plancher: "45",
    date_depot: new Date("2023-11-01"),
    date_limite_instruction: new Date("2024-01-01"),
  }).returning(); const dossier3 = dossier3_rows[0]!;
  console.log(`✅ Dossier: ${dossier3.numero}`);

  // ── Messages ──
  await db.insert(dossier_messages).values({
    dossier_id: dossier1.id,
    from_user_id: citoyen.id,
    from_role: "citoyen",
    content: "Bonjour, je souhaiterais savoir où en est l'instruction de mon dossier. Merci.",
  });

  await db.insert(dossier_messages).values({
    dossier_id: dossier1.id,
    from_user_id: instructeur.id,
    from_role: "instructeur",
    content: "Bonjour, votre dossier est en cours d'instruction. Nous attendons l'avis de l'architecte des Bâtiments de France. Nous reviendrons vers vous sous quinze jours.",
  });

  console.log("\n✅✅✅ Seed terminé !");
  console.log("\n📧 Identifiants de test :");
  console.log("  Admin      : admin@heureka.fr / admin123");
  console.log("  Mairie     : mairie@tours.fr / password123");
  console.log("  Instructeur: instructeur@tours.fr / password123");
  console.log("  Citoyen    : citoyen@test.fr / password123");
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
