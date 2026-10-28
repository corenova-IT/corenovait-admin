/** The top-bar search: results grouped by page. Shared by the data layer and the results page. */
export type SearchHit = { key: string; title: string; detail: string; href: string };
export type SearchGroup = { id: string; label: string; hits: SearchHit[]; /** a link to the page's own filtered list, when it has one */ moreHref?: string };

export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
export const SEARCH_PER_GROUP = 5;

/** A LIKE pattern for a typed term, with the wildcards in it escaped. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
