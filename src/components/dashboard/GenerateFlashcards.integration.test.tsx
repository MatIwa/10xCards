import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import GenerateFlashcards from "./GenerateFlashcards";
import { installApiRouteFetchStub } from "../../../test/helpers/api-route-fetch-stub";
import { resetFlashcards, readFlashcards } from "../../../test/helpers/db";
import { getTestUserId } from "../../../test/helpers/integration-user";
import { signInTestUser } from "../../../test/helpers/supabase-session";

const generatedProposals = [
  { id: "proposal-1", front: "P1-front", back: "P1-back" },
  { id: "proposal-2", front: "P2-front", back: "P2-back" },
  { id: "proposal-3", front: "P3-front", back: "P3-back" },
  { id: "proposal-4", front: "P4-front", back: "P4-back" },
  { id: "proposal-5", front: "P5-front", back: "P5-back" },
];

function getProposalItemByFront(front: string) {
  const frontInput = screen.getByDisplayValue(front);
  const proposalItem = frontInput.closest("li");

  if (!proposalItem) {
    throw new Error(`Could not find proposal item for ${front}`);
  }

  return proposalItem;
}

describe("GenerateFlashcards candidate save flow", () => {
  beforeEach(async () => {
    const userId = getTestUserId();
    await resetFlashcards(userId);

    const session = await signInTestUser();
    vi.stubGlobal(
      "fetch",
      installApiRouteFetchStub({
        userId: session.userId,
        sessionCookie: session.cookieHeader,
        generateProposalsResponse: generatedProposals,
      }),
    );

    render(<GenerateFlashcards />);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists exactly the accepted subset with edits, and nothing else", async () => {
    const user = userEvent.setup();
    const sourceText = `${"Flashcard source material. ".repeat(12)}This extra sentence pushes the text past the minimum length.`;

    await user.type(screen.getByRole("textbox", { name: /source text/i }), sourceText);
    await user.click(screen.getByRole("button", { name: /generate/i }));

    const firstFrontInput = await screen.findByDisplayValue("P1-front");
    await user.clear(firstFrontInput);
    await user.type(firstFrontInput, "P1-front-EDITED");

    await user.click(screen.getAllByRole("button", { name: "Reject" })[1]);
    await waitFor(() => expect(screen.queryByDisplayValue("P2-front")).not.toBeInTheDocument());

    const p3Item = getProposalItemByFront("P3-front");
    await user.click(within(p3Item).getByRole("checkbox"));

    expect(within(getProposalItemByFront("P1-front-EDITED")).getByRole("checkbox")).toBeChecked();
    expect(within(p3Item).getByRole("checkbox")).not.toBeChecked();
    expect(within(getProposalItemByFront("P4-front")).getByRole("checkbox")).toBeChecked();
    expect(within(getProposalItemByFront("P5-front")).getByRole("checkbox")).toBeChecked();

    await user.click(screen.getByRole("button", { name: /accept selected/i }));
    await screen.findByText("Accepted 3");

    const userId = getTestUserId();
    await waitFor(async () => {
      await expect(readFlashcards(userId)).resolves.toHaveLength(3);
    });
    const rows = await readFlashcards(userId);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ front: "P1-front-EDITED", back: "P1-back", source: "ai_edited" }),
        expect.objectContaining({ front: "P4-front", back: "P4-back", source: "ai_full" }),
        expect.objectContaining({ front: "P5-front", back: "P5-back", source: "ai_full" }),
      ]),
    );
    expect(rows).not.toEqual(expect.arrayContaining([expect.objectContaining({ front: "P2-front" })]));
    expect(rows).not.toEqual(expect.arrayContaining([expect.objectContaining({ front: "P3-front" })]));
    expect(rows.every((row) => row.user_id === userId)).toBe(true);
  });
});
