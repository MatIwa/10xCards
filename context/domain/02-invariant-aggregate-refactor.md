---
title: "Invariant Aggregate Refactor — FlashcardSource Integrity"
created: 2026-07-22
type: refactor-plan
---

# Invariant Aggregate Refactor — 10xCards

> Plan refaktoru bez zmian w kodzie produkcyjnym. Wszystkie cytaty zweryfikowane —
> format `plik:linia`.

---

## Krok 0 — Odkrycie kontekstu

### Dokumenty źródłowe

| Dokument | Ścieżka | Uwagi |
|---|---|---|
| PRD | `context/foundation/prd.md` | Success Criteria, FR-004–006, NFR |
| Domain Distillation | `context/domain/01-domain-distillation.md` | Ranking refaktoru §Krok 5 |
| Tech-stack | `context/foundation/tech-stack.md` | Stack + warstwy |

### Stack i warstwy

```
UI          src/components/dashboard/GenerateFlashcards.tsx  — React 19 island
            src/components/dashboard/FlashcardForm.tsx       — manual creation form

API Layer   src/pages/api/flashcards/index.ts                — POST (create) / GET
            src/pages/api/flashcards/[id].ts                 — PUT / DELETE
            src/pages/api/flashcards/[id]/review.ts          — POST (grade)
            src/pages/api/flashcards/review/queue.ts         — GET (session queue)
            src/pages/api/flashcards/generate.ts             — POST (AI generation)

Service     src/lib/services/flashcard.service.ts            — CRUD
            src/lib/services/ai-generation.service.ts        — LLM call + proposal assembly
            src/lib/services/review.service.ts               — FSRS grading

Schemas     src/lib/schemas/flashcard.schemas.ts
            src/lib/schemas/ai-generation.schemas.ts

Types       src/types.ts                                     — Flashcard DTO + FlashcardSource

DB          supabase/migrations/20260531120000_create_flashcards.sql
            supabase/migrations/20260601120000_flashcards_fsrs.sql
```

Logika biznesowa żyje w `src/lib/services/`. Brak warstwy domenowej —
encje są gołymi DTO. Serwisy przyjmują `SupabaseClient` bezpośrednio
bez izolacji od persystencji.

---

## Krok 1 — Identyfikacja niezmienników biznesowych

| # | Niezmiennik | Źródło | Cytat |
|---|---|---|---|
| I1 | Source Text **nie jest persystowany** po zakończeniu generacji | PRD NFR | *"Source text…is not retained after the generation request completes — no trace in operator-accessible storage"* |
| I2 | Proposals są **efemeryczne** — nie trafiają do bazy danych | PRD FR-006 | *"list of AI-generated flashcard proposals to accept, edit, or reject"*; brak tabeli proposals w migracji |
| **I3** | **`source` Flashcard musi odzwierciedlać rzeczywistą ścieżkę tworzenia** | PRD §Success Criteria | *"75% of all flashcards in the system are created via AI generation"* — `source` jest jedynym instrumentem pomiaru tego KPI |
| I4 | Pola FSRS aktualizowane **wyłącznie przez `gradeCard`** | PRD FR-013 + ts-fsrs semantics | `src/lib/services/review.service.ts:95-117` — jedyna funkcja wywołująca `scheduler.next()` |
| I5 | `front` ≤ 1000 znaków, `back` ≤ 5000 znaków | PRD AI output rules | `src/lib/services/ai-generation.service.ts:25-27`; `src/lib/schemas/flashcard.schemas.ts:6-8` |
| I6 | Generacja zwraca 1–15 propozycji | PRD §AI Generation: *"up to 15 testable knowledge units"* | `src/lib/schemas/ai-generation.schemas.ts:23` — `.transform(cards => cards.slice(0, 15))` |
| I7 | Grading w trybie `practice` **nie przesuwa harmonogramu FSRS** | Kod (brak w PRD) | `src/pages/api/flashcards/[id]/review.ts:57-59` — wczesny return `{ data: null, skipped: true }` |
| I8 | Flashcardy są **prywatne dla użytkownika** (user isolation) | PRD §Access Control: *"Each user's flashcards are private"* | RLS policies `20260531120000_create_flashcards.sql:38-61`; `src/lib/services/flashcard.service.ts:50-51` |
| I9 | Usunięcie konta jest **natychmiastowe i kompletne** (GDPR Art. 17) | PRD FR-014 | `src/lib/services/account.service.ts:14-44` |

