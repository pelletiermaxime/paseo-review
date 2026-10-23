# Rendering and platforms

Render readable diffs with default dark/light themes, background highlighting and an explicit fallback outside desktop/web.

## Sub-features

- `render-theme`: Host dark/light variants and retained language support.
- `render-worker`: Asynchronous coloring, responsiveness and caching.
- `render-cleanup`: Worker lifetime follows the mounted panel.
- `render-native`: Browser guard and native fallback.

## How to get to it (user POV)

Open Workspace Review in desktop/web. Use the host's appearance setting for themes. Open the same panel on a native client to check its fallback.

## Driving it with Paseo browser tools

Preconditions: [common fixture](../verification.md), including `scratch/many.ts`; record original host appearance.

- **Themes.** Inspect TypeScript syntax colors in both dark/light. Require readable backgrounds, text and tokens. Restore the original setting.
- **Highlighting.** Expose a new code file, wait for colors, scroll it out of the rendered set/back, then collapse a preceding large file. Require correct colors and responsive controls; old benchmark timings are not a pass threshold.
- **Workers.** In browser worker diagnostics, observe the panel-owned worker before/after closing that panel. Require termination; reopening creates a fresh worker. Merely switching to a retained tab does not unmount it.
- **Assets.** Run `vp run test` for generated-asset consistency and real highlighting/cache checks. Observe host rendering requests and flag unexpected grammar/theme/WASM downloads.
- **Native.** On an actual iOS/Android client, require the desktop/web fallback and no browser-renderer initialization. If only a DOM-free simulation is available, report it as such; static checks do not prove physical-device behavior.

## Gotchas

- Colors can arrive after initial rendering.
- Worker cleanup needs resource observations, not just a screenshot.
- The editor is beta; upgrades require host rendering/editing checks.
- Do not alter origin/security settings for a probe.
