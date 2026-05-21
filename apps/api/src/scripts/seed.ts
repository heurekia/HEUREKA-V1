import "dotenv/config";
import { db } from "../db.js";
import { users, communes, zones, zone_regulatory_rules, dossiers, dossier_messages } from "@heureka-v1/db";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";

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
    .onConflictDoUpdate({
      target: dossiers.numero,
      set: {
        adresse: values.adresse, commune: values.commune, code_postal: values.code_postal,
        status: values.status, metadata: values.metadata,
        date_depot: values.date_depot, date_completude: values.date_completude,
        date_limite_instruction: values.date_limite_instruction,
      },
    })
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

  // ── Dossiers de test Tours — dépôts mai 2026, échéances à venir ──
  // PC : +2 mois | DP : +1 mois | PA/PL : +3 mois | PD : +2 mois | CU : +2 mois
  const dossier1 = await upsertDossier({
    numero: "PC-2024-001", type: "permis_de_construire", status: "en_instruction",
    user_id: citoyen.id, instructeur_id: instructeur.id, parcelle: "AB 123",
    adresse: "12 Rue Nationale, Tours", commune: "Tours", code_postal: "37000",
    description: "Construction d'une maison individuelle de 120m²", surface_plancher: "120",
    date_depot: new Date("2026-05-05"),
    date_completude: new Date("2026-05-09"),
    date_limite_instruction: new Date("2026-07-05"), // +2 mois PC
    metadata: {},
  });
  console.log(`✅ Dossier: ${dossier1.numero}`);

  await upsertDossier({
    numero: "DP-2024-042", type: "declaration_prealable", status: "soumis",
    user_id: citoyen.id, parcelle: "CD 456", adresse: "5 Avenue de la République, Tours",
    commune: "Tours", code_postal: "37000", description: "Extension de 30m² et modification de façade",
    surface_plancher: "30",
    date_depot: new Date("2026-05-14"),
    date_limite_instruction: new Date("2026-06-14"), // +1 mois DP
    metadata: {},
  });

  await upsertDossier({
    numero: "PC-2024-003", type: "permis_de_construire", status: "accepte",
    user_id: citoyen.id, instructeur_id: mairie.id, parcelle: "EF 789",
    adresse: "8 Boulevard Tonnellé, Tours", commune: "Tours", code_postal: "37000",
    description: "Construction d'un garage et d'un abri de jardin", surface_plancher: "45",
    date_depot: new Date("2026-05-02"),
    date_completude: new Date("2026-05-06"),
    date_limite_instruction: new Date("2026-07-02"), // +2 mois PC
    metadata: {},
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

  // Dossiers Ballan-Miré — dépôts mai 2026, échéances réparties juin–août 2026
  // PC : +2 mois | DP : +1 mois | CU : +2 mois
  const dossiersBM = [
    {
      numero: "PC-BM-2024-001", type: "permis_de_construire" as const, status: "en_instruction" as const,
      user_id: citoyenBM1.id, instructeur_id: instructeurBM.id, parcelle: "BM 001",
      adresse: "12 Place du 11-Novembre", commune: "Ballan-Miré", code_postal: "37510",
      description: "Construction d'une maison individuelle R+1, 145 m², avec garage",
      surface_plancher: "145",
      date_depot: new Date("2026-05-03"),
      date_completude: new Date("2026-05-08"),
      date_limite_instruction: new Date("2026-07-03"), // +2 mois PC
      metadata: {},
    },
    {
      numero: "DP-BM-2024-015", type: "declaration_prealable" as const, status: "soumis" as const,
      user_id: citoyenBM2.id, parcelle: "BM 015",
      adresse: "9 Avenue Jean Mermoz", commune: "Ballan-Miré", code_postal: "37510",
      description: "Extension de 28 m² et création d'une véranda sur maison existante",
      surface_plancher: "28",
      date_depot: new Date("2026-05-16"),
      date_limite_instruction: new Date("2026-06-16"), // +1 mois DP
      metadata: {},
    },
    {
      numero: "PC-BM-2024-022", type: "permis_de_construire" as const, status: "en_instruction" as const,
      user_id: citoyenBM1.id, instructeur_id: instructeurBM.id, parcelle: "BM 022",
      adresse: "2 Avenue de l'Orée-des-Bois", commune: "Ballan-Miré", code_postal: "37510",
      description: "Construction d'un immeuble collectif R+2 — 6 logements, 320 m²",
      surface_plancher: "320",
      date_depot: new Date("2026-05-07"),
      date_completude: new Date("2026-05-12"),
      date_limite_instruction: new Date("2026-07-07"), // +2 mois PC
      metadata: {},
    },
    {
      numero: "DP-BM-2024-008", type: "declaration_prealable" as const, status: "incomplet" as const,
      user_id: citoyenBM2.id, parcelle: "BM 008",
      adresse: "9 Rue Jean Mermoz", commune: "Ballan-Miré", code_postal: "37510",
      description: "Création d'une piscine hors-sol et modification de clôture",
      surface_plancher: "40",
      date_depot: new Date("2026-05-09"),
      date_limite_instruction: new Date("2026-06-09"), // +1 mois DP
      metadata: {},
    },
    {
      numero: "PC-BM-2023-044", type: "permis_de_construire" as const, status: "accepte" as const,
      user_id: citoyenBM1.id, instructeur_id: mairieBM.id, parcelle: "BM 044",
      adresse: "Avenue Jean Mermoz", commune: "Ballan-Miré", code_postal: "37510",
      description: "Construction d'un garage double et aménagement de l'entrée",
      surface_plancher: "60",
      date_depot: new Date("2026-05-01"),
      date_completude: new Date("2026-05-05"),
      date_limite_instruction: new Date("2026-07-01"), // +2 mois PC
      metadata: {},
    },
    {
      numero: "DP-BM-2024-033", type: "declaration_prealable" as const, status: "decision_en_cours" as const,
      user_id: citoyenBM2.id, instructeur_id: instructeurBM.id, parcelle: "BM 033",
      adresse: "Place du 11-Novembre", commune: "Ballan-Miré", code_postal: "37510",
      description: "Ravalement de façade, installation de panneaux photovoltaïques",
      surface_plancher: "20",
      date_depot: new Date("2026-05-08"),
      date_completude: new Date("2026-05-13"),
      date_limite_instruction: new Date("2026-06-08"), // +1 mois DP
      metadata: {},
    },
    {
      numero: "CU-BM-2024-007", type: "certificat_urbanisme" as const, status: "soumis" as const,
      user_id: citoyenBM1.id, parcelle: "BM 007",
      adresse: "Rue de la Houssaye", commune: "Ballan-Miré", code_postal: "37510",
      description: "Certificat d'urbanisme opérationnel — viabilité d'un projet de lotissement",
      surface_plancher: "0",
      date_depot: new Date("2026-05-19"),
      date_limite_instruction: new Date("2026-07-19"), // +2 mois CU
      metadata: {},
    },
    {
      numero: "PC-BM-2024-041", type: "permis_de_construire" as const, status: "refuse" as const,
      user_id: citoyenBM2.id, instructeur_id: instructeurBM.id, parcelle: "BM 041",
      adresse: "Rue du Commerce", commune: "Ballan-Miré", code_postal: "37510",
      description: "Construction maison individuelle — non conforme PLU zone N",
      surface_plancher: "100",
      date_depot: new Date("2026-05-04"),
      date_completude: new Date("2026-05-09"),
      date_limite_instruction: new Date("2026-07-04"), // +2 mois PC
      metadata: {},
    },
    {
      numero: "DP-BM-2024-019", type: "declaration_prealable" as const, status: "pre_instruction" as const,
      user_id: citoyenBM1.id, parcelle: "BM 019",
      adresse: "Rue du Val de l'Indre", commune: "Ballan-Miré", code_postal: "37510",
      description: "Division parcellaire et création d'un accès indépendant",
      surface_plancher: "15",
      date_depot: new Date("2026-05-20"),
      date_limite_instruction: new Date("2026-06-20"), // +1 mois DP
      metadata: {},
    },
  ];

  for (const d of dossiersBM) {
    const row = await upsertDossier(d);
    console.log(`✅ Dossier BM: ${row.numero} (${d.adresse})`);
  }

  // ── Messages Tours (skip si dossier1 a déjà des messages) ──
  const existingMessages = await db.select().from(dossier_messages).where(eq(dossier_messages.dossier_id, dossier1.id));
  if (existingMessages.length === 0) {
    await db.insert(dossier_messages).values({ dossier_id: dossier1.id, from_user_id: citoyen.id, from_role: "citoyen", content: "Bonjour, je souhaiterais savoir où en est l'instruction de mon dossier. Merci.", created_at: new Date("2026-05-09T09:15:00") });
    await db.insert(dossier_messages).values({ dossier_id: dossier1.id, from_user_id: instructeur.id, from_role: "instructeur", content: "Bonjour, votre dossier est en cours d'instruction. Nous attendons l'avis de l'architecte des Bâtiments de France. Nous reviendrons vers vous sous quinze jours.", created_at: new Date("2026-05-09T14:32:00") });
  }

  // ── Conversations Ballan-Miré ──
  const dossiersBMRows = await db.select().from(dossiers).where(sql`commune = 'Ballan-Miré'`);
  const bmMap = Object.fromEntries(dossiersBMRows.map(d => [d.numero, d]));
  const existingBMMessages = await db.select({ id: dossier_messages.id }).from(dossier_messages)
    .where(sql`dossier_id IN (SELECT id FROM dossiers WHERE commune = 'Ballan-Miré')`);

  if (existingBMMessages.length === 0) {
    // PC-BM-2024-001 — Jean Dupont : échange, dernier message du citoyen (non lu)
    const d001 = bmMap["PC-BM-2024-001"];
    if (d001) {
      await db.insert(dossier_messages).values([
        { dossier_id: d001.id, from_user_id: citoyenBM1.id, from_role: "citoyen", content: "Bonjour, pouvez-vous me donner des nouvelles de l'avancement de mon dossier PC-BM-2024-001 ? Merci.", created_at: new Date("2026-05-10T09:15:00") },
        { dossier_id: d001.id, from_user_id: instructeurBM.id, from_role: "instructeur", content: "Bonjour M. Dupont, votre dossier est en cours d'instruction. Nous attendons l'avis de l'Architecte des Bâtiments de France. Délai estimé : 3 semaines.", created_at: new Date("2026-05-10T14:32:00") },
        { dossier_id: d001.id, from_user_id: citoyenBM1.id, from_role: "citoyen", content: "Merci pour cette réponse. Est-ce que je dois fournir des documents supplémentaires de mon côté ?", created_at: new Date("2026-05-11T08:45:00") },
      ]);
    }

    // DP-BM-2024-015 — Sophie Martin : message sans réponse (non lu)
    const d015 = bmMap["DP-BM-2024-015"];
    if (d015) {
      await db.insert(dossier_messages).values([
        { dossier_id: d015.id, from_user_id: citoyenBM2.id, from_role: "citoyen", content: "Bonjour, j'ai déposé ma déclaration préalable pour une extension de 28 m². Pouvez-vous confirmer que toutes les pièces ont bien été reçues ?", created_at: new Date("2026-05-17T10:20:00") },
      ]);
    }

    // DP-BM-2024-008 — Sophie Martin : dossier incomplet, échange complet, dernier message instructeur (lu)
    const d008 = bmMap["DP-BM-2024-008"];
    if (d008) {
      await db.insert(dossier_messages).values([
        { dossier_id: d008.id, from_user_id: instructeurBM.id, from_role: "instructeur", content: "Bonjour Mme Martin, votre dossier DP-BM-2024-008 est incomplet. Il manque le plan de masse coté et la notice descriptive. Merci de les transmettre dans les meilleurs délais.", created_at: new Date("2026-05-12T11:00:00") },
        { dossier_id: d008.id, from_user_id: citoyenBM2.id, from_role: "citoyen", content: "Bonjour, voici les documents demandés en pièce jointe. J'espère que cela complète bien mon dossier.", created_at: new Date("2026-05-13T16:30:00") },
        { dossier_id: d008.id, from_user_id: instructeurBM.id, from_role: "instructeur", content: "Merci pour l'envoi. Nous procédons à la vérification et vous recontacterons si nécessaire.", created_at: new Date("2026-05-14T09:10:00") },
      ]);
    }

    // PC-BM-2024-022 — Jean Dupont : demande de mise à jour (non lu)
    const d022 = bmMap["PC-BM-2024-022"];
    if (d022) {
      await db.insert(dossier_messages).values([
        { dossier_id: d022.id, from_user_id: citoyenBM1.id, from_role: "citoyen", content: "Bonjour, je souhaitais connaître l'avancement du dossier pour mon immeuble collectif. Y a-t-il des points bloquants à ce stade ?", created_at: new Date("2026-05-15T15:00:00") },
      ]);
    }

    // DP-BM-2024-033 — Sophie Martin : échange sur délai, dernier message instructeur (lu)
    const d033 = bmMap["DP-BM-2024-033"];
    if (d033) {
      await db.insert(dossier_messages).values([
        { dossier_id: d033.id, from_user_id: citoyenBM2.id, from_role: "citoyen", content: "Bonjour, mon dossier est en décision depuis un moment. Pouvez-vous m'indiquer le délai prévu pour la réponse ?", created_at: new Date("2026-05-18T09:00:00") },
        { dossier_id: d033.id, from_user_id: instructeurBM.id, from_role: "instructeur", content: "Bonjour, la décision sera rendue dans les 5 jours ouvrés. Vous recevrez une notification par email dès qu'elle sera disponible.", created_at: new Date("2026-05-19T11:30:00") },
      ]);
    }

    console.log("✅ Conversations BM ajoutées");
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
