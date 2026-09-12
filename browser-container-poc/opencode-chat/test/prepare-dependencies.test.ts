import { test, expect } from 'bun:test';
import { selectBackends } from '../src/prepare-dependencies';

const policy = { runtimeVersion: 'test-runtime', sha256: 'test-policy', aliases: { esbuild: 'esbuild-wasm' } };
test('backend selection preserves locked versions and refuses version collapsing', () => {
  expect(selectBackends({ lockfileVersion: 1, packages: { esbuild: ['esbuild@0.28.2'] } }, policy).overrides).toEqual({ esbuild: 'npm:esbuild-wasm@0.28.2' });
  expect(() => selectBackends({ lockfileVersion: 1, packages: { esbuild: ['esbuild@0.28.2'], 'vite/esbuild': ['esbuild@0.25.12'] } }, policy)).toThrow('Multiple locked versions');
});

test('Oxide override is exact and requires original archive integrity', () => {
  const oxide = '@tailwindcss/oxide-wasm32-wasi';
  const lock = { lockfileVersion: 1, packages: { [oxide]: [oxide + '@4.3.3', '', {}, 'sha512-test'] } };
  expect(selectBackends(lock, policy).overrides[oxide]).toBe('https://registry.npmjs.org/@tailwindcss/oxide-wasm32-wasi/-/oxide-wasm32-wasi-4.3.3.tgz');
  expect(() => selectBackends({ ...lock, packages: { [oxide]: [oxide + '@4.3.4', '', {}, 'sha512-test'] } }, policy)).toThrow('qualified only');
  expect(() => selectBackends({ ...lock, packages: { [oxide]: [oxide + '@4.3.3'] } }, policy)).toThrow('integrity');
});
