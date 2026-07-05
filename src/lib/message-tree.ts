import type { Message } from "./db";

// Messages in a thread form a tree via parentId (null/undefined = root).
// Branches are created by editing a user message: the edited copy becomes a
// sibling sharing the same parentId. The active branch is identified by the
// thread's activeLeafId.

function compareByCreation(a: Message, b: Message): number {
  // Mirror getMessages() index order: createdAt asc, id asc as tiebreaker.
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Chain messages of a linear (pre-branching) thread: sort by creation and
 * set each parentId to the previous message. Mutates and returns the sorted
 * list. Used by the Dexie v4 migration and by legacy data import.
 */
export function chainByCreation(list: Message[]): Message[] {
  const sorted = [...list].sort(compareByCreation);
  for (let i = 0; i < sorted.length; i++) {
    sorted[i].parentId = i === 0 ? null : sorted[i - 1].id;
  }
  return sorted;
}

/**
 * Walk up from the active leaf to the root and return the path in
 * chronological order. Falls back to the newest message as leaf when
 * activeLeafId is missing or stale (pre-branching or imported data).
 */
export function getActivePath(
  all: Message[],
  activeLeafId?: string,
): Message[] {
  if (all.length === 0) return [];
  const byId = new Map(all.map((m) => [m.id, m]));
  let leaf = activeLeafId ? byId.get(activeLeafId) : undefined;
  if (!leaf) {
    leaf = all.reduce((a, b) => (compareByCreation(a, b) <= 0 ? b : a));
  }
  const path: Message[] = [];
  let current: Message | undefined = leaf;
  while (current && path.length <= all.length) {
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

/**
 * Sibling branches of a message: same parent and same role, ordered by
 * creation time. Includes the message itself.
 */
export function getSiblings(all: Message[], message: Message): Message[] {
  const parentId = message.parentId ?? null;
  return all
    .filter((m) => (m.parentId ?? null) === parentId && m.role === message.role)
    .sort(compareByCreation);
}

/**
 * Descend from a message picking the most recently created child at each
 * level, returning the id of the leaf reached. Used when switching branches
 * to restore the newest conversation state of that branch.
 */
export function findLatestLeaf(all: Message[], fromId: string): string {
  const childrenOf = new Map<string, Message[]>();
  for (const m of all) {
    if (!m.parentId) continue;
    const list = childrenOf.get(m.parentId);
    if (list) list.push(m);
    else childrenOf.set(m.parentId, [m]);
  }
  let currentId = fromId;
  for (let depth = 0; depth <= all.length; depth++) {
    const children = childrenOf.get(currentId);
    if (!children || children.length === 0) return currentId;
    currentId = children.reduce((a, b) =>
      compareByCreation(a, b) <= 0 ? b : a,
    ).id;
  }
  return currentId;
}
