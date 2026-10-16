/** Each credit once, dropping any another contains, since every credit opens with the database's, which is all a NOAA station's says. */
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
