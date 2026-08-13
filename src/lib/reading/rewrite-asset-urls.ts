import { parseHTML } from "linkedom";

export type AssetUrlBuilder = (relativePath: string) => string;

const ABSOLUTE_OR_SCHEME = /^([a-z][a-z0-9+.-]*:)?\/\//i;

/**
 * ADR-0012's read-time rewrite. The stored HTML keeps the Author's original relative
 * paths (ADR-0005) — a Version is not a document of its own any more (ADR-0011: one
 * Book address), so those paths cannot resolve on their own. This rewrites `src` and
 * `srcset` on `<img>` and `<source>` onto the access-checked asset route, and nothing
 * else: an absolute or `data:` reference already points somewhere real and is left
 * alone (an off-site image is the one disclosure ADR-0012 accepts).
 *
 * Never checks whether the asset exists — that would need a second Storage round trip
 * per read for a case the browser already reports for free. A missing asset 404s from
 * the route this points at, and the reading view's own `error` listener turns that
 * into the "cannot be rendered" message.
 */
export function rewriteAssetUrls(html: string, assetUrl: AssetUrlBuilder): string {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);

  for (const img of document.querySelectorAll("img")) {
    rewriteAttribute(img, "src", assetUrl);
    rewriteSrcset(img, assetUrl);
  }
  for (const source of document.querySelectorAll("source")) {
    rewriteSrcset(source, assetUrl);
  }

  return document.body.innerHTML;
}

function rewriteAttribute(
  element: Element,
  attribute: string,
  assetUrl: AssetUrlBuilder,
): void {
  const value = element.getAttribute(attribute);
  if (value === null) {
    return;
  }

  const relative = toRelativeAssetPath(value);
  if (relative === null) {
    return;
  }

  element.setAttribute(attribute, assetUrl(relative));
}

function rewriteSrcset(element: Element, assetUrl: AssetUrlBuilder): void {
  const srcset = element.getAttribute("srcset");
  if (srcset === null) {
    return;
  }

  const rewritten = srcset
    .split(",")
    .map((candidate) => rewriteCandidate(candidate, assetUrl))
    .join(", ");

  element.setAttribute("srcset", rewritten);
}

function rewriteCandidate(candidate: string, assetUrl: AssetUrlBuilder): string {
  const trimmed = candidate.trim();
  const spaceIndex = trimmed.indexOf(" ");
  const url = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const descriptor = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex).trim();

  const relative = toRelativeAssetPath(url);
  if (relative === null) {
    return descriptor === "" ? url : `${url} ${descriptor}`;
  }

  const rewritten = assetUrl(relative);
  return descriptor === "" ? rewritten : `${rewritten} ${descriptor}`;
}

function toRelativeAssetPath(value: string): string | null {
  if (value === "" || ABSOLUTE_OR_SCHEME.test(value) || value.startsWith("data:")) {
    return null;
  }

  const resolved = new URL(value, "http://marginly-asset.invalid/");
  return decodeURIComponent(resolved.pathname).replace(/^\/+/, "");
}
