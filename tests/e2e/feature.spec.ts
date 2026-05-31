import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

const SLOT_MS = 15_000;

test("alice claps for bob → bob's count syncs", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await a.waitForTimeout(800);

    await a.getByRole("button", { name: "start the contest", exact: true }).click();
    await a.waitForTimeout(500);

    await a.getByRole("button", { name: "clap for bob", exact: true }).click();
    await expect(b.locator('[data-contestant="bob"] .clap-count')).toContainText("1");
  } finally {
    await cleanup();
  }
});

/**
 * Load-bearing cross-peer assertion for the HEADLINE advertised mechanic:
 * "single-elimination popularity contest — lowest claps each round is out."
 * The original test only proved a clap count syncs; it never crossed a
 * 15-second mesh-slot boundary, so the round-advance + elimination logic
 * (the whole point of the app) was untested.
 *
 * Here: B (bob) claps for alice and nobody claps for bob, so when the mesh
 * clock crosses into round 2 the round-advance effect tallies round 1 and
 * eliminates the lowest contestant (bob). With two contestants that leaves a
 * single survivor, so the contest also transitions to "done" with alice as
 * winner. Every assertion is read on the OPPOSITE peer A — the elimination
 * status, the bracket history line, and the winner all have to cross the
 * Yjs mesh, not just live in one peer's React state.
 *
 * Driven by the real mesh-slot wall clock (no fake-time bridge), so it
 * exercises the exact production code path. We align to the start of a fresh
 * slot before clapping so the clap and the boundary-cross don't race.
 */
test("lowest-clap contestant is eliminated across the mesh and the survivor wins", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    // let both names propagate so startContest sees 2 contestants
    await expect(b.locator("[data-contestant]").first()).toBeHidden(); // still in lobby
    await a.waitForTimeout(1000);

    // Align to the start of a fresh slot so we have the full 15s window to
    // clap before the round-advance boundary fires.
    const msIntoSlot = await a.evaluate((slot) => Date.now() % slot, SLOT_MS);
    const msToNextSlot = SLOT_MS - msIntoSlot;
    if (msToNextSlot < 11_000) {
      // too little runway left in this slot — wait for the next one to begin
      await a.waitForTimeout(msToNextSlot + 300);
    }

    await a.getByRole("button", { name: "start the contest", exact: true }).click();

    // Both peers should now show two live contestants in round 1.
    await expect(a.locator('[data-contestant="bob"]')).toBeVisible();
    await expect(b.locator('[data-contestant="alice"]')).toBeVisible();
    await expect(a.locator(".clap-status")).toContainText("round 1");

    // B claps for alice; nobody claps for bob → bob is the round-1 loser.
    await b.getByRole("button", { name: "clap for alice", exact: true }).click();
    // Confirm the clap crossed the mesh into A before we let the slot roll.
    await expect(a.locator('[data-contestant="alice"] .clap-count')).toContainText("1");

    // Now ride the real mesh clock across the 15s slot boundary into round 2,
    // which triggers the round-advance/elimination effect on every peer.
    await expect(a.locator(".clap-bracket")).toContainText("bob eliminated", {
      timeout: 30_000,
    });

    // Read the elimination + winner on the OPPOSITE peer B as well: the
    // out-status (data-out) and the winner must have crossed Yjs, not just
    // rendered locally on A.
    await expect(b.locator('[data-contestant="bob"]')).toHaveAttribute("data-out", "1");
    await expect(b.locator(".clap-bracket")).toContainText("bob eliminated");
    await expect(b.locator(".clap-winner")).toContainText("alice");
    await expect(a.locator(".clap-winner")).toContainText("alice");
  } finally {
    await cleanup();
  }
});