---

## Krok 2 — Klasyfikacja i wybór #1

### Tabela klasyfikacji

| # | Niezmiennik | (a) Rdzenność produktu | (b) Rozsmarowanie po warstwach | (c) Jakość egzekucji |
|---|---|---|---|---|
| I1 | Source Text nie persystowany | Wysoka (kontrakt prywatności) | 1 warstwa (service) | ✅ Silna — enforced by absence |
| I2 | Proposals efemeryczne | Wysoka (definicja domeny) | 1 warstwa (brak tabeli) | ✅ Silna — enforced by absence |
| **I3** | **FlashcardSource integrity** | **🔴 Maksymalna — jedyny instrument pomiaru KPI #1** | **🔴 3 warstwy: DB enum check / Zod enum / klient** | **🔴 Krytyczna luka: semantyka enforced WYŁĄCZNIE przez klienta** |
| I4 | FSRS tylko via `gradeCard` | Wysoka (broken scheduling = broken product) | 2 warstwy (service + schema) | 🟡 Umiarkowana — chroniona przez schema omission, nie przez projekt |
| I5 | front/back length limits | Średnia (content constraint) | 3 warstwy (DB, Zod, prompt) | ✅ Silna — double enforcement |
| I6 | 1–15 propozycji | Średnia (model output quality) | 1 warstwa (Zod transform) | ✅ Silna |
| I7 | Practice no-advance | Średnia | 1 warstwa (route guard) | ✅ Silna — explicit guard |
| I8 | User isolation | Wysoka (bezpieczeństwo) | 2 warstwy (RLS + service) | ✅ Silna |
| I9 | Total deletion | Wysoka (GDPR) | 2 warstwy | ✅ Silna |

### Wybór: I3 — FlashcardSource integrity

**Uzasadnienie**:

Niezmiennik I3 jest jednocześnie:

1. **Najbardziej rdzeniowy**: `FlashcardSource` jest *jedynym* instrumentem pomiaru primary success criterion (PRD: *"75% of all flashcards…created via AI generation"*). Bez wiarygodnych wartości `source` produkt nie potrafi zmierzyć, czy osiąga swój #1 KPI. Nie jest to wyłącznie reguła techniczna — to fundament mierzalności produktu.

2. **Najsłabiej egzekwowany**: Cała semantyczna reguła (*"jeśli front i back są niezmienione względem propozycji → `ai_full`, inaczej `ai_edited`"*) istnieje wyłącznie w funkcji `getSourceForProposal()` w `src/components/dashboard/GenerateFlashcards.tsx:78-83` — **po stronie klienta**. Serwer przyjmuje dowolną poprawną wartość enum bez żadnej weryfikacji ścieżki. Każde bezpośrednie wywołanie API może sfalszować `source`.

---

## Krok 3 — Diagnoza wybranego niezmiennika

### Pełna mapa obecnego życia reguły

#### Warstwa klienta (JEDYNA semantyczna egzekucja)

**`src/components/dashboard/GenerateFlashcards.tsx:78-83`**
```typescript
function getSourceForProposal(proposal: ProposalState): FlashcardSource {
  const frontUnchanged = normalizeInput(proposal.front) === normalizeInput(proposal.originalFront);
  const backUnchanged = normalizeInput(proposal.back) === normalizeInput(proposal.originalBack);
  return frontUnchanged && backUnchanged ? "ai_full" : "ai_edited";
}
```

**`src/components/dashboard/GenerateFlashcards.tsx:314-320`**
```typescript
body: JSON.stringify({
  front: normalizeInput(proposal.front),
  back: normalizeInput(proposal.back),
  source: getSourceForProposal(proposal),  // ← client computes and sends source
}),
```

#### Warstwa API (brak semantycznej egzekucji)

