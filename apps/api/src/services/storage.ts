/**
 * Abstraction du stockage des fichiers déposés par les pétitionnaires.
 *
 * Deux implémentations interchangeables via STORAGE_PROVIDER :
 *  - "local" (défaut)  → disque local sous apps/api/uploads/ (dev + VPS OVH actuel)
 *  - "s3"              → service S3-compatible (OVH Object Storage / Scaleway / AWS S3)
 *
 * Pourquoi cette abstraction :
 *  - Découpler la persistance des fichiers du système de fichiers de l'hôte,
 *    pour pouvoir basculer sans changer le code applicatif.
 *  - Pré-requis pour SecNumCloud / 3DS Outscale (Phase 7).
 *
 * Tous les chemins applicatifs (routes/dossiers, auth, jobs/scheduler,
 * services/piece*) doivent passer par cette abstraction et plus jamais
 * manipuler fs directement.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { Buffer } from "node:buffer";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  NoSuchKey,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCAL_UPLOADS_DIR = path.resolve(__dirname, "../../uploads");

export interface StoredFile {
  /** Identifiant unique sans extension de chemin (ex: "a1b2c3.pdf"). */
  key: string;
  /** URL relative utilisée par le frontend (ex: "/api/uploads/a1b2c3.pdf"). */
  url: string;
  /** Taille en octets. */
  size: number;
  /** Type MIME tel que reçu de multer. */
  mime: string;
}

export interface PutInput {
  /** Identifiant final du fichier (généré côté appelant — typiquement UUID + extension). */
  key: string;
  /** Contenu binaire à stocker. */
  body: Buffer;
  /** Type MIME pour Content-Type côté S3. */
  mime: string;
}

/** Descripteur d'un flux de lecture — utilisé par la route /api/uploads
 *  pour streamer le fichier sans exposer d'URL S3 expirante au navigateur. */
export interface StoredStream {
  stream: Readable;
  contentType?: string;
  contentLength?: number;
}

export interface StorageProvider {
  /** Identifiant du provider, pour logs et probes. */
  readonly name: "local" | "s3";

  /** Écrit un fichier et retourne son descripteur. */
  put(input: PutInput): Promise<StoredFile>;

  /** Récupère le contenu binaire d'un fichier — utilisé par les services
   *  d'analyse IA qui doivent passer le buffer au LLM. */
  getBuffer(key: string): Promise<Buffer>;

  /** Ouvre un flux de lecture sur le fichier — utilisé par la route Express
   *  qui sert les pièces jointes en proxy (pas de redirection vers une URL
   *  signée qui expirerait dans le cache navigateur). */
  getStream(key: string): Promise<StoredStream>;

  /** Génère une URL signée (temporaire) pour téléchargement direct par le
   *  navigateur. Sur le provider "local", retourne simplement l'URL publique
   *  servie par Express. */
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /** Supprime un fichier (idempotent : pas d'erreur si déjà absent). */
  remove(key: string): Promise<void>;

  /** Suppression en lot — RGPD art. 17 lors de la suppression de compte
   *  ou de la purge des brouillons abandonnés (cf. jobs/scheduler.ts). */
  removeBulk(keys: string[]): Promise<{ deleted: number; failed: number }>;

  /** Helper : extrait la "key" d'une URL stockée en base. Gère les anciens
   *  enregistrements créés sous "local" même si on est passé à "s3". */
  keyFromUrl(url: string): string;
}

// ── Helpers communs ─────────────────────────────────────────────────────────

/** Extrait la dernière partie d'une URL "/api/uploads/<key>" — partagé par
 *  les deux providers car les anciens enregistrements en base utilisent
 *  ce format historique. */
function keyFromLegacyUrl(url: string): string {
  const tail = url.split("/").pop();
  if (!tail) throw new Error(`URL invalide pour extraction de clé : ${url}`);
  return tail;
}

