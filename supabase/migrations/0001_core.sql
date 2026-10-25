-- =====================================================================
-- CoreNovaIT admin portal: core schema (users, permissions, audit, settings)
--
-- Permissions are enforced HERE, in the database. The app hides buttons for
-- convenience only. Every table has row-level security, and all privileged
-- changes go through SECURITY DEFINER functions that check the caller.
-- =====================================================================

-- ---------- enums ----------
create type public.app_module as enum (
  'home', 'finances', 'transactions', 'payments', 'streams', 'countries',
  'representatives', 'marketing', 'calendar', 'tasks', 'chat', 'team',
  'settings', 'audit'
);
create type public.app_action as enum ('view', 'create', 'edit', 'delete', 'export');
-- own      = rows the user created
-- assigned = rows assigned to the user (or invited to), plus their own
-- all      = every row
create type public.data_scope as enum ('own', 'assigned', 'all');

-- ---------- settings (single row) ----------
create table public.settings (
  id boolean primary key default true check (id),
  company_name text not null default 'CoreNovaIT' check (length(company_name) between 1 and 120),
  base_currency char(3) not null default 'AUD' check (base_currency ~ '^[A-Z]{3}$'),
  timezone text not null default 'Australia/Sydney' check (length(timezone) between 1 and 64),
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

-- ---------- role presets ----------
create table public.role_presets (
  id text primary key check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),
  name text not null check (length(name) between 1 and 60),
  description text not null default '',
  sort int not null default 100
);

create table public.preset_permissions (
  preset_id text not null references public.role_presets (id) on delete cascade,
  module public.app_module not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_export boolean not null default false,
  scope public.data_scope not null default 'own',
  primary key (preset_id, module)
);

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (length(full_name) <= 120),
  job_title text not null default '' check (length(job_title) <= 120),
  -- 'custom' means the matrix was edited by hand and no longer follows a preset
  preset_id text not null default 'staff' references public.role_presets (id),
  active boolean not null default false,
  -- true for anyone with access to team, settings or audit: they must use TOTP
  mfa_required boolean not null default false,
  -- access tokens issued before this moment are rejected by the app
  sessions_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- the effective, per-person permission matrix (source of truth for has_perm)
create table public.user_permissions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  module public.app_module not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_export boolean not null default false,
  scope public.data_scope not null default 'own',
  primary key (user_id, module)
);

-- ---------- audit log (append-only) ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null check (action in (
    'create', 'update', 'delete', 'export', 'sign_in', 'sign_out', 'invite',
    'permissions', 'preset', 'sessions_reset', 'activate', 'deactivate'
  )),
  entity text not null,
  entity_id text,
  summary text,
  before jsonb,
  after jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_entity_idx on public.audit_log (entity, at desc);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);

-- =====================================================================
-- Helper functions
-- =====================================================================

-- Authenticator assurance level of the current request ('aal1' or 'aal2')
create function public.current_aal() returns text
language sql stable
set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1') $$;

-- The caller's profile if it is active and its MFA requirement is satisfied
create function public.caller_ok() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active
      and (not p.mfa_required or public.current_aal() = 'aal2')
  )
$$;

create function public.has_perm(p_module public.app_module, p_action public.app_action)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.caller_ok() and exists (
    select 1 from public.user_permissions up
    where up.user_id = auth.uid()
      and up.module = p_module
      and case p_action
            when 'view' then up.can_view
            when 'create' then up.can_create
            when 'edit' then up.can_edit
            when 'delete' then up.can_delete
            when 'export' then up.can_export
          end
  )
$$;

-- The caller's data scope for a module, or null if they have no access
create function public.perm_scope(p_module public.app_module) returns public.data_scope
language sql stable security definer
set search_path = ''
as $$
  select up.scope from public.user_permissions up
  where up.user_id = auth.uid() and up.module = p_module and public.caller_ok()
$$;

-- Row-level check: may the caller perform p_action on a row owned by
-- p_owner and assigned to p_assignee, given their scope for p_module?
create function public.row_allowed(
  p_module public.app_module, p_action public.app_action, p_owner uuid, p_assignee uuid
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.has_perm(p_module, p_action) and case public.perm_scope(p_module)
    when 'all' then true
    when 'assigned' then auth.uid() = p_owner or auth.uid() = p_assignee
    when 'own' then auth.uid() = p_owner
    else false
  end
$$;

create function public.is_admin() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.caller_ok() and exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.preset_id = 'admin'
  )
$$;

create function public.active_admin_count() returns int
language sql stable security definer
set search_path = ''
as $$ select count(*)::int from public.profiles where preset_id = 'admin' and active $$;

