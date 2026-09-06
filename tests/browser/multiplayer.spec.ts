import { test, expect, type Page } from "@playwright/test";
async function create(page: Page, name: string) {
  await page.goto("/?test=1");
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.locator("#hud")).toBeVisible();
  return (await page.locator("#room-code").textContent())!;
}
async function join(page: Page, code: string, name: string, wasm = false) {
  await page.goto(`/?test=1&fresh=1&room=${code}${wasm ? "&wasm=1" : ""}`);
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join →", exact: true }).click();
  await expect(page.locator("#hud")).toBeVisible();
}
const state = (page: Page) =>
  page.evaluate(() => (window as any).__friendslop.state);
/** Drive a client the way a player would: hold W and steer toward a point. */
async function controls(page: Page) {
  await page.evaluate(() => {
    const d = (window as any).__friendslop;
    (window as any).walkTo = async (tx: number, tz: number, timeout = 14000) => {
      const started = performance.now();
      d.input("ShiftLeft", true);
      d.input("KeyW", true);
      while (performance.now() - started < timeout) {
        const s = d.state,
          dx = tx - s.x,
          dz = tz - s.z;
        if (Math.hypot(dx, dz) < 0.7) break;
        d.look(Math.atan2(-dx, -dz), 0);
        await new Promise((r) => requestAnimationFrame(r));
      }
      d.input("KeyW", false);
      d.input("ShiftLeft", false);
      await new Promise((r) => setTimeout(r, 260));
      return d.state;
    };
    // Aim at a thing rather than at a guessed angle; props settle where they like.
    (window as any).aimAt = async (x: number, y: number, z: number) => {
      const s = d.state;
      d.look(
        Math.atan2(-(x - s.x), -(z - s.z)),
        Math.atan2(-(y - (s.y + 0.65)), Math.hypot(x - s.x, z - s.z)),
      );
      await new Promise((r) => setTimeout(r, 260));
    };
    (window as any).aimAtProp = async (id: number) => {
      const p = d.scene.props.get(id).position;
      await (window as any).aimAt(p.x, p.y, p.z);
      return d.sim.target(d.state);
    };
  });
}
const walkTo = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => (window as any).walkTo(x, z), [x, z] as const);
test("Chrome lobby, authoritative movement and reconnect", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  const github = page.getByRole("link", {
    name: "Get Friendslop Base on GitHub",
  });
  await expect(github).toHaveAttribute(
    "href",
    "https://github.com/larshurrelb/friendslop-base",
  );
  await expect(github).toHaveAttribute("target", "_blank");
  await page.screenshot({ path: "test-results/lobby.png" });
  const code = await create(page, "Scout");
  const friend = await context.newPage();
  await join(friend, code, "Moss");
  await expect(page.locator("#player-count")).toHaveText("2 / 8");
  const friendId = (await state(friend)).id;
  const before = await state(page);
  await page.evaluate(() => (window as any).__friendslop.input("KeyW", true));
  await expect
    .poll(async () => (await state(page)).z)
    .toBeLessThan(before.z - 2);
  await page.evaluate(() => (window as any).__friendslop.input("KeyW", false));
  await page.screenshot({ path: "test-results/room.png" });
  await friend.reload();
  await expect(friend.locator("#loading")).toBeHidden();
  await friend.getByRole("button", { name: "Join →", exact: true }).click();
  await expect(friend.locator("#hud")).toBeVisible();
  await expect(page.locator("#player-count")).toHaveText("2 / 8");
  expect((await state(friend)).id).toBe(friendId);
  expect(errors).toEqual([]);
});
test("three Chrome peers: native P2P, WASM relay, isolated failure and upgrade", async ({
  context,
}) => {
  const a = await context.newPage(),
    b = await context.newPage(),
    c = await context.newPage();
  const errors: string[] = [];
  for (const p of [a, b, c]) p.on("pageerror", (e) => errors.push(e.message));
  const code = await create(a, "Ash");
  await join(b, code, "Birch", true);
  await join(c, code, "Cedar");
  for (const p of [a, b, c]) {
    await p.getByRole("button", { name: "Enable voice", exact: true }).click();
    await expect
      .poll(
        async () =>
          p.evaluate(() => (window as any).__friendslop?.voice.status),
        { timeout: 15000 },
      )
      .not.toMatch(/Preparing|unavailable/);
    await expect(
      p.getByRole("button", { name: "Audio on", exact: true }),
    ).toBeVisible();
  }
  const routes = (p: Page) =>
    p.evaluate(() =>
      [...(window as any).__friendslop.voice.peers.values()].map((x: any) => ({
        id: x.id,
        state: x.state,
        relay: x.relay,
        packets: x.packets,
        pcm: x.pcm,
        buffer: x.bufferMs,
        rms: x.rms,
      })),
    );
  await expect
    .poll(
      async () => (await routes(a)).filter((x) => x.state === "DIRECT").length,
      { timeout: 30000 },
    )
    .toBe(2);
  await expect
    .poll(
      async () => (await routes(b)).filter((x) => x.state === "DIRECT").length,
      { timeout: 30000 },
    )
    .toBe(2);
  await a.evaluate(() => (window as any).__friendslop.voice.force(2, true));
  await expect
    .poll(async () => (await routes(a)).find((x) => x.id === 2)?.state)
    .toBe("RELAY");
  await expect
    .poll(
      async () =>
        await b.evaluate(() => (window as any).__friendslop.voice.received),
    )
    .toBeGreaterThan(20);
  await expect
    .poll(async () => (await routes(b)).find((x) => x.id === 1)?.rms ?? 0)
    .toBeGreaterThan(0.001);
  expect((await routes(a)).find((x) => x.id === 3)?.state).toBe("DIRECT");
  await a.evaluate(() => (window as any).__friendslop.voice.force(2, false));
  await expect
    .poll(async () => (await routes(a)).find((x) => x.id === 2)?.state, {
      timeout: 45000,
    })
    .toBe("DIRECT");
  await b.getByRole("button", { name: "Mute microphone" }).click();
  expect(await b.evaluate(() => (window as any).__friendslop.voice.gate)).toBe(
    false,
  );
  // Abrupt one-pair media failure triggers automatic relay, without a room-wide switch.
  await a.evaluate(() => {
    const p = (window as any).__friendslop.voice.peers.get(2);
    p.pc.close();
  });
  await expect
    .poll(async () => (await routes(a)).find((x) => x.id === 2)?.relay, {
      timeout: 10000,
    })
    .toBe(true);
  expect((await routes(a)).find((x) => x.id === 3)?.relay).toBe(false);
  await expect
    .poll(async () => (await routes(a)).find((x) => x.id === 2)?.state, {
      timeout: 45000,
    })
    .toBe("DIRECT");
  expect(errors).toEqual([]);
});
test("Chrome pointer lock, Blender character, pickup, throw and crouch", async ({
  page,
  context,
}) => {
  const code = await create(page, "Fern");
  const friend = await context.newPage();
  await join(friend, code, "Clay");
  await page.evaluate(() => (window as any).__friendslop.input("KeyS", true));
  await expect.poll(async () => (await state(page)).z).toBeGreaterThan(8);
  await page.evaluate(() => {
    (window as any).__friendslop.input("KeyS", false);
    (window as any).__friendslop.look(0.6, 0.05);
  });
  await page.bringToFront();
  await page.getByRole("button", { name: "Click to explore →" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.pointerLockElement))
    .toBe(true);
  await expect(page.locator("#pause")).toBeHidden();
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as any).__friendslop;
        return d.cameraMode === "third" && d.scene.avatars.has(d.state.id);
      }),
    )
    .toBe(true);
  await page.keyboard.press("Tab");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as any).__friendslop;
        return d.cameraMode === "first" && !d.scene.avatars.has(d.state.id);
      }),
    )
    .toBe(true);
  await page.screenshot({ path: "test-results/character.png" });
  await page.evaluate(() => {
    (window as any).__friendslop.look(0, 0.55);
    (window as any).__friendslop.input("KeyW", true);
  });
  await expect
    .poll(async () => (await state(page)).z, { timeout: 15000 })
    .toBeLessThan(0.65);
  await page.evaluate(() => (window as any).__friendslop.input("KeyW", false));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const d = (window as any).__friendslop;
        return d.sim.target(d.state);
      }),
    )
    .toBeGreaterThan(0);
  await page.evaluate(() => (window as any).__friendslop.action());
  await expect.poll(async () => (await state(page)).held).toBeGreaterThan(0);
  const held = (await state(page)).held;
  await expect
    .poll(() =>
      friend.evaluate(
        (object) => (window as any).__friendslop.sim.owners.get(object),
        held,
      ),
    )
    .toBe(1);
  await page.screenshot({ path: "test-results/holding.png" });
  await page.evaluate(() => (window as any).__friendslop.action(true));
  await expect.poll(async () => (await state(page)).held).toBe(0);
  await page.evaluate(() => (window as any).__friendslop.input("KeyC", true));
  await expect.poll(async () => (await state(page)).flags & 2).toBe(2);
  await page.evaluate(() => (window as any).__friendslop.input("KeyC", false));
  await expect.poll(async () => (await state(page)).flags & 2).toBe(0);
});
test("eight Chrome players sustain the mesh and all-relay room", async ({
  context,
}) => {
  test.setTimeout(150000);
  const pages: Page[] = [];
  for (let i = 0; i < 8; i++) pages.push(await context.newPage());
  const code = await create(pages[0], "Player 1");
  for (let i = 1; i < 8; i++)
    await join(pages[i], code, `Player ${i + 1}`, i % 2 === 1);
  // Eight audio stacks share one machine: pause game animation/physics in this voice-only stress test.
  for (const p of pages)
    await p.evaluate(() => {
      window.requestAnimationFrame = () => 0;
    });
  for (const p of pages) {
    await p.getByRole("button", { name: "Enable voice", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "Audio on", exact: true }),
    ).toBeVisible();
  }
  for (const p of pages)
    await expect
      .poll(
        () =>
          p.evaluate(
            () =>
              [...(window as any).__friendslop.voice.peers.values()].filter(
                (p: any) => p.state === "DIRECT" || p.state === "RELAY",
              ).length,
          ),
        { timeout: 40000 },
      )
      .toBe(7);
  for (const p of pages)
    await p.evaluate(() => {
      const d = (window as any).__friendslop;
      for (const id of d.voice.peers.keys())
        if (d.state.id < id) d.voice.force(id, true);
    });
  try {
    for (const p of pages) {
      await expect
        .poll(
          () =>
            p.evaluate(
              () =>
                [...(window as any).__friendslop.voice.peers.values()].filter(
                  (p: any) => p.relay && p.pcm > 2880 && p.rms > 0.001,
                ).length,
            ),
          { timeout: 25000 },
        )
        .toBe(7);
    }
  } catch (error) {
    for (const p of pages)
      console.log(
        "VOICE DIAGNOSTICS",
        await p.evaluate(() => {
          const v = (window as any).__friendslop.voice;
          return {
            id: v.identity,
            received: v.received,
            sent: v.sent,
            level: v.level,
            gate: v.gate,
            status: v.status,
            context: v.spatial.context.state,
            peers: [...v.peers.values()].map((p: any) => ({
              id: p.id,
              state: p.state,
              relay: p.relay,
              pcm: p.pcm,
              rms: p.rms,
              active: p.active,
              reason: p.reason,
              buffer: p.bufferMs,
              underruns: p.underruns,
            })),
          };
        }),
      );
    throw error;
  }
  const start = await pages[0].evaluate(
    () => (window as any).__friendslop.voice.received,
  );
  await expect
    .poll(
      () =>
        pages[0].evaluate(() => (window as any).__friendslop.voice.received),
      { timeout: 10000 },
    )
    .toBeGreaterThan(start + 700);
  expect(await pages[0].locator("#player-count").textContent()).toBe("8 / 8");
});
test("embedded preview fallback enables real WASD and drag-look after a canvas click", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = () =>
      Promise.reject(
        new DOMException(
          "Embedded preview does not support capture",
          "NotSupportedError",
        ),
      );
  });
  await page.goto("/");
  await expect(page.locator("#loading")).toBeHidden();
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(page.locator("#hud")).toBeVisible();
  await page.bringToFront();
  await page.locator("canvas").click({ position: { x: 180, y: 260 } });
  await expect(page.locator("#pause")).toBeHidden();
  await expect(page.locator("#toast")).toContainText("Preview controls");
  const before = await state(page);
  await page.keyboard.down("w");
  await expect
    .poll(async () => (await state(page)).z)
    .toBeLessThan(before.z - 1);
  await page.keyboard.up("w");
  await page.mouse.move(250, 300);
  await page.mouse.down();
  await page.mouse.move(420, 330, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await state(page)).yaw - before.yaw))
    .toBeGreaterThan(0.2);
  await page.keyboard.press("Escape");
  await expect(page.locator("#pause")).toBeVisible();
});

