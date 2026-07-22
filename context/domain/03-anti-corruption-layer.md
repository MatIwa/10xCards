---
title: "Anti-Corruption Layer — ts-fsrs / Scheduling Isolation"
created: 2026-07-22
type: refactor-plan
---

# Anti-Corruption Layer — ts-fsrs / Scheduling Isolation

> Plan refaktoru bez zmian w kodzie produkcyjnym. Wszystkie cytaty kodu
> zweryfikowane ręcznie — format `plik:linia`.

---

## Krok 0 — Kontekst

### Dokumenty źródłowe

| Dokument | Ścieżka | Relevantny fragment |
|---|---|---|
| PRD | `context/foundation/prd.md` | §Non-Goals: *"No custom SR algorithm — use a ready-made spaced repetition library"* |
| Domain Distillation | `context/domain/01-domain-distillation.md` | §Krok 2: Spaced Repetition = **Supporting** subdomain; Krok 5 #4: "Recall Rating without domain mapping" |
| Invariant Refactor | `context/domain/02-invariant-aggregate-refactor.md` | §Krok 4 row 2: "Recall Rating" PRD vs `Rating` z ts-fsrs w kodzie |
| Tech-stack | `context/foundation/tech-stack.md` | Stack: Astro 6 + React 19 + Supabase + Cloudflare Workers |

### Stack i warstwy

```
UI           src/components/dashboard/ReviewSession.tsx
API Layer    src/pages/api/flashcards/[id]/review.ts
             src/pages/api/flashcards/review/queue.ts
Schema       src/lib/schemas/review.schemas.ts
Service      src/lib/services/review.service.ts
Domain type  src/types.ts
DB           supabase/migrations/20260601120000_flashcards_fsrs.sql
```

### Manifest — zewnętrzne zależności

```json
"ts-fsrs": "^5.4.1"          ← biblioteka SR (FSRS algorytm)
"@supabase/supabase-js": "^2.99.1"
"zod": "^4.4.3"
"@sentry/astro": "^10.65.0"
```

---

## Krok 1 — Identyfikacja przeciekających zależności

### Oś 1: `ts-fsrs` — bezpośrednie importy

| Plik | Linia | Import |
|---|---|---|
| `src/lib/schemas/review.schemas.ts` | 1 | `import { Rating } from "ts-fsrs"` |
| `src/lib/services/review.service.ts` | 2 | `import { fsrs, Rating, type Card, type Grade } from "ts-fsrs"` |
| `src/lib/services/review.service.test.ts` | 2 | `import type { Card, RecordLogItem } from "ts-fsrs"` |
| `src/lib/services/review.service.test.ts` | 29 | `import { Rating } from "ts-fsrs"` |
| `test/review/review.service.integration.test.ts` | 3 | `import { Rating } from "ts-fsrs"` |

### Oś 2: `ts-fsrs` — implicitna wiedza (bez importu)

