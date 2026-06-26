import crypto from "crypto";

// ── Déchargement coopératif des opérations CPU lourdes (durcissement § 1.3b) ──
//
// `Buffer.toString("base64")` et `crypto.createHash("sha256").update(buf)` sont
// du C++ natif SYNCHRONE : sur un gros buffer ils monopolisent l'event loop.
// Mesuré sur cette machine (l'API tourne en mono-instance `fork` — un seul event
// loop sert TOUTES les requêtes) :
//
//     taille | base64 encode | sha256
//      20 Mo |     ~13 ms    |  ~53 ms
//      60 Mo |     ~41 ms    | ~159 ms
//
// Pendant ces millisecondes, plus aucune autre requête n'avance — pas même le
// healthcheck. Les uploads vont jusqu'à 60 Mo (espace mairie) : un seul hash peut
// donc geler l'API ~160 ms, et ces gels se cumulent sous concurrence en latence
// subie par tout le monde.
//
// Solution : on découpe le buffer en tranches et on rend la main à l'event loop
// (`setImmediate`) entre chaque tranche. Le coût CPU total est identique mais
// ÉTALÉ — entre deux tranches, les autres requêtes/timers en attente sont
// traités. La responsivité est préservée sans changer de modèle d'exécution.
//
// Pourquoi PAS `worker_threads` : pour cette magnitude (≤ ~160 ms, chemins
// d'analyse déjà plafonnés à 30 Mo et sérialisés par la file OCR), un pool de
// workers (transfert/clonage des buffers, cycle de vie, point d'entrée distinct
// à gérer dans le bundle tsup) serait disproportionné. Le découpage coopératif
// suffit et reste trivial à bundler. À reconsidérer si l'on passe en
// multi-instances (Palier 4) ou si des buffers >> 60 Mo deviennent fréquents sur
// le chemin requête.
//
// Sous le seuil, on conserve le chemin natif synchrone : il est plus rapide et le
// gel (<~20 ms) est négligeable — inutile de payer le surcoût des `setImmediate`.

const yieldToEventLoop = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

// Au-delà de ce seuil (octets), on découpe + cède la main. Défaut 8 Mo
// (~20 ms de sha256), surchargeable pour ajuster sans redéploiement.
const THRESHOLD = Math.max(0, Number(process.env.CPU_YIELD_THRESHOLD_BYTES) || 8 * 1024 * 1024);

// Taille d'une tranche (octets) : ~5 ms de sha256 par tranche → cession
// fréquente sans multiplier inutilement les ticks. Multiple de 12 (= 3 × 4) pour
// retomber sur les frontières base64 (3 octets encodés → 4 caractères) sans
// arithmétique supplémentaire.
const CHUNK = (() => {
  const raw = Math.max(12, Number(process.env.CPU_CHUNK_BYTES) || 2 * 1024 * 1024);
  return raw - (raw % 12);
})();

/** SHA-256 (hex) d'un buffer, en cédant la main pour les gros buffers. */
export async function sha256HexAsync(buf: Buffer): Promise<string> {
  if (buf.length <= THRESHOLD) {
    return crypto.createHash("sha256").update(buf).digest("hex");
  }
  const hash = crypto.createHash("sha256");
  for (let i = 0; i < buf.length; i += CHUNK) {
    hash.update(buf.subarray(i, i + CHUNK));
    if (i + CHUNK < buf.length) await yieldToEventLoop();
  }
  return hash.digest("hex");
}

/**
 * SHA-256 (hex) de la CONCATÉNATION de plusieurs buffers (mêmes octets que de
 * hacher leur concat), en cédant la main au fil des tranches. Utilisé pour le
 * hash agrégé d'un lot de pièces (cache + traçabilité) sans bloquer l'event loop
 * quand le lot est volumineux.
 */
export async function sha256HexConcatAsync(bufs: Buffer[]): Promise<string> {
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const hash = crypto.createHash("sha256");
  if (total <= THRESHOLD) {
    for (const b of bufs) hash.update(b);
    return hash.digest("hex");
  }
  for (const b of bufs) {
    for (let i = 0; i < b.length; i += CHUNK) {
      hash.update(b.subarray(i, i + CHUNK));
      await yieldToEventLoop();
    }
  }
  return hash.digest("hex");
}

/**
 * Encode un buffer en base64, en cédant la main pour les gros buffers.
 * base64 encode 3 octets → 4 caractères, sans état entre groupes : tant que
 * chaque tranche (sauf la dernière) fait un multiple de 3 octets, concaténer les
 * encodages par tranche == encoder le buffer entier (aucun padding intermédiaire).
 * `CHUNK` est multiple de 12 (donc de 3), la propriété est garantie.
 */
export async function toBase64Async(buf: Buffer): Promise<string> {
  if (buf.length <= THRESHOLD) return buf.toString("base64");
  const parts: string[] = [];
  for (let i = 0; i < buf.length; i += CHUNK) {
    parts.push(buf.subarray(i, i + CHUNK).toString("base64"));
    if (i + CHUNK < buf.length) await yieldToEventLoop();
  }
  return parts.join("");
}
