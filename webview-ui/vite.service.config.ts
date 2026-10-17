import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../cep', import.meta.url)),
  base: './',
  build: {
    outDir: 'service-client', emptyOutDir: true, target: 'chrome99',
    rollupOptions: { input: fileURLToPath(new URL('../cep/service.html', import.meta.url)) },
  },
});
