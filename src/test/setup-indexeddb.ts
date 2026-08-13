// Dexie needs a real IndexedDB implementation. Loading this before any test
// module means `src/lib/db.ts` finds one when it constructs ChatDB at import
// time, so the storage layer can be tested against actual transactions rather
// than a hand-written mock.
import "fake-indexeddb/auto";
