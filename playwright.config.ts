import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  // Native macOS application activation must not race between Electron instances.
  workers: 1,
  use: {
    headless: false
  }
});
