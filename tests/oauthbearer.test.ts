import test from "node:test";
import assert from "node:assert/strict";
import { OAuthBearerMechanism } from "../src/xmpp/oauthbearer.js";

test("oauthbearer formats token payload", () => {
  const mech = new OAuthBearerMechanism();
  const response = mech.response({ token: "token-123", username: "user-1" });
  assert.match(response, /^n,a=user-1,/);
  assert.match(response, /auth=Bearer token-123/);
  assert.ok(response.endsWith("\u0001\u0001"));
});
