export function getDraftRestoreKey(
  submittedKey: string,
  currentKey: string,
  validConversationIds: readonly string[],
): string {
  return validConversationIds.includes(submittedKey)
    ? submittedKey
    : currentKey;
}

export function mergeRestoredInput(
  submittedInput: string,
  currentInput: string,
): string {
  if (!currentInput) return submittedInput;
  if (!submittedInput || currentInput === submittedInput) return currentInput;
  return `${currentInput}\n${submittedInput}`;
}
