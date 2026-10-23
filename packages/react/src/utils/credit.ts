/** Each credit once, dropping any that another contains: every credit starts with the database credit, and a NOAA station's is only that, so a longer credit already covers it. */
export function distinctCredits(attributions: Iterable<string | undefined>): string[] {
  const unique = [...new Set([...attributions].filter((a): a is string => !!a?.trim()))];
  return unique.filter((a) => !unique.some((b) => b !== a && b.includes(a)));
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** A credit as text in MapLibre's attribution control, which reads its entries as HTML. */
export function creditHtml(credit: string): string {
  return credit.replace(/[&<>"]/g, (c) => HTML_ESCAPES[c]);
}
