import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { viteSingleFile } from "vite-plugin-singlefile";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), svelte(), viteSingleFile()],
  server: {
    port: 8081,
  },
  build: {
    outDir: "../public/webview-ui",
  },
});
