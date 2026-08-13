import { describe, expect, it } from "vitest";

import { ALLOWLISTED_GLOBAL_FILES, checkComponent, checkStylesheet, TOKEN_FILE } from "./rules";

const RESET_FILE = ALLOWLISTED_GLOBAL_FILES.find((file) => file !== TOKEN_FILE)!;

describe("checkStylesheet", () => {
  it("passes a CSS Module that only reaches for tokens", () => {
    const css = ".card {\n  padding: var(--space-4);\n}\n";

    expect(checkStylesheet("src/app/page.module.css", css)).toEqual([]);
  });

  it("flags a raw hex colour in a CSS Module, naming the line", () => {
    const css = ".card {\n  color: #2b241c;\n}\n";

    expect(checkStylesheet("src/app/page.module.css", css)).toEqual([
      expect.objectContaining({
        file: "src/app/page.module.css",
        line: 2,
        rule: "no-raw-value",
      }),
    ]);
  });

  it("flags a raw px value in a CSS Module, naming the line", () => {
    const css = ".card {\n  padding: 12px;\n}\n";

    expect(checkStylesheet("src/app/page.module.css", css)).toEqual([
      expect.objectContaining({
        file: "src/app/page.module.css",
        line: 2,
        rule: "no-raw-value",
      }),
    ]);
  });

  it("flags every raw value line, not just the first", () => {
    const css = ".card {\n  color: #fff;\n  padding: 12px;\n}\n";

    expect(checkStylesheet("src/app/page.module.css", css)).toHaveLength(2);
  });

  it("does not flag a class selector inside a CSS Module", () => {
    const css = ".card {\n  padding: var(--space-4);\n}\n";

    const violations = checkStylesheet("src/app/page.module.css", css);

    expect(violations.some((violation) => violation.rule === "no-global-class-selector")).toBe(
      false,
    );
  });

  it("does not flag a raw value in the token file itself", () => {
    const css = ":root {\n  --color-ink: #2b241c;\n  --radius-sm: 4px;\n}\n";

    expect(checkStylesheet(TOKEN_FILE, css)).toEqual([]);
  });

  it("flags a class selector in the token file despite the allowlist", () => {
    const css = ":root {\n  --color-ink: #2b241c;\n}\n\n.stray {\n  color: red;\n}\n";

    expect(checkStylesheet(TOKEN_FILE, css)).toEqual([
      expect.objectContaining({
        file: TOKEN_FILE,
        line: 5,
        rule: "no-global-class-selector",
      }),
    ]);
  });

  it("flags a raw value in the allowlisted reset file, which holds no tokens of its own", () => {
    const css = "body {\n  color: #2b241c;\n}\n";

    expect(checkStylesheet(RESET_FILE, css)).toEqual([
      expect.objectContaining({ file: RESET_FILE, line: 2, rule: "no-raw-value" }),
    ]);
  });

  it("does not flag a stray-stylesheet violation for an allowlisted global file", () => {
    const css = "body {\n  margin: 0;\n}\n";

    const violations = checkStylesheet(RESET_FILE, css);

    expect(
      violations.some((violation) => violation.rule === "no-stray-global-stylesheet"),
    ).toBe(false);
  });

  it("flags a global stylesheet outside the allowlist", () => {
    const css = "body {\n  margin: 0;\n}\n";

    expect(checkStylesheet("src/styles/extra.css", css)).toEqual([
      expect.objectContaining({
        file: "src/styles/extra.css",
        line: 1,
        rule: "no-stray-global-stylesheet",
      }),
    ]);
  });

  it("flags a class selector declared in a stray global stylesheet", () => {
    const css = ".title {\n  color: var(--color-ink);\n}\n";

    const violations = checkStylesheet("src/styles/extra.css", css);

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "no-stray-global-stylesheet" }),
        expect.objectContaining({ rule: "no-global-class-selector", line: 1 }),
      ]),
    );
  });

  it("does not mistake a class-shaped example inside a comment for a real selector", () => {
    const css = "/* a global `.title` would leak */\nbody {\n  margin: 0;\n}\n";

    const violations = checkStylesheet(RESET_FILE, css);

    expect(violations.some((violation) => violation.rule === "no-global-class-selector")).toBe(
      false,
    );
  });

  it("keeps line numbers aligned after stripping a multi-line comment", () => {
    const css = "/*\n * example: .title\n */\n.stray {\n  color: var(--color-ink);\n}\n";

    expect(checkStylesheet(RESET_FILE, css)).toEqual([
      expect.objectContaining({ line: 4, rule: "no-global-class-selector" }),
    ]);
  });

  it("does not mistake a decimal value or a compound element.class for a class selector", () => {
    const css = "a.title {\n  margin: 0.5rem;\n}\n";

    const violations = checkStylesheet(RESET_FILE, css);

    expect(violations.some((violation) => violation.rule === "no-global-class-selector")).toBe(
      false,
    );
  });
});

describe("checkComponent", () => {
  it("passes a component with no inline style", () => {
    const tsx = 'export const Card = () => <div className={styles.card} />;\n';

    expect(checkComponent("src/app/page.tsx", tsx)).toEqual([]);
  });

  it("flags an inline style object, naming the line", () => {
    const tsx = "export const Card = () => (\n  <div style={{ color: \"red\" }} />\n);\n";

    expect(checkComponent("src/app/page.tsx", tsx)).toEqual([
      expect.objectContaining({ file: "src/app/page.tsx", line: 2, rule: "no-inline-style" }),
    ]);
  });

  it("does not flag a style prop holding a variable rather than an object literal", () => {
    const tsx = "export const Card = () => <div style={dynamicStyle} />;\n";

    expect(checkComponent("src/app/page.tsx", tsx)).toEqual([]);
  });
});
