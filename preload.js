const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickImage: () => ipcRenderer.invoke('pick-image'),
  prepare: (payload) => ipcRenderer.invoke('prepare', payload),
  addFrame: (pixels) => ipcRenderer.invoke('add-frame', pixels),
  finish: () => ipcRenderer.invoke('finish'),
  saveGif: () => ipcRenderer.invoke('save-gif'),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),
});
