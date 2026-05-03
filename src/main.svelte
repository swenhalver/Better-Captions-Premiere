<script lang="ts">
  import { uxp, premierepro } from "./globals";
  import { api } from "./api/api";
  import { onMount } from "svelte";
  import { id } from "../uxp.config";

  const webviewUI = import.meta.env.VITE_BOLT_WEBVIEW_UI === "true";
  import { webviewInitHost } from "./webview-setup-host";
  import type { WebviewAPI } from "../webview-ui/src/webview";
  let webviewAPIs: WebviewAPI[];
  let mainWebviewAPI: WebviewAPI;

  const hostName = (uxp?.host?.name || "").toLowerCase();

  if (webviewUI) {
    onMount(async () => {
      webviewAPIs = await webviewInitHost({ multi: true });
      [mainWebviewAPI] = webviewAPIs;
      window.mainWebviewAPI = mainWebviewAPI;

      if (hostName === "premierepro") {
        setupSequenceListeners();
      }
    });
  }

  async function setupSequenceListeners() {
    try {
      premierepro.EventManager.addGlobalEventListener(
        premierepro.Constants.SequenceEvent.ACTIVATED,
        () => {
          if (mainWebviewAPI) {
            mainWebviewAPI.onSequenceActivated();
          }
        },
      );

      premierepro.EventManager.addGlobalEventListener(
        premierepro.Constants.SequenceEvent.CLOSED,
        () => {
          if (mainWebviewAPI) {
            mainWebviewAPI.onSequenceClosed();
          }
        },
      );
    } catch (e) {
      console.error("Failed to register sequence listeners:", e);
    }
  }
</script>

<style lang="scss">
  @use "./variables.scss" as *;
</style>