-- internal: write one audit row as the current caller
create function public.write_audit(
  p_action text, p_entity text, p_entity_id text, p_summary text, p_before jsonb, p_after jsonb
) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, summary, before, after)
  values (
    auth.uid(),
    (select email from public.profiles where id = auth.uid()),
    p_action, p_entity, p_entity_id, p_summary, p_before, p_after
  )
$$;

-- internal: a user's permission matrix as JSON (for audit before/after)
create function public.permissions_json(p_user uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'module', module, 'view', can_view, 'create', can_create, 'edit', can_edit,
    'delete', can_delete, 'export', can_export, 'scope', scope) order by module), '[]'::jsonb)
  from public.user_permissions where user_id = p_user
$$;

-- internal: privileged modules require TOTP
create function public.recompute_mfa(p_user uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.profiles p set mfa_required = (
    p.preset_id = 'admin' or exists (
      select 1 from public.user_permissions up
      where up.user_id = p_user and up.module in ('team', 'settings', 'audit')
        and (up.can_view or up.can_create or up.can_edit or up.can_delete or up.can_export)
    )
  ), updated_at = now()
  where p.id = p_user
$$;

-- internal: replace a user's matrix with a preset's
create function public.copy_preset(p_user uuid, p_preset text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  delete from public.user_permissions where user_id = p_user;
  insert into public.user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, can_export, scope)
  select p_user, module, can_view, can_create, can_edit, can_delete, can_export, scope
  from public.preset_permissions where preset_id = p_preset;
  update public.profiles set preset_id = p_preset, updated_at = now() where id = p_user;
  perform public.recompute_mfa(p_user);
end
$$;

-- =====================================================================
-- New users: always least privilege. No public sign-up exists; a user is only
-- active if they were invited by an admin or provisioned by the seed script
-- (app_metadata can only be set with the service-role key).
-- =====================================================================
create function public.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, active)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120),
    new.invited_at is not null
      or coalesce((new.raw_app_meta_data ->> 'provisioned')::boolean, false)
  );
  perform public.copy_preset(new.id, 'staff');
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.sync_user_email() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, ''), updated_at = now() where id = new.id;
  return new;
end
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.sync_user_email();

-- =====================================================================
-- Generic row audit trigger (finance records, settings, profiles):
-- stores full before and after values.
-- =====================================================================
create function public.audit_row() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_after jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
begin
  if tg_op = 'UPDATE' and (v_before - 'updated_at') = (v_after - 'updated_at') then
    return new;
  end if;
  perform public.write_audit(
    case tg_op when 'INSERT' then 'create' when 'UPDATE' then 'update' else 'delete' end,
    tg_table_name,
    coalesce(v_after, v_before) ->> 'id',
    null,
    v_before,
    v_after
  );
  return coalesce(new, old);
end
$$;

create trigger audit_settings after insert or update or delete on public.settings
  for each row execute function public.audit_row();
create trigger audit_profiles after update or delete on public.profiles
  for each row execute function public.audit_row();

-- =====================================================================
-- Admin RPCs (the Team and permissions page). All require an active admin
-- who has passed two-factor (is_admin() checks aal2).
-- =====================================================================
create function public.assert_admin() returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin with two-factor verified can do this' using errcode = '42501';
  end if;
end
$$;

