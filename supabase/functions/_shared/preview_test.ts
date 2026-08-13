import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip-js/zip-js";

import { type PreviewSuccess, previewUpload } from "./preview.ts";

type Entry = readonly [string, string | Uint8Array];

const HTML_BYTE_LIMIT = 10 * 1024 * 1024;

async function zipOf(entries: readonly Entry[]): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [path, content] of entries) {
    await writer.add(
      path,
      typeof content === "string"
        ? new TextReader(content)
        : new Uint8ArrayReader(content),
    );
  }
  return await writer.close();
}

async function previewOf(entries: readonly Entry[]): Promise<PreviewSuccess> {
  const result = await previewUpload(await zipOf(entries));
  assert(result.ok, "expected the zip to be accepted");
  return result;
}

async function previewOfHtml(html: string): Promise<PreviewSuccess> {
  return await previewOf([["index.html", html]]);
}

Deno.test("a zip with no index.html at its root is refused", async () => {
  const result = await previewUpload(
    await zipOf([["chapter.html", "<p>one</p>"]]),
  );

  assert(!result.ok);
  assertStringIncludes(result.message, "index.html");
});

Deno.test("an index.html below the root does not count as the root one", async () => {
  const result = await previewUpload(
    await zipOf([["book/index.html", "<p>one</p>"]]),
  );

  assert(!result.ok);
  assertStringIncludes(result.message, "index.html");
});

Deno.test("a corrupt zip is refused", async () => {
  const result = await previewUpload(new Uint8Array([1, 2, 3, 4, 5]));

  assert(!result.ok);
  assertStringIncludes(result.message, "zip");
});

Deno.test("malformed HTML is accepted, because an HTML5 parser recovers", async () => {
  const preview = await previewOfHtml("<p>one<p>two</i></p>");

  assertEquals(preview.firstTwentySegments, ["one", "two"]);
});

Deno.test("any .html other than the root index.html is ignored", async () => {
  const preview = await previewOf([
    ["index.html", "<p>kept</p>"],
    ["chapter.html", "<p>ignored</p>"],
    ["nested/index.html", "<p>ignored</p>"],
  ]);

  assertEquals(preview.text, "kept");
});

Deno.test("an index.html over 10 MB is refused with a message naming the limit", async () => {
  const oversized = "a".repeat(HTML_BYTE_LIMIT + 1);

  const result = await previewUpload(await zipOf([["index.html", oversized]]));

  assert(!result.ok);
  assertStringIncludes(result.message, "10 MB");
});

Deno.test("an index.html at exactly 10 MB is accepted", async () => {
  const atTheLimit = "a".repeat(HTML_BYTE_LIMIT);

  const result = await previewUpload(await zipOf([["index.html", atTheLimit]]));

  assert(result.ok);
});

Deno.test("script, iframe, object and embed are stripped unconditionally", async () => {
  const preview = await previewOfHtml(
    `<p>text</p><script>alert(1)</script><iframe src="x"></iframe>` +
      `<object data="x"></object><embed src="x">`,
  );

  assertEquals(preview.removedTagCount, 4);
  assertEquals(preview.html.includes("script"), false);
  assertEquals(preview.html.includes("iframe"), false);
  assertEquals(preview.html.includes("object"), false);
  assertEquals(preview.html.includes("embed"), false);
});

Deno.test("a form and its inputs go together, counted once", async () => {
  const preview = await previewOfHtml(
    `<form action="/x"><label>Name<input name="n"></label>` +
      `<textarea></textarea><select><option>one</option></select>` +
      `<button>go</button></form><p>text</p>`,
  );

  assertEquals(preview.removedTagCount, 1);
  assertEquals(preview.html.includes("form"), false);
  assertEquals(preview.html.includes("input"), false);
  assertEquals(preview.text, "text");
});

Deno.test("a form control outside a form is stripped too", async () => {
  const preview = await previewOfHtml(
    `<p>text</p><input name="n"><fieldset><legend>l</legend></fieldset>` +
      `<datalist></datalist><output></output><optgroup></optgroup>`,
  );

  assertEquals(preview.removedTagCount, 5);
});