**`src/pages/api/flashcards/index.ts:49-53`** — POST handler
```typescript
const parsed = createFlashcardSchema.safeParse(payload);
// ...
const { data, error } = await createFlashcard(supabase, parsed.data, context.locals.user.id);
```
Serwer parsuje `source` jako enum, przekazuje bez weryfikacji.

#### Warstwa schematu (tylko syntaktyczna egzekucja)

**`src/lib/schemas/flashcard.schemas.ts:11`**
```typescript
source: z.enum(flashcardSourceValues).default("manual"),
```
Validates: *"wartość jest jedną z trzech"*. Nie validates: *"wartość odpowiada rzeczywistej ścieżce tworzenia"*.

#### Warstwa serwisu (pass-through)

**`src/lib/services/flashcard.service.ts:30-36`**
```typescript
const response = await supabase
  .from("flashcards")
  .insert({
    user_id: userId,
    front: input.front,
    back: input.back,
    source: input.source,  // ← blindly forwarded from API input
  })
```

#### Warstwa bazy danych (tylko syntaktyczna egzekucja)

**`supabase/migrations/20260531120000_create_flashcards.sql:26`**
```sql
constraint flashcards_source_valid check (source in ('manual', 'ai_full', 'ai_edited'))
```
Validates: *"wartość jest poprawna"*. Nie validates semantyki.

### Gdzie reguła jest naruszalna

| Scenariusz | Efekt |
|---|---|
| Bezpośredni `POST /api/flashcards { front, back, source: "ai_full" }` z zewnętrznego klienta | Karta z `source = "ai_full"` bez żadnej propozycji AI — inflacja metryki |
| Bug w `normalizeInput` lub `getSourceForProposal` na kliencie | Niezmieniona propozycja może zostać sklasyfikowana jako `"ai_edited"` lub odwrotnie |
| Nowy klient (mobile app, integration) który nie implementuje logiki porównania | Zawsze wysyła `"manual"` lub `"ai_full"` dla wszystkich kart — deflacja/inflacja metryki |
| Bezpośredni `POST /api/flashcards` z Postmana/testy | `source` można ustawić na dowolną wartość |

### Gdzie semantyka jest połykana / niewidoczna

- Serwis `createFlashcard` nie zwraca błędu ani wyjątku, gdy `source` nie odpowiada ścieżce — błąd jest po prostu niewidoczny
- Nie ma żadnego logu/eventu wskazującego na fałszywą klasyfikację
- DB constraint jest poprawna, ale ogranicza zbiór wartości, nie semantykę

---

## Krok 4 — Projekt agregatu-strażnika

### Koncepcja

Przenieść obliczanie `source` z klienta na serwer przez wprowadzenie **fabryki domenowej** jako jedynego miejsca tworzenia `NewFlashcardPayload`. Klient przestaje wysyłać `source` — wysyła `originalFront`/`originalBack` (dane propozycji) plus `front`/`back` (dane po ewentualnej edycji). Serwer oblicza `source`.

### Moduł domenowy — sygnatury + pseudokod

