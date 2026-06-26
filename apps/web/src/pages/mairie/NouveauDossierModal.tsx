import { useState, useEffect, useMemo } from "react";
import { api } from "../../lib/api";
import BundleSplitModal from "./BundleSplitModal";
import { DOSSIER_TYPE_OPTIONS, type NouveauDossierType } from "./shared";

// Modale "Nouveau dossier" : dépôt OCR (CERFA + pièces), reconnaissance des
// pièces, création du dossier. La saisie 100 % manuelle a été retirée — le
// formulaire reste éditable à la main après dépôt (option « aucun CERFA »).
// Types et sous-composants (overlay, en-tête, devinette de code pièce) locaux.
// Extrait de MairieApp.tsx.

type NouveauDossierForm = {
  type: NouveauDossierType;
  petitionnaire_prenom: string;
  petitionnaire_nom: string;
  petitionnaire_email: string;
  adresse: string;
  code_postal: string;
  commune: string;
  parcelle: string;
  surface_plancher: string;
  description: string;
  date_depot: string;
  instructeur_id: string;
  invite_petitionnaire: boolean;
};


type OcrExtraction = {
  type: NouveauDossierType | null;
  numero_cerfa: string | null;
  petitionnaire_prenom: string | null;
  petitionnaire_nom: string | null;
  petitionnaire_email: string | null;
  siret: string | null;
  adresse: string | null;
  code_postal: string | null;
  commune: string | null;
  parcelle: string | null;
  surface_plancher: string | null;
  description: string | null;
  confidence: number;
};

// Famille de codes d'emplacement CERFA selon le type de dossier. Aligné sur
// pieceCodeFamily() côté serveur : un PC porte des pièces PC*, une DP des DP*…
type CodeFamily = "PCMI" | "PC" | "DP";
function codeFamilyFromDossierType(type: string | null | undefined): CodeFamily | null {
  switch (type) {
    case "permis_de_construire_mi": return "PCMI";
    case "permis_de_construire":    return "PC";
    case "declaration_prealable":   return "DP";
    // PA / PD / lotissement / CU : pas de convention auto fiable → pas de code.
    default: return null;
  }
}

// Heuristique : à quel code_piece correspond le fichier d'après son nom ?
// Permet de pré-coder la pièce avant upload pour que l'extracteur côté serveur
// reçoive un hint pertinent (plan_masse, plan_facade, etc.). Le préfixe (PC/
// PCMI/DP) dépend du TYPE de dossier : un PC ne doit pas ressortir en DP*.
function guessCodePieceFromName(name: string, family: CodeFamily | null): string {
  const n = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (/cerfa|13406|13703|13409|13405|13410/.test(n)) return "CERFA";
  if (!family) return ""; // type sans nomenclature gérée → l'instructeur tranche
  // Détermine le numéro d'emplacement (1..8) : mot-clé, ou numéro explicite
  // précédé d'un préfixe connu (pc2, dp2, pcmi2…) pour éviter les faux positifs.
  const num = /situation|(?:pcmi|dpmi|pc|dp)\s*0?1\b/.test(n) ? 1
    : /masse|(?:pcmi|dpmi|pc|dp)\s*0?2\b/.test(n) ? 2
    : /coupe|(?:pcmi|dpmi|pc|dp)\s*0?3\b/.test(n) ? 3
    : /notice|(?:pcmi|dpmi|pc|dp)\s*0?4\b/.test(n) ? 4
    : /facade|(?:pcmi|dpmi|pc|dp)\s*0?5\b/.test(n) ? 5
    : /insertion|paysag|(?:pcmi|dpmi|pc|dp)\s*0?6\b/.test(n) ? 6
    : /photo.*proche|(?:pcmi|dpmi|pc|dp)\s*0?7\b/.test(n) ? 7
    : /photo.*lointain|(?:pcmi|dpmi|pc|dp)\s*0?8\b/.test(n) ? 8
    : /photo/.test(n) ? 7
    : null;
  return num ? `${family}${num}` : "";
}

