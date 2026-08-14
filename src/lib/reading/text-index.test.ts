import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";

import { buildTextIndex, resolvePoint, resolveRange } from "./text-index";

function bodyOf(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  return document.body as unknown as Node;
}

function textAt(index: ReturnType<typeof buildTextIndex>, offset: number): string {
  const position = index.resolveOffset(offset);
  if (!position) {
    return "";
  }
  const node = position.node as unknown as Text;
  return node.data.slice(position.offset, position.offset + 1);
}

/**
 * ADR-0007: this index has to agree exactly with the extraction rules
 * `supabase/functions/_shared/preview/extract.ts` stores the text under — a
 * one-character disagreement draws every Highlight on the page wrong. So every rule
 * exercised here is exercised there too (ADR-0013).
 */
describe("buildTextIndex", () => {
  it("indexes a single paragraph's text", () => {
    const index = buildTextIndex(bodyOf("<p>hello world</p>"));

    expect(index.length).toBe("hello world".length);
    expect(textAt(index, 0)).toBe("h");
    expect(textAt(index, 6)).toBe("w");
  });

  it("joins two segments with a single space", () => {
    const index = buildTextIndex(bodyOf("<p>hello</p><p>world</p>"));

    // "hello world" — offset 5 is the join space, offset 6 is "world"'s "w".
    expect(index.length).toBe(11);
    expect(textAt(index, 6)).toBe("w");
  });

  it("resolves the join space to a real DOM position, not null", () => {
    const index = buildTextIndex(bodyOf("<p>hello</p><p>world</p>"));

    expect(index.resolveOffset(5)).not.toBeNull();
  });

  it("treats h1-h6, li, blockquote, pre, figcaption and div as segment boundaries", () => {
    const html =
      "<h1>a</h1><li>b</li><blockquote>c</blockquote><pre>d</pre>" +
      "<figcaption>e</figcaption><div>f</div>";
    const index = buildTextIndex(bodyOf(html));

    expect(index.length).toBe("a b c d e f".length);
  });

  it("gives an inline element's text no extra space", () => {
    const index = buildTextIndex(bodyOf("<p>wo<em>nd</em>er</p>"));

    expect(index.length).toBe("wonder".length);
  });

  it("gives a br a space rather than starting a new segment", () => {
    const index = buildTextIndex(bodyOf("<p>one<br>two</p>"));

    expect(index.length).toBe("one two".length);
  });

  it("excludes table text from the index entirely", () => {
    const index = buildTextIndex(
      bodyOf("<p>before</p><table><tr><td>hidden</td></tr></table><p>after</p>"),
    );

    expect(index.length).toBe("before after".length);
  });

  it("includes figcaption text, selectable like any other segment", () => {
    const index = buildTextIndex(bodyOf("<figure><figcaption>a caption</figcaption></figure>"));

    expect(index.length).toBe("a caption".length);
  });

  it("collapses a run of whitespace to a single space", () => {
    const index = buildTextIndex(bodyOf("<p>hello   \n  world</p>"));

    expect(index.length).toBe("hello world".length);
    expect(textAt(index, 6)).toBe("w");
  });

  it("trims leading and trailing whitespace from a segment", () => {
    const index = buildTextIndex(bodyOf("<p>   hello   </p>"));

    expect(index.length).toBe("hello".length);
    expect(textAt(index, 0)).toBe("h");
  });

  it("drops an empty segment with no join space around it", () => {
    const index = buildTextIndex(bodyOf("<p>hello</p><p>   </p><p>world</p>"));

    expect(index.length).toBe("hello world".length);
  });

  it("decodes entities before indexing", () => {
    const index = buildTextIndex(bodyOf("<p>cats &amp; dogs</p>"));

    expect(index.length).toBe("cats & dogs".length);
    expect(textAt(index, 5)).toBe("&");
  });

  it("skips a comment node, contributing neither text nor a boundary", () => {
    const index = buildTextIndex(bodyOf("<p>a<!-- note -->b</p>"));

    expect(index.length).toBe("ab".length);
  });

  it("exposes the extracted text itself, identical to what preview.ts stores", () => {
    const index = buildTextIndex(bodyOf("<p>hello</p><p>world</p>"));

    expect(index.text).toBe("hello world");
  });

  it("returns null past the end of the text", () => {
    const index = buildTextIndex(bodyOf("<p>hi</p>"));

    expect(index.resolveOffset(99)).toBeNull();
  });

  describe("resolveRange — the two boundaries a Range needs for [start, end)", () => {
    it("resolves an interior range to the start and the character right after it", () => {
      const body = bodyOf("<p>hello world</p>");
      const index = buildTextIndex(body);
      const textNode = (body as unknown as Element).querySelector("p")!.firstChild as Text;

      const resolved = resolveRange(index, 0, 5);
      expect(resolved).toEqual({
        start: { node: textNode, offset: 0 },
        end: { node: textNode, offset: 5 },
      });
    });

    it("resolves a range reaching the end of the text to one past its last character", () => {
      const body = bodyOf("<p>hi</p>");
      const index = buildTextIndex(body);
      const textNode = (body as unknown as Element).querySelector("p")!.firstChild as Text;

      const resolved = resolveRange(index, 0, 2);
      expect(resolved).toEqual({
        start: { node: textNode, offset: 0 },
        end: { node: textNode, offset: 2 },
      });
    });

    it("returns null for a start past the end of the text", () => {
      const index = buildTextIndex(bodyOf("<p>hi</p>"));
      expect(resolveRange(index, 99, 100)).toBeNull();
    });
  });

  describe("resolvePoint — a single-point caret position (ADR-0014's Unlinked placement)", () => {
    it("resolves an interior offset to that character's own position", () => {
      const body = bodyOf("<p>hello world</p>");
      const index = buildTextIndex(body);
      const textNode = (body as unknown as Element).querySelector("p")!.firstChild as Text;

      expect(resolvePoint(index, 6)).toEqual({ node: textNode, offset: 6 });
    });

    it("resolves an offset sitting exactly at the end of the text to one past its last character", () => {
      const body = bodyOf("<p>hi</p>");
      const index = buildTextIndex(body);
      const textNode = (body as unknown as Element).querySelector("p")!.firstChild as Text;

      expect(resolvePoint(index, 2)).toEqual({ node: textNode, offset: 2 });
    });

    it("returns null for an index holding no text at all", () => {
      const index = buildTextIndex(bodyOf(""));
      expect(resolvePoint(index, 0)).toBeNull();
    });
  });

  describe("offsetOf — the reverse direction the same index must also serve", () => {
    it("recovers the exact offset for a real character's own DOM position", () => {
      const body = bodyOf("<p>hello world</p>");
      const index = buildTextIndex(body);
      const textNode = (body as unknown as Element).querySelector("p")!.firstChild as Text;

      expect(index.offsetOf(textNode, 6)).toBe(6);
    });

    it("resolves a point inside collapsed whitespace to the one collapsed offset", () => {
      const body = bodyOf("<p>hello   world</p>");
      const index = buildTextIndex(body);
      const textNode = (body as unknown as Element).querySelector("p")!.firstChild as Text;

      // Raw offsets 5, 6 and 7 are all inside the collapsed run; only offset 5 (the
      // first) was ever recorded, so every point in the run resolves to it.
      expect(index.offsetOf(textNode, 5)).toBe(5);
      expect(index.offsetOf(textNode, 7)).toBe(5);
    });

    it("returns null for a node the index never walked", () => {
      const body = bodyOf("<p>hello</p>");
      const index = buildTextIndex(body);
      const { document: other } = parseHTML("<!doctype html><body><p>bye</p></body>");
      const foreignNode = other.querySelector("p")!.firstChild as unknown as Text;

      expect(index.offsetOf(foreignNode as unknown as Node, 0)).toBeNull();
    });

    it("recovers a segment's second half after crossing a join space", () => {
      const body = bodyOf("<p>hello</p><p>world</p>");
      const index = buildTextIndex(body);
      const secondParagraph = (body as unknown as Element).querySelectorAll("p")[1]!;
      const textNode = secondParagraph.firstChild as Text;

      expect(index.offsetOf(textNode, 0)).toBe(6);
    });
  });
});
