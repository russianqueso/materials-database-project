import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package exposes development and test scripts', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(packageJson.scripts.start);
  assert.equal(packageJson.scripts.test, 'node --test');
});

test('README documents local Vercel development and the key name', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /vercel dev/);
  assert.match(readme, /MP_API_KEY/);
});