```typescript
// src/lib/domain/flashcard.factory.ts

export class InvalidFlashcardError extends Error {
  constructor(
    public readonly code: "front_empty" | "back_empty" | "front_too_long" | "back_too_long"
  ) {
    super(`flashcard_invalid: ${code}`);
    this.name = "InvalidFlashcardError";
  }
}

export interface NewFlashcardPayload {
  user_id: string;
  front: string;   // trimmed, validated
  back: string;    // trimmed, validated
  source: FlashcardSource;  // computed, never caller-supplied
}

/**
 * Preconditions (throw InvalidFlashcardError if violated):
 *  - front.trim() nie jest pusty
 *  - back.trim() nie jest pusty
 *  - front.trim().length ≤ 1000
 *  - back.trim().length ≤ 5000
 * Postcondition: source = "manual" (zawsze)
 */
export function createManual(
  userId: string,
  front: string,
  back: string,
): NewFlashcardPayload {
  const f = front.trim();
  const b = back.trim();
  if (!f) throw new InvalidFlashcardError("front_empty");
  if (!b) throw new InvalidFlashcardError("back_empty");
  if (f.length > 1000) throw new InvalidFlashcardError("front_too_long");
  if (b.length > 5000) throw new InvalidFlashcardError("back_too_long");
  return { user_id: userId, front: f, back: b, source: "manual" };
}

/**
 * Preconditions (throw InvalidFlashcardError if violated):
 *  - edited.front.trim() nie jest pusty
 *  - edited.back.trim() nie jest pusty
 *  - edited.front.trim().length ≤ 1000
 *  - edited.back.trim().length ≤ 5000
 * Postcondition:
 *  - source = "ai_full"   gdy  edited.front.trim() === original.front.trim()
 *                              && edited.back.trim()  === original.back.trim()
 *  - source = "ai_edited" w każdym innym przypadku
 */
export function acceptProposal(
  userId: string,
  original: { front: string; back: string },
  edited: { front: string; back: string },
): NewFlashcardPayload {
  const f = edited.front.trim();
  const b = edited.back.trim();
  if (!f) throw new InvalidFlashcardError("front_empty");
  if (!b) throw new InvalidFlashcardError("back_empty");
  if (f.length > 1000) throw new InvalidFlashcardError("front_too_long");
  if (b.length > 5000) throw new InvalidFlashcardError("back_too_long");
  const source: FlashcardSource =
    f === original.front.trim() && b === original.back.trim()
      ? "ai_full"
      : "ai_edited";
  return { user_id: userId, front: f, back: b, source };
}
```

Nielegalna operacja (puste `front`/`back`, przekroczony limit) **rzuca nazwany błąd domenowy** `InvalidFlashcardError` z kodem — nie loguje-i-jedzie dalej.

### Repozytorium / serwis

Serwis `createFlashcard` przestaje przyjmować `CreateFlashcardInput` (który zawiera `source` od klienta). Przyjmuje `NewFlashcardPayload` — zawsze z fabryki:

```typescript
// src/lib/services/flashcard.service.ts

export async function createFlashcard(
  supabase: SupabaseClient,
  payload: NewFlashcardPayload,  // ← z fabryki, nie z API body
): Promise<DataResult<Flashcard>> {
  const response = await supabase
    .from("flashcards")
    .insert(payload)          // user_id, front, back, source — wszystkie z fabryki
    .select("*")
    .single();
  // ...
}
```

`source` nigdy nie przechodzi przez sieć jako dane wejściowe — jest zawsze obliczone serwerowo.

### Cienkie API

**`POST /api/flashcards`** (manual creation only):
```
Request body: { front: string, back: string }
Server:
  1. parse input (Zod: no `source` field)
  2. createManual(user.id, front, back)      → throws InvalidFlashcardError or returns payload
  3. createFlashcard(supabase, payload)
  4. map InvalidFlashcardError → 422 (domain error)
Response: 201 { data: Flashcard }
```

**`POST /api/flashcards/accept`** (NEW — AI proposal acceptance):
```
Request body: {
  originalFront: string,
  originalBack: string,
  front: string,
  back: string
}
Server:
  1. parse input (Zod: acceptProposalSchema)
  2. acceptProposal(user.id, { originalFront, originalBack }, { front, back })
     → throws InvalidFlashcardError or returns payload with computed source
  3. createFlashcard(supabase, payload)
  4. map InvalidFlashcardError → 422
Response: 201 { data: Flashcard }
```

Klient `GenerateFlashcards.tsx` przestaje obliczać `source` — wysyła do nowego endpointu `originalFront`/`originalBack` + `front`/`back`.

### Atomowość

Brak wymagań wielokrokowych dla tego niezmiennika. Każda karta jest tworzona w jednym `INSERT`. Atomowość jest zapewniona na poziomie pojedynczego rekordu.

---

## Krok 5 — Before/After, Plan, Testy

### Before/After dla każdego obecnego miejsca reguły

#### 1. `src/lib/schemas/flashcard.schemas.ts`

**BEFORE**
```typescript
export const createFlashcardSchema = z.object({
  front: frontSchema,
  back: backSchema,
  source: z.enum(flashcardSourceValues).default("manual"),
  //      ^^^ klient może wysłać dowolną wartość
});
```