Deno.test("every on* attribute is removed", async () => {
  const preview = await previewOfHtml(
    `<p onclick="alert(1)" ONMOUSEOVER="alert(2)" id="one">text</p>`,
  );

  assertEquals(preview.html.includes("onclick"), false);
  assertEquals(preview.html.toLowerCase().includes("onmouseover"), false);
  assertEquals(preview.removedTagCount, 0);
});

Deno.test("the inline style attribute is removed", async () => {
  const preview = await previewOfHtml(`<p style="color:red">text</p>`);

  assertEquals(preview.html.includes("style"), false);
});

Deno.test("javascript: URLs are removed wherever they sit", async () => {
  const preview = await previewOfHtml(
    `<a href="javascript:alert(1)">one</a>` +
      `<blockquote cite="javascript:alert(3)">three</blockquote>`,
  );

  assertEquals(preview.html.includes("href"), false);
  assertEquals(preview.html.includes("cite"), false);
});

Deno.test("a scheme broken up by whitespace is still a javascript: URL", async () => {
  const preview = await previewOfHtml(
    `<a href="JAVA\tSCRIPT:alert(1)">one</a>` +
      `<a href="java\nscript:alert(2)">two</a>` +
      `<a href="  javascript:alert(3)">three</a>`,
  );

  assertEquals(preview.html.includes("href"), false);
});

Deno.test("a non-image data: URL is removed and an image one survives", async () => {
  const preview = await previewOfHtml(
    `<img src="data:image/png;base64,AAAA">` +
      `<img srcset="data:image/png;base64,AAAA 1x">` +
      `<a href="data:text/html,<b>x</b>">one</a>` +
      `<img srcset="data:text/html,x 1x">`,
  );

  assertEquals(preview.html.includes("data:image/png;base64,AAAA"), true);
  assertEquals(preview.html.includes("data:text/html"), false);
});

Deno.test("an ordinary link and image keep their references exactly", async () => {
  const preview = await previewOfHtml(
    `<a href="https://example.com/x">one</a><img src="images/fig1.png">`,
  );

  assertStringIncludes(preview.html, `href="https://example.com/x"`);
  assertStringIncludes(preview.html, `src="images/fig1.png"`);
});

Deno.test("style and link elements are removed and class and id survive", async () => {
  const preview = await previewOfHtml(
    `<link rel="stylesheet" href="book.css"><style>p{color:red}</style>` +
      `<p class="lead" id="one">text</p>`,
  );

  assertEquals(preview.removedTagCount, 2);
  assertStringIncludes(preview.html, `class="lead"`);
  assertStringIncludes(preview.html, `id="one"`);
  assertEquals(preview.html.includes("color:red"), false);
});

Deno.test("the Book's html, head and body do not survive", async () => {
  const preview = await previewOfHtml(
    `<html onmouseover="alert(1)" style="color:red"><head><title>t</title>` +
      `</head><body bgcolor="black"><p>text</p></body></html>`,
  );

  assertEquals(preview.html, "<p>text</p>");
});

Deno.test("the hash is stable across a re-zip of unchanged content", async () => {
  const entries: readonly Entry[] = [
    ["index.html", "<p>one</p>"],
    ["images/fig1.png", new Uint8Array([1, 2, 3])],
  ];

  const first = await previewOf(entries);
  const second = await previewOf(entries);

  assertEquals(first.hash, second.hash);
});

Deno.test("the hash does not depend on the order files sit in the zip", async () => {
  const forwards = await previewOf([
    ["index.html", "<p>one</p>"],
    ["images/fig1.png", new Uint8Array([1, 2, 3])],
  ]);
  const backwards = await previewOf([
    ["images/fig1.png", new Uint8Array([1, 2, 3])],
    ["index.html", "<p>one</p>"],
  ]);

  assertEquals(forwards.hash, backwards.hash);
});

Deno.test("the hash covers file content", async () => {
  const one = await previewOfHtml("<p>one</p>");
  const two = await previewOfHtml("<p>two</p>");

  assert(one.hash !== two.hash);
});

