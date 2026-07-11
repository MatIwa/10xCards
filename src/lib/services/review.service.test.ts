import type { SupabaseClient } from "@supabase/supabase-js";
import type { Card, RecordLogItem } from "ts-fsrs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flashcard } from "@/types";

// ---------------------------------------------------------------------------
// Mock ts-fsrs: replace the `fsrs()` factory with a spy-able version while
// keeping `Rating` real so tests can pass Rating.Again etc. as inputs.
// The factory itself is a spy so we can assert on the config the service
// passes into it (see "fsrs scheduler configuration" below).
// ---------------------------------------------------------------------------
const schedulerSpies = vi.hoisted(() => ({
  next: vi.fn(),
  repeat: vi.fn(),
}));

const fsrsFactorySpy = vi.hoisted(() => vi.fn(() => schedulerSpies));

vi.mock("ts-fsrs", async () => {
  const actual = await vi.importActual<typeof import("ts-fsrs")>("ts-fsrs");
  return {
    ...actual,
    fsrs: fsrsFactorySpy,
  };
});

// Import service AFTER mock is set up (module is resolved fresh due to vi.mock hoisting)
import { gradeCard, listDueCards, listPracticeCards, previewRatings, rehydrate, serialize } from "./review.service";
import { Rating } from "ts-fsrs";

// Snapshot the fsrs factory call that happens during service module import. The
// existing test suites call `vi.clearAllMocks()` in afterEach hooks, which
// would otherwise wipe this call before the "fsrs scheduler configuration"
// test runs.
// Cast via `unknown[]` because vi.fn infers an empty-tuple args type for a
// zero-arg factory, even though ts-fsrs invokes it with a config object.
const initialFsrsFactoryArgs = (fsrsFactorySpy.mock.calls[0] as unknown[] | undefined)?.[0];

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeFsrsCard(overrides: Partial<Card> = {}): Card {
  return {
    due: new Date("2027-01-01T00:00:00.000Z"),
    stability: 1.5,
    difficulty: 5.0,
    elapsed_days: 0,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: 1,
    last_review: new Date("2026-12-31T00:00:00.000Z"),
    ...overrides,
  };
}

