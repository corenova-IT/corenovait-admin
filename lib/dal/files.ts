import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isProduction } from "@/lib/env";
import { sniffType } from "@/lib/file-types";
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

export { ALLOWED_MIME, sniffType } from "@/lib/file-types";

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
  input: { module: AppModule; entityType?: string; entityId?: string; name: string; bytes: Buffer; private?: boolean }
): Promise<{ id: string; mimeType: string; sizeBytes: number }> {
  // attaching a receipt is part of adding OR editing a record
  if (!hasPerm(actor, input.module, "create") && !hasPerm(actor, input.module, "edit")) requirePerm(actor, input.module, "create");
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
    // private (chat): the audit log records that a file was added, not its name, so admins can't read DMs through it
    if (input.private) await writeAudit(tx, actorRef(actor), { action: "create", entity: "files", entityId: id, summary: "Uploaded a chat attachment" });
    else await writeAudit(tx, actorRef(actor), { action: "create", entity: "files", entityId: id, summary: `Uploaded ${row.originalName}`, after: { ...row, storageKey: undefined } });
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
  // chat attachments: only members of that channel or DM, never the uploader or an admin outside it
  if (f.module === "chat") {
    if (f.entityType !== "chat_messages" || !f.entityId || !(await chatAttachmentVisible(actor, f.entityId, f.id))) return null;
    if (!KEY.test(f.storageKey)) return null;
    return { name: f.originalName, mimeType: f.mimeType, bytes: await readFile(path.join(uploadDir(), f.storageKey)) };
  }
  const linkedOk = f.entityType && f.entityId && f.module === "transactions" ? await financeRecordVisible(actor, f.entityType, f.entityId) : false;
  if (!linkedOk && !rowAllowed(actor, f.module, { ownerId: f.uploadedBy })) return null;
  if (!KEY.test(f.storageKey)) return null;
  const bytes = await readFile(path.join(uploadDir(), f.storageKey));
  return { name: f.originalName, mimeType: f.mimeType, bytes };
}

/** The message still has this file, isn't deleted, and the caller is a member of its conversation. */
async function chatAttachmentVisible(actor: Actor, messageId: string, fileId: string): Promise<boolean> {
  const db = getDb();
  const [msg] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, messageId));
  if (!msg || msg.deletedAt || msg.fileId !== fileId) return false;
  const [member] = await db
    .select({ userId: schema.chatMembers.userId })
    .from(schema.chatMembers)
    .where(and(eq(schema.chatMembers.channelId, msg.channelId), eq(schema.chatMembers.userId, actor.userId)));
  return !!member;
}

/**
 * Clean-up (run by the scheduler): chat attachments no message points to any
 * more, from deleted or admin-removed messages, or an upload whose message
 * was never saved. Removed from disk and from the database. Uploads younger
 * than an hour are left alone, in case their message is still being sent.
 * One audit entry with the count; no file names (they may come from DMs).
 */
export async function cleanupOrphanedChatFiles(now = new Date(), graceMinutes = 60): Promise<number> {
  const db = getDb();
  const candidates = await db
    .select({ id: schema.files.id, storageKey: schema.files.storageKey, entityId: schema.files.entityId, linked: schema.chatMessages.fileId })
    .from(schema.files)
    .leftJoin(schema.chatMessages, eq(schema.chatMessages.id, schema.files.entityId))
    .where(and(eq(schema.files.module, "chat"), lt(schema.files.createdAt, new Date(now.getTime() - graceMinutes * 60_000))))
    .limit(500);
  const orphans = candidates.filter((c) => c.linked !== c.id);
  if (!orphans.length) return 0;
  for (const f of orphans) {
    if (!KEY.test(f.storageKey)) continue;
    try {
      await unlink(path.join(uploadDir(), f.storageKey));
    } catch (e) {
      // already gone from disk is fine; anything else, keep the row and try again next run
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") continue;
    }
    await db.delete(schema.files).where(eq(schema.files.id, f.id));
  }
  const remaining = await db.select({ id: schema.files.id }).from(schema.files).where(inArray(schema.files.id, orphans.map((o) => o.id)));
  const removed = orphans.length - remaining.length;
  if (removed) await writeAudit(db, null, { action: "delete", entity: "files", summary: `Clean-up: removed ${removed} chat attachment${removed === 1 ? "" : "s"} no longer attached to a message` });
  return removed;
}
