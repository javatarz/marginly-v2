import type { Document, Element, Node, Text } from "@b-fuze/deno-dom";

const SEGMENT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "figcaption",
  "div",
]);

const WHITESPACE = new RegExp("\\s+", "g");
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export function extractSegments(document: Document): readonly string[] {
  const segments: string[] = [];
  let buffer = "";

  const flush = () => {
    const segment = buffer.replaceAll(WHITESPACE, " ").trim();
    if (segment.length > 0) {
      segments.push(segment);
    }
    buffer = "";
  };

  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        buffer += (child as Text).data;
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) {
        continue;
      }
      const element = child as Element;
      if (element.localName === "table") {
        continue;
      }
      if (element.localName === "br") {
        buffer += " ";
        continue;
      }
      if (SEGMENT_TAGS.has(element.localName)) {
        flush();
        walk(element);
        flush();
        continue;
      }
      walk(element);
    }
  };

  walk(document.body!);
  flush();

  return segments;
}