test("original jump and footstep audio works without enabling the microphone", async ({
  page,
}) => {
  await create(page, "Pip");
  await page.getByRole("button", { name: "Click to explore →" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).__friendslop.voice.spatial?.context.state,
      ),
    )
    .toBe("running");
  await page.evaluate(() => {
    const d = (window as any).__friendslop,
      spatial = d.voice.spatial;
    const played: string[] = [];
    (window as any).__sounds = played;
    const original = spatial.effect.bind(spatial);
    spatial.effect = (p: any, kind: string) => {
      played.push(kind);
      original(p, kind);
    };
    const analyser = spatial.context.createAnalyser();
    analyser.fftSize = 512;
    spatial.master.connect(analyser);
    (window as any).__audioPeak = 0;
    setInterval(() => {
      const samples = new Float32Array(512);
      analyser.getFloatTimeDomainData(samples);
      (window as any).__audioPeak = Math.max(
        (window as any).__audioPeak,
        ...samples.map(Math.abs),
      );
    }, 20);
  });
  await page.keyboard.down("w");
  await expect
    .poll(() => page.evaluate(() => (window as any).__sounds.includes("step")))
    .toBe(true);
  await page.keyboard.up("w");
  await page.keyboard.press("Space", { delay: 100 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__sounds.filter((s: string) => s === "jump").length,
      ),
    )
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => (window as any).__audioPeak))
    .toBeGreaterThan(0.005);
  expect(
    await page.evaluate(() => (window as any).__friendslop.voice.stream),
  ).toBeUndefined();
});

