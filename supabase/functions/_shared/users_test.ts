import { assert, assertFalse } from "jsr:@std/assert@1";
import { tokenShaped } from "./users.ts";

Deno.test("tokenShaped: пустые, короткие и огромные токены в базу не идут", () => {
  assertFalse(tokenShaped(null));
  assertFalse(tokenShaped(undefined));
  assertFalse(tokenShaped(""));
  assertFalse(tokenShaped("a".repeat(31)));
  assertFalse(tokenShaped("a".repeat(201)));
  assert(tokenShaped("a".repeat(32)));
  assert(tokenShaped("f".repeat(64)));
});
