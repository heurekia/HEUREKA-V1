import "dotenv/config";
import { db } from "../db.js";
import { users, communes, zones, zone_regulatory_rules, dossiers, dossier_messages } from "@heureka-v1/db";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";

async function upsertCommune(values: { name: string; insee_code: string; zip_code: string }) {
  // Remove any stale row with the same name but a different (wrong) INSEE code before upserting
  await db.delete(communes).where(sql`name = ${values.name} AND insee_code != ${values.insee_code}`);
  const [row] = await db.insert(communes).values(values)
    .onConflictDoUpdate({ target: communes.insee_code, set: { name: values.name, zip_code: values.zip_code } })
    .returning();
  return row!;
}

async function upsertUser(values: { email: string; password_hash: string; prenom: string; nom: string; role: "admin" | "mairie" | "instructeur" | "citoyen"; commune?: string }) {
  const [row] = await db.insert(users).values(values)
    .onConflictDoUpdate({ target: users.email, set: { password_hash: values.password_hash, prenom: values.prenom, nom: values.nom, role: values.role, commune: values.commune ?? null } })
    .returning();
  return row!;
}

async function upsertDossier(values: Parameters<typeof db.insert>[0] extends (table: infer T) => any ? never : any) {
  const [row] = await db.insert(dossiers).values(values)
    .onConflictDoUpdate({
      target: dossiers.numero,
      set: {
        adresse: values.adresse, commune: values.commune, code_postal: values.code_postal,
        status: values.status, metadata: {},
        date_depot: values.date_depot, date_completude: values.date_completude,
        date_limite_instruction: values.date_limite_instruction,
      },
    })
    .returning();
  return row!;
}

async function insertMessagesIfNone(dossierId: string, messages: Array<{ from_user_id: string; from_role: string; content: string; created_at: Date }>) {
  const [existing] = await db.select({ id: dossier_messages.id }).from(dossier_messages)
    .where(eq(dossier_messages.dossier_id, dossierId)).limit(1);
  if (!existing) {
    await db.insert(dossier_messages).values(messages.map(m => ({ ...m, dossier_id: dossierId })));
  }
}

