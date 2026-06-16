// Orchestration : génération du CERFA prérempli et attachement comme pièce
// du dossier. Découplé de la route HTTP pour pouvoir être appelé soit à la
// création du brouillon, soit à la régénération (PATCH cerfa_data).
//
// Idempotent : si une pièce CERFA pré-remplie existe déjà pour ce dossier
// (même code_piece), elle est supprimée du storage puis remplacée.

import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import { dossiers, dossier_pieces_jointes, users } from "@heureka-v1/db";
import { getStorageProvider } from "./storage.js";
import { fillPcmiCerfa, type CerfaPcmiData } from "./cerfaPcmiFiller.js";

const PCMI_PIECE_CODE = "PCMI-FORMULAIRE";

/** Mapping type dossier → générateur CERFA. Pour l'instant uniquement PCMI ;
 *  les autres CERFA (DP/PC/PA/PD/CU) seront branchés dans les prochains commits. */
function generatorFor(dossierType: string, metadata: Record<string, unknown>): null | {
  code: string;
  filename: string;
  generate: (input: { user: { nom: string; prenom: string; email: string; telephone: string | null }; dossier: { adresse: string | null; commune: string | null; code_postal: string | null; parcelle: string | null; description: string | null; surface_plancher: string | null }; cerfa: CerfaPcmiData }) => Promise<Buffer>;
} {
  // PCMI = permis de construire pour une maison individuelle. Depuis l'ajout
  // du type `permis_de_construire_mi` au niveau dossier, celui-ci suffit à
  // déclencher la génération PCMI. On garde l'ancienne heuristique
  // (`permis_de_construire` + nature `maison_neuve`) pour les brouillons
  // antérieurs à la migration qui n'auraient pas encore été reclassés.
  const natures = (metadata?.natures as string[] | undefined) ?? [];
  const isPcmi = dossierType === "permis_de_construire_mi"
    || (dossierType === "permis_de_construire" && natures.includes("maison_neuve"));
  if (isPcmi) {
    return {
      code: PCMI_PIECE_CODE,
      filename: "CERFA-13406-16-PCMI.pdf",
      generate: fillPcmiCerfa,
    };
  }
  return null;
}

/** Génère et attache (ou met à jour) le CERFA pré-rempli pour un dossier.
 *  - Retourne `null` si le type de dossier n'a pas de générateur disponible.
 *  - Échoue silencieusement côté appelant (loggé) plutôt que de bloquer la
 *    création du dossier si la génération échoue : on préfère un dossier
 *    sans CERFA pré-rempli qu'un échec total de POST /dossiers. */
export async function attachCerfaToDossier(dossierId: string): Promise<{ pieceId: string } | null> {
  const [dossier] = await db
    .select()
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .limit(1);
  if (!dossier) return null;

  const generator = generatorFor(dossier.type, (dossier.metadata as Record<string, unknown>) ?? {});
  if (!generator) return null;

  const [user] = await db
    .select({ id: users.id, nom: users.nom, prenom: users.prenom, email: users.email, telephone: users.telephone })
    .from(users)
    .where(eq(users.id, dossier.user_id))
    .limit(1);
  if (!user) return null;

  const metadata = (dossier.metadata as Record<string, unknown>) ?? {};
  const cerfaData = (metadata.cerfa_data as CerfaPcmiData | undefined) ?? {};

  const buffer = await generator.generate({
    user: {
      nom: user.nom,
      prenom: user.prenom,
      email: user.email,
      telephone: user.telephone,
    },
    dossier: {
      adresse: dossier.adresse,
      commune: dossier.commune,
      code_postal: dossier.code_postal,
      parcelle: dossier.parcelle,
      description: dossier.description,
      surface_plancher: dossier.surface_plancher,
    },
    cerfa: cerfaData,
  });

  const storage = getStorageProvider();
  const fileKey = `${crypto.randomUUID()}.pdf`;
  const stored = await storage.put({ key: fileKey, body: buffer, mime: "application/pdf" });

  // Si une version précédente du CERFA est déjà attachée, on la remplace.
  const existing = await db
    .select()
    .from(dossier_pieces_jointes)
    .where(and(
      eq(dossier_pieces_jointes.dossier_id, dossierId),
      eq(dossier_pieces_jointes.code_piece, generator.code),
    ));
  for (const old of existing) {
    try {
      await storage.remove(storage.keyFromUrl(old.url));
    } catch {
      // Best-effort : un fichier orphelin sera nettoyé par le scheduler.
    }
    await db.delete(dossier_pieces_jointes).where(eq(dossier_pieces_jointes.id, old.id));
  }

  const [piece] = await db
    .insert(dossier_pieces_jointes)
    .values({
      dossier_id: dossierId,
      user_id: user.id,
      nom: generator.filename,
      url: stored.url,
      type: "application/pdf",
      taille: buffer.length,
      code_piece: generator.code,
    })
    .returning();

  return { pieceId: piece!.id };
}
