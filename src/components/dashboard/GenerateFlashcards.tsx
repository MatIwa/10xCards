import { Check, LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { FlashcardSource } from "@/types";

type GenerateState = "idle" | "generating" | "reviewing" | "error";

interface ApiErrorResponse {
  error?: string;
  code?: string;
}

interface ProposalResponse {
  id: string;
  front: string;
  back: string;
}

interface GenerateResponse {
  proposals?: ProposalResponse[];
}

interface ProposalState {
  id: string;
  originalFront: string;
  originalBack: string;
  front: string;
  back: string;
  isSaving: boolean;
  saveError?: string;
}

interface FieldErrors {
  front?: string;
  back?: string;
}

type BulkAction = { kind: "idle" } | { kind: "accepting" | "rejecting"; total: number; done: number };
type AcceptOutcome = { status: "accepted" } | { status: "failed"; error: string };

const MIN_CHARS = 200;
const MAX_CHARS = 25000;
const FRONT_MAX = 1000;
const BACK_MAX = 5000;
const GENERATE_TIMEOUT_MS = 35000;

function normalizeInput(value: string) {
  return value.trim();
}

function mapGenerateError(code: string | undefined, fallback: string | undefined) {
  if (code === "missing_api_key") {
    return "AI generation is not configured yet. Please try again later.";
  }

  if (code === "provider_unavailable") {
    if (fallback?.toLowerCase().includes("timed out")) {
      return "Generation took too long. Try a shorter passage or retry in a moment.";
    }

    return "The AI service is temporarily unavailable. Please retry.";
  }

  if (code === "invalid_model_output") {
    return "The AI service returned an unexpected response. Please retry.";
  }

  if (code === "empty_result") {
    return "No usable flashcards were found in that text. Try a more detailed passage.";
  }

  return fallback ?? "Generation failed. Please try again.";
}

function getSourceForProposal(proposal: ProposalState): FlashcardSource {
  const frontUnchanged = normalizeInput(proposal.front) === normalizeInput(proposal.originalFront);
  const backUnchanged = normalizeInput(proposal.back) === normalizeInput(proposal.originalBack);

  return frontUnchanged && backUnchanged ? "ai_full" : "ai_edited";
}

function validateProposal(proposal: ProposalState): FieldErrors {
  const errors: FieldErrors = {};
  const front = normalizeInput(proposal.front);
  const back = normalizeInput(proposal.back);

  if (!front) {
    errors.front = "Front is required";
  } else if (front.length > FRONT_MAX) {
    errors.front = `Front must be ${FRONT_MAX} characters or fewer`;
  }

  if (!back) {
    errors.back = "Back is required";
  } else if (back.length > BACK_MAX) {
    errors.back = `Back must be ${BACK_MAX} characters or fewer`;
  }

  return errors;
}

function pluralizeCards(count: number) {
  return count === 1 ? "1 card" : `${count} cards`;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export default function GenerateFlashcards() {
  const checkboxIdPrefix = useId();
  const [sourceText, setSourceText] = useState("");
  const [state, setState] = useState<GenerateState>("idle");
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>({ kind: "idle" });

  const normalizedSourceText = sourceText.trim();
  const charCount = sourceText.length;
  const isTooShort = normalizedSourceText.length > 0 && normalizedSourceText.length < MIN_CHARS;
  const isTooLong = sourceText.length > MAX_CHARS;
  const canGenerate = normalizedSourceText.length >= MIN_CHARS && sourceText.length <= MAX_CHARS;
  const remainingCount = proposals.length;
  const selectedCount = selectedIds.size;
  const isBulkRunning = bulkAction.kind !== "idle";
  const allSelected = proposals.length > 0 && selectedCount === proposals.length;
  const counterTone = useMemo(() => {
    if (isTooLong) {
      return "text-red-200";
    }

    if (isTooShort || normalizedSourceText.length === 0) {
      return "text-amber-200";
    }

    return "text-blue-100/70";
  }, [isTooLong, isTooShort, normalizedSourceText.length]);

  async function generateCards() {
    if (!canGenerate || state === "generating") {
      return;
    }

    setState("generating");
    setError(null);
    setStatusMessage(null);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, GENERATE_TIMEOUT_MS);

    try {
      const response = await fetch("/api/flashcards/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ source_text: normalizedSourceText }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
        setError(mapGenerateError(body.code, body.error));
        setState("error");
        return;
      }

      const body = (await response.json()) as GenerateResponse;
      const nextProposals = (body.proposals ?? []).map((proposal) => ({
        id: proposal.id,
        originalFront: proposal.front,
        originalBack: proposal.back,
        front: proposal.front,
        back: proposal.back,
        isSaving: false,
      }));

      if (nextProposals.length === 0) {
        setError("No usable flashcards were found in that text. Try a more detailed passage.");
        setState("error");
        return;
      }

      setSavedCount(0);
      setProposals(nextProposals);
      setSelectedIds(new Set(nextProposals.map((proposal) => proposal.id)));
      setState("reviewing");
    } catch (requestError) {
      setError(
        isAbortError(requestError)
          ? "Generation took too long. Try a shorter passage or retry in a moment."
          : "Network error while generating flashcards. Please try again.",
      );
      setState("error");
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function finishIfLastProposal(nextProposals: ProposalState[], nextSavedCount: number) {
    if (nextProposals.length > 0) {
      return;
    }

    setSourceText("");
    setState("idle");
    setStatusMessage(`${pluralizeCards(nextSavedCount)} saved. Paste more text to generate again.`);
  }

  function updateProposal(proposalId: string, patch: Partial<Pick<ProposalState, "front" | "back" | "saveError">>) {
    setProposals((currentProposals) =>
      currentProposals.map((proposal) => (proposal.id === proposalId ? { ...proposal, ...patch } : proposal)),
    );
  }

  function updateSourceText(value: string) {
    setSourceText(value);
    setError(null);
    setStatusMessage(null);
    if (state === "error") {
      setState("idle");
    }
  }

  function removeSelectedId(proposalId: string) {
    setSelectedIds((currentSelectedIds) => {
      const nextSelectedIds = new Set(currentSelectedIds);
      nextSelectedIds.delete(proposalId);
      return nextSelectedIds;
    });
  }

  function toggleSelectedId(proposalId: string, checked: boolean) {
    setSelectedIds((currentSelectedIds) => {
      const nextSelectedIds = new Set(currentSelectedIds);
      if (checked) {
        nextSelectedIds.add(proposalId);
      } else {
        nextSelectedIds.delete(proposalId);
      }
      return nextSelectedIds;
    });
  }

  function toggleAllSelected() {
    setSelectedIds(allSelected ? new Set() : new Set(proposals.map((proposal) => proposal.id)));
  }

  function renderStatusMessage() {
    if (!statusMessage) {
      return null;
    }

    return (
      <div className="flex flex-col gap-3 rounded-md border border-emerald-300/50 bg-emerald-500/20 p-3 text-sm text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
        <p>{statusMessage}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setStatusMessage(null);
          }}
          className="border-emerald-100/50 text-emerald-50 hover:bg-emerald-100/10 hover:text-white"
        >
          Dismiss
        </Button>
      </div>
    );
  }

  function rejectProposal(proposalId: string) {
    let nextProposals: ProposalState[] = [];
    flushSync(() => {
      setProposals((prev) => {
        nextProposals = prev.filter((proposal) => proposal.id !== proposalId);
        return nextProposals;
      });
      removeSelectedId(proposalId);
    });
    finishIfLastProposal(nextProposals, savedCount);
  }

  async function acceptProposal(proposalId: string): Promise<AcceptOutcome> {
    const proposal = proposals.find((item) => item.id === proposalId);
    if (!proposal || proposal.isSaving) {
      return { status: "failed", error: "Proposal is no longer available" };
    }

    const validationErrors = validateProposal(proposal);
    if (validationErrors.front ?? validationErrors.back) {
      const message = validationErrors.front ?? validationErrors.back ?? "Validation error";
      updateProposal(proposalId, { saveError: message });
      return { status: "failed", error: message };
    }

    setProposals((currentProposals) =>
      currentProposals.map((item) =>
        item.id === proposalId ? { ...item, isSaving: true, saveError: undefined } : item,
      ),
    );

    try {
      const response = await fetch("/api/flashcards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          front: normalizeInput(proposal.front),
          back: normalizeInput(proposal.back),
          source: getSourceForProposal(proposal),
        }),
      });

      if (!response.ok) {
        const message = "Couldn't save - try again";
        setProposals((currentProposals) =>
          currentProposals.map((item) =>
            item.id === proposalId ? { ...item, isSaving: false, saveError: message } : item,
          ),
        );
        return { status: "failed", error: message };
      }

      // Use flushSync + functional setState so concurrent Accept resolutions read the latest
      // proposals/savedCount (not a stale closure snapshot). See impl-review F3.
      let nextSavedCount = 0;
      let nextProposals: ProposalState[] = [];
      flushSync(() => {
        setSavedCount((prev) => {
          nextSavedCount = prev + 1;
          return nextSavedCount;
        });
        setProposals((prev) => {
          nextProposals = prev.filter((item) => item.id !== proposalId);
          return nextProposals;
        });
        removeSelectedId(proposalId);
      });
      finishIfLastProposal(nextProposals, nextSavedCount);
      return { status: "accepted" };
    } catch {
      const message = "Network error while saving";
      setProposals((currentProposals) =>
        currentProposals.map((item) =>
          item.id === proposalId ? { ...item, isSaving: false, saveError: message } : item,
        ),
      );
      return { status: "failed", error: message };
    }
  }

  async function acceptSelected() {
    if (isBulkRunning || selectedCount === 0) {
      return;
    }

    const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
    const selectedProposals = Array.from(selectedIds)
      .map((proposalId) => proposalById.get(proposalId))
      .filter((proposal): proposal is ProposalState => Boolean(proposal));
    const validProposalIds: string[] = [];
    let skipped = 0;

    for (const proposal of selectedProposals) {
      const validationErrors = validateProposal(proposal);
      const message = validationErrors.front ?? validationErrors.back;
      if (message) {
        skipped += 1;
        updateProposal(proposal.id, { saveError: message });
      } else {
        validProposalIds.push(proposal.id);
      }
    }

    let accepted = 0;
    let failed = 0;

    if (validProposalIds.length > 0) {
      setBulkAction({ kind: "accepting", total: validProposalIds.length, done: 0 });

      for (const proposalId of validProposalIds) {
        const outcome = await acceptProposal(proposalId);
        if (outcome.status === "accepted") {
          accepted += 1;
        } else {
          failed += 1;
        }
        setBulkAction((currentBulkAction) =>
          currentBulkAction.kind === "accepting"
            ? { ...currentBulkAction, done: currentBulkAction.done + 1 }
            : currentBulkAction,
        );
      }
    }

    const summaryParts = [`Accepted ${accepted}`];
    if (skipped > 0) {
      summaryParts.push(`skipped ${skipped} (validation errors)`);
    }
    if (failed > 0) {
      summaryParts.push(`failed ${failed} (network - retry available)`);
    }

    setStatusMessage(summaryParts.join(", "));
    setBulkAction({ kind: "idle" });
  }

  function rejectSelected() {
    if (isBulkRunning || selectedCount === 0) {
      return;
    }

    const proposalIds = new Set(proposals.map((proposal) => proposal.id));
    const selectedProposalIds = Array.from(selectedIds).filter((proposalId) => proposalIds.has(proposalId));

    setBulkAction({ kind: "rejecting", total: selectedProposalIds.length, done: 0 });
    for (const proposalId of selectedProposalIds) {
      rejectProposal(proposalId);
      setBulkAction((currentBulkAction) =>
        currentBulkAction.kind === "rejecting"
          ? { ...currentBulkAction, done: currentBulkAction.done + 1 }
          : currentBulkAction,
      );
    }

    setStatusMessage(`Rejected ${selectedProposalIds.length}`);
    setBulkAction({ kind: "idle" });
  }

  function renderPasteView() {
    return (
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void generateCards();
        }}
      >
        {renderStatusMessage()}

        {state === "error" ? (
          <div className="space-y-3 rounded-md border border-red-300/50 bg-red-500/20 p-3 text-sm text-red-100">
            <p>{error ?? "Something went wrong"}</p>
            <Button
              type="button"
              onClick={() => {
                void generateCards();
              }}
              disabled={!canGenerate}
              className="bg-white text-slate-900 hover:bg-white/90"
            >
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="source-text" className="text-blue-100">
            Source text
          </Label>
          <Textarea
            id="source-text"
            value={sourceText}
            onChange={(event) => {
              updateSourceText(event.currentTarget.value);
            }}
            onInput={(event) => {
              updateSourceText(event.currentTarget.value);
            }}
            onPaste={(event) => {
              const textarea = event.currentTarget;
              window.requestAnimationFrame(() => {
                updateSourceText(textarea.value);
              });
            }}
            rows={14}
            disabled={state === "generating"}
            placeholder="Paste study notes, article excerpts, or lecture material"
            aria-invalid={isTooLong || isTooShort}
            className="min-h-72 border-white/25 text-white placeholder:text-blue-100/60"
          />
          <div className="flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
            <p className={cn("font-medium", counterTone)}>
              {charCount}/{MAX_CHARS}
            </p>
            {isTooShort ? <p className="text-amber-200">Use at least {MIN_CHARS} characters.</p> : null}
            {isTooLong ? <p className="text-red-200">Use {MAX_CHARS} characters or fewer.</p> : null}
          </div>
        </div>

        {state === "generating" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-md border border-white/20 bg-black/20 p-3 text-sm text-blue-100">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              <span>Generating cards from your text...</span>
            </div>
            <ul className="space-y-3" aria-label="Loading generated proposals">
              {Array.from({ length: 3 }).map((_, index) => (
                <li key={index}>
                  <Skeleton className="h-32 w-full rounded-lg bg-white/15" />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Button
          type="submit"
          disabled={!canGenerate || state === "generating"}
          className="bg-white text-slate-900 hover:bg-white/90"
        >
          {state === "generating" ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles aria-hidden="true" />
          )}
          {state === "generating" ? "Generating..." : "Generate"}
        </Button>
      </form>
    );
  }

  function renderReviewView() {
    return (
      <div className="space-y-5">
        {renderStatusMessage()}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-white">Review proposals</h3>
            <p className="mt-1 text-sm text-blue-100/80">{pluralizeCards(remainingCount)} remaining</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBulkRunning || proposals.length === 0}
              onClick={toggleAllSelected}
              className="border-white/25 text-white hover:bg-white/10 hover:text-white"
            >
              {allSelected ? "Select none" : "Select all"}
            </Button>
            <span className="text-sm text-blue-100/80">
              {selectedCount} of {proposals.length} selected
            </span>
            <Button
              type="button"
              size="sm"
              disabled={isBulkRunning || selectedCount === 0}
              onClick={() => {
                void acceptSelected();
              }}
              className="bg-white text-slate-900 hover:bg-white/90"
            >
              Accept selected
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isBulkRunning || selectedCount === 0}
              onClick={rejectSelected}
            >
              Reject selected
            </Button>
          </div>
        </div>

        {bulkAction.kind !== "idle" ? (
          <div className="flex items-center gap-3 rounded-md border border-white/20 bg-black/20 p-3 text-sm text-blue-100">
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            <span>
              {bulkAction.kind === "accepting" ? "Accepting" : "Rejecting"}{" "}
              {Math.min(bulkAction.done + 1, bulkAction.total)}/{bulkAction.total}...
            </span>
          </div>
        ) : null}

        <ul className="space-y-4">
          {proposals.map((proposal, index) => {
            const fieldErrors = validateProposal(proposal);
            const acceptDisabled = isBulkRunning || proposal.isSaving || Boolean(fieldErrors.front ?? fieldErrors.back);
            const checkboxId = `${checkboxIdPrefix}-proposal-${proposal.id}`;

            return (
              <li key={proposal.id} className="rounded-lg border border-white/20 bg-black/20 p-4">
                <div className="flex gap-3">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={selectedIds.has(proposal.id)}
                    disabled={isBulkRunning}
                    aria-label={`Select proposal ${index + 1}`}
                    onChange={(event) => {
                      toggleSelectedId(proposal.id, event.target.checked);
                    }}
                    className="mt-1 h-4 w-4 rounded border-white/30 bg-black/30 text-blue-500 accent-blue-400"
                  />
                  <div className="min-w-0 flex-1 space-y-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <Label htmlFor={checkboxId} className="text-sm font-medium text-white">
                        Proposal {index + 1}
                      </Label>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`proposal-front-${proposal.id}`} className="text-blue-100">
                        Front
                      </Label>
                      <Input
                        id={`proposal-front-${proposal.id}`}
                        value={proposal.front}
                        onChange={(event) => {
                          updateProposal(proposal.id, { front: event.target.value, saveError: undefined });
                        }}
                        maxLength={FRONT_MAX}
                        disabled={isBulkRunning}
                        aria-label="Editable proposal front"
                        aria-invalid={Boolean(fieldErrors.front)}
                        className="border-white/25 text-white placeholder:text-blue-100/60"
                      />
                      <p className="text-xs text-blue-100/70">
                        {proposal.front.length}/{FRONT_MAX}
                      </p>
                      {fieldErrors.front ? <p className="text-sm text-red-300">{fieldErrors.front}</p> : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`proposal-back-${proposal.id}`} className="text-blue-100">
                        Back
                      </Label>
                      <Textarea
                        id={`proposal-back-${proposal.id}`}
                        value={proposal.back}
                        onChange={(event) => {
                          updateProposal(proposal.id, { back: event.target.value, saveError: undefined });
                        }}
                        maxLength={BACK_MAX}
                        rows={5}
                        disabled={isBulkRunning}
                        aria-label="Editable proposal back"
                        aria-invalid={Boolean(fieldErrors.back)}
                        className="border-white/25 text-white placeholder:text-blue-100/60"
                      />
                      <p className="text-xs text-blue-100/70">
                        {proposal.back.length}/{BACK_MAX}
                      </p>
                      {fieldErrors.back ? <p className="text-sm text-red-300">{fieldErrors.back}</p> : null}
                    </div>

                    {proposal.saveError ? <p className="text-sm text-red-300">{proposal.saveError}</p> : null}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={acceptDisabled}
                        onClick={() => {
                          void acceptProposal(proposal.id);
                        }}
                        className="bg-white text-slate-900 hover:bg-white/90"
                      >
                        {proposal.isSaving ? (
                          <LoaderCircle className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Check aria-hidden="true" />
                        )}
                        {proposal.isSaving ? "Saving..." : "Accept"}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={isBulkRunning || proposal.isSaving}
                        onClick={() => {
                          rejectProposal(proposal.id);
                        }}
                      >
                        <X aria-hidden="true" />
                        Reject
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 text-white">
      <Card className="border-white/20 bg-white/10 shadow-xl backdrop-blur">
        <CardHeader>
          <CardTitle className="text-2xl text-white">AI generation</CardTitle>
          <p className="mt-1 text-sm text-blue-100/80">Generate, edit, and save one proposal at a time.</p>
        </CardHeader>
        <CardContent>{state === "reviewing" ? renderReviewView() : renderPasteView()}</CardContent>
      </Card>
    </section>
  );
}
