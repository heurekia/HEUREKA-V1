/**
 * Assistant d'aide de l'espace mairie / instructeur (module « ? » de la barre
 * du haut). Conversationnel, ancré sur la base de connaissances mairie (cf.
 * services/helpAssistant.ts). Usage prioritaire : « Comment faire… ».
 *
 * Surface REST :
 *   GET  /mairie/assistant/suggestions → questions d'amorce pour l'UI
 *   POST /mairie/assistant             → réponse en streaming SSE
 *
 * Le routeur parent (mairie/index.ts) applique déjà requireAuth +
 * requireRole("mairie","instructeur","admin") et exclut /assistant de l'audit
 * des mutations (ce n'en est pas une).
 */
import { Router } from "express";
import { type AuthRequest } from "../../middlewares/auth.js";
import { streamAi } from "../../services/aiUsage.js";
import { llmLimiter } from "../../middlewares/rateLimiters.js";
import {
  buildMairieAssistantSystemPrompt,
  sanitizeHistory,
  MAIRIE_ASSISTANT_SUGGESTIONS,
} from "../../services/helpAssistant.js";

export const assistantRouter = Router();

// GET /mairie/assistant/suggestions
assistantRouter.get("/assistant/suggestions", (_req, res) => {
  res.json({ suggestions: MAIRIE_ASSISTANT_SUGGESTIONS });
});

// POST /mairie/assistant — réponse en streaming SSE.
//
// Body : { question: string, history?: { role: "user"|"assistant", content }[] }
//
// Streaming SSE pour la même raison que les agents de structuration PLU : la
// passerelle nginx coupe une requête « silencieuse » longue et l'utilisateur
// verrait un 502 alors que Mistral a déjà facturé. On forwarde les deltas de
// texte (effet de frappe) ; le tracking ai_usage_events est automatique à
// finalMessage().
assistantRouter.post("/assistant", llmLimiter, async (req: AuthRequest, res) => {
  const body = (req.body ?? {}) as { question?: unknown; history?: unknown };
  const question = typeof body.question === "string" ? body.question.trim() : "";
  if (!question) return res.status(400).json({ error: "question requise" });
  if (question.length > 2000) return res.status(400).json({ error: "Question trop longue (2000 caractères max)." });

  const history = sanitizeHistory(body.history);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    (res as unknown as { flush?: () => void }).flush?.();
  };

  try {
    send({ type: "started" });

    const stream = await streamAi(
      { purpose: "mairie_assistant", userId: req.user?.id ?? null },
      {
        model: "ai-fast",
        max_tokens: 1200,
        temperature: 0.2,
        system: buildMairieAssistantSystemPrompt(),
        messages: [
          ...history.map((t) => ({ role: t.role, content: t.content })),
          { role: "user" as const, content: question },
        ],
      },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send({ type: "delta", text: event.delta.text });
      }
    }

    const finalMessage = await stream.finalMessage();
    send({ type: "done", stop_reason: finalMessage.stop_reason });
    res.end();
  } catch (err) {
    console.error("[mairie-assistant]", err);
    send({ type: "error", message: err instanceof Error ? err.message : "Échec de l'assistant — réessayez." });
    res.end();
  }
});
