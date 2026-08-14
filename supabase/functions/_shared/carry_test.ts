import { assertEquals } from "@std/assert";

import { toOpenThreads } from "./carry.ts";

Deno.test("a linked row becomes an OpenThread with its previous text_position as a range", () => {
  const [thread] = toOpenThreads([
    {
      thread_id: "t1",
      selected_text: "brown fox",
      paragraph_text: "the quick brown fox jumps",
      status: "linked",
      text_position_start: 10,
      text_position_end: 19,
      thread_position: null,
    },
  ]);

  assertEquals(thread, {
    id: "t1",
    text: { selected: "brown fox", paragraph: "the quick brown fox jumps" },
    previous: { status: "linked", textPosition: { start: 10, end: 19 } },
  });
});

Deno.test("an unlinked row becomes an OpenThread with its previous thread_position", () => {
  const [thread] = toOpenThreads([
    {
      thread_id: "t2",
      selected_text: "brown fox",
      paragraph_text: "the quick brown fox jumps",
      status: "unlinked",
      text_position_start: null,
      text_position_end: null,
      thread_position: 7,
    },
  ]);

  assertEquals(thread, {
    id: "t2",
    text: { selected: "brown fox", paragraph: "the quick brown fox jumps" },
    previous: { status: "unlinked", threadPosition: 7 },
  });
});

Deno.test("several rows map independently, in order", () => {
  const threads = toOpenThreads([
    {
      thread_id: "t1",
      selected_text: "a",
      paragraph_text: "a paragraph",
      status: "linked",
      text_position_start: 0,
      text_position_end: 1,
      thread_position: null,
    },
    {
      thread_id: "t2",
      selected_text: "b",
      paragraph_text: "b paragraph",
      status: "unlinked",
      text_position_start: null,
      text_position_end: null,
      thread_position: 3,
    },
  ]);

  assertEquals(threads.map((thread) => thread.id), ["t1", "t2"]);
});

Deno.test("no rows produces no Open Threads", () => {
  assertEquals(toOpenThreads([]), []);
});

Deno.test("a deliberately Unlinked row carries no matching text (#35)", () => {
  const [thread] = toOpenThreads([
    {
      thread_id: "t3",
      selected_text: null,
      paragraph_text: null,
      status: "unlinked",
      text_position_start: null,
      text_position_end: null,
      thread_position: 4,
    },
  ]);

  assertEquals(thread, {
    id: "t3",
    text: null,
    previous: { status: "unlinked", threadPosition: 4 },
  });
});
