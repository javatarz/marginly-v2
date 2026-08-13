/**
 * The style guard's decisions, held apart from the filesystem walk that applies them
 * (tests/style-guard.test.ts).
 *
 * ADR-0012 keeps an Author's `class` and `id` attributes on the grounds that they
 * "define nothing" — true only while Marginly has no stylesheet. A global class
 * selector would end that: with no iframe and no shadow root, the Book's HTML shares
 * this document, so a global `.title` would style an Author's `<p class="title">` and
 * move the text's metrics #27 measures Highlights against. CSS Modules close that
 * gap by construction (hashed class names cannot collide), so these rules exist to
 * keep every stylesheet a Module except the two that are deliberately global.
 */
export type Violation = {
  file: string;
  line: number;
  rule: string;
  message: string;
};

export const TOKEN_FILE = "src/styles/tokens.css";
export const ALLOWLISTED_GLOBAL_FILES: readonly string[] = [
  TOKEN_FILE,
  "src/styles/reset.css",
];

const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/;
const PX_VALUE = /-?\d+(?:\.\d+)?px\b/;
// A dot not preceded by a word character or another dot, so `a.title` (an
// element+class compound) and `0.5rem` (a decimal) are left alone — this is a class
// selector standing on its own, which is the shape every rule in the token file and
// the reset file is written in today.
const CLASS_SELECTOR = /(?<![\w.])\.[a-zA-Z_-][\w-]*/;
const INLINE_STYLE_OBJECT = /\bstyle\s*=\s*\{\s*\{/;

export function checkStylesheet(path: string, rawContents: string): Violation[] {
  const violations: Violation[] = [];
  const global = isGlobalStylesheet(path);
  // A comment explaining *why* a rule exists is free to write ".foo" as an example —
  // it is prose, not a selector — so it is blanked out (newlines kept, for line
  // numbers) before either scan below ever sees it.
  const contents = stripBlockComments(rawContents);

  if (global && !ALLOWLISTED_GLOBAL_FILES.includes(path)) {
    violations.push({
      file: path,
      line: 1,
      rule: "no-stray-global-stylesheet",
      message: `${path} is a global stylesheet outside the allowlist (${ALLOWLISTED_GLOBAL_FILES.join(", ")}). Name it *.module.css so its classes are hashed.`,
    });
  }

  if (global) {
    violations.push(...matchEachLine(contents, CLASS_SELECTOR, path, "no-global-class-selector",
      "A class selector is declared in a global stylesheet. A Book's HTML keeps its own class attributes and shares this document, so a global class would style the Author's prose — move this rule into a *.module.css file."));
  }

  if (path !== TOKEN_FILE) {
    violations.push(
      ...matchEachLine(
        contents,
        HEX_COLOR,
        path,
        "no-raw-value",
        `A raw hex colour appears outside the token file (${TOKEN_FILE}). Reach for a var(--...) custom property instead.`,
      ),
      ...matchEachLine(
        contents,
        PX_VALUE,
        path,
        "no-raw-value",
        `A raw px value appears outside the token file (${TOKEN_FILE}). Reach for a var(--...) custom property instead.`,
      ),
    );
  }

  return violations;
}

export function checkComponent(path: string, contents: string): Violation[] {
  return matchEachLine(
    contents,
    INLINE_STYLE_OBJECT,
    path,
    "no-inline-style",
    "An inline style={{ ... }} bypasses the stylesheet entirely — move these values into a *.module.css file.",
  );
}

function isGlobalStylesheet(path: string): boolean {
  return path.endsWith(".css") && !path.endsWith(".module.css");
}

function stripBlockComments(contents: string): string {
  return contents.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function matchEachLine(
  contents: string,
  pattern: RegExp,
  file: string,
  rule: string,
  message: string,
): Violation[] {
  return contents
    .split("\n")
    .flatMap((line, index) => (pattern.test(line) ? [index + 1] : []))
    .map((line) => ({ file, line, rule, message }));
}
