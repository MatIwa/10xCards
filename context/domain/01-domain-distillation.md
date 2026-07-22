---
title: "Domain Distillation — 10xCards"
created: 2026-07-22
type: domain-distillation
---

# Domain Distillation — 10xCards

> Artefakt odkrycia domeny. Nie zawiera kodu produkcyjnego. Wszystkie cytaty kodu
> zweryfikowane ręcznie — format `plik:linia`.

---

## Krok 0 — Kontekst projektu

### Dokumenty źródłowe

| Dokument | Ścieżka | Stan |
|---|---|---|
| PRD | `context/foundation/prd.md` | draft, v1 |
| Tech-stack | `context/foundation/tech-stack.md` | stabilny |
| README | `README.md` | starter-level |
| Lessons Learned | `context/foundation/lessons.md` | append-only |

### Stack i warstwy

```
UI (Astro + React 19 islands)
   └── src/pages/**          — strony + handlers SSR
   └── src/components/**     — Astro static / React interactive

API Layer
   └── src/pages/api/**      — handlery HTTP (Astro APIRoute)
   └── src/middleware.ts     — auth guard

Service Layer
   └── src/lib/services/**   — logika biznesowa (czyste funkcje + SupabaseClient)
   └── src/lib/schemas/**    — Zod schematy walidacji

Typy domenowe
   └── src/types.ts          — główny typ Flashcard + FlashcardSource

Persystencja
   └── Supabase (PostgreSQL) — tabela `flashcards` + RLS
   └── supabase/migrations/  — historia schematu
```

Logika biznesowa żyje głównie w `src/lib/services/`. Brak warstwy domeny wyizolowanej
od persystencji — serwisy przyjmują `SupabaseClient` bezpośrednio.

---

## Krok 1 — Ubiquitous Language

