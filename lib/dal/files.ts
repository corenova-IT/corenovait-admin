import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isProduction } from "@/lib/env";
import type { AppModule } from "@/lib/permissions";
import { actorRef, writeAudit } from "./audit";
import { RuleError, hasPerm, requirePerm, rowAllowed, type Actor } from "./guard";
import { financeRecordVisible } from "./finance";

/**
 * Uploads live in UPLOAD_DIR, outside the app folder and the public web root,
 * under random names. They are only ever served by app/api/files/[id], which
 * calls getFileForDownload below.
 */
export const MAX_UPLOAD_BYTES = (Number(process.env.UPLOAD_MAX_MB ?? 10) || 10) * 1024 * 1024;

/** The allow-list. The type is decided from the file's first bytes, never from its name. */
const TYPES: Array<{ mime: string; ext: string; sniff: (b: Buffer) => boolean }> = [
  { mime: "application/pdf", ext: "pdf", sniff: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "image/png", ext: "png", sniff: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", sniff: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", sniff: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];
export const ALLOWED_MIME = TYPES.map((t) => t.mime);

export function sniffType(bytes: Buffer) {
  return TYPES.find((t) => t.sniff(bytes)) ?? null;
}

export function uploadDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("UPLOAD_DIR must be an absolute path");
    return configured;
  }
  if (isProduction()) throw new Error("Set UPLOAD_DIR to a folder outside the app and public_html");
  return path.resolve(process.cwd(), ".uploads");
}

const KEY = /^[a-f0-9]{32}$/;

function cleanName(name: string, ext: string) {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 150) || "file";
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

export async function saveUpload(
  actor: Actor,
  input: { module: AppModule; entityType?: string; entityId?: string; name: string; bytes: Buffer }
): Promise<{ id: string; mimeType: string; sizeBytes: number }> {
  requirePerm(actor, input.module, "create");
  if (input.bytes.length === 0) throw new RuleError("That file is empty.");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new RuleError(`Files can be up to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  const type = sniffType(input.bytes);
  if (!type) throw new RuleError("Upload a PDF, PNG, JPG or WebP file.");

  const dir = uploadDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const storageKey = randomBytes(16).toString("hex");
  await writeFile(path.join(dir, storageKey), input.bytes, { mode: 0o600, flag: "wx" });

  const id = crypto.randomUUID();
  const row = {
    id,
    module: input.module,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    originalName: cleanName(input.name, type.ext),
    mimeType: type.mime,
    sizeBytes: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    storageKey,
    uploadedBy: actor.userId,
  };
  await getDb().transaction(async (tx) => {
    await tx.insert(schema.files).values(row);
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "files", entityId: id, summary: `Uploaded ${row.originalName}`, after: { ...row, storageKey: undefined } });
  });
  return { id, mimeType: type.mime, sizeBytes: row.sizeBytes };
}

/**
 * Null when the file doesn't exist OR the caller may not see it, so the
 * route answers 404 either way and doesn't confirm that an ID exists.
 */
export async function getFileForDownload(actor: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [f] = await getDb().select().from(schema.files).where(eq(schema.files.id, id));
  if (!f || !hasPerm(actor, f.module, "view")) return null;
  const linkedOk = f.entityType && f.entityId && f.module === "transactions" ? await financeRecordVisible(actor, f.entityType, f.entityId) : false;
  if (!linkedOk && !rowAllowed(actor, f.module, { ownerId: f.uploadedBy })) return null;
  if (!KEY.test(f.storageKey)) return null;
  const bytes = await readFile(path.join(uploadDir(), f.storageKey));
  return { name: f.originalName, mimeType: f.mimeType, bytes };
}