function makeFlashcard(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: "card-uuid",
    user_id: "user-uuid",
    front: "Front",
    back: "Back",
    source: "manual",
    due: "2027-01-01T00:00:00.000Z",
    stability: 1.5,
    difficulty: 5.0,
    elapsed_days: 0,
    scheduled_days: 1,
    learning_steps: 0,
    reps: 1,
    lapses: 0,
    state: 1,
    last_review: "2026-12-31T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rehydrate / serialize
// ---------------------------------------------------------------------------
describe("rehydrate / serialize round-trip", () => {
  it("converts a full Flashcard row to a Card and back preserving FSRS fields", () => {
    const row = makeFlashcard();
    const card = rehydrate(row);
    const serialized = serialize(card);

    expect(serialized).toMatchObject({
      due: row.due,
      stability: row.stability,
      difficulty: row.difficulty,
      elapsed_days: row.elapsed_days,
      scheduled_days: row.scheduled_days,
      learning_steps: row.learning_steps,
      reps: row.reps,
      lapses: row.lapses,
      state: row.state,
      last_review: row.last_review,
    });
  });

  it("handles null last_review correctly", () => {
    const row = makeFlashcard({ last_review: null });
    const card = rehydrate(row);
    const serialized = serialize(card);

    expect(card.last_review).toBeUndefined();
    expect(serialized.last_review).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// previewRatings
// ---------------------------------------------------------------------------
describe("previewRatings", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns due dates for all four ratings in a single scheduler.repeat call", () => {
    const now = new Date("2027-01-01T00:00:00.000Z");
    const row = makeFlashcard();

    const againDue = new Date("2027-01-01T00:10:00.000Z");
    const hardDue = new Date("2027-01-01T04:00:00.000Z");
    const goodDue = new Date("2027-01-02T00:00:00.000Z");
    const easyDue = new Date("2027-01-04T00:00:00.000Z");

    const repeatReturn: Partial<Record<number, RecordLogItem>> = {
      [Rating.Again]: { card: { ...makeFsrsCard(), due: againDue }, log: {} } as unknown as RecordLogItem,
      [Rating.Hard]: { card: { ...makeFsrsCard(), due: hardDue }, log: {} } as unknown as RecordLogItem,
      [Rating.Good]: { card: { ...makeFsrsCard(), due: goodDue }, log: {} } as unknown as RecordLogItem,
      [Rating.Easy]: { card: { ...makeFsrsCard(), due: easyDue }, log: {} } as unknown as RecordLogItem,
    };

    schedulerSpies.repeat.mockReturnValueOnce(repeatReturn);

    const result = previewRatings(row, now);

    expect(schedulerSpies.repeat).toHaveBeenCalledOnce();
    const [calledCard, calledDate] = schedulerSpies.repeat.mock.calls[0] as [Card, Date];
    expect(calledDate).toEqual(now);
    // The rehydrated card should have the same FSRS fields as the row
    expect(calledCard.stability).toBe(row.stability);
    expect(calledCard.difficulty).toBe(row.difficulty);
    expect(calledCard.reps).toBe(row.reps);

    expect(result.again).toEqual(againDue);
    expect(result.hard).toEqual(hardDue);
    expect(result.good).toEqual(goodDue);
    expect(result.easy).toEqual(easyDue);
  });
});

// ---------------------------------------------------------------------------
// gradeCard
// ---------------------------------------------------------------------------
describe("gradeCard", () => {
  const FIXED_NOW = new Date("2027-06-15T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function createSupabaseStub({
    selectReturn,
    updateReturn,
  }: {
    selectReturn: { data: Flashcard | null; error: { message: string } | null };
    updateReturn?: { data: Flashcard | null; error: { message: string } | null };
  }) {
    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => Promise.resolve(updateReturn ?? { data: null, error: null })),
    };
    updateChain.eq.mockReturnValue(updateChain);
    updateChain.select.mockReturnValue(updateChain);

    const selectChain = {
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(() => Promise.resolve(selectReturn)),
    };
    selectChain.eq.mockReturnValue(selectChain);

    const updateFn = vi.fn(() => updateChain);

    const fromFn = vi.fn((_table: string) => ({
      select: vi.fn(() => selectChain),
      update: updateFn,
    }));

    return {
      supabase: { from: fromFn } as unknown as SupabaseClient,
      fromFn,
      updateFn,
      selectChain,
      updateChain,
    };
  }

  it.each([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy])(
    "calls scheduler.next and persists serialize(card) for rating %s",
    async (rating) => {
      const row = makeFlashcard();
      const fakeUpdatedCard = makeFsrsCard({ reps: 2, stability: 2.5 });
      const fakeUpdatedRow = makeFlashcard({ reps: 2, stability: 2.5 });

      schedulerSpies.next.mockReturnValueOnce({ card: fakeUpdatedCard, log: {} });

      const { supabase, updateFn } = createSupabaseStub({
        selectReturn: { data: row, error: null },
        updateReturn: { data: fakeUpdatedRow, error: null },
      });

      const result = await gradeCard(supabase, "card-uuid", "user-uuid", rating);

      // scheduler.next called with rehydrated card, fixed time, and the rating
      expect(schedulerSpies.next).toHaveBeenCalledOnce();
      const [calledCard, calledDate, calledRating] = schedulerSpies.next.mock.calls[0] as [Card, Date, number];
      expect(calledDate).toEqual(FIXED_NOW);
      expect(calledRating).toBe(rating);
      expect(calledCard.stability).toBe(row.stability);
      expect(calledCard.reps).toBe(row.reps);

      // update() received serialize(fakeUpdatedCard)
      expect(updateFn).toHaveBeenCalledOnce();
      // Cast via `unknown[]` for the same reason as `initialFsrsFactoryArgs`
      // above: the stub `vi.fn(() => updateChain)` has a zero-arg inferred type.
      const updatePayload = (updateFn.mock.calls[0] as unknown[] | undefined)?.[0] as Partial<Flashcard>;
      expect(updatePayload).toMatchObject(serialize(fakeUpdatedCard));

      expect(result).toEqual({ data: fakeUpdatedRow, error: null });
    },
  );

  it("returns Flashcard not found without calling scheduler when row is missing", async () => {
    schedulerSpies.next.mockReturnValueOnce({ card: makeFsrsCard(), log: {} });

    const { supabase } = createSupabaseStub({
      selectReturn: { data: null, error: null },
    });

    const result = await gradeCard(supabase, "card-uuid", "user-uuid", Rating.Good);

    expect(result).toEqual({ data: null, error: "Flashcard not found" });
    expect(schedulerSpies.next).not.toHaveBeenCalled();
  });

  it("passes through upstream select errors without calling scheduler", async () => {
    const { supabase } = createSupabaseStub({
      selectReturn: { data: null, error: { message: "db down" } },
    });

    const result = await gradeCard(supabase, "card-uuid", "user-uuid", Rating.Good);

    expect(result).toEqual({ data: null, error: "db down" });
    expect(schedulerSpies.next).not.toHaveBeenCalled();
  });

  it("surfaces update errors from Supabase", async () => {
    // Select succeeds, scheduler runs, but the persisting `update()` fails.
    // The service must return the update error verbatim so the API layer can
    // convert it into an HTTP 5xx — silently swallowing it would leave the
    // caller thinking the grade was saved.
    const row = makeFlashcard();
    schedulerSpies.next.mockReturnValueOnce({ card: makeFsrsCard(), log: {} });

    const { supabase } = createSupabaseStub({
      selectReturn: { data: row, error: null },
      updateReturn: { data: null, error: { message: "constraint violation" } },
    });

    const result = await gradeCard(supabase, "card-uuid", "user-uuid", Rating.Good);

    expect(result).toEqual({ data: null, error: "constraint violation" });
  });

  it("returns Flashcard not found when the update returns no row", async () => {
    // A missing return row after update means RLS silently filtered it out
    // (row belongs to another user). The service must map that to a
    // "Flashcard not found" error rather than returning `data: null` with no
    // error, which would look like a successful no-op to the caller.
    const row = makeFlashcard();
    schedulerSpies.next.mockReturnValueOnce({ card: makeFsrsCard(), log: {} });

    const { supabase } = createSupabaseStub({
      selectReturn: { data: row, error: null },
      updateReturn: { data: null, error: null },
    });

    const result = await gradeCard(supabase, "card-uuid", "user-uuid", Rating.Good);

    expect(result).toEqual({ data: null, error: "Flashcard not found" });
  });
});

