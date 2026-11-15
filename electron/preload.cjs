const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('heliosDesktop', {
  isDesktopApp: true,
  platform: process.platform,
});