**AFTER**
```typescript
export const createFlashcardSchema = z.object({
  front: frontSchema,
  back: backSchema,
  // source usunięty — zawsze "manual" dla tego endpointu
});

export const acceptProposalSchema = z.object({
  originalFront: z.string().trim().min(1).max(1000),
  originalBack:  z.string().trim().min(1).max(5000),
  front:         frontSchema,
  back:          backSchema,
});

export type AcceptProposalInput = z.infer<typeof acceptProposalSchema>;
```

---

#### 2. `src/lib/services/flashcard.service.ts`

**BEFORE**
```typescript
export async function createFlashcard(
  supabase: SupabaseClient,
  input: CreateFlashcardInput,   // source pochodzi z API body
  userId: string,
): Promise<DataResult<Flashcard>> {
  const response = await supabase
    .from("flashcards")
    .insert({
      user_id: userId,
      front: input.front,
      back: input.back,
      source: input.source,    // ← forwarded bez weryfikacji
    })
```

**AFTER**
```typescript
import type { NewFlashcardPayload } from "@/lib/domain/flashcard.factory";

export async function createFlashcard(
  supabase: SupabaseClient,
  payload: NewFlashcardPayload,   // source już obliczone przez fabrykę
): Promise<DataResult<Flashcard>> {
  const response = await supabase
    .from("flashcards")
    .insert(payload)              // user_id, front, back, source — z fabryki
```

---

#### 3. `src/pages/api/flashcards/index.ts` (POST handler)

**BEFORE**
```typescript
const parsed = createFlashcardSchema.safeParse(payload);
// ...
const { data, error } = await createFlashcard(supabase, parsed.data, context.locals.user.id);
```

**AFTER**
```typescript
import { createManual, InvalidFlashcardError } from "@/lib/domain/flashcard.factory";
// ...
const parsed = createFlashcardSchema.safeParse(payload);
// ...
try {
  const flashcardPayload = createManual(
    context.locals.user.id,
    parsed.data.front,
    parsed.data.back,
  );
  const { data, error } = await createFlashcard(supabase, flashcardPayload);
  // ...
} catch (err) {
  if (err instanceof InvalidFlashcardError) {
    return Response.json({ error: err.message, code: err.code }, { status: 422 });
  }
  throw err;
}
```

---

#### 4. Nowy plik: `src/pages/api/flashcards/accept.ts`

**BEFORE**: nie istniał

**AFTER**
```typescript
import type { APIRoute } from "astro";
import { acceptProposalSchema } from "@/lib/schemas/flashcard.schemas";
import { acceptProposal, InvalidFlashcardError } from "@/lib/domain/flashcard.factory";
import { createFlashcard } from "@/lib/services/flashcard.service";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return Response.json({ error: "Supabase not configured" }, { status: 500 });
  if (!context.locals.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let payload: unknown;
  try { payload = await context.request.json(); }
  catch { return Response.json({ error: "Invalid JSON body" }, { status: 400 }); }

  const parsed = acceptProposalSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });

  try {
    const flashcardPayload = acceptProposal(
      context.locals.user.id,
      { front: parsed.data.originalFront, back: parsed.data.originalBack },
      { front: parsed.data.front, back: parsed.data.back },
    );
    const { data, error } = await createFlashcard(supabase, flashcardPayload);
    if (error || !data) return Response.json({ error: error ?? "Failed to create flashcard" }, { status: 500 });
    return Response.json({ data }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidFlashcardError) {
      return Response.json({ error: err.message, code: err.code }, { status: 422 });
    }
    throw err;
  }
};
```

---

#### 5. `src/components/dashboard/GenerateFlashcards.tsx` — `acceptProposal()`

**BEFORE**
```typescript
// GenerateFlashcards.tsx:78-83
function getSourceForProposal(proposal: ProposalState): FlashcardSource {
  const frontUnchanged = normalizeInput(proposal.front) === normalizeInput(proposal.originalFront);
  const backUnchanged = normalizeInput(proposal.back) === normalizeInput(proposal.originalBack);
  return frontUnchanged && backUnchanged ? "ai_full" : "ai_edited";
}

// GenerateFlashcards.tsx:314-320
body: JSON.stringify({
  front: normalizeInput(proposal.front),
  back: normalizeInput(proposal.back),
  source: getSourceForProposal(proposal),  // klient oblicza i wysyła
}),
```