// ── Provider LOCAL (disque local — défaut sur le VPS OVH et en dev) ─────────

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  private readonly dir: string;

  constructor(dir = DEFAULT_LOCAL_UPLOADS_DIR) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async put({ key, body, mime }: PutInput): Promise<StoredFile> {
    const filePath = path.join(this.dir, key);
    fs.writeFileSync(filePath, body);
    return { key, url: `/api/uploads/${key}`, size: body.length, mime };
  }

  async getBuffer(key: string): Promise<Buffer> {
    return fs.promises.readFile(path.join(this.dir, key));
  }

  async getStream(key: string): Promise<StoredStream> {
    const filePath = path.join(this.dir, key);
    const stat = await fs.promises.stat(filePath);
    return {
      stream: fs.createReadStream(filePath),
      contentLength: stat.size,
    };
  }

  async getDownloadUrl(key: string): Promise<string> {
    // Servi par express.static sur /api/uploads (cf. apps/api/src/app.ts).
    // Pas de signature : l'authentification se fait au niveau Express middleware.
    return `/api/uploads/${key}`;
  }

  async remove(key: string): Promise<void> {
    try {
      await fs.promises.unlink(path.join(this.dir, key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async removeBulk(keys: string[]): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;
    for (const key of keys) {
      try {
        await this.remove(key);
        deleted++;
      } catch {
        failed++;
      }
    }
    return { deleted, failed };
  }

  keyFromUrl(url: string): string {
    return keyFromLegacyUrl(url);
  }
}

// ── Provider S3 (Cellar / Scaleway OS / OVH OS / AWS S3) ────────────────────

export interface S3Config {
  endpoint?: string;       // URL S3 (omettre pour AWS S3 natif)
  region: string;          // ex: "fr-par", "eu-central-1"
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public read base URL (Cellar : https://<bucket>.cellar-c2.services.clever-cloud.com).
   *  Optionnel — si fourni, les URL renvoyées par getDownloadUrl peuvent être
   *  publiques quand le bucket l'autorise. Sinon on génère une URL signée. */
  publicBaseUrl?: string;
}

export class S3StorageProvider implements StorageProvider {
  readonly name = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | null;

  constructor(cfg: S3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      // forcePathStyle nécessaire pour Cellar/Scaleway/OVH (path-style URLs).
      // AWS S3 natif accepte les deux.
      forcePathStyle: !!cfg.endpoint,
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
    this.bucket = cfg.bucket;
    this.publicBaseUrl = cfg.publicBaseUrl ?? null;
  }

  async put({ key, body, mime }: PutInput): Promise<StoredFile> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: mime,
    }));
    // L'URL côté frontend reste sous /api/uploads/<key> ; la route Express
    // se chargera de rediriger vers une URL signée à la volée. Cela évite
    // d'exposer la structure S3 dans les liens stockés en base.
    return { key, url: `/api/uploads/${key}`, size: body.length, mime };
  }

  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    if (!res.Body) throw new Error(`Body vide pour ${key}`);
    // res.Body est un Readable (Node) sur Node 20+.
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  }

  async getStream(key: string): Promise<StoredStream> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    if (!res.Body) throw new Error(`Body vide pour ${key}`);
    return {
      stream: res.Body as Readable,
      contentType: res.ContentType,
      contentLength: typeof res.ContentLength === "number" ? res.ContentLength : undefined,
    };
  }

  async getDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(key)}`;
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }));
    } catch (err) {
      // L'idempotence n'est pas garantie sur tous les S3-compatibles : on
      // ne lève pas si le fichier n'existait pas.
      if (!(err instanceof NoSuchKey)) {
        const code = (err as { name?: string }).name;
        if (code !== "NoSuchKey" && code !== "NotFound") throw err;
      }
    }
  }

  async removeBulk(keys: string[]): Promise<{ deleted: number; failed: number }> {
    if (keys.length === 0) return { deleted: 0, failed: 0 };
    // DeleteObjects accepte jusqu'à 1000 clés par requête.
    let deleted = 0;
    let failed = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      try {
        const res = await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }));
        deleted += batch.length - (res.Errors?.length ?? 0);
        failed += res.Errors?.length ?? 0;
      } catch {
        failed += batch.length;
      }
    }
    return { deleted, failed };
  }

  /** Vérifie l'existence d'un objet (probe au boot). */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  keyFromUrl(url: string): string {
    return keyFromLegacyUrl(url);
  }
}

// ── Factory singleton ───────────────────────────────────────────────────────

let _instance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (_instance) return _instance;
  const which = (process.env.STORAGE_PROVIDER ?? "local").toLowerCase();
  if (which === "s3") {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION;
    const bucket = process.env.S3_BUCKET;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL;
    if (!region || !bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "[storage] STORAGE_PROVIDER=s3 mais variables manquantes : S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY sont obligatoires.",
      );
    }
    _instance = new S3StorageProvider({
      endpoint,
      region,
      bucket,
      accessKeyId,
      secretAccessKey,
      publicBaseUrl,
    });
    console.log(`[storage] 🇪🇺 Provider actif : S3 (endpoint=${endpoint ?? "AWS natif"}, region=${region}, bucket=${bucket})`);
  } else {
    _instance = new LocalStorageProvider();
    console.log(`[storage] 💾 Provider actif : disque local (${DEFAULT_LOCAL_UPLOADS_DIR})`);
  }
  return _instance;
}

/** Utilisé par les tests pour réinitialiser le singleton entre cas. */
export function _resetStorageProviderForTests(): void {
  _instance = null;
}
