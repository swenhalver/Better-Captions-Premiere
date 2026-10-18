import { mount } from "svelte";
import "./app.css";
import App from "./main-webview.svelte";
import BrowserPreview from "./BrowserPreview.svelte";

// Review chrome is browser-only. The installed UXP/CEP panel mounts the editor directly.
const hostWindow = window as Window & { uxpHost?: unknown; __adobe_cep__?: unknown };
mount(hostWindow.uxpHost || hostWindow.__adobe_cep__ ? App : BrowserPreview, {
  target: document.getElementById("app")!,
});
