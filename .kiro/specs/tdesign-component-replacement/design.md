# TDesign Component Replacement Design

## Current Context

The app is a uni-app Vue 3 mini-program compiled for `mp-weixin`. It already depends on `tdesign-miniprogram@1.15.2`, has `mp-weixin.usingComponents` enabled, and uses `t-image-viewer` on the album page. The current build copies only the TDesign image viewer subset into the generated mini-program output.

Several files are already modified in the working tree before this migration. The migration must preserve those edits and build on top of them.

## Architecture

### Component Registration

Register the approved TDesign components globally through `pages.json` `globalStyle.usingComponents` where supported by the uni-app compiler. Keep page-level `usingComponents` only when a page needs an override or when global registration does not compile.

The canonical component path format is:

```json
"t-button": "tdesign-miniprogram/button/button"
```

### Build Asset Copy

Extend `copyTdesignMiniprogramNpmPlugin()` in `apps/miniprogram/vite.config.js` so the generated `dist/*/mp-weixin/miniprogram_npm/tdesign-miniprogram` contains every approved component that appears in app templates, plus dependency folders required by those components.

The asset copy list should be explicit and sorted enough to audit. It must include direct components such as `button`, `input`, `popup`, and shared dependencies such as `common`, `icon`, `loading`, and `overlay`.

### Template Migration

Replace native primitives conservatively:

- `<button>` to `<t-button>` while preserving `open-type`, disabled state, tap/click handlers, and existing classes.
- `<input>` to `<t-input>` or `<t-search>` depending on whether the field is a plain form value or search field.
- `<textarea>` to `<t-textarea>` while preserving value binding, maxlength, placeholder, disabled state, and submit controls.
- `<switch>` to `<t-switch>` while normalizing event handlers to read `event.detail.value`.
- `<picker mode="date/time/selector">` to `t-date-time-picker` or `t-picker` when the existing value and event contract can be preserved.
- `<image>` to `<t-image>` while preserving `src`, `mode`, existing class names, lazy/loading behavior, and long-press behavior where present.

Do not replace `scroll-view` or `uv-waterfall`, because they are outside the approved replacement scope for this migration.

### Feedback Components

Keep existing imperative `uni.showToast`, `uni.showModal`, and `uni.showActionSheet` calls unless a task verifies the corresponding TDesign component instance pattern in this uni-app mini-program build. This avoids changing modal/action-sheet lifecycle behavior during broad UI primitive migration.

### Static Audit

Add migration checks to `scripts/check-miniprogram.js`:

- Verify `tdesign-miniprogram` dependency remains installed.
- Verify `pages.json` registers each TDesign tag used in source.
- Verify the Vite copy list includes each approved component that source uses.
- Verify no unapproved native primitive tags remain in app source files.
- Preserve the existing album `t-image-viewer` assertions.

## Testing Strategy

Use the existing script-first verification style in this repository:

1. Add the static audit and run it before template migration to confirm it fails on remaining native primitives.
2. Replace components task by task.
3. Run `node scripts/check-miniprogram.js` after each broad replacement batch.
4. Run `npm --workspace apps/miniprogram run build:mp-weixin` after static checks pass.

## Risk Controls

- Preserve existing CSS class names on migrated tags so visual changes remain scoped to component internals.
- Prefer `t-button` text slots and plain properties over introducing new wrapper abstractions.
- Keep feedback APIs unchanged where replacing them would require wider behavioral testing.
- Record unavoidable compatibility exceptions in `tasks.md` before marking the migration complete.
