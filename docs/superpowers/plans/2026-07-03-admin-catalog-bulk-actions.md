# Admin Catalog Bulk Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select batch up/down/delete operations for admin stores and scripts.

**Architecture:** Keep batching in `CatalogWorkspace.vue` and serially call existing single-item API helpers. Selection state is local to the active tab and cleared when the list reloads or the tab changes.

**Tech Stack:** Vue 3 script setup, existing admin-web API helpers, static d12 check, Vite build.

---

### Task 1: Failing Static Check

**Files:**
- Modify: `scripts/d12-admin-web-check.js`

- [ ] Add assertions for `selectedItemIds`, `toggleSelectAllVisible`, `batchUpdateStatus`, `batchDeleteSelected`, and visible copy `批量上架` / `批量下架` / `批量删除`.
- [ ] Run `node scripts/d12-admin-web-check.js` and confirm it fails before implementation.

### Task 2: Frontend Batch Selection

**Files:**
- Modify: `apps/admin-web/src/components/CatalogWorkspace.vue`

- [ ] Add a checkbox column only for `stores` and `scripts`.
- [ ] Track selected row ids in `selectedItemIds`.
- [ ] Add header select-all checkbox for the visible loaded rows.
- [ ] Clear selection on tab switch and after list reload.

### Task 3: Frontend Batch Actions

**Files:**
- Modify: `apps/admin-web/src/components/CatalogWorkspace.vue`

- [ ] Render a compact batch action bar when `selectedCount > 0` and `tab !== "sessions"`.
- [ ] Implement `batchUpdateStatus("active")` and `batchUpdateStatus("inactive")`, serially calling `saveStore` or `saveScript`.
- [ ] Implement `batchDeleteSelected()`, requiring all selected rows to be `inactive`, then serially calling `deleteStore` or `deleteScript`.
- [ ] Use existing `beginOperation/endOperation` busy lock and reload on success.

### Task 4: Verification

**Files:**
- Verify: `scripts/d12-admin-web-check.js`
- Verify: `apps/admin-web/src/components/CatalogWorkspace.vue`

- [ ] Run `node scripts/d12-admin-web-check.js`.
- [ ] Run `npm --workspace apps/admin-web run build`.
- [ ] Inspect the admin page in the browser and confirm store/script rows have checkboxes and batch buttons appear after selecting rows.
