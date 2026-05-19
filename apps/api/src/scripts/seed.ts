import "dotenv/config";
import { db } from "../db.js";
import { users, communes, zones, zone_regulatory_rules, dossiers, dossier_messages } from "@heureka-v1/db";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

async function upsertCommune(values: { name: string; insee_code: string; zip_code: string }) {
  const [row] = await db.insert(communes).values(values)
    .onConflictDoUpdate({ target: communes.insee_code, set: { name: values.name, zip_code: values.zip_code } })
    .returning();
  return row!;
}

async function upsertUser(values: { email: string; password_hash: string; prenom: string; nom: string; role: "admin" | "mairie" | "instructeur" | "citoyen"; commune?: string }) {
  const [row] = await db.insert(users).values(values)
    .onConflictDoUpdate({ target: users.email, set: { prenom: values.prenom, nom: values.nom, role: values.role, commune: values.commune ?? null } })
    .returning();
  return row!;
}

async function upsertDossier(values: Parameters<typeof db.insert>[0] extends (table: infer T) => any ? never : any) {
  const [row] = await db.insert(dossiers).values(values)
    .onConflictDoUpdate({ target: dossiers.numero, set: { adresse: values.adresse, commune: values.commune, code_postal: values.code_postal, status: values.status, metadata: values.metadata } })
    .returning();
  return row!;
}

