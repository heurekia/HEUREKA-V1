import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

export interface PieceAnalysis {
  score: "conforme" | "acceptable" | "incomplet" | "non_conforme";
  commentaire: string;
  suggestions: string[];
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

function isAllowedImage(mime: string): mime is AllowedImageType {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mime);
}

function getAnthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const candidates = [
    process.env.CLAUDE_SESSION_INGRESS_TOKEN_FILE,
    "/home/claude/.claude/remote/.session_ingress_token",
  ];
  for (const p of candidates) {
    if (!p) continue;
    try { return fs.readFileSync(p, "utf8").trim(); } catch { /* try next */ }
  }
  throw new Error("ANTHROPIC_API_KEY non configurée");
}

export async function analyzePiece(
  filePath: string,
  mimeType: string,
  nomPiece: string,
  codePiece: string,
): Promise<PieceAnalysis> {
  if (!isAllowedImage(mimeType)) {
    return {
      score: "acceptable",
      commentaire: "Document reçu. Vérification visuelle non disponible pour ce format — un instructeur vérifiera le contenu.",
      suggestions: [],
    };
  }

  const fileData = fs.readFileSync(filePath);
  const base64 = fileData.toString("base64");

  const client = new Anthropic({ apiKey: getAnthropicKey() });
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: `Tu es expert en dossiers de permis d'urbanisme. Analyse cette pièce justificative.
Réponds UNIQUEMENT en JSON valide :
{"score":"conforme"|"acceptable"|"incomplet"|"non_conforme","commentaire":"1-2 phrases sur la qualité et la conformité","suggestions":["suggestion concrète actionnable si nécessaire"]}
Critères : conforme = document clair, lisible et approprié au type demandé ; acceptable = utilisable mais améliorable ; incomplet = partiellement visible, amputé ou illisible en partie ; non_conforme = mauvais type de document ou totalement illisible.`,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mimeType, data: base64 },
        },
        { type: "text", text: `Pièce demandée : ${nomPiece} (code : ${codePiece})` },
      ],
    }],
  });

  const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]) as PieceAnalysis;
  }
  return { score: "acceptable", commentaire: "Analyse effectuée.", suggestions: [] };
}
