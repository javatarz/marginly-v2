import { describe, expect, it } from "vitest";

import { rewriteAssetUrls } from "./rewrite-asset-urls";

function urlFor(path: string): string {
  return `/asset/${path}`;
}

describe("rewriteAssetUrls", () => {
  it("rewrites a plain img src", () => {
    const out = rewriteAssetUrls('<img src="fig1.png">', urlFor);
    expect(out).toContain('src="/asset/fig1.png"');
  });

  it("rewrites a src given as ./ relative", () => {
    const out = rewriteAssetUrls('<img src="./fig1.png">', urlFor);
    expect(out).toContain('src="/asset/fig1.png"');
  });

  it("rewrites a nested relative path, keeping the sub-path", () => {
    const out = rewriteAssetUrls('<img src="images/fig1.png">', urlFor);
    expect(out).toContain('src="/asset/images/fig1.png"');
  });

  it("leaves an absolute http(s) URL untouched", () => {
    const out = rewriteAssetUrls('<img src="https://example.com/fig1.png">', urlFor);
    expect(out).toContain('src="https://example.com/fig1.png"');
  });

  it("leaves a protocol-relative URL untouched", () => {
    const out = rewriteAssetUrls('<img src="//example.com/fig1.png">', urlFor);
    expect(out).toContain('src="//example.com/fig1.png"');
  });

  it("leaves a data: URL untouched", () => {
    const out = rewriteAssetUrls('<img src="data:image/png;base64,AAAA">', urlFor);
    expect(out).toContain('src="data:image/png;base64,AAAA"');
  });

  it("leaves an img with no src attribute untouched", () => {
    const out = rewriteAssetUrls('<img alt="no src">', urlFor);
    expect(out).toContain('<img alt="no src">');
  });

  it("leaves an empty src untouched", () => {
    const out = rewriteAssetUrls('<img src="">', urlFor);
    expect(out).toContain('src=""');
  });

  it("rewrites every candidate in an img's srcset, keeping each descriptor", () => {
    const out = rewriteAssetUrls(
      '<img src="fig1.png" srcset="fig1.png 1x, fig1-2x.png 2x">',
      urlFor,
    );
    expect(out).toContain('srcset="/asset/fig1.png 1x, /asset/fig1-2x.png 2x"');
  });

  it("rewrites a srcset candidate given by width descriptor", () => {
    const out = rewriteAssetUrls('<img src="fig1.png" srcset="fig1-large.png 800w">', urlFor);
    expect(out).toContain('srcset="/asset/fig1-large.png 800w"');
  });

  it("rewrites a srcset candidate with no descriptor", () => {
    const out = rewriteAssetUrls('<img src="fig1.png" srcset="fig1.png">', urlFor);
    expect(out).toContain('srcset="/asset/fig1.png"');
  });

  it("leaves an absolute URL inside a srcset candidate untouched", () => {
    const out = rewriteAssetUrls(
      '<img src="fig1.png" srcset="https://example.com/fig1.png 1x">',
      urlFor,
    );
    expect(out).toContain('srcset="https://example.com/fig1.png 1x"');
  });

  it("leaves an absolute URL with no descriptor inside a srcset candidate untouched", () => {
    const out = rewriteAssetUrls(
      '<img src="fig1.png" srcset="https://example.com/fig1.png">',
      urlFor,
    );
    expect(out).toContain('srcset="https://example.com/fig1.png"');
  });

  it("leaves an img with no srcset attribute untouched", () => {
    const out = rewriteAssetUrls('<img src="fig1.png">', urlFor);
    expect(out).not.toContain("srcset");
  });

  it("rewrites a picture's source srcset, and its fallback img src", () => {
    const out = rewriteAssetUrls(
      '<picture><source srcset="fig1.webp" type="image/webp"><img src="fig1.png"></picture>',
      urlFor,
    );
    expect(out).toContain('srcset="/asset/fig1.webp"');
    expect(out).toContain('src="/asset/fig1.png"');
    expect(out).toContain('type="image/webp"');
  });

  it("leaves a source with no srcset attribute untouched", () => {
    const out = rewriteAssetUrls('<picture><source type="image/webp"><img src="fig1.png"></picture>', urlFor);
    expect(out).toContain("<source type=\"image/webp\">");
  });

  it("leaves prose with no img or source untouched, aside from wrapper tags", () => {
    const out = rewriteAssetUrls("<p>Just words.</p>", urlFor);
    expect(out).toContain("<p>Just words.</p>");
  });
});
