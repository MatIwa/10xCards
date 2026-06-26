import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Flashcard } from "@/types";

type QueueMode = "due" | "practice";
type ReviewState = "loading" | "reviewing" | "revealed" | "submitting" | "empty" | "practiceEmpty" | "error";
type RatingValue = 1 | 2 | 3 | 4;

interface ApiErrorResponse {
  error?: string;
}

interface ReviewPreview {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

interface ReviewFlashcard extends Flashcard {
  preview: ReviewPreview;
}

interface QueueResponse {
  data: ReviewFlashcard[];
  mode: QueueMode;
}

const ratingOptions: { rating: RatingValue; key: keyof ReviewPreview; label: string; tone: string }[] = [
  { rating: 1, key: "again", label: "Again", tone: "border-red-300/50 bg-red-500/20 hover:bg-red-500/30" },
  { rating: 2, key: "hard", label: "Hard", tone: "border-amber-300/50 bg-amber-500/20 hover:bg-amber-500/30" },
  { rating: 3, key: "good", label: "Good", tone: "border-emerald-300/50 bg-emerald-500/20 hover:bg-emerald-500/30" },
  { rating: 4, key: "easy", label: "Easy", tone: "border-sky-300/50 bg-sky-500/20 hover:bg-sky-500/30" },
];

function formatRelativeTime(isoDate: string) {
  const due = new Date(isoDate);
  const now = new Date();
  const differenceMs = due.getTime() - now.getTime();

  if (Number.isNaN(due.getTime())) {
    return "later";
  }

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 1000 * 60 * 60 * 24],
    ["hour", 1000 * 60 * 60],
    ["minute", 1000 * 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const [unit, unitMs] of units) {
    const value = Math.round(differenceMs / unitMs);
    if (Math.abs(value) >= 1) {
      return formatter.format(value, unit);
    }
  }

  return "in less than 1 minute";
}