**AFTER**
```typescript
// getSourceForProposal() usunięta

// acceptProposal() — zmiana endpointu i body
const response = await fetch("/api/flashcards/accept", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    originalFront: proposal.originalFront,   // dane oryginalnej propozycji
    originalBack: proposal.originalBack,
    front: normalizeInput(proposal.front),   // dane po ewentualnej edycji
    back: normalizeInput(proposal.back),
    // source usunięty — serwer oblicza
  }),
});
```

`FlashcardSource` import usunięty z `GenerateFlashcards.tsx` — nie jest już potrzebny po stronie klienta.

---

### Plan faz refaktoru

| Faza | Działanie | Test-first? | Uwagi |
|---|---|---|---|
| **F1** | Dodaj `src/lib/domain/flashcard.factory.ts` z `createManual`, `acceptProposal`, `InvalidFlashcardError` | **TDD** | Czysta logika domenowa bez zależności zewnętrznych. Zacznij od testów jednostkowych. |
| **F2** | Zaktualizuj `src/lib/schemas/flashcard.schemas.ts`: usuń `source` z `createFlashcardSchema`, dodaj `acceptProposalSchema` | Tak (schema unit test) | Zmiany w typach mogą złamać typy w serwisie — typechecker wykryje miejsca do naprawy |
| **F3** | Zaktualizuj `src/lib/services/flashcard.service.ts`: zmień sygnaturę `createFlashcard` na `NewFlashcardPayload` | Pośrednio przez integrację | Typechecker wskaże wszystkie callsite |
| **F4** | Zaktualizuj `POST /api/flashcards` handler — usuń `source` z body, wywołaj `createManual` | **TDD** — test integracyjny API | Sprawdź: `source` w body jest ignorowany / zwraca "manual" |
| **F5** | Utwórz `POST /api/flashcards/accept` | **TDD** — test integracyjny API | Sprawdź: ai_full/ai_edited na podstawie porównania |
| **F6** | Zaktualizuj `GenerateFlashcards.tsx`: zmień endpoint, usuń `getSourceForProposal`, wyślij `originalFront`/`originalBack` | Test komponentu (istniejący integration test) | `GenerateFlashcards.integration.test.tsx` musi przejść po zmianie |

---

### Przypadki testowe dla niezmiennika

#### F1 — Fabryka domenowa (jednostkowe, TDD)

**`createManual` — legalne przejścia**
- `createManual("uid", "Q", "A")` → `{ source: "manual", front: "Q", back: "A", user_id: "uid" }`
- `createManual("uid", "  Q  ", "A")` → `{ front: "Q" }` (trimmed)
- `createManual("uid", "Q", "A".repeat(5000))` → OK (dokładnie na granicy)
- `createManual("uid", "Q".repeat(1000), "A")` → OK

**`createManual` — nielegalne przejścia (fail-fast)**
- `createManual("uid", "", "A")` → throws `InvalidFlashcardError { code: "front_empty" }`
- `createManual("uid", "  ", "A")` → throws `InvalidFlashcardError { code: "front_empty" }` (trim → empty)
- `createManual("uid", "Q", "")` → throws `InvalidFlashcardError { code: "back_empty" }`
- `createManual("uid", "Q".repeat(1001), "A")` → throws `InvalidFlashcardError { code: "front_too_long" }`
- `createManual("uid", "Q", "A".repeat(5001))` → throws `InvalidFlashcardError { code: "back_too_long" }`

**`acceptProposal` — source determination**
- `acceptProposal("uid", { front: "Q", back: "A" }, { front: "Q", back: "A" })` → `{ source: "ai_full" }`
- `acceptProposal("uid", { front: " Q ", back: "A" }, { front: "Q", back: "A" })` → `{ source: "ai_full" }` (trim-normalized)
- `acceptProposal("uid", { front: "Q", back: "A" }, { front: "Q modified", back: "A" })` → `{ source: "ai_edited" }`
- `acceptProposal("uid", { front: "Q", back: "A" }, { front: "Q", back: "A modified" })` → `{ source: "ai_edited" }`
- `acceptProposal("uid", { front: "Q", back: "A" }, { front: "Q mod", back: "A mod" })` → `{ source: "ai_edited" }`

