drop index if exists public.idx_flashcards_user_next_review;

alter table public.flashcards
  drop constraint if exists flashcards_interval_non_negative,
  drop constraint if exists flashcards_repetitions_non_negative,
  drop constraint if exists flashcards_ease_factor_positive;

alter table public.flashcards
  drop column if exists interval,
  drop column if exists ease_factor,
  drop column if exists repetitions;

alter table public.flashcards
  rename column next_review_at to due;

alter table public.flashcards
  add column stability double precision not null default 0,
  add column difficulty double precision not null default 0,
  add column elapsed_days integer not null default 0,
  add column scheduled_days integer not null default 0,
  add column learning_steps integer not null default 0,
  add column reps integer not null default 0,
  add column lapses integer not null default 0,
  add column state smallint not null default 0,
  add column last_review timestamptz,
  add constraint flashcards_state_valid check (state between 0 and 3);

create index idx_flashcards_user_due
  on public.flashcards (user_id, due);

notify pgrst, 'reload schema';