/** The upload allow-list. The type is decided from the file's first bytes, never from its name. */
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
