let _globalSyncProcessing = false;

export const SyncLock = {
  acquire(): boolean {
    if (_globalSyncProcessing) return false;
    _globalSyncProcessing = true;
    return true;
  },
  release(): void {
    _globalSyncProcessing = false;
  },
  isLocked(): boolean {
    return _globalSyncProcessing;
  },
};
