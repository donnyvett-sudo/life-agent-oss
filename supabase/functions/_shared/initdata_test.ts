import { assertEquals } from "jsr:@std/assert@1";
import { signInitData, verifyInitData } from "./initdata.ts";

const TOKEN = "123:test-token";

async function make(fields: Record<string, string>) {
  const hash = await signInitData(fields, TOKEN);
  return new URLSearchParams({ ...fields, hash }).toString();
}

Deno.test("valid initData", async () => {
  const init = await make({
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "AAA",
    user: JSON.stringify({ id: 42, first_name: "X" }),
  });
  assertEquals((await verifyInitData(init, TOKEN))?.id, 42);
});

Deno.test("tampered / wrong token / expired", async () => {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42 }),
  };
  const init = await make(fields);
  assertEquals(await verifyInitData(init.replace("42", "43"), TOKEN), null);
  assertEquals(await verifyInitData(init, "123:other"), null);
  const old = await make({ ...fields, auth_date: "1000" });
  assertEquals(await verifyInitData(old, TOKEN), null);
});
