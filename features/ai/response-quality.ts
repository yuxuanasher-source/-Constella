export function hasMeaningfulAiContent(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  // Letters and numbers cover Chinese, Latin text and useful numeric answers while
  // rejecting whitespace, punctuation and Markdown decoration on their own.
  return /[\p{L}\p{N}]/u.test(value.normalize("NFKC"));
}
