import assert from "node:assert/strict";
import { buildSessionScope } from "../src/server/sessionScope";

{
  const scope = buildSessionScope({
    loginId: "master",
    canonicalLoginId: "master",
  });

  assert.equal(scope.isMaster, true);
  assert.equal(scope.canControlAccounts, true);
  assert.deepEqual(scope.userIds, ["login:admin", "login:ops2"]);
}

{
  const scope = buildSessionScope({
    loginId: "hasun",
    canonicalLoginId: "admin",
  });

  assert.equal(scope.isMaster, false);
  assert.equal(scope.canControlAccounts, false);
  assert.deepEqual(scope.userIds, ["login:admin"]);
}

{
  const scope = buildSessionScope({
    loginId: "ops2",
    canonicalLoginId: "ops2",
  });

  assert.equal(scope.isMaster, false);
  assert.equal(scope.canControlAccounts, false);
  assert.deepEqual(scope.userIds, ["login:ops2"]);
}

console.log("sessionScope tests passed");