test("refined Blender wardrobe, articulated crouch and talking mouth", async ({
  page,
}) => {
  await create(page, "Model review");
  const poses = await page.evaluate(async () => {
    const nextFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = () => 0;
    await new Promise<void>((resolve) => nextFrame(() => resolve()));
    const d = (window as any).__friendslop,
      scene = d.scene;
    for (const element of document.querySelectorAll<HTMLElement>(
      "#hud, #pause, header, .world-labels",
    ))
      element.style.display = "none";
    const states = [0, 1, 2].map((i) => ({
      ...d.state,
      id: 101 + i,
      x: -1.05 + i * 1.05,
      y: 0.85,
      z: 5,
      yaw: Math.PI + (i === 2 ? -0.85 : 0),
      pitch: 0,
      flags: 1,
      held: 0,
      vx: 0,
      vz: 0,
    }));
    const avatars = states.map((s, i) => scene.updatePlayer(s, "", 0.2, i));
    const bonePosition = (a: any, name: string) =>
      a.root
        .getObjectByName(name)
        .getWorldPosition(scene.camera.position.clone())
        .toArray();
    scene.scene.updateMatrixWorld(true);
    const standingHead = bonePosition(avatars[2], "head"),
      standingFoot = bonePosition(avatars[2], "footL");
    states[2].flags = 3;
    states[2].y = 0.5;
    for (let i = 0; i < 6; i++) scene.updatePlayer(states[2], "", 0.1, 2);
    scene.scene.updateMatrixWorld(true);
    const crouchedHead = bonePosition(avatars[2], "head"),
      crouchedFoot = bonePosition(avatars[2], "footL");
    avatars[1].loudness = 0.07;
    scene.camera.position.set(0, 1.62, 8.4);
    scene.camera.lookAt(0, 1.04, 5);
    scene.render(0.1);
    const mouthOpen = avatars[1].mouth;
    const colors = avatars.map((a: any) => {
      let color = "";
      a.root.traverse((o: any) => {
        for (const m of Array.isArray(o.material)
          ? o.material
          : o.material
            ? [o.material]
            : [])
          if (m.name.startsWith("Jacket")) color = m.color.getHexString();
      });
      return color;
    });
    return {
      standingHead,
      standingFoot,
      crouchedHead,
      crouchedFoot,
      scale: avatars[2].root.scale.toArray(),
      mouthOpen,
      colors,
    };
  });
  await page.screenshot({ path: "artifacts/refined-characters.png" });
  expect(poses.scale).toEqual([1, 1, 1]);
  expect(poses.standingHead[1] - poses.crouchedHead[1]).toBeGreaterThan(0.25);
  expect(Math.abs(poses.standingFoot[1] - poses.crouchedFoot[1])).toBeLessThan(
    0.06,
  );
  expect(poses.mouthOpen).toBeGreaterThan(0.2);
  expect(new Set(poses.colors).size).toBe(3);
});

