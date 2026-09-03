import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const STARTUP_TIMEOUT_MS = 10_000;

function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    child.kill('SIGTERM');
  } else {
    process.kill(-child.pid, 'SIGTERM');
  }
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for the development server.\n${output}`));
    }, STARTUP_TIMEOUT_MS);

    const onData = (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(
        `Development server exited before becoming ready (${signal ?? code}).\n${output}`,
      ));
    });
  });
}

test('vercel dev serves the static application and API on one local origin', async () => {
  const vercelBin = process.platform === 'win32'
    ? 'node_modules\\.bin\\vercel.cmd'
    : 'node_modules/.bin/vercel';
  const child = spawn(vercelBin, ['dev', '--yes', '--listen', '127.0.0.1:0'], {
    cwd: process.cwd(),
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      MP_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const port = await waitForServer(child);
    const origin = `http://127.0.0.1:${port}`;

    const pageResponse = await fetch(`${origin}/`);
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get('content-type'), /^text\/html\b/);
    assert.match(await pageResponse.text(), /Materials Explorer/);

    const appResponse = await fetch(`${origin}/app.js`);
    assert.equal(appResponse.status, 200);
    assert.match(appResponse.headers.get('content-type'), /^text\/javascript\b/);
    assert.match(await appResponse.text(), /searchMaterials/);

    const apiResponse = await fetch(`${origin}/api/materials?q=Si`);
    assert.equal(apiResponse.status, 503);
    assert.match(apiResponse.headers.get('content-type'), /^application\/json\b/);
    assert.deepEqual(await apiResponse.json(), {
      error: 'Materials search is not configured.',
    });
  } finally {
    stopProcess(child);
    if (child.exitCode === null && child.signalCode === null) {
      await once(child, 'exit');
    }
  }
});
