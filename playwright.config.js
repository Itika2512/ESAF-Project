import path from 'path';
import { loadProfile, testTimeoutMs } from './config/loadProfile.js';

const isLoadRun = process.env.LOAD_TEST === '10';

function workerCount() {
  if (process.env.WORKERS) return parseInt(process.env.WORKERS, 10);
  return isLoadRun ? loadProfile.totalVus : 10;
}

export default {
  testDir: './tests',
  testIgnore: isLoadRun ? undefined : ['**/load/**'],

  fullyParallel: true,
  workers: workerCount(),

  // Retries would duplicate samples and skew load metrics.
  retries: 0,

  reporter: isLoadRun
    ? [
        ['list'],
        ['json', { outputFile: path.join(loadProfile.runDir, 'playwright-results.json') }],
        ['html', { outputFolder: path.join(loadProfile.runDir, 'playwright-html'), open: 'never' }]
      ]
    : [['list'], ['html', { open: 'never' }]],

  globalTeardown: isLoadRun ? './reporting/globalTeardown.js' : undefined,

  outputDir: isLoadRun ? path.join(loadProfile.runDir, 'artifacts') : './test-results',

  use: {
    baseURL: loadProfile.baseURL,
    headless: isLoadRun ? loadProfile.headless : false,
    viewport: { width: 1280, height: 720 },
    // Tracing/video are expensive per VU; keep them off during load runs.
    trace: isLoadRun ? 'off' : 'on-first-retry',
    screenshot: isLoadRun ? 'off' : 'only-on-failure',
    video: isLoadRun ? 'off' : 'retain-on-failure',
    ignoreHTTPSErrors: true,
    actionTimeout: isLoadRun ? 60000 : 0,
    navigationTimeout: isLoadRun ? 90000 : 0
  },

  timeout: isLoadRun ? testTimeoutMs() : 50000
};