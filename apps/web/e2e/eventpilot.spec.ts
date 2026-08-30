import { expect, test } from "@playwright/test";

test("discovers markets and evaluates an explicit strategy snapshot", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Build it\. Simulate it\./ })).toBeVisible();
  await expect(page.getByText("Shannon testnet", { exact: true })).toBeVisible();
  await expect(page.getByText("Deterministic fixture")).toBeVisible();
  await expect(page.getByText("BTC direction", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Use market" }).first().click();
  await page.getByRole("button", { name: "Evaluate now" }).click();
  await expect(page.getByText(/Eligible|Skipped/, { exact: true })).toBeVisible();
  await expect(page.getByText("Inspect every guard")).toBeVisible();
});

test("paper mode remains browser-local and records honest snapshot language", async ({ page }) => {
  let adminCalls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/v1/admin/")) adminCalls += 1;
  });
  await page.goto("/");
  await expect(page.getByText("Deterministic fixture")).toBeVisible();
  await expect(page.getByText("BTC direction", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Paper run" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(
    page
      .getByText(
        /Would submit at this snapshot|Snapshot is inside|Market has enough|Best ask satisfies/,
      )
      .first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Strategy cooldown is still active.").first()).toBeVisible({
    timeout: 7_000,
  });
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("paused", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("stopped", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Paper run" }).click();
  await expect(page.getByText("Would submit at this snapshot.").first()).toBeVisible();
  expect(adminCalls).toBe(0);
});

test("public demo runner and evidence console expose honest empty states", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Deterministic fixture")).toBeVisible();
  await page.getByRole("button", { name: "Demo runner" }).click();
  await expect(page.getByText("Public controls disabled")).toBeVisible();
  await expect(page.getByText("No persisted runner activity yet.")).toBeVisible();

  await page.getByRole("button", { name: "Evidence" }).click();
  await expect(page.getByText("Evidence Console")).toBeVisible();
  await expect(
    page.getByText(/Verified transaction evidence is still an external acceptance gate/),
  ).toBeVisible();
});

test("strategy policies export and unsupported imports fail visibly", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Deterministic fixture")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("eventpilot-strategy-v1.json");

  const savedStrategy = await page.evaluate(() => localStorage.getItem("eventpilot.strategy.v1"));
  expect(savedStrategy).not.toBeNull();
  const importedStrategy = JSON.parse(savedStrategy ?? "{}") as Record<string, unknown>;
  importedStrategy.name = "Imported judge policy";
  const validChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import" }).click();
  const validChooser = await validChooserPromise;
  await validChooser.setFiles({
    name: "judge-strategy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(importedStrategy)),
  });
  await expect(page.getByLabel("Policy name")).toHaveValue("Imported judge policy");
  await page.reload();
  await expect(page.getByLabel("Policy name")).toHaveValue("Imported judge policy");

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "unsupported-strategy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ version: "2" })),
  });
  await expect(page.getByText("Evaluation unavailable")).toBeVisible();
});

test("corrupt paper history is removed instead of trusted", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("eventpilot.paper.v1", JSON.stringify([{ fabricated: true }]));
  });
  await page.goto("/");
  await expect(page.getByText("Local state recovered safely")).toBeVisible();
  await expect(page.getByText(/paper history was removed/i)).toBeVisible();
  await page.getByRole("button", { name: "Paper run" }).click();
  await expect(page.getByText("No paper decisions yet.")).toBeVisible();
});
