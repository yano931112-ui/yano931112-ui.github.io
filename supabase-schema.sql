create table if not exists public.recipes (
  id uuid primary key,
  workspace_id uuid not null,
  date date not null,
  title text not null default '',
  servings integer not null default 1,
  time text not null default '',
  category text not null default 'その他',
  ingredients text not null default '',
  steps text not null default '',
  notes text not null default '',
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recipes_workspace_id_date_idx
  on public.recipes (workspace_id, date desc, updated_at desc);

alter table public.recipes enable row level security;

drop policy if exists "Anyone can read recipes" on public.recipes;
drop policy if exists "Anyone can insert recipes" on public.recipes;
drop policy if exists "Anyone can update recipes" on public.recipes;
drop policy if exists "Anyone can delete recipes" on public.recipes;

create policy "Anyone can read recipes"
  on public.recipes
  for select
  to anon
  using (true);

create policy "Anyone can insert recipes"
  on public.recipes
  for insert
  to anon
  with check (true);

create policy "Anyone can update recipes"
  on public.recipes
  for update
  to anon
  using (true)
  with check (true);

create policy "Anyone can delete recipes"
  on public.recipes
  for delete
  to anon
  using (true);
