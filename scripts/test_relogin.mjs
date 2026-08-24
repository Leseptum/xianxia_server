#!/usr/bin/env node
// Regression test for the relogin bug found & fixed in spacetimedb/Lib.cs
// (see CLAUDE.md / the PlayerSession table): before that fix, logging in as
// an existing player from a *different* connection/Identity (a new browser
// tab, a cleared session, a different device - exactly what this script
// simulates with two separate DbConnections) would report success, but every
// subsequent action reducer (update_position/qi_sammeln/durchbruch) silently
// no-op'd, because they resolved the acting player from the raw connecting
// Identity's hash rather than from whichever account Login actually
// authenticated. That's not expressible via `spacetime call` (the CLI has no
// way to reuse a specific non-default identity across calls - see
// scripts/smoketest.sh's header comment) so it needs a real second WebSocket
// connection/Identity, i.e. this script.
//
// Usage: node scripts/test_relogin.mjs
// Always targets the local dev instance (ws://localhost:3000) - this is a
// dev-iteration regression check, not something to run against maincloud.

import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkPath = join(__dirname, "..", "web_client", "node_modules", "spacetimedb", "dist", "index.mjs");

const {
  DbConnectionImpl,
  DbConnectionBuilder,
  SubscriptionBuilderImpl,
  t,
  table,
  schema,
  reducerSchema,
  reducers: reducersHelper,
  procedures: proceduresHelper,
} = await import(sdkPath);

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const PlayerRow = t.row({
  playerId: t.u64().primaryKey().name("player_id"),
  name: t.string(),
  qi: t.u64(),
  qiMaximum: t.u64().name("qi_maximum"),
  stufe: t.u8(),
  posX: t.f32().name("pos_x"),
  posY: t.f32().name("pos_y"),
});
const LoginAttemptRow = t.row({
  playerId: t.u64().primaryKey().name("player_id"),
  success: t.bool(),
});

const tablesSchema = schema({
  player: table({ name: "player" }, PlayerRow),
  loginAttempt: table({ name: "login_attempt" }, LoginAttemptRow),
});
const reducersSchema = reducersHelper(
  reducerSchema("register", { name: t.string(), passwordHash: t.string() }),
  reducerSchema("login", { name: t.string(), passwordHash: t.string() }),
  reducerSchema("qi_sammeln", {}),
  reducerSchema("durchbruch", {}),
  reducerSchema("update_position", { x: t.f32(), y: t.f32() }),
);
const proceduresSchema = proceduresHelper();
const REMOTE_MODULE = {
  versionInfo: { cliVersion: "2.7.0" },
  tables: tablesSchema.schemaType.tables,
  reducers: reducersSchema.reducersType.reducers,
  ...proceduresSchema,
};

class DbConnection extends DbConnectionImpl {
  static builder() {
    return new DbConnectionBuilder(REMOTE_MODULE, (config) => new DbConnection(config));
  }
  subscriptionBuilder() {
    return new SubscriptionBuilderImpl(this);
  }
}

let pass = 0;
let fail = 0;
function ok(msg) {
  pass++;
  console.log(`  OK: ${msg}`);
}
function bad(msg) {
  fail++;
  console.error(`  FAIL: ${msg}`);
}
function assertEqual(actual, expected, msg) {
  if (actual === expected) ok(`${msg} (${actual})`);
  else bad(`${msg}: expected ${expected}, got ${actual}`);
}

async function openConnection() {
  let conn;
  await new Promise((resolve, reject) => {
    conn = DbConnection.builder()
      .withUri("ws://localhost:3000")
      .withDatabaseName("xianxia")
      // No withToken(): every call gets a brand-new Identity, simulating a
      // fresh browser tab / cleared sessionStorage / a different device.
      .onConnect(() => resolve())
      .onConnectError((_ctx, err) => reject(err))
      .build();
  });
  await new Promise((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError((ctx) => reject(new Error(`subscription error: ${JSON.stringify(ctx.event)}`)))
      .subscribe(["SELECT * FROM player", "SELECT * FROM login_attempt"]);
  });
  return conn;
}

function findPlayer(conn, name) {
  for (const row of conn.db.player.iter()) if (row.name === name) return row;
  return undefined;
}

function findLoginAttempt(conn, playerId) {
  for (const row of conn.db.loginAttempt.iter()) if (row.playerId === playerId) return row;
  return undefined;
}

const name = `relogin_test_${Date.now()}`;
const password = "testpass123";
const passwordHash = sha256Hex(password);

console.log(`=== 1. Connection A registers '${name}' and collects Qi ===`);
const connA = await openConnection();
await connA.reducers.register({ name, passwordHash });
let rowA = findPlayer(connA, name);
if (!rowA) {
  bad("register did not create a player row - aborting");
  process.exit(1);
}
ok(`registered, playerId=${rowA.playerId}, qi=${rowA.qi}`);

await connA.reducers.qiSammeln({});
rowA = findPlayer(connA, name);
assertEqual(rowA.qi, 10n, "qi_sammeln on the registering connection increments qi");

console.log(`\n=== 2. Connection B (fresh identity) logs in as '${name}' - the relogin ===`);
const connB = await openConnection();
await connB.reducers.login({ name, passwordHash });
const rowB = findPlayer(connB, name);
if (!rowB) {
  bad("connection B cannot see the player row after login - aborting");
  process.exit(1);
}
const attempt = findLoginAttempt(connB, rowB.playerId);
if (attempt?.success) ok("login_attempt.success is true for connection B");
else bad(`login_attempt.success expected true, got ${attempt?.success}`);
assertEqual(rowB.playerId, rowA.playerId, "connection B sees the same playerId as A");
assertEqual(rowB.qi, 10n, "connection B sees A's qi=10 (state is shared, only the acting identity differs)");

console.log("\n=== 3. Connection B acts on the account it just logged into (the actual bug) ===");
await connB.reducers.qiSammeln({});
await new Promise((r) => setTimeout(r, 200));
let rowB2 = findPlayer(connB, name);
assertEqual(rowB2.qi, 20n, "qi_sammeln on connection B (post-relogin) actually increments qi");

await connB.reducers.updatePosition({ x: 129, y: 128 });
await new Promise((r) => setTimeout(r, 200));
rowB2 = findPlayer(connB, name);
if (rowB2.posX === 129 && rowB2.posY === 128) ok(`update_position on connection B moved the player to (129, 128)`);
else bad(`update_position on connection B: expected (129, 128), got (${rowB2.posX}, ${rowB2.posY})`);

console.log("\n=== 4. durchbruch on connection B (drain qi to max, retry until success) ===");
const stufeBefore = rowB2.stufe;
let success = false;
for (let i = 0; i < 40 && !success; i++) {
  while (rowB2.qi < rowB2.qiMaximum) {
    await connB.reducers.qiSammeln({});
    rowB2 = findPlayer(connB, name);
  }
  await connB.reducers.durchbruch({});
  await new Promise((r) => setTimeout(r, 50));
  rowB2 = findPlayer(connB, name);
  if (rowB2.stufe > stufeBefore) success = true;
}
if (success) ok(`durchbruch on connection B succeeded: stufe ${stufeBefore} -> ${rowB2.stufe}`);
else bad(`durchbruch on connection B never succeeded after 40 retries (extraordinarily unlikely, or a real bug)`);

console.log(`\n=== Summary: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