| Plik | Linia | Ukryta zależność |
|---|---|---|
| `src/types.ts` | 8–17 | Pola `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `reps`, `lapses` — nazwy 1:1 z polami `Card` w ts-fsrs |
| `src/types.ts` | 17 | `state: 0 \| 1 \| 2 \| 3` — zakodowane wartości ts-fsrs `State` enum (0=New, 1=Learning, 2=Review, 3=Relearning) |
| `src/components/dashboard/ReviewSession.tsx` | 22 | `type RatingValue = 1 \| 2 \| 3 \| 4` — hardcoded wartości ts-fsrs `Rating` enum (Again=1, Hard=2, Good=3, Easy=4) bez żadnego importu |
| `src/components/dashboard/ReviewSession.tsx` | 45–49 | `ratingOptions` mapuje `rating: 1/2/3/4` na etykiety Again/Hard/Good/Easy — wiedza o kolejności ts-fsrs `Rating` wbudowana w UI |

### Oś 3: `ts-fsrs` — DB schema (persystencja)

| Plik | Linia | Opis |
|---|---|---|
| `supabase/migrations/20260601120000_flashcards_fsrs.sql` | 16–23 | Kolumny `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state` — nazwy kolumn odzwierciedlają dokładnie pola ts-fsrs `Card` type |
| `supabase/migrations/20260601120000_flashcards_fsrs.sql` | 24 | `check (state between 0 and 3)` — DB-level walidacja zakodowana w wartościach ts-fsrs `State` |

### Oś 4: `@supabase/supabase-js` — bezpośrednie importy w serwisach

| Plik | Linia | Import |
|---|---|---|
| `src/lib/services/review.service.ts` | 1 | `import type { SupabaseClient } from "@supabase/supabase-js"` |
| `src/lib/services/flashcard.service.ts` | 1 | `import type { SupabaseClient } from "@supabase/supabase-js"` |
| `src/lib/services/account.service.ts` | 1 | `import type { SupabaseClient } from "@supabase/supabase-js"` |

---

## Krok 2 — Klasyfikacja i wybór #1

### Tabela porównawcza

| Zależność | (a) Liczba warstw/plików | (b) Ryzyko/koszt wymiany dziś | (c) Intencja dokumentów |
|---|---|---|---|
| **`ts-fsrs`** | **5 warstw**: schema API, service, domain types, UI komponent (implicitnie), DB schema | **Katastrofalny**: zmiana biblioteki = zmiana wire protocol, nazw kolumn DB, typów domenowych, UI | **PRD §Non-Goals**: *"use a ready-made spaced repetition library"* — biblioteka ma być implementacyjnym szczegółem. Historia migracji (SM-2 → FSRS) udowadnia, że wymiana **już nastąpiła** i kosztowała przepisanie schematu |
| `@supabase/supabase-js` | 3 pliki service | Wysoki | Tech-stack wybrał Supabase jawnie jako core; brak sygnału o wymienialności |

### Uzasadnienie wyboru `ts-fsrs` jako #1

1. **Rozjazd intencja–kod**: PRD §Non-Goals definiuje SR bibliotekę jako podmienny komponent (*"use a ready-made spaced repetition library"* — nie *this* library). Domain Distillation potwierdza: Spaced Repetition to subdomena **Supporting**, nie Core. Tymczasem kod traktuje `ts-fsrs` jak fundament — nazwy pól domeny i API są dosłownie skopiowane z biblioteki.

2. **Historia zmiany algorytmu**: Migracja `20260601120000_flashcards_fsrs.sql` jest materialnym dowodem, że zmiana algorytmu SR już się wydarzyła (SM-2 → FSRS). Poprzednia zmiana wymagała: nowej migracji, przepisania serwisu, zmiany typów. ACL zaprojektowany przed tą zmianą skróciłby ją do modyfikacji jednego adaptera.

3. **Przeciek do warstwy API (wire protocol)**: `src/lib/schemas/review.schemas.ts:1` importuje `Rating` z `ts-fsrs`, by zdefiniować dozwolone wartości pola `rating` w żądaniu HTTP. Oznacza to, że **kontrakt API jest zakodowany w wartościach wewnętrznego enum biblioteki** (`Again=1, Hard=2, Good=3, Easy=4`). Klient (UI) zakodował te wartości w `type RatingValue = 1 | 2 | 3 | 4` bez importu biblioteki — tzn. wiedza o internaliach ts-fsrs jest **duplikowana bez traceability**.

4. **Supabase** jest potwierdzonym core'em stacku (tech-stack.md); brak dokumentacji o zamiarze wymiany. Priorytet niższy.

---

## Krok 3 — Diagnoza

### D1: Protokół wire API zakodowany w wartościach ts-fsrs

**Lokalizacja przecieku**:
```
src/lib/schemas/review.schemas.ts:1
import { Rating } from "ts-fsrs";          // biblioteka importowana w warstwie schema API

src/lib/schemas/review.schemas.ts:4
rating: z.union([z.literal(Rating.Again), z.literal(Rating.Hard),
                 z.literal(Rating.Good),   z.literal(Rating.Easy)])
// → kompiluje do: rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
// Wire protocol: { "rating": 1 | 2 | 3 | 4 }
```

**Duplikacja po stronie UI** (bez importu biblioteki):
```
src/components/dashboard/ReviewSession.tsx:22
type RatingValue = 1 | 2 | 3 | 4;          // ts-fsrs Rating.Again..Easy zakodowane na twardo

