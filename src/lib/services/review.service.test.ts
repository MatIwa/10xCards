import type { SupabaseClient } from "@supabase/supabase-js";
import type { Card, RecordLogItem } from "ts-fsrs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flashcard } from "@/types";

// ---------------------------------------------------------------------------
// Mock ts-fsrs: replace the `fsrs()` factory with a spy-able version while
// keeping `Rating` real so tests can pass Rating.Again etc. as inputs.
// ---------------------------------------------------------------------------
const schedulerSpies = vi.hoisted(() => ({
  next: vi.fn(),
  repeat: vi.fn(),
}));

vi.mock("ts-fsrs", async () => {
  const actual = await vi.importActual<typeof import("ts-fsrs")>("ts-fsrs");
  return {
    ...actual,
    fsrs: () => schedulerSpies,
  };
});

// Import service AFTER mock is set up (module is resolved fresh due to vi.mock hoisting)
import { gradeCard, previewRatings, rehydrate, serialize } from "./review.service";
import { Rating } from "ts-fsrs";

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

  it.each([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy])(
    "calls scheduler.repeat and returns the due date for rating %s",
    (_rating) => {
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
    },
  );
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
      const updatePayload = updateFn.mock.calls[0]?.[0] as Partial<Flashcard>;
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
});
