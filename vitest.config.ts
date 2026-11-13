import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('./Shared/src'),
      '@gameserver': r('./GameServer/src'),
    },
  },
  test: {
    include: ['Tests/**/*.test.ts'],
    testTimeout: 120000,
  },
});