src/components/dashboard/ReviewSession.tsx:45–49
const ratingOptions = [
  { rating: 1, key: "again", ... },         // Rating.Again === 1 — wiedza bez śladu importu
  { rating: 2, key: "hard",  ... },
  { rating: 3, key: "good",  ... },
  { rating: 4, key: "easy",  ... },
];
```

**Zagrożenie**: Jeśli nowa biblioteka SR używa innych wartości numerycznych (np. 0-based lub string enums), zarówno schema jak i UI muszą zmienić się równocześnie, **bez żadnego statycznego gwaranta** że obie są zsynchronizowane.

### D2: Typ domenowy `Flashcard` to alias ts-fsrs `Card` + pola biznesowe

```
src/types.ts:8–17
  due: string;                 // Card.due (ISO zamiast Date)
  stability: number;           // Card.stability — ts-fsrs field
  difficulty: number;          // Card.difficulty — ts-fsrs field
  elapsed_days: number;        // Card.elapsed_days — ts-fsrs field (deprecated w v5, ale nadal używane)
  scheduled_days: number;      // Card.scheduled_days — ts-fsrs field
  learning_steps: number;      // Card.learning_steps — ts-fsrs field
  reps: number;                // Card.reps — ts-fsrs field
  lapses: number;              // Card.lapses — ts-fsrs field
  state: 0 | 1 | 2 | 3;       // State enum: New=0, Learning=1, Review=2, Relearning=3
  last_review: string | null;  // Card.last_review (ISO zamiast Date)
```

**Konwersja `rehydrate`/`serialize` istnieje, ale to nie ACL**:
```
src/lib/services/review.service.ts:18–47
export function rehydrate(row: Flashcard): Card { ... }   // Flashcard→Card (tylko Date/ISO konwersja)
export function serialize(card: Card): Partial<Flashcard> { ... }  // Card→Flashcard
```
Funkcje te wykonują tylko konwersję `string↔Date`. Nie izolują biblioteki — `Card` i `Grade` z `ts-fsrs` nadal wypływają do sygnatury funkcji `gradeCard`:

```
src/lib/services/review.service.ts:91
export async function gradeCard(
  supabase: SupabaseClient,
  id: string,
  userId: string,
  rating: Rating,              // ← typ ts-fsrs w domenie serwisu
): Promise<DataResult<Flashcard>>
```

### D3: Rozjazd PRD — dziedzina mówi "Recall Rating", kod mówi `Rating`

```
context/domain/01-domain-distillation.md:70
| **Rating** | Ocena przypomnienia karty przez użytkownika. Cztery wartości: Again, Hard, Good, Easy.
  Wejście do algorytmu FSRS. | PRD FR-013 | src/lib/schemas/review.schemas.ts:4 |
```

PRD FR-013: *"User can rate their recall (scheduling input for the SR algorithm)"* — domenowe pojęcie to **Recall Rating** jako wejście do harmonogramowania. Kod nie ma żadnego domenowego type'u `RecallRating`. Bezpośrednie użycie `Rating` z ts-fsrs oznacza, że **termin domenowy i typ biblioteki są tożsame** — nie ma miejsca, gdzie domena "nie wie" o ts-fsrs.

---

## Krok 4 — Projekt ACL

### Value object: `RecallRating`

Domenowy enum zastępujący `Rating` z ts-fsrs w każdym miejscu poza adapterem.

```typescript
// src/lib/scheduling/types.ts (pseudokod — nie modyfikuj kodu)

/** Domenowa ocena przypomnienia. Odpowiada PR FR-013: "rate their recall". */
export type RecallRating = "again" | "hard" | "good" | "easy";

/**
 * Faza cyklu uczenia karty — domenowa nazwa zastępująca ts-fsrs State enum
 * (0=New → "new", 1=Learning → "learning", 2=Review → "review", 3=Relearning → "relearning").
 */
export type SchedulingPhase = "new" | "learning" | "review" | "relearning";

/**
 * Domenowy stan harmonogramowania karty — jedyne miejsce wiedzy o kształcie
 * FSRS-kompatybilnych pól. Reszta kodu zna tylko ten interfejs.
 */
export interface ScheduledCard {
  due: string;              // ISO 8601 — data następnej powtórki
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  phase: SchedulingPhase;   // ZASTĘPUJE state: 0|1|2|3
  last_review: string | null;
}

