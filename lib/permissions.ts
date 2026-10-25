export const MODULES = [
  "home",
  "finances",
  "transactions",
  "payments",
  "streams",
  "countries",
  "representatives",
  "marketing",
  "calendar",
  "tasks",
  "chat",
  "team",
  "settings",
  "audit",
] as const;
export type AppModule = (typeof MODULES)[number];

export const ACTIONS = ["view", "create", "edit", "delete", "export"] as const;
export type AppAction = (typeof ACTIONS)[number];

export const SCOPES = ["own", "assigned", "all"] as const;
export type DataScope = (typeof SCOPES)[number];

export const MODULE_LABELS: Record<AppModule, string> = {
  home: "Home",
  finances: "Finances (analytics)",
  transactions: "Transactions",
  payments: "Payments & subscriptions",
  streams: "Revenue streams",
  countries: "Countries",
  representatives: "Representatives",
  marketing: "Marketing",
  calendar: "Calendar",
  tasks: "Tasks",
  chat: "Team chat",
  team: "Team & permissions",
  settings: "Settings",
  audit: "Audit log",
};

export const SCOPE_LABELS: Record<DataScope, string> = {
  own: "Own",
  assigned: "Assigned",
  all: "All",
};

/**
 * Any access to these modules makes two-factor required (as does the Admin
 * preset). Everyone else may turn it on but doesn't have to.
 */
export const PRIVILEGED_MODULES: AppModule[] = ["finances", "transactions", "team", "settings", "audit"];

export type PermRow = {
  module: AppModule;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_export: boolean;
  scope: DataScope;
};

export type ModulePerm = Record<AppAction, boolean> & { scope: DataScope };
export type PermMap = Record<AppModule, ModulePerm>;

const none = (): ModulePerm => ({ view: false, create: false, edit: false, delete: false, export: false, scope: "own" });

export function emptyPermMap(): PermMap {
  return Object.fromEntries(MODULES.map((m) => [m, none()])) as PermMap;
}

export function toPermMap(rows: PermRow[] | null | undefined): PermMap {
  const map = emptyPermMap();
  for (const r of rows ?? []) {
    map[r.module] = {
      view: r.can_view,
      create: r.can_create,
      edit: r.can_edit,
      delete: r.can_delete,
      export: r.can_export,
      scope: r.scope,
    };
  }
  return map;
}

/** For the admin RPCs: only modules with at least one action are sent. */
export function permMapToPayload(map: PermMap) {
  return MODULES.filter((m) => ACTIONS.some((a) => map[m][a])).map((m) => ({ module: m, ...map[m] }));
}

export function can(map: PermMap, module: AppModule, action: AppAction = "view"): boolean {
  return map[module]?.[action] ?? false;
}
