import type { Document, Element } from "@b-fuze/deno-dom";

const REMOVED_TAGS = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "optgroup",
  "datalist",
  "output",
  "fieldset",
  "legend",
  "label",
  "style",
  "link",
]);

const BLANKS = new RegExp("[^\\x21-\\x7E]+", "g");

const URL_ATTRIBUTES = new Set([
  "href",
  "src",
  "srcset",
  "poster",
  "cite",
  "background",
  "xlink:href",
]);

export function sanitise(document: Document): number {
  return removeFrom(document.documentElement!);
}

function removeFrom(element: Element): number {
  let removed = 0;
  for (const child of [...element.children]) {
    if (REMOVED_TAGS.has(child.localName)) {
      child.remove();
      removed += 1;
      continue;
    }
    stripAttributes(child);
    removed += removeFrom(child);
  }
  return removed;
}

function stripAttributes(element: Element): void {
  for (const name of element.getAttributeNames()) {
    if (isRemovableAttribute(name, element.getAttribute(name)!)) {
      element.removeAttribute(name);
    }
  }
}

function isRemovableAttribute(name: string, value: string): boolean {
  const lowered = name.toLowerCase();
  return lowered.startsWith("on") ||
    lowered === "style" ||
    (URL_ATTRIBUTES.has(lowered) && holdsDangerousUrl(value));
}

function holdsDangerousUrl(value: string): boolean {
  return value.replaceAll(BLANKS, "").split(",").some(isDangerousUrl);
}

function isDangerousUrl(candidate: string): boolean {
  const url = candidate.toLowerCase();
  return url.startsWith("javascript:") ||
    (url.startsWith("data:") && !url.startsWith("data:image/"));
}
