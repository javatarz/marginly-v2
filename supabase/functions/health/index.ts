import { jsonResponse } from "../_shared/http.ts";

/**
 * The one function the scaffolding deploys, so that the deploy path is exercised
 * before there is any product behaviour to deploy.
 */
Deno.serve(() => jsonResponse({ status: "ok" }));
