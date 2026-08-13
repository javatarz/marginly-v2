import { assertEquals } from "@std/assert";

import { type OpenThread, matchThreads } from "./match.ts";

function linkedThread(
  id: string,
  selected: string,
  paragraph: string,
  previousTextPosition: { start: number; end: number } = { start: 0, end: 0 },
): OpenThread {
  return {
    id,
    text: { selected, paragraph },
    previous: { status: "linked", textPosition: previousTextPosition },
  };
}

function unlinkedThread(
  id: string,
  selected: string | null,
  paragraph: string | null,
  previousThreadPosition: number,
): OpenThread {
  return {
    id,
    text: selected === null || paragraph === null
      ? null
      : { selected, paragraph },
    previous: { status: "unlinked", threadPosition: previousThreadPosition },
  };
}

Deno.test("one occurrence links, with the text's own range as the position", () => {
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps")],
    "the quick brown fox jumps",
  );

  assertEquals(result, {
    threadId: "t1",
    status: "linked",
    textPosition: { start: 10, end: 19 },
  });
});

Deno.test("no occurrence leaves the Thread Unlinked", () => {
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps")],
    "an entirely different sentence",
  );

  assertEquals(result.status, "unlinked");
});

Deno.test("several occurrences resolve to the one inside a paragraph that still matches", () => {
  const text =
    "intro. brown fox in the wrong place. later, the quick brown fox jumps, for real.";
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps")],
    text,
  );

  assertEquals(result.status, "linked");
  if (result.status === "linked") {
    assertEquals(
      text.slice(result.textPosition.start, result.textPosition.end),
      "brown fox",
    );
    assertEquals(result.textPosition.start > text.indexOf("wrong"), true);
  }
});

Deno.test("several occurrences with no matching paragraph leaves the Thread Unlinked", () => {
  const text = "brown fox here, and brown fox there too";
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps")],
    text,
  );

  assertEquals(result.status, "unlinked");
});

Deno.test("two indistinguishable candidates leave the Thread Unlinked", () => {
  const text =
    "the quick brown fox jumps here. the quick brown fox jumps there.";
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps")],
    text,
  );

  assertEquals(result.status, "unlinked");
});

Deno.test("a re-export that changes only whitespace keeps the Thread linked", () => {
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps")],
    "the   quick\nbrown   fox jumps",
  );

  assertEquals(result.status, "linked");
});

Deno.test("the resolved offset is never itself matched against", () => {
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps", {
      start: 999,
      end: 1005,
    })],
    "the quick brown fox jumps",
  );

  assertEquals(result, {
    threadId: "t1",
    status: "linked",
    textPosition: { start: 10, end: 19 },
  });
});

Deno.test("a passage cut then restored re-links, because Unlinked keeps its text", () => {
  const [result] = matchThreads(
    [unlinkedThread("t1", "brown fox", "the quick brown fox jumps", 3)],
    "the quick brown fox jumps",
  );

  assertEquals(result.status, "linked");
});

Deno.test("a deliberately unlinked Thread has discarded its text and stays Unlinked", () => {
  const [result] = matchThreads(
    [unlinkedThread("t1", null, null, 7)],
    "the quick brown fox jumps",
  );

  assertEquals(result, { threadId: "t1", status: "unlinked", threadPosition: 7 });
});

Deno.test("an Unlinked placement is the start of the previous linked text_position", () => {
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps", {
      start: 5,
      end: 14,
    })],
    "no match at all in this text",
  );

  assertEquals(result, { threadId: "t1", status: "unlinked", threadPosition: 5 });
});

Deno.test("an Unlinked placement carries the previous placement unchanged when it was already Unlinked", () => {
  const [result] = matchThreads(
    [unlinkedThread("t1", "brown fox", "the quick brown fox jumps", 12)],
    "still no match here",
  );

  assertEquals(result, { threadId: "t1", status: "unlinked", threadPosition: 12 });
});

Deno.test("a placement beyond the new text's length clamps to it, from a previous linked position", () => {
  const [result] = matchThreads(
    [linkedThread("t1", "brown fox", "the quick brown fox jumps", {
      start: 50,
      end: 59,
    })],
    "short",
  );

  assertEquals(result, { threadId: "t1", status: "unlinked", threadPosition: 5 });
});

Deno.test("a placement beyond the new text's length clamps to it, from a carried Unlinked position", () => {
  const [result] = matchThreads(
    [unlinkedThread("t1", "brown fox", "the quick brown fox jumps", 50)],
    "short",
  );

  assertEquals(result, { threadId: "t1", status: "unlinked", threadPosition: 5 });
});

Deno.test("several Open Threads are each matched independently", () => {
  const text = "the quick brown fox jumps over the lazy dog";
  const results = matchThreads(
    [
      linkedThread("t1", "brown fox", "the quick brown fox jumps"),
      linkedThread("t2", "lazy dog", "over the lazy dog"),
      linkedThread("t3", "not present anywhere", "not present anywhere"),
    ],
    text,
  );

  assertEquals(results.map((result) => result.threadId), ["t1", "t2", "t3"]);
  assertEquals(results[0].status, "linked");
  assertEquals(results[1].status, "linked");
  assertEquals(results[2].status, "unlinked");
});

Deno.test("no Open Threads produces no results", () => {
  assertEquals(matchThreads([], "any text"), []);
});
