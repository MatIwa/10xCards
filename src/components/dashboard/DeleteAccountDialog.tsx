import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface DeleteAccountDialogProps {
  flashcardCount: number;
  userEmail: string;
}

interface ApiErrorResponse {
  error?: string;
}

export default function DeleteAccountDialog({ flashcardCount, userEmail }: DeleteAccountDialogProps) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canDelete = confirmation === "DELETE" && !isSubmitting;

  async function handleSubmit(event: { preventDefault: () => void }) {
    event.preventDefault();

    if (!canDelete) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE" }),
        redirect: "follow",
      });

      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }

      const body = (await response.json().catch(() => ({}))) as ApiErrorResponse;
      setError(body.error ?? "Deletion failed — please try again later.");
    } catch {
      setError("Deletion failed — please try again later.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setConfirmation("");
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" className="bg-red-600 text-white hover:bg-red-700">
          Delete account
        </Button>
      </DialogTrigger>
      <DialogContent className="border-red-200 bg-white text-slate-950 sm:max-w-xl">
        <form className="space-y-5" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Delete account permanently</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The account for {userEmail} and all data owned by it will be erased.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-950">
            <p className="font-medium">All your flashcards ({flashcardCount}) will be permanently deleted.</p>
            <p className="mt-2 text-red-900/80">Type DELETE to confirm you understand this is irreversible.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-account-confirmation">Confirmation</Label>
            <Input
              id="delete-account-confirmation"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
              autoComplete="off"
              spellCheck={false}
              placeholder="DELETE"
              aria-invalid={Boolean(error)}
            />
          </div>

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
          ) : null}

          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={!canDelete} className="bg-red-600 hover:bg-red-700">
              {isSubmitting ? "Deleting..." : "Delete account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
