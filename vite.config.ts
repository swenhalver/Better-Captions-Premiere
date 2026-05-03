import { defineConfig } from "vite";
import { runAction, uxp, uxpSetup } from "vite-uxp-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte"; 
import { sveltePreprocess } from "svelte-preprocess"; 

import { config } from "./uxp.config";

const action = process.env.BOLT_ACTION;
const mode = process.env.MODE;
process.env.VITE_BOLT_MODE = mode;
process.env.VITE_BOLT_WEBVIEW_UI = (config.webviewUi === true).toString();
process.env.VITE_BOLT_WEBVIEW_PORT = config.webviewReloadPort.toString();

if (action) runAction(config, action);

const shouldNotEmptyDir =
  mode === "dev" && config.manifest.requiredPermissions?.enableAddon;

export default defineConfig({
  plugins: [
    uxp(config, mode),
    svelte(), 
  ],
  build: {
    sourcemap: mode && ["dev", "build"].includes(mode) ? true : false,
    minify: false,
    emptyOutDir: !shouldNotEmptyDir,
    rollupOptions: {
      external: [
        "premierepro", 
        "bolt-uxp-hybrid.uxpaddon", 
        "uxp",
        "fs",
        "os",
        "path",
        "process",
        "shell",
      ],
      output: {
        // format: "cjs",
        format: "iife", // Needed for Webview UI in Vue to prevent global overrides
      },
    },
  },
  publicDir: "public",
});
