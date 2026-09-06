import { test } from "node:test";
import assert from "node:assert/strict";
import { linkedChannels } from "../src/net/loopback.js";
import { bridgeToWorker, bridgeFromMain } from "../src/net/worker-bridge.js";
import { createHost } from "../src/host/index.js";
import { safeToken } from "../src/net/channel.js";

const settle = () => new Promise((r) => setTimeout(r, 0));
async function until(predicate: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Timed out");
}

test("linked channels carry both directions and close together", async () => {
  const [a, b] = linkedChannels();
  const seen: unknown[] = [];
  b.onmessage = (d) => seen.push(d);
  const closed: string[] = [];
  a.onclose = () => closed.push("a");
  b.onclose = () => closed.push("b");
  a.send("hello");
  a.send(new Uint8Array([1, 2, 3]).buffer);
  await settle();
  assert.equal(seen.length, 2);
  assert.equal(seen[0], "hello");
  assert.ok(seen[1] instanceof ArrayBuffer);
  assert.equal(a.open, true);
  b.close();
  await settle();
  assert.equal(a.open, false);
  assert.deepEqual(closed.sort(), ["a", "b"]);
});

test("safeToken compares without leaking on length or content", () => {
  assert.equal(safeToken("abcd", "abcd"), true);
  assert.equal(safeToken("abcd", "abce"), false);
  assert.equal(safeToken("abcd", "abcde"), false);
  assert.equal(safeToken("", ""), true);
});

test("a browser host serves join, membership and snapshots over a loopback", async () => {
  const host = await createHost({ maxRooms: 2 });
  try {
    const room = host.ensureRoom("TESTAB");
    assert.equal(room.code, "TESTAB");

    const open = (name: string) => {
      const [mine, theirs] = linkedChannels();
      host.accept(theirs, "game");
      const json: any[] = [];
      let snapshots = 0;
      mine.onmessage = (d) =>
        typeof d === "string" ? json.push(JSON.parse(d)) : snapshots++;
      mine.send(JSON.stringify({ type: "join", name, code: "TESTAB" }));
      return {
        json,
        get snapshots() {
          return snapshots;
        },
      };
    };

    const first = open("Ada");
    await until(() => first.json.some((m) => m.type === "welcome"));
    const welcome = first.json.find((m) => m.type === "welcome");
    assert.equal(welcome.code, "TESTAB");
    assert.equal(welcome.id, 1);
    assert.ok(welcome.token && welcome.ticket);

    const second = open("Grace");
    await until(() => second.json.some((m) => m.type === "welcome"));
    await until(() =>
      first.json.some(
        (m) => m.type === "members" && m.members.length === 2,
      ),
    );
    const members = first.json.filter((m) => m.type === "members").at(-1);
    assert.deepEqual(
      members.members.map((m: any) => m.name),
      ["Ada", "Grace"],
    );
    // Distinct clothing colours, as the server-mode suite also asserts.
    assert.equal(new Set(members.members.map((m: any) => m.color)).size, 2);

    // The tick loop must actually be running in this environment.
    await until(() => first.snapshots > 0 && second.snapshots > 0);
  } finally {
    host.dispose();
  }
});

test("the worker bridge proxies a channel across a postMessage boundary", async () => {
  // Stand in for a Worker: whatever the main side posts, hand to the worker side.
  const fromWorker: any[] = [];
  let toWorkerHandler: (m: any) => void = () => {};
  const fake = {
    postMessage: (m: any) => toWorkerHandler(m),
    addEventListener: (_t: string, fn: any) => (deliver = fn),
    terminate: () => {},
  } as unknown as Worker;
  let deliver: any = () => {};
  const bridge = bridgeToWorker(fake);
  const accepted: { data: unknown[] }[] = [];
  toWorkerHandler = bridgeFromMain(
    (channel) => {
      const record = { data: [] as unknown[] };
      accepted.push(record);
      channel.onmessage = (d) => {
        record.data.push(d);
        channel.send("ack:" + d);
      };
    },
    (m) => {
      fromWorker.push(m);
      deliver({ data: m });
    },
  );

  const [mine, theirs] = linkedChannels();
  const replies: unknown[] = [];
  mine.onmessage = (d) => replies.push(d);
  bridge.attach(theirs, "game");
  mine.send("ping");
  await until(() => replies.length > 0);
  assert.deepEqual(accepted[0].data, ["ping"]);
  assert.deepEqual(replies, ["ack:ping"]);
  bridge.dispose();
});