/** Podgląd dat następnych powtórek dla każdej możliwej oceny. */
export interface RatingPreview {
  again: Date;
  hard: Date;
  good: Date;
  easy: Date;
}
```

### Port (interfejs domenowy)

```typescript
// src/lib/scheduling/scheduler.port.ts (pseudokod)

import type { RecallRating, ScheduledCard, RatingPreview } from "./types";

/**
 * Port harmonogramowania — jedyna abstrakcja, którą reszta kodu "zna".
 * Implementacja (konkretna biblioteka) jest wstrzykiwana przez DI lub
 * tworzenie instancji w module serwisu.
 */
export interface SchedulerPort {
  /**
   * Oblicza nowy stan harmonogramowania po ocenie karty.
   * @param card    Aktualny stan karty (domenowy ScheduledCard)
   * @param rating  Ocena użytkownika (domenowy RecallRating)
   * @param now     Czas oceny (domyślnie: new Date())
   * @returns       Zaktualizowany stan harmonogramowania
   */
  schedule(card: ScheduledCard, rating: RecallRating, now?: Date): ScheduledCard;

  /**
   * Zwraca podgląd dat dla wszystkich czterech możliwych ocen.
   * Używany do wyświetlenia użytkownikowi przed wyborem.
   */
  preview(card: ScheduledCard, now?: Date): RatingPreview;
}
```

### Adapter implementujący port przez ts-fsrs

```typescript
// src/lib/scheduling/fsrs.adapter.ts (pseudokod)

import { fsrs, Rating, type Card } from "ts-fsrs";    // ← JEDYNE miejsce importu ts-fsrs
import type { SchedulerPort } from "./scheduler.port";
import type { RecallRating, ScheduledCard, RatingPreview } from "./types";

// ---- Mapowania (hermetyczna wiedza adaptera) ----

const RATING_MAP: Record<RecallRating, Rating> = {
  again: Rating.Again,   // 1
  hard:  Rating.Hard,    // 2
  good:  Rating.Good,    // 3
  easy:  Rating.Easy,    // 4
};

const PHASE_TO_STATE: Record<string, 0 | 1 | 2 | 3> = {
  new:        0,
  learning:   1,
  review:     2,
  relearning: 3,
};

const STATE_TO_PHASE = ["new", "learning", "review", "relearning"] as const;

// ---- Konwersja ScheduledCard ↔ ts-fsrs Card ----

function toFsrsCard(sc: ScheduledCard): Card {
  return {
    due:            new Date(sc.due),
    stability:      sc.stability,
    difficulty:     sc.difficulty,
    elapsed_days:   sc.elapsed_days,
    scheduled_days: sc.scheduled_days,
    learning_steps: sc.learning_steps,
    reps:           sc.reps,
    lapses:         sc.lapses,
    state:          PHASE_TO_STATE[sc.phase] ?? 0,
    last_review:    sc.last_review ? new Date(sc.last_review) : undefined,
  };
}

function fromFsrsCard(card: Card): ScheduledCard {
  return {
    due:            card.due.toISOString(),
    stability:      card.stability,
    difficulty:     card.difficulty,
    elapsed_days:   card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps:           card.reps,
    lapses:         card.lapses,
    phase:          STATE_TO_PHASE[card.state] ?? "new",
    last_review:    card.last_review?.toISOString() ?? null,
  };
}

// ---- Implementacja portu ----

export class FsrsAdapter implements SchedulerPort {
  private readonly scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true, enable_short_term: true });

  schedule(sc: ScheduledCard, rating: RecallRating, now = new Date()): ScheduledCard {
    const { card } = this.scheduler.next(toFsrsCard(sc), now, RATING_MAP[rating]);
    return fromFsrsCard(card);
  }

  preview(sc: ScheduledCard, now = new Date()): RatingPreview {
    const p = this.scheduler.repeat(toFsrsCard(sc), now);
    return {
      again: p[Rating.Again].card.due,
      hard:  p[Rating.Hard].card.due,
      good:  p[Rating.Good].card.due,
      easy:  p[Rating.Easy].card.due,
    };
  }
}
```

### Schemat docelowy `types.ts`

Typ `Flashcard` zostaje rozszerzony o pole `phase: SchedulingPhase` zastępujące `state: 0|1|2|3`.
Pole `state` jest zachowane w DB (kolumna `smallint`) — adapter mapuje `state → phase` przy odczycie.

```typescript
// src/types.ts — BEFORE (fragment)
  state: 0 | 1 | 2 | 3;       // ts-fsrs State enum zakodowany bezpośrednio

