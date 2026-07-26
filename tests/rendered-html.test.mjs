import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

test("builds the Barkoff online arena", async () => {
  const [page, layout, worker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    access(new URL("../dist/server/index.js", import.meta.url)),
  ]);
  assert.equal(worker, undefined);
  assert.match(layout, /Barkoff — Real People\. Real Barks\. One Top Dog\./i);
  assert.match(page, /BARK/);
  assert.match(page, /PROVE YOU/);
  assert.match(page, /FIND A LIVE RIVAL/);
  assert.match(page, /WORLDWIDE 1V1 MATCHMAKING/);
  assert.doesNotMatch(page, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships the finished product instead of starter preview assets", async () => {
  const [page, layout, arena, css, packageJson, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/arena/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /getUserMedia/);
  assert.match(page, /RTCPeerConnection/);
  assert.match(page, /onicecandidate/);
  assert.match(page, /AudioContext/);
  assert.match(page, /localStorage/);
  assert.match(page, /leaderboard/);
  assert.match(arena, /match_queue/);
  assert.match(arena, /signals/);
  assert.match(arena, /maybeFinalize/);
  assert.match(layout, /Real People\. Real Barks\. One Top Dog/);
  assert.match(layout, /og\.png/);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});
