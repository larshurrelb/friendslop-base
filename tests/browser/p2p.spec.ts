import { test, expect, type Page } from "@playwright/test";

// These run against the same dev server as the server-mode suite; ?net=p2p
// forces browser hosting, and the local broker from tools/broker.ts brokers it.
const state = (page: Page) =>
  page.evaluate(() => (window as any).__friendslop.state);

async function host(page: Page, name: string) {
  await page.goto("/?test=1&net=p2p");
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.locator("#hud")).toBeVisible({ timeout: 30000 });
  return (await page.locator("#room-code").textContent())!;
}
async function guest(page: Page, code: string, name: string) {
  await page.goto(`/?test=1&fresh=1&net=p2p&room=${code}`);
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join →", exact: true }).click();
  await expect(page.locator("#hud")).toBeVisible({ timeout: 30000 });
}

test("a browser hosts a room and a peer joins, moves and is seen", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const code = await host(page, "Keeper");
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  // The host is a player like any other: it joined its own authority.
  expect((await state(page)).id).toBe(1);

  const friend = await context.newPage();
  await guest(friend, code, "Visitor");
  await expect(page.locator("#player-count")).toHaveText("2 / 8");
  await expect(friend.locator("#player-count")).toHaveText("2 / 8");

  // The guest's inputs are authoritative only via the host's simulation.
  const before = await state(friend);
  await friend.evaluate(() => (window as any).__friendslop.input("KeyW", true));
  await expect
    .poll(async () => (await state(friend)).z, { timeout: 15000 })
    .toBeLessThan(before.z - 2);
  await friend.evaluate(() =>
    (window as any).__friendslop.input("KeyW", false),
  );

  // ...and the host renders that movement from its own snapshots.
  const friendId = (await state(friend)).id;
  await expect
    .poll(
      async () =>
        await page.evaluate(
          (id) =>
            (window as any).__friendslop.scene.avatars.get(id)?.root.position
              .z ?? 0,
          friendId,
        ),
      { timeout: 15000 },
    )
    .toBeLessThan(before.z - 1);

  await page.screenshot({ path: "test-results/p2p-host.png" });
  expect(errors).toEqual([]);
});

test("the host keeps serving while another tab is in front", async ({
  page,
  context,
}) => {
  // NOTE: this does NOT prove a backgrounded host survives timer throttling.
  // playwright.config.ts passes --disable-background-timer-throttling and
  // --disable-renderer-backgrounding, so the throttling this architecture
  // worries about cannot occur here. It only shows the authority is not
  // coupled to the host tab being the focused one. Background-host behaviour
  // is unverified — see AGENTS.md section 10.
  const code = await host(page, "Keeper");
  const friend = await context.newPage();
  await guest(friend, code, "Visitor");
  await expect(friend.locator("#player-count")).toHaveText("2 / 8");

  await friend.bringToFront();
  const before = await state(friend);
  await friend.evaluate(() => (window as any).__friendslop.input("KeyW", true));
  await expect
    .poll(async () => (await state(friend)).z, { timeout: 20000 })
    .toBeLessThan(before.z - 2);
  await friend.evaluate(() =>
    (window as any).__friendslop.input("KeyW", false),
  );
});

test("voice negotiates through the browser host and relays when forced", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const code = await host(page, "Keeper");
  const friend = await context.newPage();
  friend.on("pageerror", (e) => errors.push(e.message));
  await guest(friend, code, "Visitor");

  for (const p of [page, friend]) {
    await p.getByRole("button", { name: "Enable voice", exact: true }).click();
    await expect
      .poll(
        async () =>
          p.evaluate(() => (window as any).__friendslop?.voice.status),
        { timeout: 20000 },
      )
      .not.toMatch(/Preparing|unavailable/);
  }
  const peers = (p: Page) =>
    p.evaluate(() =>
      [...(window as any).__friendslop.voice.peers.values()].map((x: any) => ({
        state: x.state,
        relay: x.relay,
        packets: x.packets,
      })),
    );
  // Signalling is relayed by the host, exactly as the Node authority does it.
  await expect
    .poll(async () => (await peers(page)).filter((x) => x.state === "DIRECT")
      .length, { timeout: 30000 })
    .toBe(1);

  // Force the relay path, which in p2p mode is a DataChannel to the host.
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await page.getByRole("button", { name: "Force relay" }).click();
  await expect
    .poll(async () => (await peers(page)).filter((x) => x.relay).length, {
      timeout: 30000,
    })
    .toBe(1);
  await expect
    .poll(async () => (await peers(page))[0]?.packets ?? 0, { timeout: 30000 })
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("the landing page names which deployment is running", async ({
  page,
  context,
}) => {
  await page.goto("/?net=server");
  await expect(page.locator("#loading")).toBeHidden();
  const badge = page.locator("#net-mode");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(/LIVE SERVER/);
  await expect(badge).toHaveAttribute("data-mode", "server");

  const p2p = await context.newPage();
  await p2p.goto("/?net=p2p");
  await expect(p2p.locator("#loading")).toBeHidden();
  const other = p2p.locator("#net-mode");
  await expect(other).toBeVisible();
  await expect(other).toHaveText(/STATIC · BROWSER-HOSTED/);
  await expect(other).toHaveAttribute("data-mode", "p2p");
  await p2p.screenshot({ path: "test-results/lobby-p2p.png" });

  // Unforced, this dev server answers /healthz, so detection must say server.
  const auto = await context.newPage();
  await auto.goto("/");
  await expect(auto.locator("#loading")).toBeHidden();
  await expect(auto.locator("#net-mode")).toHaveText(/LIVE SERVER/);
});
