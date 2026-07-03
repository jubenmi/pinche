# Admin Catalog Bulk Actions Design

## Goal

Allow admins to select multiple stores or scripts and apply common catalog actions in one pass.

## Scope

- Add checkbox selection to `店家` and `剧本` tabs.
- Add visible batch actions when one or more rows are selected:
  - `批量上架`
  - `批量下架`
  - `批量删除`
- Keep `车局` excluded from batch selection and batch actions.
- Reuse existing single-item APIs in serial order:
  - stores: `saveStore`, `deleteStore`
  - scripts: `saveScript`, `deleteScript`

## Rules

- Selection is scoped to the current tab and current loaded list.
- Switching tabs or reloading data clears the selection.
- `批量删除` only proceeds when every selected item is already `inactive`; otherwise it shows `请先下架后删除。`
- Batch operations show one confirmation dialog before sending requests.
- Batch operations stop at the first failed item and show that item name plus the backend message.
- Existing single-row edit, status toggle, and delete behavior stays unchanged.

## Testing

Extend `scripts/d12-admin-web-check.js` to assert that `CatalogWorkspace.vue` includes:

- `selectedItemIds`
- `toggleSelectAllVisible`
- `batchUpdateStatus`
- `batchDeleteSelected`
- `批量上架`
- `批量下架`
- `批量删除`
- `tab !== 'sessions'` gating for batch controls

Verification:

- `node scripts/d12-admin-web-check.js`
- `npm --workspace apps/admin-web run build`