// src/types.ts — AFTER (pseudokod)
  import type { SchedulingPhase } from "@/lib/scheduling/types";
  phase: SchedulingPhase;      // "new" | "learning" | "review" | "relearning"
  // state: 0|1|2|3 usunięte z domain type; adapter transluje DB row → ScheduledCard
```

### Schemat docelowy `review.schemas.ts`

```typescript
// BEFORE (src/lib/schemas/review.schemas.ts:1-5)
import { Rating } from "ts-fsrs";
export const gradeReviewSchema = z.object({
  rating: z.union([z.literal(Rating.Again), z.literal(Rating.Hard),
                   z.literal(Rating.Good),  z.literal(Rating.Easy)]),
});
// Wire: { "rating": 1 | 2 | 3 | 4 }

// AFTER (pseudokod)
// import { RecallRating } from "@/lib/scheduling/types";
export const gradeReviewSchema = z.object({
  rating: z.enum(["again", "hard", "good", "easy"]),
});
// Wire: { "rating": "again" | "hard" | "good" | "easy" }
```

Wire protocol staje się self-documenting — klient wysyła `"good"`, nie `3`.

---

## Krok 5 — Dowód izolacji + before/after

### Lista plików znających `ts-fsrs` dziś vs. po refaktorze

| Plik | Dziś zna ts-fsrs? | Po refaktorze? | Jak? |
|---|---|---|---|
| `src/lib/scheduling/fsrs.adapter.ts` | — (nowy plik) | **TAK** | jedyne miejsce importu biblioteki |
| `src/lib/services/review.service.ts` | ✅ (bezpośredni import `fsrs, Rating, Card, Grade`) | ❌ | zamienia import na `SchedulerPort` |
| `src/lib/schemas/review.schemas.ts` | ✅ (import `Rating`) | ❌ | `z.enum(["again","hard","good","easy"])` |
| `src/types.ts` | ✅ (implicite: `state: 0\|1\|2\|3`, ts-fsrs field names) | ❌ | `phase: SchedulingPhase` (string); pozostałe pola bez zmian |
| `src/components/dashboard/ReviewSession.tsx` | ✅ (implicite: `type RatingValue = 1\|2\|3\|4`) | ❌ | `type RatingValue = RecallRating` lub inlined string type |
| `src/lib/services/review.service.test.ts` | ✅ (import `Card, RecordLogItem, Rating`) | ❌ | testy mockują `SchedulerPort`, nie `ts-fsrs` |
| `test/review/review.service.integration.test.ts` | ✅ (import `Rating`) | ❌ | używa `RecallRating` string literals |

**Kryterium sukcesu (KROK 6)**:
```
grep -r "from \"ts-fsrs\"" src/
```
Zwraca **wyłącznie**:
```
src/lib/scheduling/fsrs.adapter.ts
```

### Before/after: zduplikowana wiedza o Rating values

**Before** — wiedza w 3 miejscach, brak spójności gwarantowanej statycznie:
```
src/lib/schemas/review.schemas.ts:4   z.literal(Rating.Again) ... (import z ts-fsrs)
src/lib/services/review.service.ts:2  import { Rating } from "ts-fsrs"
src/components/dashboard/ReviewSession.tsx:22  type RatingValue = 1|2|3|4  ← duplikat bez importu
src/components/dashboard/ReviewSession.tsx:45  { rating: 1, key: "again" }  ← wartości enum bez śladu
```

**After** — wiedza w 1 miejscu:
```
src/lib/scheduling/types.ts           export type RecallRating = "again"|"hard"|"good"|"easy"
src/lib/scheduling/fsrs.adapter.ts    RATING_MAP: Record<RecallRating, Rating>  ← jedyna translacja