create function public.admin_set_user_details(p_user uuid, p_full_name text, p_job_title text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.profiles
  set full_name = left(btrim(p_full_name), 120), job_title = left(btrim(p_job_title), 120), updated_at = now()
  where id = p_user;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
end
$$;

create function public.admin_apply_preset(p_user uuid, p_preset text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_old_preset text;
begin
  perform public.assert_admin();
  if p_preset = 'custom' then
    raise exception 'Use the permission matrix to make a custom role' using errcode = '22023';
  end if;
  if not exists (select 1 from public.role_presets where id = p_preset) then
    raise exception 'Unknown role preset' using errcode = '22023';
  end if;
  select preset_id into v_old_preset from public.profiles where id = p_user for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if v_old_preset = 'admin' and p_preset <> 'admin' and public.active_admin_count() <= 1
     and (select active from public.profiles where id = p_user) then
    raise exception 'You cannot remove the last active admin' using errcode = '42501';
  end if;
  v_before := public.permissions_json(p_user);
  perform public.copy_preset(p_user, p_preset);
  perform public.write_audit('permissions', 'profiles', p_user::text,
    format('Role set to %s', p_preset), v_before, public.permissions_json(p_user));
end
$$;

-- p_perms: [{"module":"tasks","view":true,"create":true,"edit":true,"delete":false,"export":false,"scope":"own"}, ...]
-- Modules not listed get no access. The user's role becomes 'custom'.
create function public.admin_set_user_permissions(p_user uuid, p_perms jsonb) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_old_preset text;
begin
  perform public.assert_admin();
  if jsonb_typeof(p_perms) <> 'array' then
    raise exception 'Permissions must be a list' using errcode = '22023';
  end if;
  select preset_id into v_old_preset from public.profiles where id = p_user for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if v_old_preset = 'admin' and public.active_admin_count() <= 1
     and (select active from public.profiles where id = p_user) then
    raise exception 'You cannot change the last active admin to a custom role' using errcode = '42501';
  end if;
  v_before := public.permissions_json(p_user);
  delete from public.user_permissions where user_id = p_user;
  insert into public.user_permissions (user_id, module, can_view, can_create, can_edit, can_delete, can_export, scope)
  select p_user, x.module::public.app_module,
         coalesce(x."view", false), coalesce(x."create", false), coalesce(x."edit", false),
         coalesce(x."delete", false), coalesce(x."export", false),
         coalesce(x.scope, 'own')::public.data_scope
  from jsonb_to_recordset(p_perms) as x(module text, "view" boolean, "create" boolean, "edit" boolean,
                                         "delete" boolean, "export" boolean, scope text);
  -- any action implies view
  update public.user_permissions set can_view = true
  where user_id = p_user and (can_create or can_edit or can_delete or can_export);
  update public.profiles set preset_id = 'custom', updated_at = now() where id = p_user;
  perform public.recompute_mfa(p_user);
  perform public.write_audit('permissions', 'profiles', p_user::text, 'Custom permissions set',
    v_before, public.permissions_json(p_user));
end
$$;

create function public.admin_set_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  perform public.assert_admin();
  select * into v_profile from public.profiles where id = p_user for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if not p_active and p_user = auth.uid() then
    raise exception 'You cannot deactivate your own account' using errcode = '42501';
  end if;
  if not p_active and v_profile.preset_id = 'admin' and v_profile.active and public.active_admin_count() <= 1 then
    raise exception 'You cannot deactivate the last active admin' using errcode = '42501';
  end if;
  if v_profile.active = p_active then return; end if;
  update public.profiles
  set active = p_active,
      sessions_revoked_at = case when p_active then sessions_revoked_at else now() end,
      updated_at = now()
  where id = p_user;
  if not p_active then
    delete from auth.sessions where user_id = p_user;
  end if;
  perform public.write_audit(case when p_active then 'activate' else 'deactivate' end,
    'profiles', p_user::text, null, null, null);
end
$$;

create function public.admin_reset_sessions(p_user uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  update public.profiles set sessions_revoked_at = now(), updated_at = now() where id = p_user;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  -- refresh tokens hang off sessions, so this signs them out everywhere
  delete from auth.sessions where user_id = p_user;
  perform public.write_audit('sessions_reset', 'profiles', p_user::text, null, null, null);
end
$$;

-- Edit a preset's matrix; users currently on that preset are updated too.
-- The Admin preset is fixed (full access) so nobody can lock the company out.
create function public.admin_update_preset(p_preset text, p_perms jsonb) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_user uuid;
begin
  perform public.assert_admin();
  if p_preset in ('admin', 'custom') then
    raise exception 'The % role cannot be edited', p_preset using errcode = '42501';
  end if;
  if not exists (select 1 from public.role_presets where id = p_preset) then
    raise exception 'Unknown role preset' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(to_jsonb(pp) - 'preset_id' order by module), '[]'::jsonb) into v_before
  from public.preset_permissions pp where preset_id = p_preset;
  delete from public.preset_permissions where preset_id = p_preset;
  insert into public.preset_permissions (preset_id, module, can_view, can_create, can_edit, can_delete, can_export, scope)
  select p_preset, x.module::public.app_module,
         coalesce(x."view", false), coalesce(x."create", false), coalesce(x."edit", false),
         coalesce(x."delete", false), coalesce(x."export", false),
         coalesce(x.scope, 'own')::public.data_scope
  from jsonb_to_recordset(p_perms) as x(module text, "view" boolean, "create" boolean, "edit" boolean,
                                         "delete" boolean, "export" boolean, scope text);
  update public.preset_permissions set can_view = true
  where preset_id = p_preset and (can_create or can_edit or can_delete or can_export);
  for v_user in select id from public.profiles where preset_id = p_preset loop
    perform public.copy_preset(v_user, p_preset);
  end loop;
  perform public.write_audit('preset', 'role_presets', p_preset, 'Role preset edited', v_before,
    (select coalesce(jsonb_agg(to_jsonb(pp) - 'preset_id' order by module), '[]'::jsonb)
     from public.preset_permissions pp where preset_id = p_preset));
end
$$;

-- sign-in, sign-out and export events written by the app on the user's behalf
create function public.log_event(p_action text, p_entity text, p_entity_id text, p_summary text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_action not in ('sign_in', 'sign_out', 'export', 'invite') then
    raise exception 'Event type not allowed' using errcode = '22023';
  end if;
  if p_action = 'export' and not public.has_perm(p_entity::public.app_module, 'export') then
    raise exception 'No export permission for %', p_entity using errcode = '42501';
  end if;
  if p_action = 'invite' and not public.is_admin() then
    raise exception 'Only admins can invite' using errcode = '42501';
  end if;
  perform public.write_audit(p_action, p_entity, p_entity_id, left(p_summary, 500), null, null);
end
$$;

-- One-time: promote the first user to admin. Service role only, and only
-- while there is no active admin yet.
create function public.bootstrap_first_admin(p_user uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if public.active_admin_count() > 0 then
    raise exception 'An admin already exists; invite further admins from the Team page' using errcode = '42501';
  end if;
  update public.profiles set active = true, updated_at = now() where id = p_user;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  perform public.copy_preset(p_user, 'admin');
  insert into public.audit_log (actor_id, actor_email, action, entity, entity_id, summary)
  values (null, 'seed-script', 'permissions', 'profiles', p_user::text, 'First admin created by seed script');
end
$$;

-- =====================================================================
-- Row-level security
-- =====================================================================
alter table public.settings enable row level security;
alter table public.role_presets enable row level security;
alter table public.preset_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.user_permissions enable row level security;
alter table public.audit_log enable row level security;

create policy settings_read on public.settings for select to authenticated
  using (public.caller_ok());
create policy settings_update on public.settings for update to authenticated
  using (public.has_perm('settings', 'edit')) with check (public.has_perm('settings', 'edit'));

create policy presets_read on public.role_presets for select to authenticated
  using (public.caller_ok());
create policy preset_perms_read on public.preset_permissions for select to authenticated
  using (public.has_perm('team', 'view'));

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_perm('team', 'view'));
create policy user_perms_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_perm('team', 'view'));

create policy audit_read on public.audit_log for select to authenticated
  using (public.has_perm('audit', 'view'));

-- Belt and braces: no direct writes to these tables from the API at all.
-- Changes happen only through the functions above.
revoke insert, update, delete on public.role_presets, public.preset_permissions,
  public.profiles, public.user_permissions, public.audit_log from anon, authenticated;
revoke all on public.settings, public.role_presets, public.preset_permissions,
  public.profiles, public.user_permissions, public.audit_log from anon;

-- Internal helpers and the seed function are not callable from the API.
revoke execute on function public.write_audit(text, text, text, text, jsonb, jsonb),
  public.permissions_json(uuid), public.recompute_mfa(uuid), public.copy_preset(uuid, text),
  public.handle_new_user(), public.sync_user_email(), public.audit_row(),
  public.bootstrap_first_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(uuid) to service_role;

-- =====================================================================
-- Seed role presets
-- =====================================================================
insert into public.role_presets (id, name, description, sort) values
  ('admin', 'Admin', 'Full control, including team, settings and the audit log. Two-factor required.', 10),
  ('manager', 'Manager', 'Runs finances, marketing and the team''s work. No team, settings or audit access.', 20),
  ('staff', 'Staff', 'Least privilege: home, their own tasks, the calendar and chat. No finance access.', 30),
  ('custom', 'Custom', 'Hand-edited permissions for one person.', 40);

-- Admin: everything, all rows
insert into public.preset_permissions (preset_id, module, can_view, can_create, can_edit, can_delete, can_export, scope)
select 'admin', m, true, true, true, true, true, 'all'
from unnest(enum_range(null::public.app_module)) as m;

-- Manager: operational modules, no team/settings/audit
insert into public.preset_permissions (preset_id, module, can_view, can_create, can_edit, can_delete, can_export, scope)
select 'manager', m, true, true, true, m in ('calendar', 'tasks', 'chat', 'marketing'), m <> 'chat', 'all'
from unnest(array['home', 'finances', 'transactions', 'payments', 'streams', 'countries',
  'representatives', 'marketing', 'calendar', 'tasks', 'chat']::public.app_module[]) as m;

-- Staff: home, own tasks, calendar events they are invited to, chat
insert into public.preset_permissions (preset_id, module, can_view, can_create, can_edit, can_delete, can_export, scope) values
  ('staff', 'home', true, false, false, false, false, 'own'),
  ('staff', 'tasks', true, true, true, false, false, 'assigned'),
  ('staff', 'calendar', true, true, true, false, false, 'assigned'),
  ('staff', 'chat', true, true, true, false, false, 'assigned');