type StagedFile = {
  id: string;
  file: File;
  isCerfa: boolean;
  status: "queued" | "uploading" | "done" | "error";
  error?: string | null;
};

// Hoistés hors du composant : redéfinis à chaque render, React voyait un nouveau
// type → unmount/remount complet du sous-arbre à chaque setState, ce qui faisait
// "fermer" la modale (clic accidentel sur le backdrop pendant la reconstruction
// du DOM, perte du focus, flickering).
function NouveauDossierOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: 16, width: 580, maxWidth: "92vw", boxShadow: "0 20px 60px rgba(0,0,0,0.22)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function NouveauDossierModalHeader({ title, back, onClose }: { title: string; back?: () => void; onClose: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "18px 24px", borderBottom: "1px solid #E2E8F0" }}>
      {back && <button onClick={back} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 18, lineHeight: 1, padding: 0 }}>←</button>}
      <div style={{ fontSize: 16, fontWeight: 700, color: "#0F172A", flex: 1 }}>{title}</div>
      <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 20, color: "#94a3b8", lineHeight: 1 }}>×</button>
    </div>
  );
}

export function NouveauDossierModal({ onClose, commune }: { onClose: () => void; commune: string }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const emptyForm: NouveauDossierForm = {
    type: "permis_de_construire",
    petitionnaire_prenom: "",
    petitionnaire_nom: "",
    petitionnaire_email: "",
    adresse: "",
    code_postal: "",
    commune,
    parcelle: "",
    surface_plancher: "",
    description: "",
    date_depot: today,
    instructeur_id: "",
    invite_petitionnaire: true,
  };
  const [form, setForm] = useState<NouveauDossierForm>(emptyForm);
  const [instructeurs, setInstructeurs] = useState<{ id: string; prenom: string; nom: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  // Une fois le dossier créé et les pièces déposées, on reste sur cet écran
  // de confirmation : l'OCR/IA tourne en arrière-plan et la cloche notifiera
  // l'instructeur quand tout sera prêt. On ne redirige plus immédiatement
  // vers le détail du dossier pour ne pas laisser croire qu'il est déjà
  // analysable.
  const [createdSummary, setCreatedSummary] = useState<{ id: string; numero: string; piecesCount: number } | null>(null);
  // Dépôt groupé : quand l'agent dépose UN SEUL PDF, on confie le découpage en
  // pièces à la modale de segmentation (ouverte juste après la création du
  // dossier) au lieu d'attacher le PDF comme une pièce unique.
  const [bundleSplit, setBundleSplit] = useState<{ dossierId: string; numero: string; file: File } | null>(null);

  // OCR state — multi-fichiers : le CERFA pré-remplit le formulaire, les
  // autres pièces sont mises en attente et uploadées après création du dossier.
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [cerfaScanning, setCerfaScanning] = useState(false);
  const [cerfaDone, setCerfaDone] = useState(false);
  // Dépôt multi-fichiers sans CERFA séparé (formulaire saisi à la main) : on
  // n'auto-désigne alors aucun fichier comme CERFA et le pré-remplissage est sauté.
  const [noCerfa, setNoCerfa] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ocrNumero, setOcrNumero] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ id: string; prenom: string; nom: string }[]>("/mairie/instructeurs")
      .then(setInstructeurs)
      .catch(() => setInstructeurs([]));
  }, []);

  // Garde le champ "commune" du formulaire en phase avec la commune active
  // si l'opérateur change de commune dans la sidebar tant que la modale est ouverte.
  useEffect(() => {
    setForm(prev => prev.commune ? prev : { ...prev, commune });
  }, [commune]);

  const setField = <K extends keyof NouveauDossierForm>(key: K, value: NouveauDossierForm[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Lance l'extraction CERFA sur le fichier marqué comme CERFA. Appelé soit
  // au moment où l'utilisateur ajoute des fichiers (le premier CERFA détecté
  // est extrait), soit quand l'utilisateur change le fichier désigné CERFA.
  const runCerfaExtract = async (file: File) => {
    setOcrError(null);
    setCerfaScanning(true);
    setCerfaDone(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/mairie/ocr-cerfa", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        // 413 = Payload Too Large (proxy ou multer 60 Mo). Inutile d'afficher
        // un code HTTP brut au déposant : on traduit en message actionnable.
        if (res.status === 413) {
          throw new Error("Fichier trop volumineux pour l'extraction (limite ~60 Mo).");
        }
        throw new Error(body.error ?? `Erreur ${res.status}`);
      }
      const data = await res.json() as OcrExtraction;
      setForm(prev => ({
        ...prev,
        type: data.type ?? prev.type,
        petitionnaire_prenom: data.petitionnaire_prenom ?? prev.petitionnaire_prenom,
        petitionnaire_nom: data.petitionnaire_nom ?? prev.petitionnaire_nom,
        petitionnaire_email: data.petitionnaire_email ?? prev.petitionnaire_email,
        adresse: data.adresse ?? prev.adresse,
        code_postal: data.code_postal ?? prev.code_postal,
        commune: data.commune ?? prev.commune,
        parcelle: data.parcelle ?? prev.parcelle,
        surface_plancher: data.surface_plancher ?? prev.surface_plancher,
        description: data.description ?? prev.description,
      }));
      setOcrNumero(data.numero_cerfa);
      setCerfaDone(true);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : "Échec de l'extraction OCR");
    } finally {
      setCerfaScanning(false);
    }
  };

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setStagedFiles(prev => {
      const next = [...prev];
      const hasCerfa = next.some(f => f.isCerfa);
      for (const file of arr) {
        // Évite les doublons exacts (nom + taille) si l'opérateur ré-importe.
        if (next.some(f => f.file.name === file.name && f.file.size === file.size)) continue;
        const guessed = guessCodePieceFromName(file.name, codeFamilyFromDossierType(form.type));
        const looksLikeCerfa = guessed === "CERFA";
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file,
          // Premier CERFA détecté → marqué CERFA ; sinon si on n'a encore rien
          // de désigné CERFA et que c'est un PDF, on prend le 1er PDF par défaut.
          isCerfa: !noCerfa && looksLikeCerfa && !hasCerfa,
          status: "queued",
        });
      }
      // Si toujours pas de CERFA désigné (hors mode « aucun CERFA »), prend le
      // premier PDF (fallback).
      if (!noCerfa && !next.some(f => f.isCerfa)) {
        const firstPdf = next.find(f => /\.pdf$/i.test(f.file.name));
        if (firstPdf) firstPdf.isCerfa = true;
      }
      return next;
    });
  };

  // Quand le CERFA désigné change, déclenche l'extraction. On lit la liste
  // mise à jour via la callback de setStagedFiles pour ne pas dépendre de
  // l'état périmé.
  useEffect(() => {
    const cerfa = stagedFiles.find(f => f.isCerfa);
    if (!cerfa) {
      setCerfaDone(false);
      setOcrNumero(null);
      return;
    }
    // Re-extraction uniquement quand la cible change.
    void runCerfaExtract(cerfa.file);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stagedFiles.find(f => f.isCerfa)?.id]);

  const setCerfa = (id: string) => {
    setNoCerfa(false);
    setStagedFiles(prev => prev.map(f => ({ ...f, isCerfa: f.id === id })));
  };
  const chooseNoCerfa = () => {
    setNoCerfa(true);
    setStagedFiles(prev => prev.map(f => ({ ...f, isCerfa: false })));
  };
  const removeFile = (id: string) => {
    setStagedFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      // Si on a retiré le CERFA (hors mode « aucun CERFA »), promeut le 1er restant.
      if (!noCerfa && !next.some(f => f.isCerfa) && next.length > 0) next[0]!.isCerfa = true;
      return next;
    });
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitError(null);
    if (!form.petitionnaire_nom.trim()) {
      setSubmitError("Le nom du pétitionnaire est obligatoire.");
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        type: form.type,
        petitionnaire_nom: form.petitionnaire_nom.trim(),
        petitionnaire_prenom: form.petitionnaire_prenom.trim() || undefined,
        petitionnaire_email: form.petitionnaire_email.trim() || undefined,
        adresse: form.adresse.trim() || undefined,
        code_postal: form.code_postal.trim() || undefined,
        commune: form.commune.trim() || undefined,
        parcelle: form.parcelle.trim() || undefined,
        surface_plancher: form.surface_plancher.trim() || undefined,
        description: form.description.trim() || undefined,
        date_depot: form.date_depot || undefined,
        instructeur_id: form.instructeur_id || undefined,
        // N'a d'effet côté API que si un email est renseigné.
        invite_petitionnaire: form.petitionnaire_email.trim() ? form.invite_petitionnaire : false,
      };
      // created_via pilote la génération du CERFA prérempli côté API : en OCR
      // (dossier scanné), la mairie a déjà le vrai CERFA signé dans les pièces
      // numérisées → aucun CERFA prérempli n'est généré.
      const meta: Record<string, unknown> = { created_via: "ocr" };
      if (ocrNumero) meta["numero_cerfa"] = ocrNumero;
      payload["metadata"] = meta;
      const created = await api.post<{ id: string; numero: string }>("/mairie/dossiers", payload);

      // Dépôt groupé : un SEUL PDF déposé = très probablement le dossier complet.
      // Plutôt que de l'attacher comme une pièce CERFA unique, on confie ce PDF
      // à la modale de segmentation (découpage en pièces, validé par l'agent) —
      // le découpage se fait ainsi pendant la phase de dépôt. Si c'était en
      // réalité un simple CERFA, la modale proposera une seule pièce à confirmer.
      const lone = stagedFiles.length === 1 ? stagedFiles[0] : null;
      if (lone && (/pdf/i.test(lone.file.type) || /\.pdf$/i.test(lone.file.name))) {
        setBundleSplit({ dossierId: created.id, numero: created.numero, file: lone.file });
        return; // la suite (confirmation) se fait à la fermeture de la modale ; finally remet submitting à false
      }

      // Upload séquentiel des pièces : on évite de saturer la bande passante
      // côté navigateur (CERFAs scannés à 15 Mo par fichier × N pièces) et on
      // garde un feedback de progression simple. Une erreur sur une pièce
      // n'empêche pas les suivantes : le dossier est déjà créé, l'opérateur
      // pourra rejouer l'ajout depuis l'écran du dossier.
      //
      // Note : depuis le passage de l'OCR en asynchrone côté back, chaque
      // upload retourne en quelques centaines de ms (le temps d'écrire le
      // fichier en stockage et la ligne en DB). L'analyse IA tourne ensuite
      // en arrière-plan et l'instructeur est notifié quand toutes les pièces
      // sont analysées — voir finalize-upload-session ci-dessous.
      if (stagedFiles.length > 0) {
        setUploadProgress({ done: 0, total: stagedFiles.length });
        let done = 0;
        const errors: string[] = [];
        for (const f of stagedFiles) {
          try {
            const fd = new FormData();
            fd.append("file", f.file);
            const code = f.isCerfa ? "CERFA" : guessCodePieceFromName(f.file.name, codeFamilyFromDossierType(form.type));
            if (code) fd.append("code_piece", code);
            fd.append("nom_piece", f.file.name);
            const res = await fetch(`/api/mairie/dossiers/${created.id}/pieces/upload`, {
              method: "POST",
              credentials: "include",
              body: fd,
            });
            if (!res.ok) {
              const body = await res.json().catch(() => ({})) as { error?: string };
              errors.push(`${f.file.name} : ${body.error ?? `Erreur ${res.status}`}`);
            }
          } catch (err) {
            errors.push(`${f.file.name} : ${err instanceof Error ? err.message : "échec"}`);
          } finally {
            done += 1;
            setUploadProgress({ done, total: stagedFiles.length });
          }
        }
        if (errors.length > 0) {
          // Best-effort : on prévient mais on continue vers le détail du dossier
          // pour que l'opérateur voie l'état réel et rejoue les uploads ratés.
          console.warn("[NouveauDossier] uploads en échec :", errors);
        }

        // Signale au back que l'agent a fini de déposer les pièces. Tant que
        // cet appel n'a pas eu lieu, la notification "dossier prêt" reste
        // bloquée — ça évite le faux positif quand l'OCR de la pièce 1 finit
        // avant que la pièce 2 ne soit uploadée.
        try {
          await api.post(`/mairie/dossiers/${created.id}/pieces/finalize-upload-session`, {});
        } catch (err) {
          // Best-effort : l'instructeur recevra quand même la notification au
          // prochain événement sur le dossier, et l'agent voit l'état réel
          // sur l'écran du dossier.
          console.warn("[NouveauDossier] finalize-upload-session:", err);
        }
      }

      // On NE redirige PAS vers le détail du dossier : l'OCR/IA des pièces
      // tourne en arrière-plan et l'instructeur recevra une notification
      // « Dossier prêt à instruire » dès que toutes les pièces seront
      // analysées (cf. pieceOcrQueue.maybeNotifyDossierReady côté API).
      // L'agent au comptoir voit une confirmation et peut fermer la modale.
      setCreatedSummary({ id: created.id, numero: created.numero, piecesCount: stagedFiles.length });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Erreur lors de la création");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };


  const inputStyle = { width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8, fontSize: 13, color: "#374151", outline: "none", boxSizing: "border-box" as const, background: "white" };

  // Dépôt groupé en cours de découpage : la modale de segmentation remplace le
  // wizard. À sa fermeture, on bascule sur l'écran de confirmation. Si l'agent
  // annule le découpage, on rattache quand même le PDF en pièce unique pour ne
  // pas laisser le dossier sans pièce.
  if (bundleSplit) {
    const bs = bundleSplit;
    return (
      <BundleSplitModal
        dossierId={bs.dossierId}
        file={bs.file}
        onClose={(applied, createdCount) => {
          setBundleSplit(null);
          setCreatedSummary({ id: bs.dossierId, numero: bs.numero, piecesCount: applied ? (createdCount ?? 0) : 1 });
          void (async () => {
            if (!applied) {
              try {
                const fd = new FormData();
                fd.append("file", bs.file);
                fd.append("code_piece", "CERFA");
                fd.append("nom_piece", bs.file.name);
                await fetch(`/api/mairie/dossiers/${bs.dossierId}/pieces/upload`, { method: "POST", credentials: "include", body: fd });
              } catch (err) {
                console.warn("[NouveauDossier] rattachement PDF après annulation du découpage:", err);
              }
            }
            await api.post(`/mairie/dossiers/${bs.dossierId}/pieces/finalize-upload-session`, {}).catch(() => {});
          })();
        }}
      />
    );
  }

  // Confirmation post-création : dossier persisté, pièces uploadées, OCR/IA
  // en cours côté worker. On reste sur la modale pour rappeler à l'agent que
  // la suite arrive via la cloche de notification.
  if (createdSummary) return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Dossier enregistré" onClose={onClose} />
      <div style={{ padding: "24px", display: "flex", flexDirection: "column" as const, gap: 16 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 10, padding: "14px 16px" }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>✅</span>
          <div style={{ fontSize: 13, color: "#065F46", lineHeight: 1.55 }}>
            Dossier <strong>{createdSummary.numero}</strong> enregistré
            {createdSummary.piecesCount > 0 && (
              <> avec {createdSummary.piecesCount} pièce{createdSummary.piecesCount > 1 ? "s" : ""}</>
            )}.
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "14px 16px" }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>⏳</span>
          <div style={{ fontSize: 13, color: "#075985", lineHeight: 1.6 }}>
            L'analyse OCR et IA des pièces tourne en arrière-plan.
            <strong> Vous (ou l'instructeur assigné) recevrez une notification dans la cloche dès que le dossier sera prêt à instruire.</strong>
            <div style={{ marginTop: 6, fontSize: 12, color: "#0C4A6E" }}>
              Inutile d'ouvrir le dossier maintenant : tant que la notification n'est pas arrivée, les analyses ne sont pas finalisées.
            </div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
          <button onClick={onClose}
            style={{ background: "#4F46E5", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            Fermer
          </button>
        </div>
      </div>
    </NouveauDossierOverlay>
  );

  const formFields = (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Type de dossier</label>
        <select value={form.type} onChange={e => setField("type", e.target.value as NouveauDossierType)} style={inputStyle}>
          {DOSSIER_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Prénom du pétitionnaire</label>
          <input value={form.petitionnaire_prenom} onChange={e => setField("petitionnaire_prenom", e.target.value)} placeholder="Jean" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Nom du pétitionnaire *</label>
          <input value={form.petitionnaire_nom} onChange={e => setField("petitionnaire_nom", e.target.value)} placeholder="DUPONT" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Email du pétitionnaire</label>
        <input type="email" value={form.petitionnaire_email} onChange={e => setField("petitionnaire_email", e.target.value)} placeholder="jean.dupont@example.com" style={inputStyle} />
        {form.petitionnaire_email.trim() ? (
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.invite_petitionnaire}
              onChange={e => setField("invite_petitionnaire", e.target.checked)}
              style={{ marginTop: 2, cursor: "pointer" }}
            />
            <span style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>
              Inviter le pétitionnaire à suivre son dossier en ligne — un email d'activation de son espace citoyen lui sera envoyé (ou une notification s'il a déjà un compte).
            </span>
          </label>
        ) : (
          <p style={{ fontSize: 12, color: "#9CA3AF", margin: "8px 0 0", lineHeight: 1.5 }}>
            Sans email, aucun espace citoyen n'est créé : le dossier est rattaché à un compte interne non utilisable par le pétitionnaire.
          </p>
        )}
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Adresse du projet</label>
        <input value={form.adresse} onChange={e => setField("adresse", e.target.value)} placeholder="12 rue des Lilas" style={inputStyle} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Code postal</label>
          <input value={form.code_postal} onChange={e => setField("code_postal", e.target.value)} placeholder="37510" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Commune</label>
          <input value={form.commune} onChange={e => setField("commune", e.target.value)} placeholder={commune || "Ballan-Miré"} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Références cadastrales</label>
          <input value={form.parcelle} onChange={e => setField("parcelle", e.target.value)} placeholder="AB 142" style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Surface plancher (m²)</label>
          <input value={form.surface_plancher} onChange={e => setField("surface_plancher", e.target.value)} placeholder="95" style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Description du projet</label>
        <textarea value={form.description} onChange={e => setField("description", e.target.value)} rows={2} placeholder="Construction d'une maison individuelle de 95 m²…" style={{ ...inputStyle, resize: "vertical" as const, fontFamily: "inherit" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10 }}>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Date de dépôt</label>
          <input type="date" value={form.date_depot} onChange={e => setField("date_depot", e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontSize: 12, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>Instructeur assigné</label>
          <select value={form.instructeur_id} onChange={e => setField("instructeur_id", e.target.value)} style={inputStyle}>
            <option value="">— Non assigné —</option>
            {instructeurs.map(i => <option key={i.id} value={i.id}>{i.prenom} {i.nom}</option>)}
          </select>
        </div>
      </div>
    </div>
  );

  const submitLabel = submitting
    ? (uploadProgress ? `Dépôt ${uploadProgress.done}/${uploadProgress.total}…` : "Création…")
    : (stagedFiles.length > 0 ? `Créer le dossier (${stagedFiles.length} pièce${stagedFiles.length > 1 ? "s" : ""})` : "Créer le dossier");

  const footer = (
    <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E8F0" }}>
      {submitError && (
        <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 12, padding: "8px 12px", borderRadius: 6, marginBottom: 10, border: "1px solid #FECACA" }}>{submitError}</div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button onClick={onClose} disabled={submitting} style={{ border: "1px solid #E2E8F0", background: "white", borderRadius: 8, padding: "9px 18px", fontSize: 13, color: "#374151", cursor: submitting ? "not-allowed" : "pointer", fontWeight: 500, opacity: submitting ? 0.6 : 1 }}>Annuler</button>
        <button onClick={submit} disabled={submitting} style={{ background: "linear-gradient(135deg, #4F46E5, #6366F1)", color: "white", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", opacity: submitting ? 0.7 : 1 }}>
          {submitLabel}
        </button>
      </div>
    </div>
  );

  // Un seul fichier déposé = dossier complet : on n'oblige pas à désigner « le
  // CERFA » (trompeur — le PDF contient le CERFA, qui sera détecté au découpage).
  const singleFile = stagedFiles.length === 1;
  const fileList = stagedFiles.length > 0 && (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", background: "#F8FAFC", fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 0.4, display: "flex", justifyContent: "space-between" }}>
        <span>{stagedFiles.length} fichier{stagedFiles.length > 1 ? "s" : ""}</span>
        <span style={{ textTransform: "none" as const, letterSpacing: 0, fontWeight: 500 }}>{singleFile ? "Découpage automatique" : "Choisissez le CERFA"}</span>
      </div>
      {stagedFiles.map(f => {
        const code = f.isCerfa ? "CERFA" : guessCodePieceFromName(f.file.name, codeFamilyFromDossierType(form.type));
        return (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: "1px solid #F1F5F9", fontSize: 13 }}>
            {!singleFile && <input type="radio" checked={f.isCerfa} onChange={() => setCerfa(f.id)} title="Désigner comme CERFA" />}
            <span style={{ fontSize: 16 }}>{/\.pdf$/i.test(f.file.name) ? "📄" : "🖼️"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "#0F172A", whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" as const }}>{f.file.name}</div>
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                {(f.file.size / 1024).toFixed(0)} Ko
                {singleFile
                  ? <> · <span style={{ color: "#4F46E5", fontWeight: 600 }}>dossier complet</span></>
                  : code && <> · <span style={{ color: f.isCerfa ? "#4F46E5" : "#64748b", fontWeight: 600 }}>{code}</span></>}
              </div>
            </div>
            <button onClick={() => removeFile(f.id)} title="Retirer" style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", fontSize: 16, padding: 4 }}>×</button>
          </div>
        );
      })}
      {singleFile && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid #F1F5F9", fontSize: 11.5, color: "#475569", background: "#FAFAFF", lineHeight: 1.5 }}>
          📦 Un seul PDF = dossier complet : ses données pré-remplissent le formulaire, et il sera <strong>découpé en pièces</strong> (CERFA, plans, notice…) à la création.
        </div>
      )}
      {!singleFile && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: "1px solid #F1F5F9", fontSize: 12.5, color: "#475569", cursor: "pointer" }}>
          <input type="radio" checked={noCerfa} onChange={chooseNoCerfa} title="Aucun CERFA dans ce dépôt" />
          Aucun CERFA dans ce dépôt (je remplis le formulaire à la main)
        </label>
      )}
      <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderTop: "1px solid #F1F5F9", background: "#F8FAFC", cursor: "pointer", fontSize: 12, color: "#4F46E5", fontWeight: 600 }}>
        ＋ Ajouter d'autres fichiers
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={e => { if (e.target.files) { addFiles(e.target.files); e.target.value = ""; } }} style={{ display: "none" }} />
      </label>
    </div>
  );

  return (
    <NouveauDossierOverlay onClose={onClose}>
      <NouveauDossierModalHeader title="Nouveau dossier" onClose={onClose} />
      <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: 16 }}>
        {stagedFiles.length > 0 && !submitting && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ fontSize: 16 }}>⚡</span>
            <div style={{ fontSize: 12.5, color: "#075985", lineHeight: 1.5 }}>
              Le dépôt prend quelques secondes — l'analyse OCR des pièces tourne ensuite en arrière-plan.
              <strong> L'instructeur reçoit une notification dès que le dossier est entièrement constitué.</strong>
            </div>
          </div>
        )}
        {submitting && uploadProgress && uploadProgress.done >= uploadProgress.total && uploadProgress.total > 0 && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, padding: "10px 14px" }}>
            <span style={{ fontSize: 16 }}>✅</span>
            <div style={{ fontSize: 12.5, color: "#065F46", lineHeight: 1.5 }}>
              Pièces déposées. L'analyse OCR se poursuit en arrière-plan — vous (ou l'instructeur assigné) recevrez une notification dès que tout est prêt.
            </div>
          </div>
        )}
        {stagedFiles.length === 0 ? (
          <>
            <label style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", border: "2px dashed #CBD5E1", borderRadius: 12, padding: "40px 24px", cursor: "pointer", gap: 10, background: "#F8FAFC" }}>
              <span style={{ fontSize: 36 }}>📂</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>Déposez vos fichiers ici</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>CERFA + plans + photos — PDF, JPG, PNG (max 25 Mo / fichier)</div>
              <div style={{ background: "#4F46E5", color: "white", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 600 }}>Choisir des fichiers</div>
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={e => { if (e.target.files) addFiles(e.target.files); }} style={{ display: "none" }} />
            </label>
            {ocrError && (
              <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 13, padding: "12px 14px", borderRadius: 8, border: "1px solid #FECACA" }}>
                <strong>Échec de l'extraction.</strong> {ocrError}
              </div>
            )}
          </>
        ) : (
          <>
            {fileList}
            {cerfaScanning ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#EEF2FF", borderRadius: 8, padding: "10px 14px", border: "1px solid #C7D2FE" }}>
                <span style={{ fontSize: 18 }}>🔍</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#3730A3" }}>Analyse des documents en cours…</div>
                  <div style={{ marginTop: 6, height: 4, background: "#E0E7FF", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", background: "linear-gradient(90deg,#4F46E5,#6366F1)", borderRadius: 2, width: "60%" }} />
                  </div>
                </div>
              </div>
            ) : ocrError ? (
              <div style={{ background: "#FEF2F2", color: "#B91C1C", fontSize: 13, padding: "12px 14px", borderRadius: 8, border: "1px solid #FECACA" }}>
                <strong>L'extraction du CERFA a échoué.</strong> {ocrError} Vous pouvez quand même remplir le formulaire à la main et créer le dossier — toutes les pièces seront jointes.
              </div>
            ) : cerfaDone ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F0FDF4", borderRadius: 8, padding: "10px 14px", border: "1px solid #BBF7D0" }}>
                <span style={{ fontSize: 18 }}>✅</span>
                <div style={{ fontSize: 13, color: "#15803D", fontWeight: 500 }}>
                  Données extraites du CERFA{ocrNumero ? ` n° ${ocrNumero}` : ""}. Vérifiez et corrigez si besoin.
                </div>
              </div>
            ) : null}
            {formFields}
          </>
        )}
      </div>
      {stagedFiles.length > 0 && footer}
    </NouveauDossierOverlay>
  );
}
