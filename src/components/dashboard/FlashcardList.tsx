import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import FlashcardForm from "@/components/dashboard/FlashcardForm";
import type { Flashcard } from "@/types";

interface ApiIssue {
  message: string;
  path?: (string | number)[];
}

interface ApiErrorResponse {
  error?: string;
  issues?: ApiIssue[];
}

function formatDate(isoDate: string) {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(parsed);
}

function sourceLabel(source: Flashcard["source"]) {
  if (source === "manual") return "Manual";
  if (source === "ai_full") return "AI full";
  return "AI edited";
}

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

export default function FlashcardList() {
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadFlashcards = async () => {
      try {
        const response = await fetch("/api/flashcards", {
          headers: {
            Accept: "application/json",
          },
        });

        if (!active) {
          return;
        }

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
          setError(body.error ?? "Failed to load flashcards");
          setFlashcards([]);
          setIsLoading(false);
          return;
        }

        const body = (await response.json()) as { data: Flashcard[] };
        setError(null);
        setFlashcards(body.data);
      } catch {
        if (!active) {
          return;
        }
        setError("Network error while loading flashcards");
        setFlashcards([]);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadFlashcards();

    return () => {
      active = false;
    };
  }, []);

  function handleCreateSuccess(card: Flashcard) {
    setFlashcards((prev) => [card, ...prev]);
    setIsCreating(false);
  }

  function handleEditSuccess(updatedCard: Flashcard) {
    setFlashcards((prev) => prev.map((card) => (card.id === updatedCard.id ? updatedCard : card)));
    setEditingId(null);
  }

  async function handleDelete(cardId: string) {
    setIsDeletingId(cardId);
    setError(null);

    try {
      const response = await fetch(`/api/flashcards/${cardId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
        setError(body.error ?? "Failed to delete flashcard");
        return;
      }

      setFlashcards((prev) => prev.filter((card) => card.id !== cardId));
      setPendingDeleteId(null);
      if (editingId === cardId) {
        setEditingId(null);
      }
    } catch {
      setError("Network error while deleting flashcard");
    } finally {
      setIsDeletingId(null);
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 text-white">
      <Card className="border-white/20 bg-white/10 shadow-xl backdrop-blur">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-2xl text-white">Your flashcards</CardTitle>
            <p className="mt-1 text-sm text-blue-100/80">Create, edit, and delete cards from your dashboard.</p>
          </div>
          {!isCreating ? (
            <Button
              type="button"
              onClick={() => {
                setIsCreating(true);
                setEditingId(null);
                setPendingDeleteId(null);
              }}
              className="bg-white text-slate-900 hover:bg-white/90"
            >
              New flashcard
            </Button>
          ) : null}
        </CardHeader>

        <CardContent className="space-y-4">
          {error ? (
            <p className="rounded-md border border-red-300/50 bg-red-500/20 p-3 text-sm text-red-100">{error}</p>
          ) : null}

          {isCreating ? (
            <FlashcardForm
              mode="create"
              onSuccess={handleCreateSuccess}
              onCancel={() => {
                setIsCreating(false);
              }}
            />
          ) : null}

          {isLoading ? <p className="text-sm text-blue-100/80">Loading flashcards...</p> : null}

          {!isLoading && flashcards.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/30 p-8 text-center text-blue-100/90">
              <p className="text-base font-medium">No flashcards yet</p>
              <p className="mt-1 text-sm text-blue-100/70">Create your first card to start building your deck.</p>
            </div>
          ) : null}

          {!isLoading && flashcards.length > 0 ? (
            <ul className="space-y-3">
              {flashcards.map((card) => (
                <li key={card.id} className="rounded-lg border border-white/20 bg-black/20 p-4">
                  {editingId === card.id ? (
                    <FlashcardForm
                      mode="edit"
                      flashcard={card}
                      onSuccess={handleEditSuccess}
                      onCancel={() => {
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold text-white">{truncate(card.front, 120)}</h3>
                          <span className="rounded-full border border-blue-200/30 bg-blue-300/20 px-2 py-0.5 text-xs text-blue-100">
                            {sourceLabel(card.source)}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-blue-100/80">{truncate(card.back, 200)}</p>
                        <p className="mt-2 text-xs text-blue-100/60">Created {formatDate(card.created_at)}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="border-white/30 bg-transparent text-blue-100 hover:bg-white/15 hover:text-white"
                          onClick={() => {
                            setEditingId(card.id);
                            setPendingDeleteId(null);
                          }}
                        >
                          Edit
                        </Button>

                        {pendingDeleteId === card.id ? (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-red-100">Are you sure?</span>
                            <Button
                              type="button"
                              variant="destructive"
                              className="h-8 px-3"
                              disabled={isDeletingId === card.id}
                              onClick={() => {
                                void handleDelete(card.id);
                              }}
                            >
                              {isDeletingId === card.id ? "Deleting..." : "Yes"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 border-white/30 bg-transparent text-blue-100 hover:bg-white/15 hover:text-white"
                              disabled={isDeletingId === card.id}
                              onClick={() => {
                                setPendingDeleteId(null);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => {
                              setPendingDeleteId(card.id);
                              setEditingId(null);
                            }}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
