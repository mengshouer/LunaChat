import type { Thread } from "./db";

// At most this many assistant turns may stream at once across all threads.
export const MAX_CONCURRENT_TURNS = 3;

export type TurnStatus = "preparing" | "running" | "stopping" | "deleting";

// Enough of the live session map for the admission check; a Map or a Set both fit.
interface ActiveTurns {
  readonly size: number;
  has(threadId: string): boolean;
}

// Returns the reason a new turn cannot start, or null when it may.
export function checkTurnAdmission(
  activeTurns: ActiveTurns,
  threadId: string,
  maxConcurrentTurns: number = MAX_CONCURRENT_TURNS,
): string | null {
  if (activeTurns.has(threadId)) {
    return "This thread already has an active response";
  }
  if (activeTurns.size >= maxConcurrentTurns) {
    return `${maxConcurrentTurns} background responses are already running`;
  }
  return null;
}

// Web search is a per-conversation choice layered over the profile default.
// A stored thread keeps its own value; before the thread exists the choice
// lives in the draft override. Missing at both levels means "use the default".
export function resolveSearchEnabled(input: {
  thread: Pick<Thread, "searchEnabled"> | undefined;
  draftOverride: boolean | undefined;
  profileDefault: boolean | undefined;
}): boolean {
  const explicit = input.thread ? input.thread.searchEnabled : input.draftOverride;
  return explicit ?? input.profileDefault ?? false;
}

export type TurnFailureAction =
  // The user pressed Stop: keep whatever had already streamed.
  | "persist-partial"
  // A real failure on a turn the user can still see: record it in the thread.
  | "append-error"
  // Nothing to write — the thread is being deleted, or another turn took over.
  | "discard";

// Decides what a failed or interrupted turn leaves behind. Pulled out of the
// streaming loop because it is the rule that determines whether a half-streamed
// answer survives the user pressing Stop.
export function resolveTurnFailure(input: {
  aborted: boolean;
  status: TurnStatus | undefined;
  hasPartialContent: boolean;
  isOwner: boolean;
}): TurnFailureAction {
  if (input.aborted) {
    return input.status === "stopping" && input.hasPartialContent
      ? "persist-partial"
      : "discard";
  }
  return input.status !== "deleting" && input.isOwner
    ? "append-error"
    : "discard";
}
