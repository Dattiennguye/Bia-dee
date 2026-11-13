import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: { alias: { '@shared': fileURLToPath(new URL('../Shared/src', import.meta.url)), '@gameserver': fileURLToPath(new URL('../GameServer/src', import.meta.url)), '@backend': fileURLToPath(new URL('../Backend/src', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020', chunkSizeWarningLimit: 1200 },
  server: { port: 5173, proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } } },
});
