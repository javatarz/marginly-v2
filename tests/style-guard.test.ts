import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { checkComponent, checkStylesheet, type Violation } from "@/lib/style-guard/rules";

/**
 * Issue #36 / ADR-0012: a global class selector in Marginly's own stylesheet would
 * style an Author's Book HTML too, since the Book keeps its `class` attributes and
 * renders inside this same document with no iframe and no shadow root. This walks
 * the real tree and applies src/lib/style-guard/rules.ts to every stylesheet and
 * component in it, so the boundary keeps holding as later tickets (#22, #25, #27,
 * #29, #30) add surfaces.
 */
describe("style guard", () => {
  it("finds no raw value, no stray global class selector, and no inline style", () => {
    const violations = walk(join(process.cwd(), "src")).flatMap((filePath) => {
      const path = relative(process.cwd(), filePath);
      const contents = readFileSync(filePath, "utf8");

      if (path.endsWith(".css")) {
        return checkStylesheet(path, contents);
      }
      if (path.endsWith(".tsx")) {
        return checkComponent(path, contents);
      }
      return [];
    });

    expect(violations, formatReport(violations)).toEqual([]);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function formatReport(violations: Violation[]): string {
  return violations
    .map((violation) => `${violation.file}:${violation.line} [${violation.rule}] ${violation.message}`)
    .join("\n");
}
