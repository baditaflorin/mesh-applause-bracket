import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

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