// ---------------------------------------------------------------------------
// fsrs scheduler configuration
// ---------------------------------------------------------------------------
// Pins the FSRS scheduler configuration the service must run with — PRD Risk #6
// requires request_retention=0.9, enable_fuzz=true, enable_short_term=true.
// Any change to these values silently alters spaced-repetition scheduling for
// every user, so they belong in an assertion rather than a comment.
describe("fsrs scheduler configuration", () => {
  it("is instantiated with the PRD-mandated retention, fuzz, and short-term flags", () => {
    expect(initialFsrsFactoryArgs).toEqual({
      request_retention: 0.9,
      enable_fuzz: true,
      enable_short_term: true,
    });
  });
});

// ---------------------------------------------------------------------------
// listDueCards / listPracticeCards — Supabase query shape + result mapping
// ---------------------------------------------------------------------------
// The oracle for these tests comes from the review-session PRD slice: cards
// are fetched from `flashcards`, filtered/ordered such that the ones most in
// need of review come first, and errors from Supabase are surfaced verbatim
// so upstream handlers can convert them to HTTP responses.

interface ListChain {
  select: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  then: (onFulfilled: (value: { data: Flashcard[] | null; error: { message: string } | null }) => unknown) => unknown;
}

function createListStub(response: { data: Flashcard[] | null; error: { message: string } | null }) {
  const chain: ListChain = {
    select: vi.fn(() => chain),
    lte: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    // Make the chain thenable so `await supabase.from(...).select(...).order(...)` resolves to `response`.
    then: (onFulfilled) => Promise.resolve(response).then(onFulfilled),
  };

  const fromFn = vi.fn(() => chain);

  return {
    supabase: { from: fromFn } as unknown as SupabaseClient,
    fromFn,
    chain,
  };
}

describe("listDueCards", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("queries flashcards for rows due now, ordered by due ascending, and returns them", async () => {
    const FIXED_NOW = new Date("2027-06-15T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    const earlier = makeFlashcard({ id: "earlier", due: "2027-06-14T00:00:00.000Z" });
    const later = makeFlashcard({ id: "later", due: "2027-06-15T00:00:00.000Z" });

    const { supabase, fromFn, chain } = createListStub({ data: [earlier, later], error: null });

    const result = await listDueCards(supabase);

    expect(fromFn).toHaveBeenCalledWith("flashcards");
    expect(chain.select).toHaveBeenCalledWith("*");
    expect(chain.lte).toHaveBeenCalledWith("due", FIXED_NOW.toISOString());
    expect(chain.order).toHaveBeenCalledWith("due", { ascending: true });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
    // Ordering: earlier `due` must precede later `due` — flip to `ascending: false` and this fails.
    expect(result.data?.[0]?.id).toBe("earlier");
    expect(result.data?.[1]?.id).toBe("later");
  });

  it("surfaces Supabase errors as { data: null, error: message }", async () => {
    const { supabase } = createListStub({ data: null, error: { message: "connection refused" } });

    const result = await listDueCards(supabase);

    expect(result).toEqual({ data: null, error: "connection refused" });
  });
});

describe("listPracticeCards", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("orders by last_review asc (nulls last) then due asc and applies the default limit of 20", async () => {
    const reviewed = makeFlashcard({ id: "reviewed", last_review: "2027-06-10T00:00:00.000Z" });
    const neverReviewed = makeFlashcard({ id: "never-reviewed", last_review: null });

    // Service must place already-reviewed cards before never-reviewed ones (nullsFirst: false).
    const { supabase, fromFn, chain } = createListStub({ data: [reviewed, neverReviewed], error: null });

    const result = await listPracticeCards(supabase);

    expect(fromFn).toHaveBeenCalledWith("flashcards");
    expect(chain.select).toHaveBeenCalledWith("*");
    expect(chain.order).toHaveBeenNthCalledWith(1, "last_review", { ascending: true, nullsFirst: false });
    expect(chain.order).toHaveBeenNthCalledWith(2, "due", { ascending: true });
    expect(chain.limit).toHaveBeenCalledWith(20);

    expect(result.error).toBeNull();
    expect(result.data?.[0]?.id).toBe("reviewed");
    expect(result.data?.[1]?.id).toBe("never-reviewed");
  });

  it("honours a caller-supplied limit", async () => {
    const { supabase, chain } = createListStub({ data: [], error: null });

    await listPracticeCards(supabase, 5);

    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  it("surfaces Supabase errors as { data: null, error: message }", async () => {
    const { supabase } = createListStub({ data: null, error: { message: "network down" } });

    const result = await listPracticeCards(supabase);

    expect(result).toEqual({ data: null, error: "network down" });
  });
});
