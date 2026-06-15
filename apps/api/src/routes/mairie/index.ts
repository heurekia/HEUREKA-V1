import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth.js";
import { enforceDossierAccess } from "../../middlewares/dossierAccess.js";
import { dashboardRouter } from "./dashboard.js";
import { dossiersRouter } from "./dossiers.js";
import { piecesRouter } from "./pieces.js";
import { conformiteRouter } from "./conformite.js";
import { parcelleRouter } from "./parcelle.js";
import { courriersRouter } from "./courriers.js";
import { conversationsRouter } from "./conversations.js";
import { instructeursRouter } from "./instructeurs.js";
import { communesRouter } from "./communes.js";
import { adminRouter } from "./admin.js";
import { reglementationRouter } from "./reglementation.js";
import { consultationsRouter } from "./consultations.js";

export const mairieRouter = Router();
mairieRouter.use(requireAuth);
mairieRouter.use(requireRole("mairie", "instructeur", "admin"));
mairieRouter.use("/dossiers/:id", enforceDossierAccess);
mairieRouter.use("/conversations/:dossierId", (req, res, next) => {
  (req.params as Record<string, string>).id = req.params["dossierId"] as string;
  return enforceDossierAccess(req as AuthRequest, res, next);
});

mairieRouter.use(dashboardRouter);
mairieRouter.use(dossiersRouter);
mairieRouter.use(piecesRouter);
mairieRouter.use(conformiteRouter);
mairieRouter.use(parcelleRouter);
mairieRouter.use(courriersRouter);
mairieRouter.use(conversationsRouter);
mairieRouter.use(instructeursRouter);
mairieRouter.use(communesRouter);
mairieRouter.use(adminRouter);
mairieRouter.use(reglementationRouter);
mairieRouter.use(consultationsRouter);
