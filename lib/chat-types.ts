/** Chat shapes shared by the server and the browser (no database access here). */

export type ChannelSummary = {
  id: string;
  kind: "channel" | "dm";
  /** "#general" or the other person's name */
  label: string;
  topic: string;
  archived: boolean;
  unread: number;
  /** the other person in a DM */
  otherUserId: string | null;
  online: boolean;
  lastAt: Date | null;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  body: string;
  file: { id: string; name: string; mimeType: string; sizeBytes: number } | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  mine: boolean;
};

/** One "what changed since" answer, from the stream or the polling fallback. */
export type ChatSync = {
  now: string;
  changes: ChatMessage[];
  typing: string[];
  online: string[];
  conversations: Array<{ id: string; unread: number; online: boolean }>;
  unreadTotal: number;
  notificationsUnread: number;
};
