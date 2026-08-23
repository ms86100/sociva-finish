/**
 * Minimal preload — no Node APIs exposed to the page.
 * Phase 2 can add a narrow contextBridge for tray/notifications.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('socivaDesktop', {
  platform: process.platform,
  isDesktop: true,
  version: '1.0.0',
});
