import { unzipSync } from "npm:fflate@0.8.2";
import { DOMParser as DenoDOMParser } from "jsr:@b-fuze/deno-dom@0.1.56";
import { parse as parse5Parse } from "npm:parse5@8.0.0";

const BOUNDARY = new Set([
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

const DROP = new Set([
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
  "label",
  "fieldset",
  "legend",
  "style",
  "link",
]);

const UNWRAP = new Set(["html", "head", "body"]);

const SKIP_TEXT = new Set(["table", "script", "style"]);

const URL_ATTRS = ["href", "src", "srcset", "action", "formaction", "poster"];

function badUrl(value: string): boolean {
  const v = value.toLowerCase().replace(/[\s\u0000-\u001f]/g, "");
  if (v.startsWith("javascript:")) return true;
  if (v.startsWith("data:") && !v.startsWith("data:image/")) return true;
  return false;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

const stamps: { stage: string; ms: number; rssMb: number }[] = [];
let mark = 0;
let peakRss = 0;

function begin() {
  mark = performance.now();
}

async function end(stage: string) {
  const ms = performance.now() - mark;
  const rssMb = Math.round(Deno.memoryUsage().rss / 1048576);
  if (rssMb > peakRss) peakRss = rssMb;
  stamps.push({ stage, ms: Math.round(ms * 100) / 100, rssMb });
  console.log(`STAGE ${stage} ${ms.toFixed(1)}ms rss=${rssMb}MB`);
  await new Promise((r) => setTimeout(r, 0));
  mark = performance.now();
}

function hashInput(files: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const paths = Object.keys(files).filter((p) => !p.toLowerCase().endsWith(".css")).sort();
  let total = 0;
  for (const p of paths) total += p.length + files[p].length;
  const buf = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const p of paths) {
    for (let i = 0; i < p.length; i++) buf[at++] = p.charCodeAt(i) & 0xff;
    buf.set(files[p], at);
    at += files[p].length;
  }
  return buf;
}

function sanitiseDeno(doc: unknown): number {
  let removed = 0;
  const walk = (node: any) => {
    const kids = Array.from(node.childNodes ?? []);
    for (const kid of kids as any[]) {
      if (kid.nodeType !== 1) continue;
      const tag = kid.tagName?.toLowerCase() ?? "";
      if (DROP.has(tag)) {
        kid.remove();
        removed++;
        continue;
      }
      for (const attr of Array.from(kid.attributes ?? []) as any[]) {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || name === "style") {
          kid.removeAttribute(attr.name);
          removed++;
        } else if (URL_ATTRS.includes(name) && badUrl(attr.value)) {
          kid.removeAttribute(attr.name);
          removed++;
        }
      }
      walk(kid);
    }
  };
  walk(doc);
  return removed;
}

function extractDeno(root: any): string[] {
  const segments: string[] = [];
  let buf = "";
  const flush = () => {
    const s = collapse(buf);
    if (s) segments.push(s);
    buf = "";
  };
  const walk = (node: any) => {
    for (const kid of node.childNodes ?? []) {
      if (kid.nodeType === 3) {
        buf += kid.textContent ?? "";
        continue;
      }
      if (kid.nodeType !== 1) continue;
      const tag = kid.tagName?.toLowerCase() ?? "";
      if (SKIP_TEXT.has(tag)) continue;
      if (tag === "br") {
        buf += " ";
        continue;
      }
      if (BOUNDARY.has(tag)) {
        flush();
        walk(kid);
        flush();
        continue;
      }
      walk(kid);
    }
  };
  walk(root);
  flush();
  return segments;
}

function sanitiseParse5(node: any): number {
  let removed = 0;
  const walk = (parent: any) => {
    const kids = parent.childNodes;
    if (!kids) return;
    for (let i = kids.length - 1; i >= 0; i--) {
      const kid = kids[i];
      if (!kid.tagName) continue;
      const tag = kid.tagName.toLowerCase();
      if (DROP.has(tag)) {
        kids.splice(i, 1);
        removed++;
        continue;
      }
      if (kid.attrs) {
        kid.attrs = kid.attrs.filter((a: any) => {
          const name = a.name.toLowerCase();
          if (name.startsWith("on") || name === "style") {
            removed++;
            return false;
          }
          if (URL_ATTRS.includes(name) && badUrl(a.value)) {
            removed++;
            return false;
          }
          return true;
        });
      }
      walk(kid);
    }
  };
  walk(node);
  return removed;
}

function extractParse5(root: any): string[] {
  const segments: string[] = [];
  let buf = "";
  const flush = () => {
    const s = collapse(buf);
    if (s) segments.push(s);
    buf = "";
  };
  const walk = (node: any) => {
    for (const kid of node.childNodes ?? []) {
      if (kid.nodeName === "#text") {
        buf += kid.value ?? "";
        continue;
      }
      if (!kid.tagName) continue;
      const tag = kid.tagName.toLowerCase();
      if (SKIP_TEXT.has(tag)) continue;
      if (tag === "br") {
        buf += " ";
        continue;
      }
      if (BOUNDARY.has(tag)) {
        flush();
        walk(kid);
        flush();
        continue;
      }
      walk(kid);
    }
  };
  walk(root);
  flush();
  return segments;
}

addEventListener("beforeunload", (e: any) => {
  console.log(`SHUTDOWN ${e.detail?.reason ?? "unknown"} stamps=${JSON.stringify(stamps)}`);
});

const STAGES = ["download", "unzip", "hash", "parse", "sanitise", "extract"];

Deno.serve(async (req) => {
  stamps.length = 0;
  peakRss = 0;
  const { book, zipUrl, parser = "deno-dom", upto = "extract", run = 0, repeat = 1 } = await req.json();
  const limit = STAGES.indexOf(upto);
  console.log(`RUN book=${book} parser=${parser} upto=${upto} run=${run}`);

  begin();
  const res = await fetch(zipUrl);
  if (!res.ok) {
    const detail = await res.text();
    console.log(`STORAGE_FAIL ${res.status} body=${detail}`);
    return new Response(JSON.stringify({ error: `storage ${res.status}`, detail }), { status: 500 });
  }
  const zipBytes = new Uint8Array(await res.arrayBuffer());
  await end("download");
  if (limit === 0) return done(book, parser, upto, { zipBytes: zipBytes.length });

  const files = unzipSync(zipBytes);
  const html = new TextDecoder().decode(files["index.html"]);
  await end("unzip");
  const shape = {
    zipBytes: zipBytes.length,
    fileCount: Object.keys(files).length,
    htmlBytes: files["index.html"].length,
  };
  if (limit === 1) return done(book, parser, upto, shape);

  const digest = await crypto.subtle.digest("SHA-256", hashInput(files));
  await end("hash");
  const withHash = { ...shape, hash: [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16)).join("") };
  if (limit === 2) return done(book, parser, upto, withHash);

  let removed = 0;
  let segments: string[] = [];
  for (let i = 0; i < repeat; i++) {
    let tree: any = parser === "deno-dom"
      ? new DenoDOMParser().parseFromString(html, "text/html")
      : parse5Parse(html);
    await end("parse");
    if (limit === 3) {
      if (i === repeat - 1) return done(book, parser, upto, withHash);
      tree = null;
      continue;
    }

    removed = parser === "deno-dom" ? sanitiseDeno(tree) : sanitiseParse5(tree);
    await end("sanitise");
    if (limit === 4) {
      if (i === repeat - 1) return done(book, parser, upto, { ...withHash, removed });
      tree = null;
      continue;
    }

    segments = parser === "deno-dom" ? extractDeno(tree) : extractParse5(tree);
    await end("extract");
    tree = null;
  }

  return done(book, parser, upto, {
    ...withHash,
    removed,
    segmentCount: segments.length,
    firstTwenty: segments.slice(0, 20).map((s) => s.slice(0, 60)),
  });
});

function done(book: string, parser: string, upto: string, shape: unknown) {
  const cpu = stamps.reduce((a, s) => (s.stage === "download" ? a : a + s.ms), 0);
  const body = {
    book,
    parser,
    upto,
    stamps,
    cpuMs: Math.round(cpu * 100) / 100,
    peakRssMb: peakRss,
    shape,
  };
  console.log(`DONE ${JSON.stringify(body)}`);
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}
