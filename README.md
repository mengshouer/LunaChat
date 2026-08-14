# LunaChat

[中文文档](README.zh-CN.md)

A browser-native AI chat application with ReAct-style tool loop, message branching, and multi-provider support. All data stays in your browser — no server-side database required.

![LunaChat Screenshot](docs/screenshot.png)

## Features

- **Multi-provider support** — OpenAI, Anthropic, OpenAI Responses API, and any compatible endpoint
- **Browser-local storage** — Messages and settings stored in IndexedDB, nothing leaves your device
- **Message branching** — Edit messages to create branches, switch between alternatives
- **Built-in tools** — Web search, code interpreter, image generation, file search (provider-dependent)
- **Reasoning effort control** — 7-level selector to tune model thinking depth
- **ReAct tool loop** — Automatic multi-step tool use with streaming
- **Config profiles** — Multiple provider configurations with one-click switching
- **Encrypted API keys** — Optional passphrase-based encryption for stored credentials
- **Server proxy with access gate** — Optional `API_ACCESS_TOKEN` to protect deployed instances
- **Dark mode** — One Dark Pro inspired theme with system preference detection

## Quick Start

```bash
git clone https://github.com/mengshouer/LunaChat.git
cd lunachat
npm install
npm run dev
```

Open <http://localhost:3000>, click **Open Settings**, and configure your provider (Base URL + Model).

## Deploy

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/mengshouer/LunaChat&env=API_ACCESS_TOKEN&envDescription=Optional%20access%20token%20to%20protect%20API%20proxy%20routes)

### Netlify

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/mengshouer/LunaChat)

## Environment Variables

| Variable           | Required | Description                                                                     |
| ------------------ | -------- | ------------------------------------------------------------------------------- |
| `API_ACCESS_TOKEN` | No       | When set, all `/api/*` requests must include a matching `x-access-token` header |

## Tech Stack

- [Next.js 15](https://nextjs.org/) (App Router)
- [React 19](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/)
- [Dexie](https://dexie.org/) (IndexedDB)
- [nuqs](https://nuqs.47ng.com/) (URL state)
- [Vitest](https://vitest.dev/) (testing)

## How It Works

```
Browser ←→ Next.js API routes (thin proxy) ←→ LLM Provider APIs
         ↕
   IndexedDB (messages, threads, config)
```

- **Client mode**: Browser calls LLM APIs directly (needs CORS support)
- **Server mode**: Requests go through `/api/llm` proxy (avoids CORS, hides keys from network tab)
- **Auto mode** (default): Tries client first, falls back to server on failure

## License

[MIT](LICENSE)
