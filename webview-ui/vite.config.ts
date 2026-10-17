import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({base:"./",plugins:[tailwindcss(),svelte()],server:{host:"127.0.0.1",port:49732,strictPort:true},build:{outDir:"../cep/client",emptyOutDir:true,target:"chrome99",cssTarget:"chrome99"}});
