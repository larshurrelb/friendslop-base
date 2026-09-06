import { test, expect } from "@playwright/test";
test("production assets and both same-port sockets work in Chrome", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.locator("#hud")).toBeVisible();
  const code = await page.locator("#room-code").textContent();
  const friend = await context.newPage();
  let received = 0;
  friend.on("websocket", (ws) => {
    if (ws.url().endsWith("/voice"))
      ws.on("framereceived", (e) => {
        if (typeof e.payload !== "string") received++;
      });
  });
  friend.on("pageerror", (e) => errors.push(e.message));
  await friend.goto(`/?room=${code}&wasm=1`);
  await expect(friend.locator("#loading")).toBeHidden();
  await friend.getByRole("button", { name: "Join →", exact: true }).click();
  await expect(page.locator("#player-count")).toHaveText("2 / 8");
  for (const p of [page, friend]) {
    await p.getByRole("button", { name: "Enable voice", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Audio on", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(page.locator("#peer-debug")).toContainText("P2P · DIRECT", {
    timeout: 20000,
  });

  await page.getByRole("button", { name: "Force relay", exact: true }).click();
  await expect(page.locator("#peer-debug")).toContainText("Relayed · RELAY");
  await friend.getByRole("button", { name: "Diagnostics" }).click();
  await expect(friend.locator("#peer-debug")).toContainText("Relayed · RELAY");
  await expect(friend.locator("#codec-status")).toContainText("WASM Opus");
  await expect.poll(() => received).toBeGreaterThan(20);
  await page.getByRole("button", { name: "Allow P2P", exact: true }).click();
  await expect(page.locator("#peer-debug")).toContainText("P2P · DIRECT", {
    timeout: 45000,
  });
  expect(
    requests.filter(
      (u) => u.startsWith("http") && !u.startsWith("http://localhost:3001/"),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => typeof (window as any).__friendslop)).toBe(
    "undefined",
  );
});
