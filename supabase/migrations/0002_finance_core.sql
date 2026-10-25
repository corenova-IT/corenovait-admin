-- =====================================================================
-- Finance core tables. The screens arrive in Phase 2; the tables and their
-- row-level security exist now so permission tests cover real finance data.
-- Money is stored in integer minor units (cents/pence), never floats.
-- =====================================================================

create table public.streams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 80),
  active boolean not null default true,
  sort int not null default 100,
  created_at timestamptz not null default now()
);

create table public.countries (
  code text primary key check (code ~ '^[A-Z]{2}$' or code = 'OTHER'),
  name text not null check (length(name) between 1 and 80),
  sort int not null default 100
);

create table public.representatives (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  contact text not null default '' check (length(contact) <= 200),
  -- 0.1000 = 10% commission
  commission_rate numeric(5, 4) not null default 0 check (commission_rate between 0 and 1),
  -- optional link to a portal user, so "assigned" scope can show them their own deals
  profile_id uuid references public.profiles (id) on delete set null,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.income_entries (
  id uuid primary key default gen_random_uuid(),
  entry_date date not null,
  stream_id uuid references public.streams (id),
  country_code text references public.countries (code),
  client text not null default '' check (length(client) <= 160),
  description text not null default '' check (length(description) <= 500),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- manual rate: 1 unit of `currency` = fx_rate_to_base units of the base currency
  fx_rate_to_base numeric(18, 8) not null default 1 check (fx_rate_to_base > 0),
  amount_base_minor bigint generated always as (round(amount_minor * fx_rate_to_base)::bigint) stored,
  invoice_ref text not null default '' check (length(invoice_ref) <= 80),
  status text not null default 'pending' check (status in ('pending', 'paid', 'overdue')),
  representative_id uuid references public.representatives (id) on delete set null,
  notes text not null default '' check (length(notes) <= 2000),
  is_sample boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index income_entries_date_idx on public.income_entries (entry_date desc);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null check (length(category) between 1 and 80),
  vendor text not null default '' check (length(vendor) <= 160),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  fx_rate_to_base numeric(18, 8) not null default 1 check (fx_rate_to_base > 0),
  amount_base_minor bigint generated always as (round(amount_minor * fx_rate_to_base)::bigint) stored,
  receipt_path text,
  is_recurring boolean not null default false,
  notes text not null default '' check (length(notes) <= 2000),
  is_sample boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_date_idx on public.expenses (expense_date desc);

-- internal: the portal user a representative maps to (for "assigned" scope)
create function public.representative_profile(p_rep uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$ select profile_id from public.representatives where id = p_rep $$;

-- ---------- row-level security ----------
alter table public.streams enable row level security;
alter table public.countries enable row level security;
alter table public.representatives enable row level security;
alter table public.income_entries enable row level security;
alter table public.expenses enable row level security;

-- reference lists: readable by any active user; edited from Settings
create policy streams_read on public.streams for select to authenticated using (public.caller_ok());
create policy streams_write on public.streams for all to authenticated
  using (public.has_perm('settings', 'edit')) with check (public.has_perm('settings', 'edit'));
create policy countries_read on public.countries for select to authenticated using (public.caller_ok());
create policy countries_write on public.countries for all to authenticated
  using (public.has_perm('settings', 'edit')) with check (public.has_perm('settings', 'edit'));

create policy reps_read on public.representatives for select to authenticated
  using (public.row_allowed('representatives', 'view', created_by, profile_id));
create policy reps_insert on public.representatives for insert to authenticated
  with check (public.has_perm('representatives', 'create') and created_by = auth.uid());
create policy reps_update on public.representatives for update to authenticated
  using (public.row_allowed('representatives', 'edit', created_by, profile_id))
  with check (public.has_perm('representatives', 'edit'));
create policy reps_delete on public.representatives for delete to authenticated
  using (public.row_allowed('representatives', 'delete', created_by, profile_id));

create policy income_read on public.income_entries for select to authenticated
  using (public.row_allowed('transactions', 'view', created_by, public.representative_profile(representative_id)));
create policy income_insert on public.income_entries for insert to authenticated
  with check (public.has_perm('transactions', 'create') and created_by = auth.uid());
create policy income_update on public.income_entries for update to authenticated
  using (public.row_allowed('transactions', 'edit', created_by, public.representative_profile(representative_id)))
  with check (public.has_perm('transactions', 'edit'));
create policy income_delete on public.income_entries for delete to authenticated
  using (public.row_allowed('transactions', 'delete', created_by, public.representative_profile(representative_id)));

create policy expenses_read on public.expenses for select to authenticated
  using (public.row_allowed('transactions', 'view', created_by, null));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.has_perm('transactions', 'create') and created_by = auth.uid());
create policy expenses_update on public.expenses for update to authenticated
  using (public.row_allowed('transactions', 'edit', created_by, null))
  with check (public.has_perm('transactions', 'edit'));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.row_allowed('transactions', 'delete', created_by, null));

revoke all on public.streams, public.countries, public.representatives,
  public.income_entries, public.expenses from anon;
revoke execute on function public.representative_profile(uuid) from public, anon;

-- ---------- audit: before and after values for every finance change ----------
create trigger audit_income after insert or update or delete on public.income_entries
  for each row execute function public.audit_row();
create trigger audit_expenses after insert or update or delete on public.expenses
  for each row execute function public.audit_row();
create trigger audit_representatives after insert or update or delete on public.representatives
  for each row execute function public.audit_row();
create trigger audit_streams after insert or update or delete on public.streams
  for each row execute function public.audit_row();
create trigger audit_countries after insert or update or delete on public.countries
  for each row execute function public.audit_row();

-- ---------- seed reference lists ----------
insert into public.streams (name, sort) values
  ('Upwork', 10), ('Fiverr', 20), ('PeoplePerHour', 30), ('Website direct', 40),
  ('Individual representatives', 50);
insert into public.countries (code, name, sort) values
  ('GB', 'United Kingdom', 10), ('AU', 'Australia', 20), ('OTHER', 'Other', 30);