Deno.test("the hash covers file paths", async () => {
  const here = await previewOf([
    ["index.html", "<p>one</p>"],
    ["images/fig1.png", new Uint8Array([1])],
  ]);
  const there = await previewOf([
    ["index.html", "<p>one</p>"],
    ["images/fig2.png", new Uint8Array([1])],
  ]);

  assert(here.hash !== there.hash);
});

Deno.test("a .css file changes nothing about the hash", async () => {
  const without = await previewOf([["index.html", "<p>one</p>"]]);
  const with_ = await previewOf([
    ["index.html", "<p>one</p>"],
    ["book.CSS", "p{color:red}"],
  ]);

  assertEquals(without.hash, with_.hash);
});

Deno.test("the hash is taken before sanitisation", async () => {
  const sanitised = await previewOfHtml("<p>one</p>");
  const raw = await previewOfHtml("<p>one</p><script>alert(1)</script>");

  assert(sanitised.hash !== raw.hash);
});

Deno.test("a directory entry contributes nothing", async () => {
  const preview = await previewOf([
    ["index.html", "<p>one</p>"],
    ["images/", ""],
  ]);

  assertEquals(preview.text, "one");
});

Deno.test("every segment boundary starts a new segment", async () => {
  const preview = await previewOfHtml(
    `<h1>one</h1><h2>two</h2><h3>three</h3><h4>four</h4><h5>five</h5>` +
      `<h6>six</h6><p>seven</p><ul><li>eight</li></ul>` +
      `<blockquote>nine</blockquote><pre>ten</pre>` +
      `<figure><figcaption>eleven</figcaption></figure><div>twelve</div>`,
  );

  assertEquals(preview.firstTwentySegments, [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
  ]);
});

Deno.test("an inline element adds no space", async () => {
  const preview = await previewOfHtml("<p>wo<em>nd</em>er</p>");

  assertEquals(preview.text, "wonder");
});

Deno.test("a br contributes a space rather than starting a segment", async () => {
  const preview = await previewOfHtml("<p>one<br>two</p>");

  assertEquals(preview.firstTwentySegments, ["one two"]);
});

Deno.test("text around a nested boundary keeps its own segments", async () => {
  const preview = await previewOfHtml("<div>before<p>inside</p>after</div>");

  assertEquals(preview.firstTwentySegments, ["before", "inside", "after"]);
});

Deno.test("a table contributes no text at all", async () => {
  const preview = await previewOfHtml(
    "<p>one</p><table><tr><td><p>hidden</p></td></tr></table><p>two</p>",
  );

  assertEquals(preview.text, "one two");
});

Deno.test("entities are decoded before extraction", async () => {
  const preview = await previewOfHtml("<p>Bob&nbsp;&amp;&nbsp;Alice</p>");

  assertEquals(preview.text, "Bob & Alice");
});

Deno.test("each segment is collapsed and trimmed, and empty ones are dropped", async () => {
  const preview = await previewOfHtml(
    "<p>  one   \n  two  </p><p>   </p><p></p><p>three</p>",
  );

  assertEquals(preview.firstTwentySegments, ["one two", "three"]);
});

Deno.test("a comment contributes nothing", async () => {
  const preview = await previewOfHtml("<p>one<!-- hidden -->two</p>");

  assertEquals(preview.text, "onetwo");
});

Deno.test("the extracted text is every segment joined by a single space", async () => {
  const preview = await previewOfHtml("<p>one</p><p>two</p><p>three</p>");

  assertEquals(preview.text, "one two three");
});

Deno.test("only the first twenty segments come back, over the whole text", async () => {
  const paragraphs = Array.from(
    { length: 25 },
    (_unused, index) => `<p>${index}</p>`,
  ).join("");

  const preview = await previewOfHtml(paragraphs);

  assertEquals(preview.firstTwentySegments.length, 20);
  assertEquals(preview.firstTwentySegments.at(-1), "19");
  assertStringIncludes(preview.text, "24");
});

Deno.test("extraction runs over the sanitised tree", async () => {
  const preview = await previewOfHtml(
    "<p>kept</p><form><label>stripped</label></form>",
  );

  assertEquals(preview.text, "kept");
});
