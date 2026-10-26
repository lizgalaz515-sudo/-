const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, timezoneId: 'Asia/Shanghai', launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox','--disable-crash-reporter','--disable-crashpad'] }, screenshot: 'only-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://127.0.0.1:4173/health', reuseExistingServer: true },
  reporter: 'list'
});