async function seed() {
  console.log("🌱 Seeding HEUREKA V1 database...\n");

  const pw = await bcrypt.hash("Heureka2024!", 10);

  // ── Admin ──
  const admin = await upsertUser({ email: "admin@heureka.fr", password_hash: pw, prenom: "Admin", nom: "Heureka", role: "admin" });
  console.log(`✅ Admin: ${admin.email}`);

  // ════════════════════════════════════════════════════════════
  // TOURS
  // ════════════════════════════════════════════════════════════
  const communeTours = await upsertCommune({ name: "Tours", insee_code: "37261", zip_code: "37000" });
  console.log(`✅ Commune: ${communeTours.name}`);

  const mairieTR    = await upsertUser({ email: "mairie@tours.fr",        password_hash: pw, prenom: "Sophie",   nom: "Martin",   role: "admin",       commune: "Tours" });
  const instructeurTR = await upsertUser({ email: "instructeur@tours.fr", password_hash: pw, prenom: "Lucas",    nom: "Petit",    role: "instructeur", commune: "Tours" });
  const instr2TR    = await upsertUser({ email: "instructeur2@tours.fr",  password_hash: pw, prenom: "Isabelle", nom: "Morin",    role: "instructeur", commune: "Tours" });
  const citoyenTR1  = await upsertUser({ email: "citoyen@test.fr",        password_hash: pw, prenom: "Marie",    nom: "Dupont",   role: "citoyen",     commune: "Tours" });
  const citoyenTR2  = await upsertUser({ email: "paul.bernard@email.fr",  password_hash: pw, prenom: "Paul",     nom: "Bernard",  role: "citoyen",     commune: "Tours" });
  const citoyenTR3  = await upsertUser({ email: "claire.rousseau@email.fr", password_hash: pw, prenom: "Claire", nom: "Rousseau", role: "citoyen",     commune: "Tours" });

  // ── Zones PLU Tours (skip si déjà présentes) ──
  const existingZonesTR = await db.select().from(zones).where(eq(zones.commune_id, communeTours.id));
  if (existingZonesTR.length === 0) {
    const zoneDefs = [
      { code: "UA", label: "Zone UA - Centre ancien", type: "urbaine", parent: null },
      { code: "UB", label: "Zone UB - Extension centre", type: "urbaine", parent: "U" },
      { code: "UC", label: "Zone UC - Pavillonnaire", type: "urbaine", parent: "U" },
      { code: "N",  label: "Zone N - Naturelle", type: "naturelle", parent: null },
      { code: "A",  label: "Zone A - Agricole", type: "agricole", parent: null },
      { code: "1AU", label: "Zone 1AU - À urbaniser", type: "a_urbaniser", parent: "AU" },
      { code: "2AU", label: "Zone 2AU - Future urbanisation", type: "a_urbaniser", parent: "AU" },
    ];
    for (const z of zoneDefs) {
      await db.insert(zones).values({ commune_id: communeTours.id, zone_code: z.code, zone_label: z.label, zone_type: z.type, parent_zone_code: z.parent, is_active: true, status: "valide" });
      console.log(`  ✅ Zone Tours: ${z.code}`);
    }
  }

  // ── Dossiers Tours ──
  const dTR001 = await upsertDossier({ numero: "PC-2024-001", type: "permis_de_construire",  status: "en_instruction",   user_id: citoyenTR1.id, instructeur_id: instructeurTR.id, parcelle: "AB 123", adresse: "12 Rue Nationale",                commune: "Tours", code_postal: "37000", description: "Construction d'une maison individuelle de 120 m²", surface_plancher: "120", date_depot: new Date("2026-05-05"), date_completude: new Date("2026-05-09"), date_limite_instruction: new Date("2026-07-05") });
  const dTR002 = await upsertDossier({ numero: "DP-2024-042", type: "declaration_prealable", status: "soumis",           user_id: citoyenTR1.id,                                   parcelle: "CD 456", adresse: "5 Avenue de la République",      commune: "Tours", code_postal: "37000", description: "Extension de 30 m² et modification de façade", surface_plancher: "30",  date_depot: new Date("2026-05-14"), date_limite_instruction: new Date("2026-06-14") });
  const dTR003 = await upsertDossier({ numero: "PC-2024-003", type: "permis_de_construire",  status: "accepte",          user_id: citoyenTR1.id, instructeur_id: mairieTR.id,      parcelle: "EF 789", adresse: "8 Boulevard Tonnellé",           commune: "Tours", code_postal: "37000", description: "Construction d'un garage et d'un abri de jardin", surface_plancher: "45", date_depot: new Date("2026-05-02"), date_completude: new Date("2026-05-06"), date_limite_instruction: new Date("2026-07-02") });
  const dTR004 = await upsertDossier({ numero: "PC-TR-2024-004", type: "permis_de_construire", status: "en_instruction", user_id: citoyenTR2.id, instructeur_id: instr2TR.id,      parcelle: "GH 012", adresse: "34 Rue des Halles",              commune: "Tours", code_postal: "37000", description: "Surélévation d'un immeuble R+2 en R+3, création de 4 logements", surface_plancher: "280", date_depot: new Date("2026-05-06"), date_completude: new Date("2026-05-12"), date_limite_instruction: new Date("2026-07-06") });
  const dTR005 = await upsertDossier({ numero: "DP-TR-2024-007", type: "declaration_prealable", status: "incomplet",    user_id: citoyenTR3.id,                                   parcelle: "IJ 345", adresse: "17 Rue de la Scellerie",         commune: "Tours", code_postal: "37000", description: "Remplacement des menuiseries et isolation par l'extérieur", surface_plancher: "15", date_depot: new Date("2026-05-11"), date_limite_instruction: new Date("2026-06-11") });
  const dTR006 = await upsertDossier({ numero: "PC-TR-2024-011", type: "permis_de_construire", status: "decision_en_cours", user_id: citoyenTR2.id, instructeur_id: instructeurTR.id, parcelle: "KL 678", adresse: "2 Rue Bernard Palissy",       commune: "Tours", code_postal: "37000", description: "Construction d'une résidence étudiante — 24 studios", surface_plancher: "540", date_depot: new Date("2026-05-03"), date_completude: new Date("2026-05-08"), date_limite_instruction: new Date("2026-07-03") });
  const dTR007 = await upsertDossier({ numero: "DP-TR-2024-019", type: "declaration_prealable", status: "pre_instruction", user_id: citoyenTR3.id,                                 parcelle: "MN 901", adresse: "45 Avenue Grammont",             commune: "Tours", code_postal: "37000", description: "Création d'une terrasse couverte et d'un auvent en façade", surface_plancher: "22", date_depot: new Date("2026-05-19"), date_limite_instruction: new Date("2026-06-19") });

  console.log("✅ Dossiers Tours insérés");

  // ── Messages Tours ──
  await insertMessagesIfNone(dTR001.id, [
    { from_user_id: citoyenTR1.id, from_role: "citoyen",     content: "Bonjour, je souhaiterais savoir où en est l'instruction de mon dossier PC-2024-001. Merci.",                               created_at: new Date("2026-05-09T09:15:00") },
    { from_user_id: instructeurTR.id, from_role: "instructeur", content: "Bonjour, votre dossier est en cours d'instruction. Nous attendons l'avis de l'Architecte des Bâtiments de France. Délai estimé : 15 jours.", created_at: new Date("2026-05-09T14:32:00") },
    { from_user_id: citoyenTR1.id, from_role: "citoyen",     content: "Je comprends, merci. Est-ce que je dois fournir des pièces complémentaires pour l'ABF ?",                                   created_at: new Date("2026-05-10T08:20:00") },
    { from_user_id: instructeurTR.id, from_role: "instructeur", content: "Non, votre dossier est complet. L'avis de l'ABF est en attente, nous vous informerons dès réception.",                   created_at: new Date("2026-05-10T11:05:00") },
  ]);

  await insertMessagesIfNone(dTR002.id, [
    { from_user_id: citoyenTR1.id, from_role: "citoyen",       content: "Bonjour, je viens de déposer ma déclaration préalable DP-2024-042. Pouvez-vous confirmer sa bonne réception ?",         created_at: new Date("2026-05-14T16:00:00") },
    { from_user_id: instr2TR.id,   from_role: "instructeur",   content: "Bonjour Mme Dupont, votre dossier a bien été reçu et enregistré. Nous vous contacterons si des pièces manquent.",        created_at: new Date("2026-05-15T09:30:00") },
  ]);

  await insertMessagesIfNone(dTR003.id, [
    { from_user_id: citoyenTR1.id, from_role: "citoyen",       content: "Bonjour, mon dossier PC-2024-003 a été accordé. Puis-je commencer les travaux immédiatement ?",                         created_at: new Date("2026-04-20T10:00:00") },
    { from_user_id: mairieTR.id,   from_role: "instructeur",   content: "Bonjour, oui votre permis est exécutoire. Pensez à afficher l'avis de permis de construire et à déclarer l'ouverture des travaux (DOC).", created_at: new Date("2026-04-20T14:15:00") },
    { from_user_id: citoyenTR1.id, from_role: "citoyen",       content: "Parfait, merci beaucoup pour cette confirmation. La DOC sera envoyée cette semaine.",                                    created_at: new Date("2026-04-21T08:45:00") },
  ]);

  await insertMessagesIfNone(dTR004.id, [
    { from_user_id: citoyenTR2.id, from_role: "citoyen",       content: "Bonjour, pouvez-vous m'indiquer l'état d'avancement du dossier PC-TR-2024-004 pour la surélévation de l'immeuble rue des Halles ?", created_at: new Date("2026-05-13T10:00:00") },
    { from_user_id: instr2TR.id,   from_role: "instructeur",   content: "Bonjour M. Bernard, votre dossier est en cours d'instruction. La consultation du SDIS est en attente.", created_at: new Date("2026-05-14T14:00:00") },
    { from_user_id: citoyenTR2.id, from_role: "citoyen",       content: "Merci. Quel est le délai habituel pour l'avis du SDIS ?", created_at: new Date("2026-05-15T09:30:00") },
  ]);

  await insertMessagesIfNone(dTR005.id, [
    { from_user_id: instr2TR.id,   from_role: "instructeur",   content: "Bonjour Mme Rousseau, votre dossier DP-TR-2024-007 est incomplet. Il manque la notice de couleurs et le devis des matériaux. Merci de les transmettre.", created_at: new Date("2026-05-14T09:00:00") },
    { from_user_id: citoyenTR3.id, from_role: "citoyen",       content: "Bonjour, je transmets les documents demandés aujourd'hui par email. Aurez-vous besoin d'autre chose ?", created_at: new Date("2026-05-14T17:30:00") },
    { from_user_id: instr2TR.id,   from_role: "instructeur",   content: "Bien reçu, merci. Nous intégrons les documents et relançons l'instruction.",                                             created_at: new Date("2026-05-15T10:00:00") },
  ]);

  await insertMessagesIfNone(dTR006.id, [
    { from_user_id: citoyenTR2.id, from_role: "citoyen",       content: "Bonjour, le dossier PC-TR-2024-011 est en décision depuis plusieurs jours. Avez-vous une estimation de la date de réponse ?", created_at: new Date("2026-05-17T11:00:00") },
    { from_user_id: instructeurTR.id, from_role: "instructeur", content: "Bonjour, la décision sera rendue sous 5 jours ouvrés. Vous serez notifié par email.",                                    created_at: new Date("2026-05-17T15:00:00") },
  ]);

  await insertMessagesIfNone(dTR007.id, [
    { from_user_id: citoyenTR3.id, from_role: "citoyen",       content: "Bonjour, j'ai déposé la déclaration préalable DP-TR-2024-019. Pouvez-vous confirmer que toutes les pièces sont bien présentes ?", created_at: new Date("2026-05-19T14:00:00") },
  ]);

  // ════════════════════════════════════════════════════════════
  // BALLAN-MIRÉ
  // ════════════════════════════════════════════════════════════
  const communeBM = await upsertCommune({ name: "Ballan-Miré", insee_code: "37018", zip_code: "37510" });
  console.log(`✅ Commune: ${communeBM.name}`);

  const mairieBM      = await upsertUser({ email: "mairie@ballan-mire.fr",      password_hash: pw, prenom: "Marie",   nom: "Lambert", role: "mairie",      commune: "Ballan-Miré" });
  const instructeurBM = await upsertUser({ email: "instructeur@ballan-mire.fr", password_hash: pw, prenom: "Pierre",  nom: "Durand",  role: "instructeur", commune: "Ballan-Miré" });
  const citoyenBM1    = await upsertUser({ email: "jean.dupont@email.fr",       password_hash: pw, prenom: "Jean",    nom: "Dupont",  role: "citoyen",     commune: "Ballan-Miré" });
  const citoyenBM2    = await upsertUser({ email: "sophie.martin@email.fr",     password_hash: pw, prenom: "Sophie",  nom: "Martin",  role: "citoyen",     commune: "Ballan-Miré" });

  const dossiersBMDef = [
    { numero: "PC-BM-2024-001", type: "permis_de_construire" as const,  status: "en_instruction" as const,   user_id: citoyenBM1.id, instructeur_id: instructeurBM.id, parcelle: "BM 001", adresse: "12 Place du 11-Novembre",   commune: "Ballan-Miré", code_postal: "37510", description: "Construction d'une maison individuelle R+1, 145 m², avec garage",           surface_plancher: "145", date_depot: new Date("2026-05-03"), date_completude: new Date("2026-05-08"), date_limite_instruction: new Date("2026-07-03") },
    { numero: "DP-BM-2024-015", type: "declaration_prealable" as const, status: "soumis" as const,           user_id: citoyenBM2.id,                                   parcelle: "BM 015", adresse: "9 Avenue Jean Mermoz",       commune: "Ballan-Miré", code_postal: "37510", description: "Extension de 28 m² et création d'une véranda sur maison existante",       surface_plancher: "28",  date_depot: new Date("2026-05-16"), date_limite_instruction: new Date("2026-06-16") },
    { numero: "PC-BM-2024-022", type: "permis_de_construire" as const,  status: "en_instruction" as const,   user_id: citoyenBM1.id, instructeur_id: instructeurBM.id, parcelle: "BM 022", adresse: "2 Avenue de l'Orée-des-Bois", commune: "Ballan-Miré", code_postal: "37510", description: "Construction d'un immeuble collectif R+2 — 6 logements, 320 m²",         surface_plancher: "320", date_depot: new Date("2026-05-07"), date_completude: new Date("2026-05-12"), date_limite_instruction: new Date("2026-07-07") },
    { numero: "DP-BM-2024-008", type: "declaration_prealable" as const, status: "incomplet" as const,        user_id: citoyenBM2.id,                                   parcelle: "BM 008", adresse: "9 Rue Jean Mermoz",          commune: "Ballan-Miré", code_postal: "37510", description: "Création d'une piscine hors-sol et modification de clôture",               surface_plancher: "40",  date_depot: new Date("2026-05-09"), date_limite_instruction: new Date("2026-06-09") },
    { numero: "PC-BM-2023-044", type: "permis_de_construire" as const,  status: "accepte" as const,          user_id: citoyenBM1.id, instructeur_id: mairieBM.id,       parcelle: "BM 044", adresse: "Avenue Jean Mermoz",         commune: "Ballan-Miré", code_postal: "37510", description: "Construction d'un garage double et aménagement de l'entrée",               surface_plancher: "60",  date_depot: new Date("2026-05-01"), date_completude: new Date("2026-05-05"), date_limite_instruction: new Date("2026-07-01") },
    { numero: "DP-BM-2024-033", type: "declaration_prealable" as const, status: "decision_en_cours" as const, user_id: citoyenBM2.id, instructeur_id: instructeurBM.id, parcelle: "BM 033", adresse: "Place du 11-Novembre",       commune: "Ballan-Miré", code_postal: "37510", description: "Ravalement de façade, installation de panneaux photovoltaïques",          surface_plancher: "20",  date_depot: new Date("2026-05-08"), date_completude: new Date("2026-05-13"), date_limite_instruction: new Date("2026-06-08") },
    { numero: "CU-BM-2024-007", type: "certificat_urbanisme" as const,  status: "soumis" as const,           user_id: citoyenBM1.id,                                   parcelle: "BM 007", adresse: "Rue de la Houssaye",         commune: "Ballan-Miré", code_postal: "37510", description: "Certificat d'urbanisme opérationnel — viabilité d'un projet de lotissement", surface_plancher: "0", date_depot: new Date("2026-05-19"), date_limite_instruction: new Date("2026-07-19") },
    { numero: "PC-BM-2024-041", type: "permis_de_construire" as const,  status: "refuse" as const,           user_id: citoyenBM2.id, instructeur_id: instructeurBM.id, parcelle: "BM 041", adresse: "Rue du Commerce",            commune: "Ballan-Miré", code_postal: "37510", description: "Construction maison individuelle — non conforme PLU zone N",               surface_plancher: "100", date_depot: new Date("2026-05-04"), date_completude: new Date("2026-05-09"), date_limite_instruction: new Date("2026-07-04") },
    { numero: "DP-BM-2024-019", type: "declaration_prealable" as const, status: "pre_instruction" as const,  user_id: citoyenBM1.id,                                   parcelle: "BM 019", adresse: "Rue du Val de l'Indre",      commune: "Ballan-Miré", code_postal: "37510", description: "Division parcellaire et création d'un accès indépendant",                 surface_plancher: "15",  date_depot: new Date("2026-05-20"), date_limite_instruction: new Date("2026-06-20") },
  ];

  const bmInserted: Record<string, { id: string }> = {};
  for (const d of dossiersBMDef) {
    const row = await upsertDossier(d);
    bmInserted[d.numero] = row;
    console.log(`✅ Dossier BM: ${row.numero}`);
  }

  await insertMessagesIfNone(bmInserted["PC-BM-2024-001"]!.id, [
    { from_user_id: citoyenBM1.id,    from_role: "citoyen",     content: "Bonjour, pouvez-vous me donner des nouvelles de l'avancement de mon dossier PC-BM-2024-001 ?", created_at: new Date("2026-05-10T09:15:00") },
    { from_user_id: instructeurBM.id, from_role: "instructeur", content: "Bonjour M. Dupont, votre dossier est en cours d'instruction. Nous attendons l'avis de l'ABF. Délai estimé : 3 semaines.", created_at: new Date("2026-05-10T14:32:00") },
    { from_user_id: citoyenBM1.id,    from_role: "citoyen",     content: "Merci pour cette réponse. Est-ce que je dois fournir des documents supplémentaires de mon côté ?", created_at: new Date("2026-05-11T08:45:00") },
  ]);

  await insertMessagesIfNone(bmInserted["DP-BM-2024-015"]!.id, [
    { from_user_id: citoyenBM2.id, from_role: "citoyen", content: "Bonjour, j'ai déposé ma déclaration préalable pour une extension de 28 m². Pouvez-vous confirmer que toutes les pièces ont bien été reçues ?", created_at: new Date("2026-05-17T10:20:00") },
  ]);

  await insertMessagesIfNone(bmInserted["PC-BM-2024-022"]!.id, [
    { from_user_id: citoyenBM1.id,    from_role: "citoyen",     content: "Bonjour, je souhaitais connaître l'avancement du dossier pour l'immeuble collectif. Y a-t-il des points bloquants ?", created_at: new Date("2026-05-15T15:00:00") },
    { from_user_id: instructeurBM.id, from_role: "instructeur", content: "Bonjour M. Dupont, l'instruction est en cours. La consultation du SDIS et de la Métropole sont en attente. Pas de point bloquant identifié à ce stade.", created_at: new Date("2026-05-16T10:00:00") },
    { from_user_id: citoyenBM1.id,    from_role: "citoyen",     content: "Parfait, merci. Pouvez-vous m'indiquer un délai prévisionnel pour la décision ?", created_at: new Date("2026-05-16T14:30:00") },
  ]);

  await insertMessagesIfNone(bmInserted["DP-BM-2024-008"]!.id, [
    { from_user_id: instructeurBM.id, from_role: "instructeur", content: "Bonjour Mme Martin, votre dossier DP-BM-2024-008 est incomplet. Il manque le plan de masse coté et la notice descriptive.", created_at: new Date("2026-05-12T11:00:00") },
    { from_user_id: citoyenBM2.id,    from_role: "citoyen",     content: "Bonjour, voici les documents demandés. J'espère que cela complète bien mon dossier.",                                       created_at: new Date("2026-05-13T16:30:00") },
    { from_user_id: instructeurBM.id, from_role: "instructeur", content: "Merci pour l'envoi. Nous procédons à la vérification et vous recontacterons si nécessaire.",                                created_at: new Date("2026-05-14T09:10:00") },
  ]);

  await insertMessagesIfNone(bmInserted["PC-BM-2023-044"]!.id, [
    { from_user_id: citoyenBM1.id,    from_role: "citoyen",     content: "Bonjour, j'ai bien reçu l'arrêté de permis accordé. Merci beaucoup pour le traitement de mon dossier. Puis-je commencer les travaux ?", created_at: new Date("2026-04-10T10:00:00") },
    { from_user_id: mairieBM.id,      from_role: "instructeur", content: "Bonjour M. Dupont, oui vous pouvez démarrer les travaux. N'oubliez pas l'affichage sur le terrain et la déclaration d'ouverture de chantier.", created_at: new Date("2026-04-10T14:30:00") },
  ]);

  await insertMessagesIfNone(bmInserted["DP-BM-2024-033"]!.id, [
    { from_user_id: citoyenBM2.id,    from_role: "citoyen",     content: "Bonjour, mon dossier est en décision depuis un moment. Pouvez-vous m'indiquer le délai prévu ?",              created_at: new Date("2026-05-18T09:00:00") },
    { from_user_id: instructeurBM.id, from_role: "instructeur", content: "Bonjour, la décision sera rendue dans les 5 jours ouvrés. Vous recevrez une notification par email.",          created_at: new Date("2026-05-19T11:30:00") },
  ]);

  await insertMessagesIfNone(bmInserted["CU-BM-2024-007"]!.id, [
    { from_user_id: citoyenBM1.id, from_role: "citoyen", content: "Bonjour, j'ai déposé une demande de certificat d'urbanisme opérationnel CU-BM-2024-007. Quel est le délai d'instruction prévu ?", created_at: new Date("2026-05-19T15:00:00") },
  ]);

  await insertMessagesIfNone(bmInserted["PC-BM-2024-041"]!.id, [
    { from_user_id: instructeurBM.id, from_role: "instructeur", content: "Bonjour Mme Martin, nous avons le regret de vous informer que votre dossier PC-BM-2024-041 a été refusé. Le terrain se situe en zone N (naturelle protégée) incompatible avec une construction neuve.", created_at: new Date("2026-05-12T10:00:00") },
    { from_user_id: citoyenBM2.id,    from_role: "citoyen",     content: "Bonjour, je suis très déçue. Y a-t-il un recours possible ou une modification de projet envisageable ?",  created_at: new Date("2026-05-12T16:00:00") },
    { from_user_id: instructeurBM.id, from_role: "instructeur", content: "Vous pouvez former un recours gracieux dans les 2 mois suivant la notification, ou consulter un architecte pour étudier une implantation hors zone N.", created_at: new Date("2026-05-13T09:00:00") },
  ]);

  await insertMessagesIfNone(bmInserted["DP-BM-2024-019"]!.id, [
    { from_user_id: citoyenBM1.id, from_role: "citoyen", content: "Bonjour, j'ai déposé ma déclaration préalable DP-BM-2024-019 hier pour une division parcellaire. Mon dossier est-il complet ?", created_at: new Date("2026-05-20T16:30:00") },
  ]);

  console.log("✅ Messages Ballan-Miré insérés");

  // ════════════════════════════════════════════════════════════
  // SAINT-AVERTIN
  // ════════════════════════════════════════════════════════════
  const communeSA = await upsertCommune({ name: "Saint-Avertin", insee_code: "37208", zip_code: "37550" });
  console.log(`✅ Commune: ${communeSA.name}`);

  const mairieSA      = await upsertUser({ email: "mairie@saint-avertin.fr",      password_hash: pw, prenom: "Antoine",  nom: "Leclerc",  role: "mairie",      commune: "Saint-Avertin" });
  const instructeurSA = await upsertUser({ email: "instructeur@saint-avertin.fr", password_hash: pw, prenom: "Nathalie", nom: "Blanc",    role: "instructeur", commune: "Saint-Avertin" });
  const citoyenSA1    = await upsertUser({ email: "thomas.garnier@email.fr",      password_hash: pw, prenom: "Thomas",   nom: "Garnier",  role: "citoyen",     commune: "Saint-Avertin" });
  const citoyenSA2    = await upsertUser({ email: "helene.vidal@email.fr",        password_hash: pw, prenom: "Hélène",   nom: "Vidal",    role: "citoyen",     commune: "Saint-Avertin" });

  const dSA001 = await upsertDossier({ numero: "PC-SA-2024-001", type: "permis_de_construire"  as const, status: "en_instruction"    as const, user_id: citoyenSA1.id, instructeur_id: instructeurSA.id, parcelle: "SA 001", adresse: "15 Route de Veigné",            commune: "Saint-Avertin", code_postal: "37550", description: "Construction d'une maison individuelle de 130 m² avec piscine", surface_plancher: "130", date_depot: new Date("2026-05-04"), date_completude: new Date("2026-05-09"), date_limite_instruction: new Date("2026-07-04") });
  const dSA002 = await upsertDossier({ numero: "DP-SA-2024-005", type: "declaration_prealable" as const, status: "soumis"            as const, user_id: citoyenSA2.id,                                   parcelle: "SA 005", adresse: "4 Allée des Châtaigniers",      commune: "Saint-Avertin", code_postal: "37550", description: "Extension de 20 m² côté jardin et création d'une véranda", surface_plancher: "20", date_depot: new Date("2026-05-15"), date_limite_instruction: new Date("2026-06-15") });
  const dSA003 = await upsertDossier({ numero: "PC-SA-2023-015", type: "permis_de_construire"  as const, status: "accepte"           as const, user_id: citoyenSA1.id, instructeur_id: mairieSA.id,      parcelle: "SA 015", adresse: "22 Rue du Moulin",              commune: "Saint-Avertin", code_postal: "37550", description: "Construction d'un garage attenant et d'une buanderie", surface_plancher: "55", date_depot: new Date("2026-04-20"), date_completude: new Date("2026-04-25"), date_limite_instruction: new Date("2026-06-20") });
  const dSA004 = await upsertDossier({ numero: "DP-SA-2024-021", type: "declaration_prealable" as const, status: "incomplet"         as const, user_id: citoyenSA2.id,                                   parcelle: "SA 021", adresse: "8 Impasse des Lilas",           commune: "Saint-Avertin", code_postal: "37550", description: "Pose d'une clôture en limite de propriété et portail motorisé", surface_plancher: "0", date_depot: new Date("2026-05-10"), date_limite_instruction: new Date("2026-06-10") });
  const dSA005 = await upsertDossier({ numero: "PC-SA-2024-009", type: "permis_de_construire"  as const, status: "decision_en_cours" as const, user_id: citoyenSA1.id, instructeur_id: instructeurSA.id, parcelle: "SA 009", adresse: "35 Avenue du Danemark",         commune: "Saint-Avertin", code_postal: "37550", description: "Division en lots et construction de 3 maisons en bande, R+1", surface_plancher: "360", date_depot: new Date("2026-05-06"), date_completude: new Date("2026-05-11"), date_limite_instruction: new Date("2026-07-06") });

  console.log("✅ Dossiers Saint-Avertin insérés");

  await insertMessagesIfNone(dSA001.id, [
    { from_user_id: citoyenSA1.id,    from_role: "citoyen",     content: "Bonjour, je souhaite avoir des nouvelles de mon dossier PC-SA-2024-001 pour la construction de ma maison.", created_at: new Date("2026-05-10T10:00:00") },
    { from_user_id: instructeurSA.id, from_role: "instructeur", content: "Bonjour M. Garnier, l'instruction est en cours. La consultation des réseaux est en attente. Délai estimé : 4 semaines.", created_at: new Date("2026-05-10T15:00:00") },
    { from_user_id: citoyenSA1.id,    from_role: "citoyen",     content: "Merci. La piscine est-elle bien intégrée au dossier ou dois-je déposer une déclaration séparée ?", created_at: new Date("2026-05-11T09:00:00") },
  ]);

  await insertMessagesIfNone(dSA002.id, [
    { from_user_id: citoyenSA2.id, from_role: "citoyen", content: "Bonjour, j'ai déposé ma DP-SA-2024-005 pour une extension. Mon dossier a-t-il bien été réceptionné ?", created_at: new Date("2026-05-15T17:00:00") },
  ]);

  await insertMessagesIfNone(dSA003.id, [
    { from_user_id: citoyenSA1.id, from_role: "citoyen",     content: "Bonjour, j'ai reçu l'autorisation pour le dossier PC-SA-2023-015. Quelle est la procédure pour démarrer les travaux ?", created_at: new Date("2026-04-28T09:00:00") },
    { from_user_id: mairieSA.id,   from_role: "instructeur", content: "Bonjour, affichez l'autorisation sur votre terrain et envoyez la déclaration d'ouverture de chantier (DOC) en mairie. Bons travaux !", created_at: new Date("2026-04-28T14:00:00") },
  ]);

  await insertMessagesIfNone(dSA004.id, [
    { from_user_id: instructeurSA.id, from_role: "instructeur", content: "Bonjour Mme Vidal, votre dossier DP-SA-2024-021 est incomplet. Il manque un plan de situation et le plan de masse avec les cotes des clôtures.", created_at: new Date("2026-05-13T09:00:00") },
    { from_user_id: citoyenSA2.id,    from_role: "citoyen",     content: "Bonjour, j'envoie les documents par courrier postal ce soir. Combien de temps ai-je pour les transmettre ?", created_at: new Date("2026-05-13T18:00:00") },
    { from_user_id: instructeurSA.id, from_role: "instructeur", content: "Vous avez 3 mois à compter de la notification pour compléter votre dossier, sans quoi il sera classé sans suite.", created_at: new Date("2026-05-14T09:00:00") },
  ]);

  await insertMessagesIfNone(dSA005.id, [
    { from_user_id: citoyenSA1.id,    from_role: "citoyen",     content: "Bonjour, le dossier PC-SA-2024-009 est en décision. Avez-vous un retour sur l'issue probable ?", created_at: new Date("2026-05-18T11:00:00") },
    { from_user_id: instructeurSA.id, from_role: "instructeur", content: "Bonjour M. Garnier, nous ne pouvons pas anticiper la décision avant sa signature. Elle interviendra dans les 8 jours.", created_at: new Date("2026-05-18T15:00:00") },
  ]);

  console.log("✅ Messages Saint-Avertin insérés");

  // ════════════════════════════════════════════════════════════
  // JOUÉ-LÈS-TOURS
  // ════════════════════════════════════════════════════════════
  const communeJT = await upsertCommune({ name: "Joué-lès-Tours", insee_code: "37122", zip_code: "37300" });
  console.log(`✅ Commune: ${communeJT.name}`);

  const mairieJT      = await upsertUser({ email: "mairie@joue-les-tours.fr",      password_hash: pw, prenom: "René",  nom: "Moreau",  role: "mairie",      commune: "Joué-lès-Tours" });
  const instructeurJT = await upsertUser({ email: "instructeur@joue-les-tours.fr", password_hash: pw, prenom: "Julie", nom: "Caron",   role: "instructeur", commune: "Joué-lès-Tours" });
  const citoyenJT1    = await upsertUser({ email: "marc.lefevre@email.fr",          password_hash: pw, prenom: "Marc",  nom: "Lefèvre", role: "citoyen",     commune: "Joué-lès-Tours" });
  const citoyenJT2    = await upsertUser({ email: "anne.guillot@email.fr",          password_hash: pw, prenom: "Anne",  nom: "Guillot", role: "citoyen",     commune: "Joué-lès-Tours" });

  const dJT001 = await upsertDossier({ numero: "PC-JT-2024-003", type: "permis_de_construire"  as const, status: "en_instruction"    as const, user_id: citoyenJT1.id, instructeur_id: instructeurJT.id, parcelle: "JT 003", adresse: "27 Rue de la Croix Verte",      commune: "Joué-lès-Tours", code_postal: "37300", description: "Construction d'une maison de plain-pied de 115 m²", surface_plancher: "115", date_depot: new Date("2026-05-05"), date_completude: new Date("2026-05-10"), date_limite_instruction: new Date("2026-07-05") });
  const dJT002 = await upsertDossier({ numero: "DP-JT-2024-011", type: "declaration_prealable" as const, status: "pre_instruction"   as const, user_id: citoyenJT2.id,                                   parcelle: "JT 011", adresse: "6 Allée des Peupliers",         commune: "Joué-lès-Tours", code_postal: "37300", description: "Édification d'un abri de jardin de 15 m²", surface_plancher: "15", date_depot: new Date("2026-05-18"), date_limite_instruction: new Date("2026-06-18") });
  const dJT003 = await upsertDossier({ numero: "PC-JT-2024-031", type: "permis_de_construire"  as const, status: "decision_en_cours" as const, user_id: citoyenJT1.id, instructeur_id: instructeurJT.id, parcelle: "JT 031", adresse: "3 Rue des Fontaines",           commune: "Joué-lès-Tours", code_postal: "37300", description: "Réhabilitation complète d'une maison ancienne avec extension de 40 m²", surface_plancher: "175", date_depot: new Date("2026-05-03"), date_completude: new Date("2026-05-08"), date_limite_instruction: new Date("2026-07-03") });
  const dJT004 = await upsertDossier({ numero: "DP-JT-2023-047", type: "declaration_prealable" as const, status: "accepte"           as const, user_id: citoyenJT2.id, instructeur_id: mairieJT.id,      parcelle: "JT 047", adresse: "14 Résidence du Lac",           commune: "Joué-lès-Tours", code_postal: "37300", description: "Installation de panneaux solaires en toiture", surface_plancher: "0", date_depot: new Date("2026-04-15"), date_completude: new Date("2026-04-20"), date_limite_instruction: new Date("2026-05-15") });
  const dJT005 = await upsertDossier({ numero: "PC-JT-2024-018", type: "permis_de_construire"  as const, status: "soumis"            as const, user_id: citoyenJT1.id,                                   parcelle: "JT 018", adresse: "45 Boulevard Général Leclerc",  commune: "Joué-lès-Tours", code_postal: "37300", description: "Construction d'un local commercial de 180 m² avec logement", surface_plancher: "245", date_depot: new Date("2026-05-20"), date_limite_instruction: new Date("2026-07-20") });

  console.log("✅ Dossiers Joué-lès-Tours insérés");

  await insertMessagesIfNone(dJT001.id, [
    { from_user_id: citoyenJT1.id,    from_role: "citoyen",     content: "Bonjour, pouvez-vous me donner des nouvelles de mon dossier PC-JT-2024-003 ?", created_at: new Date("2026-05-12T09:30:00") },
    { from_user_id: instructeurJT.id, from_role: "instructeur", content: "Bonjour M. Lefèvre, l'instruction progresse normalement. Nous attendons les avis des gestionnaires de réseaux. Retour attendu sous 3 semaines.", created_at: new Date("2026-05-12T14:00:00") },
    { from_user_id: citoyenJT1.id,    from_role: "citoyen",     content: "Merci, je souhaitais m'assurer que tout se passe bien. Y a-t-il des points à surveiller particulièrement ?", created_at: new Date("2026-05-13T08:00:00") },
  ]);

  await insertMessagesIfNone(dJT002.id, [
    { from_user_id: citoyenJT2.id, from_role: "citoyen", content: "Bonjour, j'ai déposé une DP pour un abri de jardin (DP-JT-2024-011). Mon dossier est bien en cours de traitement ?", created_at: new Date("2026-05-18T18:00:00") },
  ]);

  await insertMessagesIfNone(dJT003.id, [
    { from_user_id: citoyenJT1.id,    from_role: "citoyen",     content: "Bonjour, mon dossier PC-JT-2024-031 est en décision. Puis-je espérer une réponse avant fin mai ?", created_at: new Date("2026-05-17T10:00:00") },
    { from_user_id: instructeurJT.id, from_role: "instructeur", content: "Bonjour, la décision devrait intervenir cette semaine. Nous vous contactons dès que l'arrêté est signé.", created_at: new Date("2026-05-17T15:00:00") },
  ]);

  await insertMessagesIfNone(dJT004.id, [
    { from_user_id: citoyenJT2.id, from_role: "citoyen",     content: "Bonjour, merci pour l'accord de ma DP-JT-2023-047. L'installateur commence la semaine prochaine.", created_at: new Date("2026-05-05T09:00:00") },
    { from_user_id: mairieJT.id,   from_role: "instructeur", content: "Très bien Mme Guillot, n'oubliez pas d'effectuer la déclaration attestant l'achèvement des travaux (DAACT) une fois l'installation terminée.", created_at: new Date("2026-05-05T14:00:00") },
    { from_user_id: citoyenJT2.id, from_role: "citoyen",     content: "Bien noté, je ferai la DAACT dès la fin de l'installation. Merci pour votre accompagnement.", created_at: new Date("2026-05-06T08:30:00") },
  ]);

  await insertMessagesIfNone(dJT005.id, [
    { from_user_id: citoyenJT1.id, from_role: "citoyen", content: "Bonjour, je viens de déposer mon dossier PC-JT-2024-018 pour un local commercial. Quel est le délai d'instruction pour un permis de cette nature ?", created_at: new Date("2026-05-20T17:00:00") },
  ]);

  console.log("✅ Messages Joué-lès-Tours insérés");

  // ════════════════════════════════════════════════════════════
  // LA RICHE
  // ════════════════════════════════════════════════════════════
  const communeLR = await upsertCommune({ name: "La Riche", insee_code: "37195", zip_code: "37520" });
  console.log(`✅ Commune: ${communeLR.name}`);

  const mairieLR      = await upsertUser({ email: "mairie@la-riche.fr",      password_hash: pw, prenom: "Daniel",  nom: "Perrin",   role: "mairie",      commune: "La Riche" });
  const instructeurLR = await upsertUser({ email: "instructeur@la-riche.fr", password_hash: pw, prenom: "Céline",  nom: "Fontaine", role: "instructeur", commune: "La Riche" });
  const citoyenLR1    = await upsertUser({ email: "pierre.hamelin@email.fr", password_hash: pw, prenom: "Pierre",  nom: "Hamelin",  role: "citoyen",     commune: "La Riche" });
  const citoyenLR2    = await upsertUser({ email: "isabelle.renard@email.fr", password_hash: pw, prenom: "Isabelle", nom: "Renard", role: "citoyen",     commune: "La Riche" });

  const dLR001 = await upsertDossier({ numero: "PC-LR-2024-002", type: "permis_de_construire"  as const, status: "en_instruction" as const, user_id: citoyenLR1.id, instructeur_id: instructeurLR.id, parcelle: "LR 002", adresse: "18 Rue de la Choisille",  commune: "La Riche", code_postal: "37520", description: "Construction d'une maison individuelle BBC de 95 m²", surface_plancher: "95",  date_depot: new Date("2026-05-07"), date_completude: new Date("2026-05-12"), date_limite_instruction: new Date("2026-07-07") });
  const dLR002 = await upsertDossier({ numero: "DP-LR-2024-009", type: "declaration_prealable" as const, status: "soumis"         as const, user_id: citoyenLR2.id,                                   parcelle: "LR 009", adresse: "7 Chemin de la Sablière", commune: "La Riche", code_postal: "37520", description: "Rénovation de façade et changement de couleur des menuiseries", surface_plancher: "0", date_depot: new Date("2026-05-16"), date_limite_instruction: new Date("2026-06-16") });
  const dLR003 = await upsertDossier({ numero: "PC-LR-2024-014", type: "permis_de_construire"  as const, status: "incomplet"      as const, user_id: citoyenLR1.id, instructeur_id: instructeurLR.id, parcelle: "LR 014", adresse: "52 Rue de la Milletière", commune: "La Riche", code_postal: "37520", description: "Extension de 45 m² au rez-de-chaussée et création d'un étage", surface_plancher: "145", date_depot: new Date("2026-05-09"), date_limite_instruction: new Date("2026-07-09") });
  const dLR004 = await upsertDossier({ numero: "DP-LR-2023-038", type: "declaration_prealable" as const, status: "accepte"        as const, user_id: citoyenLR2.id, instructeur_id: mairieLR.id,      parcelle: "LR 038", adresse: "31 Impasse des Acacias",  commune: "La Riche", code_postal: "37520", description: "Construction d'un carport bois de 18 m²", surface_plancher: "18", date_depot: new Date("2026-04-10"), date_completude: new Date("2026-04-15"), date_limite_instruction: new Date("2026-05-10") });
  const dLR005 = await upsertDossier({ numero: "PC-LR-2024-027", type: "permis_de_construire"  as const, status: "pre_instruction" as const, user_id: citoyenLR2.id,                                  parcelle: "LR 027", adresse: "9 Avenue de la Tranchée",  commune: "La Riche", code_postal: "37520", description: "Démolition + reconstruction — maison individuelle 110 m²", surface_plancher: "110", date_depot: new Date("2026-05-19"), date_limite_instruction: new Date("2026-07-19") });

  console.log("✅ Dossiers La Riche insérés");

  await insertMessagesIfNone(dLR001.id, [
    { from_user_id: citoyenLR1.id,    from_role: "citoyen",     content: "Bonjour, pouvez-vous me confirmer la réception de mon dossier PC-LR-2024-002 et l'état de l'instruction ?", created_at: new Date("2026-05-13T10:00:00") },
    { from_user_id: instructeurLR.id, from_role: "instructeur", content: "Bonjour M. Hamelin, votre dossier est complet et l'instruction a débuté. Les avis des services sont en cours de collecte.", created_at: new Date("2026-05-13T15:00:00") },
    { from_user_id: citoyenLR1.id,    from_role: "citoyen",     content: "Parfait, merci. Y a-t-il des contraintes particulières dans mon secteur que je devrais anticiper ?", created_at: new Date("2026-05-14T09:00:00") },
  ]);

  await insertMessagesIfNone(dLR002.id, [
    { from_user_id: citoyenLR2.id, from_role: "citoyen", content: "Bonjour, j'ai déposé ma DP-LR-2024-009 pour rénovation de façade. Est-ce que le délai d'instruction d'un mois est bien applicable à mon dossier ?", created_at: new Date("2026-05-16T16:30:00") },
  ]);

  await insertMessagesIfNone(dLR003.id, [
    { from_user_id: instructeurLR.id, from_role: "instructeur", content: "Bonjour M. Hamelin, votre dossier PC-LR-2024-014 est incomplet. Il manque les coupes et façades cotées avec les dimensions du projet.", created_at: new Date("2026-05-12T09:00:00") },
    { from_user_id: citoyenLR1.id,    from_role: "citoyen",     content: "Merci pour l'information. Je fais établir les plans par mon architecte et les transmets rapidement.", created_at: new Date("2026-05-12T18:00:00") },
    { from_user_id: instructeurLR.id, from_role: "instructeur", content: "Merci. Dès réception des documents, nous relancerons l'instruction dans les meilleurs délais.",       created_at: new Date("2026-05-13T09:00:00") },
  ]);

  await insertMessagesIfNone(dLR004.id, [
    { from_user_id: citoyenLR2.id, from_role: "citoyen",     content: "Bonjour, j'ai reçu l'accord pour mon carport DP-LR-2023-038. Je vais commencer les travaux rapidement. Dois-je faire quelque chose ?", created_at: new Date("2026-04-20T10:00:00") },
    { from_user_id: mairieLR.id,   from_role: "instructeur", content: "Bonjour Mme Renard, pensez à afficher l'autorisation sur votre terrain pendant toute la durée des travaux. Aucune autre formalité n'est requise pour ce type de projet.", created_at: new Date("2026-04-20T14:00:00") },
  ]);

  await insertMessagesIfNone(dLR005.id, [
    { from_user_id: citoyenLR2.id, from_role: "citoyen", content: "Bonjour, je viens de déposer mon dossier PC-LR-2024-027. Mon projet implique une démolition préalable, est-ce bien pris en compte dans ce permis ?", created_at: new Date("2026-05-19T17:00:00") },
  ]);

  console.log("✅ Messages La Riche insérés");

  // ── Commune Rochecorbon (maintenu pour compatibilité) ──
  await upsertCommune({ name: "Rochecorbon", insee_code: "37203", zip_code: "37210" });

  console.log("\n✅✅✅ Seed terminé !");
  console.log("\n📧 Identifiants de test :");
  console.log("  Admin              : admin@heureka.fr / admin123");
  console.log("  Mairie Tours       : mairie@tours.fr / password123");
  console.log("  Instructeur Tours  : instructeur@tours.fr / password123");
  console.log("  Citoyen Tours 1    : citoyen@test.fr / password123");
  console.log("  Citoyen Tours 2    : paul.bernard@email.fr / password123");
  console.log("  Mairie BM          : mairie@ballan-mire.fr / password123");
  console.log("  Instructeur BM     : instructeur@ballan-mire.fr / password123");
  console.log("  Mairie SA          : mairie@saint-avertin.fr / password123");
  console.log("  Mairie JT          : mairie@joue-les-tours.fr / password123");
  console.log("  Mairie LR          : mairie@la-riche.fr / password123");
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