test("automatic doors, a shove from a gun, and a ball that bounces", async ({
  page,
  context,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const code = await create(page, "Ranger");
  const friend = await context.newPage();
  await join(friend, code, "Sparrow");
  await controls(page);
  await controls(friend);
  await page.bringToFront();
  // The hall's east wall is shut until the workshop doors notice someone.
  await walkTo(page, 7, 0);
  expect(
    await page.evaluate(
      () => (window as any).__friendslop.doors.find((d: any) => d.id === 1).open,
    ),
  ).toBe(false);
  await walkTo(page, 12.5, 0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__friendslop.doors.find((d: any) => d.id === 1).open,
      ),
    )
    .toBe(true);
  await walkTo(page, 16.5, 0);
  await walkTo(page, 18, -4);
  expect((await state(page)).x).toBeGreaterThan(15);
  // The gun on the workbench, and a friend to shove with it.
  expect(await page.evaluate(() => (window as any).aimAtProp(9))).toBe(9);
  await page.evaluate(() => (window as any).__friendslop.action());
  await expect.poll(async () => (await state(page)).held).toBe(9);
  await page.screenshot({ path: "test-results/gun.png" });
  await friend.evaluate(() => (window as any).walkTo(7, 0));
  await friend.evaluate(() => (window as any).walkTo(16.5, 0));
  await friend.evaluate(() => (window as any).walkTo(26, 4));
  await walkTo(page, 18, 4);
  const before = await state(friend);
  await page.evaluate(
    ([x, z]) => (window as any).aimAt(x, 1.5, z),
    [before.x, before.z] as const,
  );
  await page.evaluate(() => (window as any).__friendslop.shoot());
  await expect
    .poll(async () => (await state(friend)).stagger, { timeout: 5000 })
    .toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/shot.png" });
  await expect
    .poll(async () => {
      const now = await state(friend);
      return Math.hypot(now.x - before.x, now.z - before.z);
    })
    .toBeGreaterThan(1);
  // Nobody dies here: they keep their slot, their name and their footing.
  expect((await state(friend)).y).toBeGreaterThan(0);
  await expect(page.locator("#player-count")).toHaveText("2 / 8");
  await page.evaluate(() => (window as any).__friendslop.action());
  await expect.poll(async () => (await state(page)).held).toBe(0);
  // A ball, thrown hard at the floor, comes back up.
  await walkTo(page, 16.5, 0);
  await walkTo(page, 11, 1.5);
  await walkTo(page, 10, 2.4);
  expect(await page.evaluate(() => (window as any).aimAtProp(7))).toBe(7);
  await page.evaluate(() => (window as any).__friendslop.action());
  await expect.poll(async () => (await state(page)).held).toBe(7);
  const flight = await page.evaluate(async () => {
    const d = (window as any).__friendslop,
      heights: number[] = [];
    d.look(d.state.yaw, 0.85);
    await new Promise((r) => setTimeout(r, 200));
    d.action(true);
    const until = performance.now() + 2500;
    while (performance.now() < until) {
      heights.push(d.scene.props.get(7).position.y);
      await new Promise((r) => requestAnimationFrame(r));
    }
    return heights;
  });
  const floor = flight.findIndex((y) => y < 0.42);
  expect(floor).toBeGreaterThan(-1);
  expect(Math.max(...flight.slice(floor))).toBeGreaterThan(0.75);
  expect(errors).toEqual([]);
});
test("a hand-worked door opens the yard and the world beyond it", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await create(page, "Wanderer");
  await controls(page);
  await walkTo(page, 3.25, -8.6);
  await page.evaluate(() => (window as any).aimAt(3.25, 1.3, -10.65));
  expect(
    await page.evaluate(() =>
      (window as any).__friendslop.sim.doorTarget(
        (window as any).__friendslop.state,
      ),
    ),
  ).toBeGreaterThan(0);
  await expect(page.locator("#interact")).toContainText("The yard");
  await walkTo(page, 3.25, -12);
  expect((await state(page)).z).toBeGreaterThan(-11);
  await page.evaluate(() => (window as any).__friendslop.action());
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).__friendslop.doors.find((d: any) => d.id === 3).open,
      ),
    )
    .toBe(true);
  await page.waitForTimeout(1100);
  await walkTo(page, 3, -14);
  await walkTo(page, 5, -18);
  expect((await state(page)).z).toBeLessThan(-15);
  await expect(page.locator("#zone-name")).toHaveText("The yard");
  await page.screenshot({ path: "test-results/yard.png" });
  expect(errors).toEqual([]);
});