src/lib/schemas/review.schemas.ts     z.enum(["again","hard","good","easy"])  ← importuje RecallRating
src/components/dashboard/ReviewSession.tsx  type RatingValue = RecallRating    ← reużywa domenowego typu
```

### Before/after: warstwa UI — dane domenowe vs. surowy obiekt biblioteki

**Before** — UI dostaje z API pole `state: 0|1|2|3` (ts-fsrs State enum), musi "wiedzieć" co to oznacza lub ignoruje (ReviewSession.tsx nie używa `state` — ale API go zwraca przez `...flashcard` spread):

```
src/pages/api/flashcards/review/queue.ts:28–36
return {
  ...flashcard,          // ← zwraca state: 0|1|2|3, elapsed_days, stability, ...
  preview: { ... },
};
```

**After** — API zwraca `phase: "review"` zamiast `state: 2`. UI i API klienci dostają czytelny domenowy string, nie surowy numeryczny enum biblioteki.

### Rozstrzygnięcie otwartych pytań (adapter jako miejsce decyzji)

**Pytanie**: Gdzie zakodować konfigurację schedulera (`request_retention: 0.9`, `enable_fuzz: true`, `enable_short_term: true`)?

**Odpowiedź** (na podstawie ts-fsrs docs): Parametry te są częścią FSRS-specific tuning — nie są domenową decyzją, lecz adaptacyjną. Należą do `FsrsAdapter`, nie do serwisu ani do typów domenowych. Konstruktor `FsrsAdapter` przyjmuje opcjonalny `Partial<FSRSParameters>`, co pozwala konfigurować go ze środowiska bez wiedzy serwisu o konkretnej bibliotece.

```typescript
export class FsrsAdapter implements SchedulerPort {
  constructor(private readonly params?: Partial<import("ts-fsrs").FSRSParameters>) {
    this.scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true, enable_short_term: true, ...params });
  }
}
```

---

## Krok 6 — Weryfikacja i plan

### Kryterium sukcesu

```bash
# Po refaktorze — lista plików znających ts-fsrs w katalogu src/:
grep -rl "from \"ts-fsrs\"" src/
# Oczekiwany wynik: WYŁĄCZNIE src/lib/scheduling/fsrs.adapter.ts
```

### Pliki dziś vs. po refaktorze

| Plik | Dziś importuje ts-fsrs | Po refaktorze |
|---|---|---|
| `src/lib/scheduling/fsrs.adapter.ts` | — (nowy) | TAK — jedyny adapter |
| `src/lib/services/review.service.ts` | **TAK** (linia 2) | NIE — zna tylko `SchedulerPort` |
| `src/lib/schemas/review.schemas.ts` | **TAK** (linia 1) | NIE — `z.enum([...RecallRating...])` |
| `src/types.ts` | implicite TAK | NIE — `phase: SchedulingPhase` |
| `src/components/dashboard/ReviewSession.tsx` | implicite TAK | NIE — `type RatingValue = RecallRating` |
| `src/lib/services/review.service.test.ts` | **TAK** (linia 2, 29) | NIE — mockuje `SchedulerPort` |
| `test/review/review.service.integration.test.ts` | **TAK** (linia 3) | NIE — `RecallRating` string literals |

### Plan faz

**Faza 1 — Stwórz katalog ACL**
- [ ] Utwórz `src/lib/scheduling/types.ts` — `RecallRating`, `SchedulingPhase`, `ScheduledCard`, `RatingPreview`
- [ ] Utwórz `src/lib/scheduling/scheduler.port.ts` — interfejs `SchedulerPort`
- [ ] Utwórz `src/lib/scheduling/fsrs.adapter.ts` — klasa `FsrsAdapter implements SchedulerPort`
  - Przenieś `rehydrate()` i `serialize()` z `review.service.ts` jako prywatne `toFsrsCard` / `fromFsrsCard`
  - Przenieś instancję `scheduler = fsrs(...)` z module-level do klasy
- [ ] Utwórz `src/lib/scheduling/index.ts` — reeksport publicznego API ACL

**Faza 2 — Napraw krytyczny przeciek w warstwie schema/API**
- [ ] Zaktualizuj `src/lib/schemas/review.schemas.ts`:
  - Usuń `import { Rating } from "ts-fsrs"`
  - Zastąp `z.union([z.literal(Rating.Again), ...])` przez `z.enum(["again","hard","good","easy"])`
  - Zaktualizuj `GradeReviewInput` — pole `rating` staje się `RecallRating`
- [ ] Zaktualizuj `src/pages/api/flashcards/[id]/review.ts`:
  - `parsedBody.data.rating` jest teraz `RecallRating` — przekaż bezpośrednio do `gradeCard`
- [ ] Zaktualizuj `src/components/dashboard/ReviewSession.tsx`:
  - `type RatingValue = RecallRating` (zamiast `1|2|3|4`)
  - `ratingOptions` używa string key jako wartości `rating: "again"|"hard"|"good"|"easy"`
  - `JSON.stringify({ rating })` wysyła string, nie liczbę

**Faza 3 — Wyizoluj serwis od ts-fsrs**
- [ ] Zaktualizuj `src/lib/services/review.service.ts`:
  - Usuń `import { fsrs, Rating, type Card, type Grade } from "ts-fsrs"`
  - Wstrzyknij / importuj `FsrsAdapter` jako `SchedulerPort`
  - Sygnatura `gradeCard(..rating: RecallRating..)` zamiast `rating: Rating`
  - Usuń `rehydrate()`, `serialize()` (przeniesione do adaptera)
  - `previewRatings` korzysta z `scheduler.preview(card)`
  - `gradeCard` korzysta z `scheduler.schedule(card, rating)`
- [ ] Zaktualizuj `src/types.ts`:
  - Importuj `SchedulingPhase` z `@/lib/scheduling/types`
  - Zastąp `state: 0|1|2|3` przez `phase: SchedulingPhase`
  - (Opcjonalnie: zachowaj `state` jako `/** @internal */` dla DB row mapping w adapterze)

**Faza 4 — Zaktualizuj testy**
- [ ] `src/lib/services/review.service.test.ts`: mock `SchedulerPort`, nie `ts-fsrs`; używaj `RecallRating` string literals
- [ ] `test/review/review.service.integration.test.ts`: zamień `Rating.Good` → `"good"` (i pozostałe)

**Faza 5 — Weryfikacja**
- [ ] `grep -rl "from \"ts-fsrs\"" src/` zwraca tylko `src/lib/scheduling/fsrs.adapter.ts`
- [ ] `npm run lint && npm run build` bez błędów
- [ ] `npm run test` zielony

---

## Podsumowanie (5–8 zdań)

Najpoważniejszym przeciekiem zależności w 10xCards jest `ts-fsrs` — biblioteka do harmonogramowania SR — która narusza granice warstw w pięciu punktach jednocześnie: warstwę schema API (`review.schemas.ts` importuje `Rating`), warstwę serwisu (`review.service.ts` importuje `fsrs, Rating, Card, Grade`), typ domenowy (`types.ts` koduje numeryczne wartości ts-fsrs `State` enum jako `0|1|2|3`), komponent UI (`ReviewSession.tsx` hardkoduje `type RatingValue = 1|2|3|4` jako wiedzę o wewnętrznym enumie biblioteki bez żadnego importu), oraz schemat bazy danych (nazwy kolumn są 1:1 kopią pól ts-fsrs `Card`). Przeciek jest szczególnie groźny, bo PRD §Non-Goals definiuje SR jako wymienialny komponent (*"use a ready-made spaced repetition library"*), a historia migracji `20260601120000_flashcards_fsrs.sql` dowodzi, że wymiana algorytmu już raz nastąpiła — kosztowała przepisanie schematu DB, typów i serwisu. Proponowany ACL wprowadza trzy artefakty: domenowy typ `RecallRating` ("again"|"hard"|"good"|"easy"), domenowy interfejs `SchedulerPort` (metody `schedule` i `preview`), oraz klasę `FsrsAdapter` jako jedyne miejsce w kodzie, które importuje `ts-fsrs`. Krytyczną poprawką fazy 2 jest zmiana wire protokołu API z `{ rating: 1|2|3|4 }` (wartości ts-fsrs) na `{ rating: "again"|"hard"|"good"|"easy" }` (domenowe stringi) — to eliminuje ukrytą duplikację wartości enum między serwisem a UI. Po zakończeniu refaktoru `grep -rl "from \"ts-fsrs\"" src/` ma zwracać wyłącznie `src/lib/scheduling/fsrs.adapter.ts`, co jest mechanicznym kryterium weryfikacji pełnej izolacji.
