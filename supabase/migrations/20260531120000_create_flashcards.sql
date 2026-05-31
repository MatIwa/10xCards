create or replace function public.set_flashcards_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  front text not null,
  back text not null,
  source text not null default 'manual',
  interval integer not null default 0,
  ease_factor real not null default 2.5,
  repetitions integer not null default 0,
  next_review_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flashcards_front_max_length check (char_length(front) <= 1000),
  constraint flashcards_back_max_length check (char_length(back) <= 5000),
  constraint flashcards_source_valid check (source in ('manual', 'ai_full', 'ai_edited')),
  constraint flashcards_interval_non_negative check (interval >= 0),
  constraint flashcards_repetitions_non_negative check (repetitions >= 0),
  constraint flashcards_ease_factor_positive check (ease_factor > 0)
);

create index if not exists idx_flashcards_user_id
  on public.flashcards (user_id);

create index if not exists idx_flashcards_user_next_review
  on public.flashcards (user_id, next_review_at);

alter table public.flashcards enable row level security;

create policy flashcards_select_own
  on public.flashcards
  for select
  using (auth.uid() = user_id);

create policy flashcards_insert_own
  on public.flashcards
  for insert
  with check (auth.uid() = user_id);

create policy flashcards_update_own
  on public.flashcards
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy flashcards_delete_own
  on public.flashcards
  for delete
  using (auth.uid() = user_id);

create trigger trg_flashcards_set_updated_at
before update on public.flashcards
for each row
execute function public.set_flashcards_updated_at();
