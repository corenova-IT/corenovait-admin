/**
 * Profile pictures. The URL carries the time the picture last changed, so a
 * new picture shows straight away while an unchanged one can be cached.
 * Null means "no picture": show the initials.
 */
export function avatarUrl(userId: string | null | undefined, updatedAt: Date | string | null | undefined): string | null {
  if (!userId || !updatedAt) return null;
  const v = typeof updatedAt === "string" ? new Date(updatedAt).getTime() : updatedAt.getTime();
  return `/api/avatars/${userId}?v=${v}`;
}

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE = 512;