| Pojęcie | Definicja | Cytat źródłowy | W kodzie |
|---|---|---|---|
| **Flashcard** | Dwustronna karta pamięciowa: `front` (pytanie/prompt) i `back` (odpowiedź). Podstawowy byt produktu. | PRD §Business Logic: *"transforms each into a question→answer flashcard pair"* | `src/types.ts:3-20` |
| **FlashcardSource** | Enum przynależności karty do jednej z trzech ścieżek tworzenia. | PRD §Success Criteria: *"75% of all flashcards…created via AI generation"* | `src/types.ts:1` |
| `manual` | Karta stworzona samodzielnie przez użytkownika (FR-007). | PRD FR-007 | `src/types.ts:1`, `src/lib/schemas/flashcard.schemas.ts:4` |
| `ai_full` | Karta zaakceptowana wprost z propozycji AI (bez edycji). | Kod (nazwa wartości odkryta w kodzie) | `src/types.ts:1` |
| `ai_edited` | Karta z propozycji AI, zmieniona przez użytkownika przed zapisem. | Kod | `src/types.ts:1` |
| **Proposal** | Efemeryczna propozycja karty wygenerowana przez model językowy. Ma UUID (wyłącznie kliencki identyfikator), `front` i `back`. **Nie jest persystowana.** | PRD FR-006: *"list of AI-generated flashcard proposals to accept, edit, or reject"* | `src/lib/schemas/ai-generation.schemas.ts:25-31` |
| **Source Text** | Surowy tekst wklejony przez użytkownika, wejście do generacji AI. 200–25 000 znaków. **Nie jest przechowywany po zakończeniu zapytania.** | PRD NFR: *"Source text…is not retained after the generation request completes"* | `src/lib/schemas/ai-generation.schemas.ts:14-19` |
| **Generation** | Proces ekstrakcji Proposals z Source Text przez LLM (OpenRouter). Limit: do 15 kart. | PRD §Business Logic: *"identifies discrete, testable knowledge units"* | `src/lib/services/ai-generation.service.ts:1-120` |
| **Review Session** | Sesja przeglądania kart zaplanowanych do powtórki. Ma dwa tryby: `due` i `practice`. | PRD FR-011, FR-012, FR-013 | `src/pages/api/flashcards/review/queue.ts:1-46` |
| **Review Queue** | Zbiór kart przydzielonych do aktualnej sesji. Tryb `due`: karty z `due ≤ now()`. Tryb `practice`: 20 najdłużej-niereviewowanych kart. | Kod (odkryte w review/queue.ts) | `src/lib/services/review.service.ts:48-77` |
| **Practice Mode** | Tryb przeglądu bez efektu harmonogramowania — karta jest pokazywana, ale ocena jest ignorowana (`skipped: true`). **Nieobecne w PRD.** | Kod | `src/pages/api/flashcards/[id]/review.ts:48-50` |
| **Rating** | Ocena przypomnienia karty przez użytkownika. Cztery wartości: `Again`, `Hard`, `Good`, `Easy`. Wejście do algorytmu FSRS. | PRD FR-013: *"User can rate their recall (scheduling input for the SR algorithm)"* | `src/lib/schemas/review.schemas.ts:4` |
| **Due Date** | Data i godzina następnego zaplanowanego przeglądu karty (`due`). Obliczana przez FSRS po każdej ocenie. | PRD §Business Logic: *"output is: a per-card next-review schedule"* | `src/types.ts:8`, `supabase/migrations/20260601120000_flashcards_fsrs.sql:14` |
| **FSRS State** | Stan cyklu uczenia karty: `0=New`, `1=Learning`, `2=Review`, `3=Relearning`. Zarządzany przez bibliotekę `ts-fsrs`. | Kod + [FSRS spec](https://github.com/open-spaced-repetition/fsrs4anki/wiki) | `src/types.ts:17`, `supabase/migrations/20260601120000_flashcards_fsrs.sql:22` |
| **Rating Preview** | Podgląd 4 dat następnej powtórki (po każdym możliwym `Rating`) przed oceną. Pokazywany użytkownikowi w sesji. | Kod | `src/lib/services/review.service.ts:16-21`, `src/pages/api/flashcards/review/queue.ts:28-36` |
| **Account Deletion** | Permanentne usunięcie konta i wszystkich danych (GDPR Art. 17). Wymaga potwierdzenia `"DELETE"`. Nieodwracalne. | PRD FR-014 | `src/lib/services/account.service.ts:14-44`, `src/lib/schemas/account.schemas.ts:4` |
| **Orphan Check** | Weryfikacja po usunięciu użytkownika, że tabele user-scoped nie zawierają osieroconych wierszy. | `context/foundation/lessons.md` (reguła) | `src/lib/services/account.service.ts:29-38` |
| **User-Scoped Table** | Każda tabela posiadająca `user_id → auth.users(id)`. Musi deklarować `on delete cascade`. | `context/foundation/lessons.md` (reguła) | `src/lib/services/account.service.ts:10-13` |

---

## Krok 2 — Klasyfikacja subdomen

| Subdomena | Obszar | Kategoria | Uzasadnienie |
|---|---|---|---|
| **AI Extraction** | Generation + Proposal lifecycle | **Core** | Główna przewaga produktu. PRD §Vision: *"No one has nailed AI generation from raw text"*. Success Criteria mierzą akceptację AI kart. |
| **Flashcard Lifecycle** | CRUD + FlashcardSource tracking | **Core** | Dane domeny — bez nich nie ma produktu. FlashcardSource jest bezpośrednim miernikiem sukcesu (75% via AI). |
| **Spaced Repetition Scheduling** | FSRS + Review Queue + Rating | **Supporting** | Umożliwia efektywną naukę, ale PRD wprost wyklucza custom algorytm: *"use a ready-made spaced repetition library"*. Wartość: duża. Customizacja: zero. |
| **Review Session Management** | Queue + Practice mode + RatingPreview | **Supporting** | Konieczne do dostarczenia sesji użytkownikowi, ale logika trywialnie wraps serwis FSRS. |
| **Authentication** | Sign-up, sign-in, sign-out (FR-001–003) | **Generic** | Standardowy email+password flow przez Supabase. Zero zróżnicowania produktowego. |
| **Account & GDPR Deletion** | FR-014, Orphan Check | **Generic** | Wymóg regulacyjny (GDPR Art. 17), nie przewaga konkurencyjna. Dobrze zaimplementowany, bez innowacji. |

---

## Krok 3 — Kandydaci na agregaty i ich niezmienniki

### Agregat A: Flashcard

**Kandydat**: Typ `Flashcard` w `src/types.ts:3`.

| Niezmiennik | Źródło | Status egzekucji |
|---|---|---|
| `front` ≤ 1000 znaków | PRD: *"front: a concise question or prompt, at most 1000 characters"*; PRD AI output rules | DB CHECK: `src/migrations/.../create_flashcards.sql:22`; Zod: `src/lib/schemas/flashcard.schemas.ts:5-7` — **egzekwowany podwójnie** |
| `back` ≤ 5000 znaków | PRD: *"back: a complete, self-contained answer, at most 5000 characters"* | DB CHECK + Zod — **egzekwowany podwójnie** |
| `source` ∈ {manual, ai_full, ai_edited} | Kod (enum `FlashcardSource`) | DB CHECK `source in ('manual','ai_full','ai_edited')` + Zod enum — **egzekwowany** |
| `front` i `back` niepuste | Zod: `min(1)` | Tylko Zod — **brak CHECK w DB** (NOT NULL wystarczy, ale pusty string przejdzie) |
| `user_id` = bieżący użytkownik | PRD §Access Control: *"Each user's flashcards are private"* | RLS policies + API ownership checks — **egzekwowany** |
| `state` ∈ {0,1,2,3} | ts-fsrs semantics | DB CHECK `state between 0 and 3` — **egzekwowany** |
| FSRS transition: tylko via `gradeCard` | Logika FSRS — poprawna sekwencja stanów | Serwis deleguje do `ts-fsrs`. Brak walidacji, że stan nie jest mutowany bezpośrednio przez update endpointa | Częściowo — `PUT /api/flashcards/[id]` aktualizuje tylko `front`/`back`, nie pola FSRS |

**Problem projektowy**: `Flashcard` to w kodzie gołe DTO (`interface` bez metod). Serwisy operują na nim jak na rekordzie DB. Brak klasy domenowej z metodami (`scheduleReview(rating)`, `accept()`, `edit()`).

---

### Agregat B: Proposal (efemeryczny)

**Kandydat**: Typ `Proposal` w `src/lib/schemas/ai-generation.schemas.ts:25`.

| Niezmiennik | Źródło | Status egzekucji |
|---|---|---|
| 1–15 propozycji na generację | PRD: *"up to 15 testable knowledge units"* | Zod `.transform(cards => cards.slice(0, 15))` — **egzekwowany** |
| `front` ≤ 1000, `back` ≤ 5000 | PRD AI output rules | Zod `modelOutputSchema` — **egzekwowany** |
| Proposal nie trafia do bazy danych | PRD NFR: source text not retained (rozszerzalnie: proposals też ephemeral) | Brak tabeli proposals w migracji — **egzekwowany przez nieobecność** |
| UUID generowany kliencko | Identyfikacja propozycji na froncie | Kod: `proposalSchema.id = z.uuid()`, ale UUID jest nadawany przez front-end, nie serwer | **Zaufanie klientowi** — brak walidacji unikalności |

---

### Agregat C: ReviewSession (niejawny)

**Kandydat**: Brak jawnej encji w kodzie. Sesja jest implikowana przez sekwencję wywołań API.

| Niezmiennik | Źródło | Status egzekucji |
|---|---|---|
| Karty w `due` queue mają `due ≤ now()` | PRD §Business Logic: *"not too early"* | `supabase.from("flashcards").select().lte("due", new Date().toISOString())` — **egzekwowany** |
| Grading w `practice` mode nie zmienia harmonogramu | Kod (odkryte) | `if (parsedBody.data.practice === true) return { data: null, skipped: true }` — **egzekwowany** |
| Jeden przegląd karty = jeden wywołanie `gradeCard` | Brak duplikatu gradingu | Brak idempotency key / deduplication — **nie egzekwowany** |

---

## Krok 4 — MODEL vs KOD — tabela rozjazdów

| # | Dokument mówi (X) | Kod robi (Y) | Dowód (plik:linia) |
|---|---|---|---|
| 1 | PRD FR-006: user może **odrzucić** propozycję — odrzucone karty są discarded and not persisted | Odrzucenie jest wyłącznie front-endową operacją; serwer nie widzi ani propozycji ani decyzji reject | `src/pages/api/flashcards/generate.ts` — brak endpointu reject; `src/lib/services/ai-generation.service.ts` — brak persystencji propozycji |
| 2 | PRD FR-013: "User can rate their recall (scheduling input for the SR algorithm)" — termin domenowy to **Recall Rating** | Kod używa `Rating` z biblioteki `ts-fsrs` (Again=1, Hard=2, Good=3, Easy=4). Brak mapowania na domenowe pojęcie "Recall Rating" | `src/lib/schemas/review.schemas.ts:4`, `src/lib/services/review.service.ts:3` |
| 3 | PRD §Business Logic: output generacji to *"a set of candidate flashcard pairs…ranked by extractability"* | Kod nie rankinguje proposals; model zwraca listę w kolejności LLM, Zod nie sortuje | `src/lib/services/ai-generation.service.ts:103-118`, `src/lib/schemas/ai-generation.schemas.ts:20-28` |
| 4 | PRD Success Criteria: *"75% of AI-generated flashcards are accepted"* — metryka wymaga liczenia zaakceptowanych vs. wygenerowanych | Kod nie ma żadnego mechanizmu zliczania przyjętych propozycji / całkowitej liczby wygenerowanych. `FlashcardSource` śledzi `ai_full`/`ai_edited` po stronie bazy, ale nie ma denominatora (ile propozycji wygenerowano) | `src/types.ts:1` — brak pola `generated_count`; brak tabeli/logów generacji |
| 5 | PRD NFR: *"Continuous visible progress during AI generation"* | Back-end zwraca pełną odpowiedź jednorazowo (brak streaming/progress). Frontend sam zarządza stanem ładowania | `src/pages/api/flashcards/generate.ts:49-52` — `Response.json(...)` na końcu, bez streaming |
| 6 | PRD §Non-Goals: *"No custom SR algorithm — use a ready-made spaced repetition library"* — SM-2 lub FSRS OK | Pierwsza migracja (`20260531`) używała SM-2 (`interval`, `ease_factor`, `repetitions`, `next_review_at`). Druga migracja (`20260601`) przepisała schemat na FSRS. Zmiana algorytmu nie jest odnotowana w PRD (PRD mówi "ready-made library") | `supabase/migrations/20260531120000_create_flashcards.sql:17-19`, `supabase/migrations/20260601120000_flashcards_fsrs.sql:1-24` |
| 7 | PRD §Access Control: *"An unauthenticated user cannot access any flashcard or generation functionality"* | `GET /api/flashcards` (index.ts) nie sprawdza `context.locals.user` jawnie. Middleware chroni trasę, ale serwis `listFlashcards` otrzyma klienta Supabase bez sesji → RLS zwróci pusty zestaw, nie 401 | `src/pages/api/flashcards/index.ts:13-21`, `src/middleware.ts:5` |
| 8 | PRD FR-014: usunięcie konta jest **natychmiastowe i nieodwracalne** | Kod weryfikuje po usunięciu, że nie ma osieroconych wierszy. Nie ma okresu karencji ani soft-delete — zgodne. Jednakże `signOut` po usunięciu konta może się nie powieść (`signout_failed`) — sesja użytkownika może pozostać aktywna w innych zakładkach | `src/pages/api/account/delete.ts:55-61` |
| 9 | Practice Mode — nieobecne w PRD, User Stories, ani FR | Endpoint `POST /api/flashcards/[id]/review` przyjmuje `practice: boolean`; gdy `true`, zwraca `{ data: null, skipped: true }` bez gradingu. To niezdokumentowany tryb sesji | `src/pages/api/flashcards/[id]/review.ts:48-50` |
| 10 | PRD: front flashcard = *"question/prompt"* — implikuje że `front` jest zawsze formą pytania | Kod akceptuje dowolny tekst ≤ 1000 znaków jako `front`; brak walidacji formy pytajnej (domenowa reguła jakościowa, nie techniczna) | `src/lib/schemas/flashcard.schemas.ts:5-7` |

---

## Krok 5 — Ranking refaktoru

| Ranking | Kandydat | Wartość (rdzenność niezmiennika) | Ryzyko (słabość egzekucji) | Uzasadnienie |
|---|---|---|---|---|
| **#1** | **Brak metryki akceptacji Proposals** | Wysoka — jest to primary success criterion PRD | Krytyczne — produkt nie może mierzyć swojego głównego KPI | PRD Success Criteria #1 wymaga `75% AI-generated flashcards accepted`. Kod nie ma denominatora — nie wiadomo ile proposals zostało wygenerowanych. `FlashcardSource = ai_full/ai_edited` daje licznik, ale bez tabeli/logu generacji (ile proposals wyprodukowała każda sesja) nie da się obliczyć metryki. Refaktor: dodać persystencję events generacji lub log count proposals-per-request. |
| **#2** | **Flashcard jako gołe DTO (brak aggregate root)** | Wysoka — Flashcard to serce domeny | Średnie — niezmienniki są egzekwowane, ale poza encją (w DB/Zod) | Brak klasy domenowej `Flashcard` z metodami (`accept(proposal)`, `scheduleReview(rating)`, `rehydrateFromRow()`). Logika rozsiana między `review.service.ts`, `flashcard.service.ts`, Zod schemas i DB constraints. `rehydrate()` i `serialize()` w `review.service.ts` to nieformalna enkapsulacja FSRS stanu — kandydat na metodę agregatu. |
| **#3** | **Practice Mode — niezadokumentowana koncepcja domenowa** | Średnia — umożliwia użycie produktu poza harmonogramem | Niskie — kod działa poprawnie | Tryb `practice` jest implementacyjnym odkryciem, nieobecnym w PRD ani user stories. Nie wiadomo jaka jest reguła biznesowa: czy `practice` karty powinny być w ogóle oceniane dla innych celów (np. statystyki)? Refaktor: albo wpisać do PRD jako FR-015, albo usunąć jeśli niechciany. |
| **#4** | **Recall Rating bez mapowania domenowego** | Średnia — jest to jedyne wejście do algorytmu SR | Niskie — typ `Rating` z ts-fsrs działa poprawnie | Termin domenowy PRD to "recall rating", kod używa `Rating` (Again/Hard/Good/Easy). Brak wartości domenowej — konsekwencja ścisłego uzależnienia od ts-fsrs. Refaktor: cienka warstwa `RecallRating` → `Rating` izolująca domenę od biblioteki. |

### Kandydat #1 do refaktoru: Brak metryki akceptacji Proposals

**Dlaczego**: Bez denominatora (ile proposals wygenerowano w danej sesji generacji) producent nie może zmierzyć primary success criterion. FlashcardSource jako licznik istnieje. Brakuje tabeli `generation_events` lub prostego logu z `proposals_count`, `session_id`, `timestamp`. Jest to luka między domenową regułą sukcesu a implementacją — i jedyna, która uniemożliwia mierzenie postępu produktu.

---

## Podsumowanie

Artefakt zawiera mapę domeny 10xCards w pięciu przekrojach: Ubiquitous Language (17 pojęć z cytatami źródłowymi), klasyfikację subdomen (Core: AI Extraction + Flashcard Lifecycle; Supporting: FSRS + Review; Generic: Auth + GDPR), trzech kandydatów na agregaty (Flashcard, Proposal, ReviewSession), tabelę 10 rozjazdów MODEL vs KOD oraz ranking czterech obszarów do refaktoru.

Najważniejszy wniosek: **produkt nie może dziś zmierzyć swojego primary success criterion** — brak denominatora propozycji AI uniemożliwia obliczenie wskaźnika akceptacji (75% target z PRD). Drugi istotny wniosek: `Flashcard` jest gołym DTO, a nie agregatem — logika stanów FSRS, walidacja i tworzenie są rozsiane między trzy warstwy (DB, Zod, serwis) bez jednego miejsca odpowiedzialności.