async function seed() {
  console.log("🌱 Seeding HEUREKA V1 database...\n");

  // ── Communes ──
  const communeTours = await upsertCommune({ name: "Tours", insee_code: "37261", zip_code: "37000" });
  console.log(`✅ Commune: ${communeTours.name}`);

  const communeRochecorbon = await upsertCommune({ name: "Rochecorbon", insee_code: "37203", zip_code: "37210" });
  console.log(`✅ Commune: ${communeRochecorbon.name}`);

  // ── Users ──
  const pw = await bcrypt.hash("password123", 10);
  const adminPw = await bcrypt.hash("admin123", 10);

  const admin = await upsertUser({ email: "admin@heureka.fr", password_hash: adminPw, prenom: "Admin", nom: "Heureka", role: "admin" });
  console.log(`✅ Admin: ${admin.email}`);

  const mairie = await upsertUser({ email: "mairie@tours.fr", password_hash: pw, prenom: "Sophie", nom: "Martin", role: "mairie", commune: "Tours" });
  console.log(`✅ Mairie: ${mairie.email}`);

  const instructeur = await upsertUser({ email: "instructeur@tours.fr", password_hash: pw, prenom: "Lucas", nom: "Petit", role: "instructeur", commune: "Tours" });
  console.log(`✅ Instructeur: ${instructeur.email}`);

  const citoyen = await upsertUser({ email: "citoyen@test.fr", password_hash: pw, prenom: "Marie", nom: "Dupont", role: "citoyen", commune: "Tours" });
  console.log(`✅ Citoyen: ${citoyen.email}`);

  // ── Zones PLU (skip si déjà présentes) ──
  const existingZones = await db.select().from(zones).where(eq(zones.commune_id, communeTours.id));
  const zoneRecords: typeof existingZones = [];

  if (existingZones.length === 0) {
    const zoneDefs = [
      { code: "UA", label: "Zone UA - Centre ancien", type: "urbaine", parent: null },
      { code: "UB", label: "Zone UB - Extension centre", type: "urbaine", parent: "U" },
      { code: "UC", label: "Zone UC - Pavillonnaire", type: "urbaine", parent: "U" },
      { code: "N", label: "Zone N - Naturelle", type: "naturelle", parent: null },
      { code: "A", label: "Zone A - Agricole", type: "agricole", parent: null },
      { code: "1AU", label: "Zone 1AU - À urbaniser", type: "a_urbaniser", parent: "AU" },
      { code: "2AU", label: "Zone 2AU - Future urbanisation", type: "a_urbaniser", parent: "AU" },
    ];

    for (const z of zoneDefs) {
      const [record] = await db.insert(zones).values({
        commune_id: communeTours.id, zone_code: z.code, zone_label: z.label,
        zone_type: z.type, parent_zone_code: z.parent, is_active: true, status: "valide",
      }).returning();
      zoneRecords.push(record!);
      console.log(`✅ Zone: ${z.code} - ${z.label}`);
    }

    const ruleSets: Record<string, Array<{ article: number; title: string; topic: string; text: string; value_exact?: number; unit?: string; value_min?: number; value_max?: number }>> = {
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
      const zoneRecord = zoneRecords.find(z => z.zone_code === zoneCode);
      if (!zoneRecord) continue;
      for (const rule of rules) {
        await db.insert(zone_regulatory_rules).values({
          zone_id: zoneRecord.id, article_number: rule.article, article_title: rule.title,
          topic: rule.topic, rule_text: rule.text, value_exact: rule.value_exact ?? null,
          value_min: rule.value_min ?? null, value_max: rule.value_max ?? null,
          unit: rule.unit ?? null, validation_status: "valide",
        });
      }
      console.log(`  📋 ${rules.length} règles pour ${zoneCode}`);
    }
  } else {
    console.log(`⏭️  Zones PLU déjà présentes (${existingZones.length}), skip`);
    zoneRecords.push(...existingZones);
  }

  // ── Dossiers de test Tours ──
  const dossier1 = await upsertDossier({
    numero: "PC-2024-001", type: "permis_de_construire", status: "en_instruction",
    user_id: citoyen.id, instructeur_id: instructeur.id, parcelle: "AB 123",
    adresse: "12 Rue Nationale, Tours", commune: "Tours", code_postal: "37000",
    description: "Construction d'une maison individuelle de 120m²", surface_plancher: "120",
    date_depot: new Date("2024-01-15"), date_limite_instruction: new Date("2024-03-15"), metadata: {},
  });
  console.log(`✅ Dossier: ${dossier1.numero}`);

  await upsertDossier({
    numero: "DP-2024-042", type: "declaration_prealable", status: "soumis",
    user_id: citoyen.id, parcelle: "CD 456", adresse: "5 Avenue de la République, Tours",
    commune: "Tours", code_postal: "37000", description: "Extension de 30m² et modification de façade",
    surface_plancher: "30", date_depot: new Date("2024-02-20"), metadata: {},
  });

  await upsertDossier({
    numero: "PC-2024-003", type: "permis_de_construire", status: "accepte",
    user_id: citoyen.id, instructeur_id: mairie.id, parcelle: "EF 789",
    adresse: "8 Boulevard Tonnellé, Tours", commune: "Tours", code_postal: "37000",
    description: "Construction d'un garage et d'un abri de jardin", surface_plancher: "45",
    date_depot: new Date("2023-11-01"), date_limite_instruction: new Date("2024-01-01"), metadata: {},
  });

  // ── Commune Ballan-Miré ──
  const communeBM = await upsertCommune({ name: "Ballan-Miré", insee_code: "37015", zip_code: "37510" });
  console.log(`✅ Commune: ${communeBM.name}`);

  const mairieBM = await upsertUser({ email: "mairie@ballan-mire.fr", password_hash: pw, prenom: "Marie", nom: "Lambert", role: "mairie", commune: "Ballan-Miré" });
  console.log(`✅ Mairie BM: ${mairieBM.email}`);

  const instructeurBM = await upsertUser({ email: "instructeur@ballan-mire.fr", password_hash: pw, prenom: "Pierre", nom: "Durand", role: "instructeur", commune: "Ballan-Miré" });
  console.log(`✅ Instructeur BM: ${instructeurBM.email}`);

  const citoyenBM1 = await upsertUser({ email: "jean.dupont@email.fr", password_hash: pw, prenom: "Jean", nom: "Dupont", role: "citoyen", commune: "Ballan-Miré" });
  const citoyenBM2 = await upsertUser({ email: "sophie.martin@email.fr", password_hash: pw, prenom: "Sophie", nom: "Martin", role: "citoyen", commune: "Ballan-Miré" });

  // Dossiers Ballan-Miré — coordonnées géocodées au premier appel /map-dossiers
  const dossiersBM = [
    { numero: "PC-BM-2024-001", type: "permis_de_construire" as const, status: "en_instruction" as const, user_id: citoyenBM1.id, instructeur_id: instructeurBM.id, parcelle: "BM 001", adresse: "12 Place du 11-Novembre", commune: "Ballan-Miré", code_postal: "37510", description: "Construction d'une maison individuelle R+1, 145 m², avec garage", surface_plancher: "145", date_depot: new Date("2024-02-10"), date_limite_instruction: new Date("2024-08-10"), metadata: {} },
    { numero: "DP-BM-2024-015", type: "declaration_prealable" as const, status: "soumis" as const, user_id: citoyenBM2.id, parcelle: "BM 015", adresse: "9 Avenue Jean Mermoz", commune: "Ballan-Miré", code_postal: "37510", description: "Extension de 28 m² et création d'une véranda sur maison existante", surface_plancher: "28", date_depot: new Date("2024-04-05"), metadata: {} },
    { numero: "PC-BM-2024-022", type: "permis_de_construire" as const, status: "en_instruction" as const, user_id: citoyenBM1.id, instructeur_id: instructeurBM.id, parcelle: "BM 022", adresse: "2 Avenue de l'Orée-des-Bois", commune: "Ballan-Miré", code_postal: "37510", description: "Construction d'un immeuble collectif R+2 — 6 logements, 320 m²", surface_plancher: "320", date_depot: new Date("2024-03-18"), date_limite_instruction: new Date("2024-09-18"), metadata: {} },
    { numero: "DP-BM-2024-008", type: "declaration_prealable" as const, status: "incomplet" as const, user_id: citoyenBM2.id, parcelle: "BM 008", adresse: "9 Rue Jean Mermoz", commune: "Ballan-Miré", code_postal: "37510", description: "Création d'une piscine hors-sol et modification de clôture", surface_plancher: "40", date_depot: new Date("2024-01-22"), metadata: {} },
    { numero: "PC-BM-2023-044", type: "permis_de_construire" as const, status: "accepte" as const, user_id: citoyenBM1.id, instructeur_id: mairieBM.id, parcelle: "BM 044", adresse: "Avenue Jean Mermoz", commune: "Ballan-Miré", code_postal: "37510", description: "Construction d'un garage double et aménagement de l'entrée", surface_plancher: "60", date_depot: new Date("2023-10-08"), date_completude: new Date("2023-11-01"), date_limite_instruction: new Date("2024-02-08"), metadata: {} },
    { numero: "DP-BM-2024-033", type: "declaration_prealable" as const, status: "decision_en_cours" as const, user_id: citoyenBM2.id, instructeur_id: instructeurBM.id, parcelle: "BM 033", adresse: "Place du 11-Novembre", commune: "Ballan-Miré", code_postal: "37510", description: "Ravalement de façade, installation de panneaux photovoltaïques", surface_plancher: "20", date_depot: new Date("2024-03-02"), date_completude: new Date("2024-03-20"), metadata: {} },
    { numero: "CU-BM-2024-007", type: "certificat_urbanisme" as const, status: "soumis" as const, user_id: citoyenBM1.id, parcelle: "BM 007", adresse: "Rue de la Houssaye", commune: "Ballan-Miré", code_postal: "37510", description: "Certificat d'urbanisme opérationnel — viabilité d'un projet de lotissement", surface_plancher: "0", date_depot: new Date("2024-04-15"), metadata: {} },
    { numero: "PC-BM-2024-041", type: "permis_de_construire" as const, status: "refuse" as const, user_id: citoyenBM2.id, instructeur_id: instructeurBM.id, parcelle: "BM 041", adresse: "Rue du Commerce", commune: "Ballan-Miré", code_postal: "37510", description: "Construction maison individuelle — non conforme PLU zone N", surface_plancher: "100", date_depot: new Date("2024-01-30"), date_completude: new Date("2024-02-15"), date_limite_instruction: new Date("2024-07-30"), metadata: {} },
    { numero: "DP-BM-2024-019", type: "declaration_prealable" as const, status: "pre_instruction" as const, user_id: citoyenBM1.id, parcelle: "BM 019", adresse: "Rue du Val de l'Indre", commune: "Ballan-Miré", code_postal: "37510", description: "Division parcellaire et création d'un accès indépendant", surface_plancher: "15", date_depot: new Date("2024-04-20"), metadata: {} },
  ];

  for (const d of dossiersBM) {
    const row = await upsertDossier(d);
    console.log(`✅ Dossier BM: ${row.numero} (${d.adresse})`);
  }

  // ── Messages (skip si dossier1 a déjà des messages) ──
  const existingMessages = await db.select().from(dossier_messages).where(eq(dossier_messages.dossier_id, dossier1.id));
  if (existingMessages.length === 0) {
    await db.insert(dossier_messages).values({ dossier_id: dossier1.id, from_user_id: citoyen.id, from_role: "citoyen", content: "Bonjour, je souhaiterais savoir où en est l'instruction de mon dossier. Merci." });
    await db.insert(dossier_messages).values({ dossier_id: dossier1.id, from_user_id: instructeur.id, from_role: "instructeur", content: "Bonjour, votre dossier est en cours d'instruction. Nous attendons l'avis de l'architecte des Bâtiments de France. Nous reviendrons vers vous sous quinze jours." });
  }

  console.log("\n✅✅✅ Seed terminé !");
  console.log("\n📧 Identifiants de test :");
  console.log("  Admin           : admin@heureka.fr / admin123");
  console.log("  Mairie Tours    : mairie@tours.fr / password123");
  console.log("  Instructeur Trs : instructeur@tours.fr / password123");
  console.log("  Citoyen         : citoyen@test.fr / password123");
  console.log("  Mairie BM       : mairie@ballan-mire.fr / password123");
  console.log("  Instructeur BM  : instructeur@ballan-mire.fr / password123");
}

export { seed };

if (process.argv[1]?.includes("seed")) {
  seed().catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  });
}
