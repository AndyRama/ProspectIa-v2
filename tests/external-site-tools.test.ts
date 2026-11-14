import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as module from "../client/src/externalSiteTools";
test("external site links normalize a public path and omit query/fragment; Wappalyzer gets only hostname", () => {
  assert.ok(module?.externalSiteTools, "externalSiteTools helper must exist");
  const tools = module.externalSiteTools(" https://WWW.Atelier-Fixture.fr:443/services/été?token=secret#private ");
  assert.ok(tools);
  const psi = new URL(tools.pagespeed);
  assert.equal(psi.origin + psi.pathname, "https://pagespeed.web.dev/analysis");
  assert.deepEqual([...psi.searchParams], [["url", "https://www.atelier-fixture.fr/services/%C3%A9t%C3%A9"]]);
  assert.equal(tools.wappalyzer, "https://www.wappalyzer.com/lookup/www.atelier-fixture.fr/");
});

test("external tools reject credentials, local/private and malformed targets before constructing any provider href", () => {
  assert.ok(module?.externalSiteTools);
  const rejected = [
    "", " ", "not a url", "atelier-fixture.fr", "//atelier-fixture.fr", "ftp://atelier-fixture.fr", "javascript:alert(1)", "data:text/html,secret",
    "https://user:secret@atelier-fixture.fr/path", "https://user@atelier-fixture.fr", "http://localhost", "http://sub.localhost", "http://localhost.", "http://printer", "http://printer.local", "http://app.internal", "http://router.lan", "http://router.home", "http://app.test", "http://app.invalid", "http://app.onion",
    "http://127.0.0.1", "http://127.1", "http://2130706433", "http://0x7f000001", "http://0177.0.0.1", "http://0.0.0.0", "http://10.0.0.1", "http://172.16.0.1", "http://172.31.255.255", "http://192.168.1.1", "http://169.254.169.254", "http://100.64.0.1", "http://198.18.0.1", "http://224.0.0.1", "http://255.255.255.255",
    "http://[::1]", "http://[::]", "http://[fc00::1]", "http://[fd00::1]", "http://[fe80::1]", "http://[::ffff:127.0.0.1]", "http://[::ffff:192.168.1.1]",
    "https://bad_host.fr", "https://-bad.fr", "https://bad-.fr", "https://a..fr", "https://atelier-fixture.fr:8080/path",
  ];
  for (const website of rejected) assert.equal(module.externalSiteTools(website), null, website);
});

test("public DNS names retain normalized paths, including HTTP, IDN and trailing-dot names", () => {
  for (const [input, target, hostname] of [
    ["http://ATELIER-fixture.fr:80/contact?a=secret#hidden", "http://atelier-fixture.fr/contact", "atelier-fixture.fr"],
    ["https://atelier-fixture.fr./services/../contact", "https://atelier-fixture.fr/contact", "atelier-fixture.fr"],
    ["https://café.fr/menu", "https://xn--caf-dma.fr/menu", "xn--caf-dma.fr"],
  ]) {
    const links = module.externalSiteTools(input);
    assert.ok(links, input);
    assert.equal(new URL(links.pagespeed).searchParams.get("url"), target);
    assert.equal(links.wappalyzer, `https://www.wappalyzer.com/lookup/${encodeURIComponent(hostname)}/`);
  }
});

test("controls 1, 3 and 4 retain their exact baseline handlers and drawer markup", async () => {
  const source = await readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8");
  // Immutable hashes extracted from 84b4d8f before editing these unchanged regions.
  for (const [start, end, expected] of [
    ["  const checkSite =", "  const externalSiteActions =", "b63eedb211813791ddd32f84ae266ad51d61e1bec6d9219d2e39faa25a6d03f0"],
    ["  const generate =", "  if (!state)", "84990e441331c59f364efa2c51be6f98ee613c8cef48bd376607b709d6d0d03f"],
    ['            <div className="drawer-actions">', '          </aside>', "955ab9230a674592632229beff36b5e94ea27fe64d1d3903e5893887aaff6e67"],
  ]) {
    const from = source.indexOf(start), to = source.indexOf(end, from);
    assert.ok(from >= 0 && to > from, start);
    assert.equal(createHash("sha256").update(source.slice(from, to)).digest("hex"), expected, start);
  }
  assert.doesNotMatch(source, /api\(`\/prospects\/\$\{opened\.id\}\/analyze`/);
});
