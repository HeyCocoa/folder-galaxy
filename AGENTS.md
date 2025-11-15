# Repository Guidelines

A concise contributor guide for Folder Constellation (Electron + Node/TS + React + D3).

## Project Structure & Module Organization
- `src/main/` – Electron main process, IPC, preload, scanner
  - `scan/scanDirectory.ts` core filesystem scan logic
- `src/renderer/` – React+D3 UI (`App.tsx`, components, hooks, utils)
- `src/shared/types.ts` – shared TypeScript interfaces (IPC/scan)
- `src/preload/global.d.ts` – preload typings
- `dist/` – build output; `vite` renders to `dist/renderer`, `tsup` to `dist/main`

## Build, Test, and Development Commands
- `npm run dev` – tsup watch (main/preload) + Vite dev server (5176) + Electron
- `npm run build` – compile main/preload and renderer to `dist/`
- `npm start` – launch Electron using built `dist/` assets
- `npm run clean` – remove `dist/`
- `npm run package` – create Windows installer via electron-builder

## Coding Style & Naming Conventions
- TypeScript strict; 2‑space indentation; semicolons; prefer const/readonly
- File names: React components `PascalCase.tsx`; utilities/hooks `kebab-case.ts` with `use*` prefix for hooks
- Keep shared contracts in `src/shared/types.ts`; don’t rename IPC channels (`scan-directory`, `open-folder`, `choose-directory`)
- Electron main stays CJS bundled by tsup; use `app.isPackaged` for dev/prod checks

## Testing Guidelines
- No test runner yet. Validate manually:
  - Depth 1 vs 2 total size identical; hover tooltip correct
  - Click opens folder; right‑click toggles trash highlight
  - Large trees (>10k files) return an error
- If adding tests, prefer Vitest for renderer and Node/TS tests for scanner under `src/**/__tests__`; add `npm test` script in a dedicated PR.

## Commit & Pull Request Guidelines
- Use clear, focused commits (Conventional style encouraged: `feat:`, `fix:`, `refactor:`)
- PR description must include: motivation, summary of changes, screenshots/gifs of UI, validation steps (`npm run dev`), and any IPC or schema changes
- Avoid drive‑by refactors; keep diffs minimal; update README when scripts change

## Security & Configuration Tips
- Keep `contextIsolation: true`, `nodeIntegration: false`; expose only safe APIs in `preload.ts`
- Validate `ScanOptions` from renderer; default `followSymlinks=false`; cap files via `MAX_FILE_THRESHOLD`
- Vite dev server uses port `5176`; keep config in sync (`vite.config.ts`, `package.json`, `src/main/main.ts`)
