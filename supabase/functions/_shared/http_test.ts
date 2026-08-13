import { assertEquals } from "@std/assert";

import { jsonResponse } from "./http.ts";

Deno.test("a JSON response carries its body and a JSON content type", async () => {
  const response = jsonResponse({ status: "ok" });

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "application/json");
  assertEquals(await response.json(), { status: "ok" });
});

Deno.test("a JSON response can take a status of its own", async () => {
  const response = jsonResponse({ status: "ok" }, 201);

  assertEquals(response.status, 201);
  await response.body?.cancel();
});
