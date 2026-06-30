/* Minimal design-token constants for mangaloader.
 *
 * Ported subset of the Atlas design kit: just the colour / font CSS-variable
 * references the content-archive surfaces consume. The variable values live in
 * `src/styles/atlas-tokens.css` (+ the shadcn theme in `globals.css`). */

export const SANS =
  "var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, sans-serif";
export const MONO =
  "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

export const BG = "var(--bg)";
export const PANEL = "var(--panel)";
export const CARD = "var(--atlas-card)";
export const CARD2 = "var(--card2)";

export const LINE = "var(--line)";
export const HAIR = "var(--hair)";

export const TX = "var(--tx)";
export const MUT = "var(--mut)";
export const FAINT = "var(--faint)";
