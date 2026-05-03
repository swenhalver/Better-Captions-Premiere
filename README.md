# Better Captions for Premiere Pro

![Better Captions for Premiere Pro](https://pub-a03d6cd40ca348a4bd05d28b925aa8ed.r2.dev/Extension-Screenshot.png)

A free, open-source Adobe Premiere Pro plugin that generates stylized captions directly inside your timeline — no subscriptions, no watermarks, no third-party services.

[![Watch the tutorial](https://pub-a03d6cd40ca348a4bd05d28b925aa8ed.r2.dev/Thumbnail.jpg)](https://youtu.be/iknzmoNrdJQ)

> **Built live on YouTube** — watch the full build video [here](https://youtu.be/iknzmoNrdJQ)

---

## Features

- **AI-Powered Transcription** — automatically transcribes your timeline audio into timed captions
- **Real-Time Preview** — see your captions styled and animated on a live canvas preview
- **Customizable Styling** — font, size, weight, color, text transform, and more
- **Stroke & Background** — toggle on/off with color pickers, opacity sliders, and border radius
- **Drop Shadow** — configurable blur, color, opacity, and offset
- **Animation Presets** — fade, pop, typewriter, karaoke, and bounce effects
- **Per-Word Highlighting** — karaoke mode highlights each word as it's spoken
- **Direct Export** — renders caption overlays and imports them straight into your Premiere Pro timeline
- **Session Persistence** — your style and animation settings are saved per sequence

## Getting Started

### Prerequisites

- [Adobe Premiere Pro](https://www.adobe.com/products/premiere.html) v25.0+
- [Node.js](https://nodejs.org/) v18+
- [Adobe UXP Developer Tools](https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/installation/)

### Installation

```bash
git clone https://github.com/Paquette1111/Better-Captions-Premiere.git
cd Better-Captions-Premiere
npm install
cd webview-ui && npm install && cd ..
```

### Development

```bash
npm run dev
```

Load the plugin in Premiere Pro using Adobe UXP Developer Tools.

### Build

```bash
npm run build
```

### Package for Distribution

```bash
npm run ccx    # Package as .ccx
npm run zip    # Package as .zip
```

## Tech Stack

- **Svelte 5** + TypeScript
- **Tailwind CSS v4**
- **Vite** + [Bolt UXP](https://github.com/nickverlinden/bolt-uxp) boilerplate
- **Canvas API** for caption rendering and export

## Connect

- **YouTube** — [Matthew Paquette](https://www.youtube.com/@matthewpaquette)
- **Instagram** — [@matthewpaquette](https://www.instagram.com/matthewpaquette/)
- **X (Twitter)** — [@matthewpaquette](https://x.com/MatthewPaquette)

## License

This project is open source and available under the [MIT License](LICENSE).
