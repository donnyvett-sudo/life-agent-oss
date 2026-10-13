import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { inviteLink, newCode, parseInvitePayload } from "./invites.ts";

Deno.test("parseInvitePayload: код из ссылки, регистр не важен", () => {
  assertEquals(parseInvitePayload("/start inv_ABCD1234"), "ABCD1234");
  assertEquals(parseInvitePayload("/start inv_abcd1234"), "ABCD1234");
  assertEquals(parseInvitePayload("/start@example_bot inv_ABCD1234"), "ABCD1234");
});

Deno.test("parseInvitePayload: чужие приставки и голый /start", () => {
  assertEquals(parseInvitePayload("/start"), null);
  assertEquals(parseInvitePayload("/start cards"), null);
  assertEquals(parseInvitePayload("/start inv_"), null);
  assertEquals(parseInvitePayload("написал inv_ABCD1234"), null);
});

Deno.test("newCode: восемь символов без похожих друг на друга", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const c = newCode();
    assertMatch(c, /^[ACDEFGHJKLMNPQRTUVWXY2346789]{8}$/);
    codes.add(c);
  }
  assert(codes.size > 45, "коды должны различаться");
});

Deno.test("inviteLink: ссылка разбирается обратно", () => {
  const code = newCode();
  const payload = inviteLink(code).split("?start=")[1];
  assertEquals(parseInvitePayload(`/start ${payload}`), code);
});
