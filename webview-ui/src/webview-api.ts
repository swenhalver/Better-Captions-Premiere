export const pingWebview = () => {
  return "hello from webview";
};

export const updateColorScheme = (val: {
  theme: string;
  colors: {
    "--uxp-host-background-color": string;
    "--uxp-host-text-color": string;
    "--uxp-host-border-color": string;
    "--uxp-host-link-text-color": string;
    "--uxp-host-widget-hover-background-color": string;
    "--uxp-host-widget-hover-text-color": string;
    "--uxp-host-widget-hover-border-color": string;
    "--uxp-host-text-color-secondary": string;
    "--uxp-host-link-hover-text-color": string;
    "--uxp-host-label-text-color": string;
  };
}) => {
  const { theme, colors } = val;
  const root = document.querySelector(":root") as HTMLElement;
  for (const key in colors) {
    //@ts-ignore
    const color = colors[key];
    root.style.setProperty(key, color);
  }
};

let sequenceActivatedCallback: (() => void) | null = null;
let sequenceClosedCallback: (() => void) | null = null;

export const onSequenceActivated = () => {
  sequenceActivatedCallback?.();
};

export const onSequenceClosed = () => {
  sequenceClosedCallback?.();
};

export const setSequenceCallbacks = (
  onActivated: () => void,
  onClosed: () => void,
) => {
  sequenceActivatedCallback = onActivated;
  sequenceClosedCallback = onClosed;
};

let timelinePlayheadCallback: ((position: unknown) => void) | null = null;

export const onTimelinePlayhead = (position: unknown) => {
  timelinePlayheadCallback?.(position);
};

export const setTimelinePlayheadCallback = (callback: ((position: unknown) => void) | null) => {
  timelinePlayheadCallback = callback;
};
