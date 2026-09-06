import { defineConfig } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: process.env.PRODUCTION ? "tests/production" : "tests/browser",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  reporter: "list",
  use: {
    channel: "chrome",
    headless: true,
    viewport: { width: 1440, height: 900 },
    baseURL: process.env.PRODUCTION
      ? "http://localhost:3001"
      : `http://localhost:${process.env.PORT ?? 3000}`,
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${path.resolve("tests/voice-fixture.wav")}`,
        "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
      ],
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command: process.env.PRODUCTION ? "PORT=3001 npm start" : "npm run dev",
    url: process.env.PRODUCTION
      ? "http://localhost:3001/healthz"
      : `http://localhost:${process.env.PORT ?? 3000}/healthz`,
    reuseExistingServer: true,
  },
});
