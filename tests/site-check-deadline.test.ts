import { test, mock } from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { readPublic } from "../server/services/http";
import { inspectSite } from "../server/services/siteAnalyzer";

test("total signal bounds DNS resolution without issuing a late request", { timeout: 300 }, async () => {
  const original = globalThis.fetch; let calls = 0;
  let release!: (value: any) => void;
  const lookup = mock.method(dns, "lookup", () => new Promise(resolve => { release = resolve; }));
  syncBuiltinESMExports();
  globalThis.fetch = async () => { calls++; throw Error("forbidden"); };
  try {
    await assert.rejects(readPublic("https://fixture.invalid", { signal: AbortSignal.timeout(25) }), /timeout|abort/i);
    release([{ address: "93.184.216.34", family: 4 }]);
    await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(calls, 0);
  } finally { lookup.mock.restore(); globalThis.fetch = original; }
});
test("one total budget covers redirect chain and body, canceling the reader", { timeout: 300 }, async () => {
  const original = globalThis.fetch; let calls = 0, canceled = false, signal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, init) => {
    calls++; signal = init?.signal;
    if (calls === 1) { await new Promise(resolve => setTimeout(resolve, 15)); return new Response(null, { status: 302, headers: { location: "/home" } }); }
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("<html>")); }, cancel() { canceled = true; } }), { headers: { "content-type": "text/html" } });
  };
  try {
    await assert.rejects(readPublic("https://93.184.216.34", { signal: AbortSignal.timeout(40) }), /timeout|abort/i);
    assert.equal(calls, 2); assert.equal(signal?.aborted, true); assert.equal(canceled, true);
  } finally { globalThis.fetch = original; }
});
test("inspectSite passes cancellation through to readPublic fetch", { timeout: 300 }, async () => {
  const original = globalThis.fetch; let canceled = false;
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => { canceled = true; reject(init.signal!.reason); }, { once: true });
  });
  try {
    await assert.rejects(inspectSite("https://93.184.216.34", { signal: AbortSignal.timeout(25) }), /timeout|abort/i);
    assert.equal(canceled, true);
  } finally { globalThis.fetch = original; }
});
// Keep the event loop alive while AbortSignal.timeout's unref'ed timers run.
const keepAlive = setInterval(() => {}, 1000);
import { after } from "node:test";
after(() => clearInterval(keepAlive));