export default function ReviewSession() {
  const [cards, setCards] = useState<ReviewFlashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [state, setState] = useState<ReviewState>("loading");
  const [practiceMode, setPracticeMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const currentCard = cards[currentIndex];
  const progressLabel = useMemo(() => {
    if (cards.length === 0) {
      return "0 / 0";
    }
    return `${currentIndex + 1} / ${cards.length}`;
  }, [cards.length, currentIndex]);

  const loadQueue = useCallback(async (mode: QueueMode) => {
    setState("loading");
    setError(null);

    try {
      const response = await fetch(`/api/flashcards/review/queue?mode=${mode}`, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
        setError(body.error ?? "Failed to load review queue");
        setState("error");
        return;
      }

      const body = (await response.json()) as QueueResponse;
      setCards(body.data);
      setCurrentIndex(0);
      setPracticeMode(body.mode === "practice");
      setState(body.data.length > 0 ? "reviewing" : body.mode === "practice" ? "practiceEmpty" : "empty");
    } catch {
      setError("Network error while loading review queue");
      setState("error");
    }
  }, []);

  useEffect(() => {
    window.setTimeout(() => {
      void loadQueue("due");
    }, 0);
  }, [loadQueue]);

  const revealAnswer = useCallback(() => {
    setState((prev) => (prev === "reviewing" ? "revealed" : prev));
  }, []);

  const gradeCurrentCard = useCallback(
    async (rating: RatingValue) => {
      if (state !== "revealed") {
        return;
      }

      setState("submitting");
      setError(null);

      try {
        const response = await fetch(`/api/flashcards/${currentCard.id}/review`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rating, practice: practiceMode }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
          setError(body.error ?? "Failed to submit rating");
          setState("error");
          return;
        }

        const nextIndex = currentIndex + 1;
        if (nextIndex >= cards.length) {
          setState(practiceMode ? "practiceEmpty" : "empty");
          return;
        }

        setCurrentIndex(nextIndex);
        setState("reviewing");
      } catch {
        setError("Network error while submitting rating");
        setState("error");
      }
    },
    [cards.length, currentCard, currentIndex, practiceMode, state],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (resetDialogOpen) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isTyping) {
        return;
      }

      if (event.code === "Space" && state === "reviewing") {
        event.preventDefault();
        revealAnswer();
        return;
      }

      if (state === "revealed" && ["1", "2", "3", "4"].includes(event.key)) {
        event.preventDefault();
        void gradeCurrentCard(Number(event.key) as RatingValue);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [gradeCurrentCard, resetDialogOpen, revealAnswer, state]);

  function renderShell(content: React.ReactNode) {
    const canResetSession = state === "reviewing" || state === "revealed";

    return (
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <section className="mx-auto w-full max-w-5xl px-4 py-8 text-white">
          <Card className="border-white/20 bg-white/10 shadow-xl backdrop-blur">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-2xl text-white">Review session</CardTitle>
                <p className="mt-1 text-sm text-blue-100/80">{practiceMode ? "Practice mode" : "Due cards"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-white/20 bg-black/20 px-3 py-1 text-sm text-blue-100">
                  {progressLabel}
                </span>
                {canResetSession ? (
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-white/30 bg-transparent text-blue-100 hover:bg-white/15 hover:text-white"
                    >
                      Reset
                    </Button>
                  </AlertDialogTrigger>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>{content}</CardContent>
          </Card>
        </section>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset review session?</AlertDialogTitle>
            <AlertDialogDescription>
              Reload the queue from scratch. Ratings already submitted will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              onClick={() => {
                void loadQueue(practiceMode ? "practice" : "due");
              }}
            >
              Reload queue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  if (state === "loading") {
    return renderShell(
      <div className="space-y-5" aria-label="Loading review queue">
        <div className="space-y-4">
          <Skeleton className="h-44 w-full rounded-lg bg-white/15" />
          <Skeleton className="h-44 w-full rounded-lg bg-white/15" />
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-md bg-white/15" />
          ))}
        </div>
      </div>,
    );
  }

  if (state === "error") {
    return renderShell(
      <div className="space-y-4">
        <p className="rounded-md border border-red-300/50 bg-red-500/20 p-3 text-sm text-red-100">
          {error ?? "Something went wrong"}
        </p>
        <Button
          type="button"
          onClick={() => {
            void loadQueue(practiceMode ? "practice" : "due");
          }}
          className="bg-white text-slate-900 hover:bg-white/90"
        >
          <RotateCcw aria-hidden="true" />
          Retry
        </Button>
      </div>,
    );
  }

  if (state === "empty") {
    return renderShell(
      <div className="rounded-lg border border-dashed border-white/30 p-8 text-center text-blue-100/90">
        <p className="text-base font-medium text-white">All caught up!</p>
        <div className="mt-4 flex justify-center">
          <Button
            type="button"
            onClick={() => {
              void loadQueue("practice");
            }}
            className="bg-white text-slate-900 hover:bg-white/90"
          >
            <RotateCcw aria-hidden="true" />
            Practice anyway
          </Button>
        </div>
      </div>,
    );
  }

  if (state === "practiceEmpty") {
    return renderShell(
      <div className="rounded-lg border border-dashed border-white/30 p-8 text-center text-blue-100/90">
        <p className="text-base font-medium text-white">Done</p>
        <a
          className="mt-4 inline-flex text-sm font-medium text-blue-100 underline-offset-4 hover:underline"
          href="/dashboard"
        >
          Back to dashboard
        </a>
      </div>,
    );
  }

  const answerVisible = state === "revealed" || state === "submitting";

  return renderShell(
    <div className="space-y-5">
      <div className="min-h-44 rounded-lg border border-white/20 bg-black/20 p-5">
        <p className="text-xs font-medium tracking-wide text-blue-100/60 uppercase">Front</p>
        <p className="mt-3 text-lg leading-7 whitespace-pre-wrap text-white">{currentCard.front}</p>
      </div>

      {answerVisible ? (
        <div className="min-h-44 rounded-lg border border-white/20 bg-black/20 p-5">
          <p className="text-xs font-medium tracking-wide text-blue-100/60 uppercase">Back</p>
          <p className="mt-3 text-base leading-7 whitespace-pre-wrap text-blue-50">{currentCard.back}</p>
        </div>
      ) : null}

      {!answerVisible ? (
        <Button type="button" onClick={revealAnswer} className="bg-white text-slate-900 hover:bg-white/90">
          Show answer
          <ArrowRight aria-hidden="true" />
        </Button>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          {ratingOptions.map((option) => (
            <Button
              key={option.rating}
              type="button"
              variant="outline"
              disabled={state === "submitting"}
              onClick={() => {
                void gradeCurrentCard(option.rating);
              }}
              className={cn("h-auto flex-col border py-3 text-white hover:text-white", option.tone)}
            >
              <span>{option.label}</span>
              <span className="text-xs font-normal text-blue-50/80">
                {formatRelativeTime(currentCard.preview[option.key])}
              </span>
            </Button>
          ))}
        </div>
      )}
    </div>,
  );
}
