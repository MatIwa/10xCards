import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Flashcard } from "@/types";

type FormMode = "create" | "edit";

interface ApiIssue {
  message: string;
  path?: (string | number)[];
}

interface ApiErrorResponse {
  error?: string;
  issues?: ApiIssue[];
}

interface FlashcardFormProps {
  mode: FormMode;
  flashcard?: Flashcard;
  onSuccess: (card: Flashcard) => void;
  onCancel: () => void;
}

interface FormErrors {
  front?: string;
  back?: string;
  form?: string;
}

const LIMITS = {
  frontMax: 1000,
  backMax: 5000,
};

function normalizeInput(value: string) {
  return value.trim();
}

function mapApiIssuesToFieldErrors(issues: ApiIssue[] | undefined): Pick<FormErrors, "front" | "back"> {
  const fieldErrors: Pick<FormErrors, "front" | "back"> = {};

  for (const issue of issues ?? []) {
    const field = issue.path?.[0];
    if (field === "front" && !fieldErrors.front) {
      fieldErrors.front = issue.message;
    }
    if (field === "back" && !fieldErrors.back) {
      fieldErrors.back = issue.message;
    }
  }

  return fieldErrors;
}

export default function FlashcardForm({ mode, flashcard, onSuccess, onCancel }: FlashcardFormProps) {
  const [front, setFront] = useState(flashcard?.front ?? "");
  const [back, setBack] = useState(flashcard?.back ?? "");
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const title = useMemo(() => (mode === "create" ? "Create flashcard" : "Edit flashcard"), [mode]);

  function validate(): boolean {
    const nextErrors: FormErrors = {};
    const normalizedFront = normalizeInput(front);
    const normalizedBack = normalizeInput(back);

    if (!normalizedFront) {
      nextErrors.front = "Front is required";
    } else if (normalizedFront.length > LIMITS.frontMax) {
      nextErrors.front = `Front must be ${LIMITS.frontMax} characters or fewer`;
    }

    if (!normalizedBack) {
      nextErrors.back = "Back is required";
    } else if (normalizedBack.length > LIMITS.backMax) {
      nextErrors.back = `Back must be ${LIMITS.backMax} characters or fewer`;
    }

    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function clearFieldError(field: "front" | "back") {
    setErrors((prev) => ({ ...prev, [field]: undefined, form: undefined }));
  }

  async function handleSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    const payload = {
      front: normalizeInput(front),
      back: normalizeInput(back),
    };

    const requestPath = mode === "create" ? "/api/flashcards" : `/api/flashcards/${flashcard?.id}`;
    const method = mode === "create" ? "POST" : "PUT";

    setIsSubmitting(true);
    setErrors({});

    try {
      const response = await fetch(requestPath, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as ApiErrorResponse;
        const fieldErrors = mapApiIssuesToFieldErrors(errorBody.issues);

        setErrors({
          ...fieldErrors,
          form: errorBody.error ?? "Request failed",
        });
        return;
      }

      const body = (await response.json()) as { data: Flashcard };
      onSuccess(body.data);
    } catch {
      setErrors({ form: "Network error. Please try again." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-white/20 bg-white/10 p-4 backdrop-blur">
      <div>
        <h3 className="text-base font-semibold text-white">{title}</h3>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`front-${mode}-${flashcard?.id ?? "new"}`} className="text-blue-100">
          Front
        </Label>
        <Input
          id={`front-${mode}-${flashcard?.id ?? "new"}`}
          value={front}
          onChange={(event) => {
            setFront(event.target.value);
            clearFieldError("front");
          }}
          placeholder="Enter question or prompt"
          maxLength={LIMITS.frontMax}
          aria-invalid={Boolean(errors.front)}
          className="border-white/25 text-white placeholder:text-blue-100/60"
        />
        <p className="text-xs text-blue-100/70">
          {front.length}/{LIMITS.frontMax}
        </p>
        {errors.front ? <p className="text-sm text-red-300">{errors.front}</p> : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`back-${mode}-${flashcard?.id ?? "new"}`} className="text-blue-100">
          Back
        </Label>
        <Textarea
          id={`back-${mode}-${flashcard?.id ?? "new"}`}
          value={back}
          onChange={(event) => {
            setBack(event.target.value);
            clearFieldError("back");
          }}
          placeholder="Enter answer or explanation"
          maxLength={LIMITS.backMax}
          rows={5}
          aria-invalid={Boolean(errors.back)}
          className="border-white/25 text-white placeholder:text-blue-100/60"
        />
        <p className="text-xs text-blue-100/70">
          {back.length}/{LIMITS.backMax}
        </p>
        {errors.back ? <p className="text-sm text-red-300">{errors.back}</p> : null}
      </div>

      {errors.form ? <p className="text-sm text-red-300">{errors.form}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting} className="bg-white text-slate-900 hover:bg-white/90">
          {isSubmitting ? "Saving..." : mode === "create" ? "Create" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isSubmitting}
          onClick={onCancel}
          className="border-white/25 bg-transparent text-blue-100 hover:bg-white/15 hover:text-white"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
