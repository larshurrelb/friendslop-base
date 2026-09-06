# CLAUDE.md — Friendslop Base

@AGENTS.md

`AGENTS.md` is the full manual: architecture, commands, where changes go, the
avatar bone contract, how to drive a second player, and the sharp edges. Read
it first; this file only adds what is specific to working here from Claude Code.

## Session habits

- Check `curl -s localhost:3000/healthz` before starting a dev server. The user
  usually already has `npm run dev` on `:3000`; attach to it rather than
  fighting over the port.
- Throwaway scripts, render previews, HTML scratch pages and bot controllers go
  in the session scratchpad, never in the repo. Kill background bots and scratch
  HTTP servers before you report back (`pkill -f "tsx.*bot.ts"`); a forgotten
  bot in the user's room looks like a haunted player.
- If the page reloads under you (Vite HMR after an edit to `src/server` or
  `src/shared`), `window.__friendslop` is gone and the room is reset. Rejoin
  and re-read state; don't chase it as a bug.
- Do not monkey-patch `renderer.render` or `scene.updatePlayer` on the live
  page to force a state for a screenshot. Wrapping is survivable if you keep a
  reference and restore it; `delete` is not (three r180 defines `render` as an
  own property, so `delete` leaves nothing behind and the frame loop dies
  silently). Prefer forcing state through the bot or the `__friendslop` handle.

## The in-app Browser pane

- A tab that is not fronted is rAF-throttled. Two tabs cannot both be live
  players; use the headless client from `AGENTS.md` §8 for player two.
- Tabs pinned to a `file://` preview cannot be navigated or scripted. Serve
  scratch HTML over HTTP from the scratchpad and open a fresh tab.
- The `zoom` action returns the full screenshot, not a crop. Scale the DOM with
  a temporary `transform` when you need to inspect something small, and undo it.
- The pause overlay (`#pause`) and HUD sit over the world when pointer lock is
  off. Hide them with `style.visibility = "hidden"` for clean screenshots.

## Verifying visual changes

- For the character, render from Blender rather than guessing: load
  `assets-source/blender/common-worker.blend` with `--background`, pose bones
  via `rig.pose.bones[...]`, render with `BLENDER_EEVEE`, and `Read` the PNG.
  On macOS Blender is at `/Applications/Blender.app/Contents/MacOS/Blender`.
- For bone behaviour, measure rather than eyeball: sample
  `avatar.head.bone.matrixWorld.elements[4..6]` over ~180 frames. A steady
  vector is correct; a climbing one is the compounding bug from §7.
- Send finished renders and screenshots to the user with `SendUserFile`; they
  may be following from another device.

## Before saying it is done

`npm run typecheck && npm test && npm run test:server && npm run test:browser`,
all green, and generated assets regenerated and committed alongside the script
change. Say plainly what you did not verify.