**`acceptProposal` — fail-fast**
- `acceptProposal("uid", { front: "Q", back: "A" }, { front: "", back: "A" })` → throws `InvalidFlashcardError { code: "front_empty" }`
- `acceptProposal("uid", { front: "Q", back: "A" }, { front: "Q", back: "A".repeat(5001) })` → throws `InvalidFlashcardError { code: "back_too_long" }`

#### F4 — API `POST /api/flashcards` (integracyjne)

- `POST /api/flashcards { front: "Q", back: "A" }` → 201, `data.source === "manual"`
- `POST /api/flashcards { front: "Q", back: "A", source: "ai_full" }` → 201, `data.source === "manual"` (source z body zignorowany)
- `POST /api/flashcards { front: "", back: "A" }` → 400 (Zod) lub 422 (fabryka)

#### F5 — API `POST /api/flashcards/accept` (integracyjne)

- `{ originalFront: "X", originalBack: "Y", front: "X", back: "Y" }` → 201, `data.source === "ai_full"`
- `{ originalFront: "X", originalBack: "Y", front: "X modified", back: "Y" }` → 201, `data.source === "ai_edited"`
- `{ originalFront: "X", originalBack: "Y", front: "X", back: "Y modified" }` → 201, `data.source === "ai_edited"`
- `{ originalFront: " X ", originalBack: "Y", front: "X", back: "Y" }` → 201, `data.source === "ai_full"` (trim-normalization)
- `{ originalFront: "X", originalBack: "Y", front: "", back: "Y" }` → 422, `code === "front_empty"`
- Brak auth → 401

---

### Nowe "load-bearing" nazwy do zarejestrowania

| Nazwa | Typ | Plik |
|---|---|---|
| `InvalidFlashcardError` | Error class (domain) | `src/lib/domain/flashcard.factory.ts` |
| `NewFlashcardPayload` | Interface | `src/lib/domain/flashcard.factory.ts` |
| `createManual` | Factory function | `src/lib/domain/flashcard.factory.ts` |
| `acceptProposal` | Factory function | `src/lib/domain/flashcard.factory.ts` |
| `acceptProposalSchema` | Zod schema | `src/lib/schemas/flashcard.schemas.ts` |
| `AcceptProposalInput` | DTO type | `src/lib/schemas/flashcard.schemas.ts` |
| `POST /api/flashcards/accept` | API endpoint | `src/pages/api/flashcards/accept.ts` |

---

## Podsumowanie

Najważniejszy niezmiennik domeny 10xCards — *"wartość `source` flashcard musi odzwierciedlać rzeczywistą ścieżkę tworzenia karty"* — jest dziś egzekwowany wyłącznie po stronie klienta (funkcja `getSourceForProposal` w `GenerateFlashcards.tsx:78-83`), co sprawia, że serwer nie ma żadnej gwarancji semantycznej poprawności wartości `source`. Jest to krytyczne, ponieważ `FlashcardSource` jest jedynym instrumentem pomiaru primary success criterion produktu (PRD: 75% kart tworzonych przez AI). Plan refaktoru wprowadza fabrykę domenową (`src/lib/domain/flashcard.factory.ts`) z dwoma factory functions — `createManual` i `acceptProposal` — które jako jedyne produkują `NewFlashcardPayload` z obliczonym `source`; żadna inna ścieżka nie może ustawić `source` na wejście. Klient przestaje wysyłać `source`, zamiast tego wysyła `originalFront`/`originalBack` do nowego endpointu `POST /api/flashcards/accept`, a serwer oblicza klasyfikację. Refaktor jest sześciofazowy (F1: TDD fabryki → F2: schematy → F3: serwis → F4: POST endpoint → F5: nowy accept endpoint → F6: klient), nie wymaga zmian migracji DB, i przynosi testowalne jednostkowo zachowanie dla każdego legalnego i nielegalnego przejścia. Po wdrożeniu fałszowanie `source` przez bezpośrednie wywołanie API staje się strukturalnie niemożliwe.
