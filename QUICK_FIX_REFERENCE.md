# Android Add/Edit Failures - Quick Fix Reference

## 🆘 **Problem**: Saves fail with "Save failed" or "Save timed out"

## ✅ **Solution Summary**

Three key changes deployed:

1. **Write timeout increased** from 8s → 15s
   - Handles Android garbage collection pauses
   - File: `src/services/api.ts` line 42

2. **Better error messages** now shown
   - Distinguishes between timeout/permission/offline errors  
   - File: `src/components/modals/ManualEntryModal.tsx` lines 837-853

3. **Debug panel** added for real-time diagnostics
   - Press `Ctrl+Shift+D` to see error logs
   - File: `src/components/common/DiagnosticsPanel.tsx`

## 🔍 **Quick Diagnostic Steps**

### Enable Debug Panel
1. Open the app
2. Press `Ctrl+Shift+D` (or look for debug button in bottom-right)
3. Try adding/editing entry again
4. Check the panel for detailed error messages

### Capture Logcat
```bash
adb logcat -s "com.shopledger.india" | grep -E "ERROR|Error|error|failed"
```

### Check Console
If using DevTools:
1. `adb forward tcp:9223 localabstract:WebViewDebugger`
2. Open `chrome://inspect`
3. Look for red error messages in Console

## 📊 **Error Guide**

| Error | Cause | Fix |
|-------|-------|-----|
| **Save timed out** | Device memory pressure | Clear cache, restart device, close apps |
| **Permission denied** | Auth issue | Logout/login, check Firestore rules |
| **Offline** | No connection | Check WiFi/mobile, try again |
| **Save failed: [message]** | Other error | Read message, check Firestore console |

## 🚀 **Performance Tips**

If saves are still slow:
- [ ] Clear app cache (Settings → Apps → ShopLedger → Storage → Clear Cache)
- [ ] Reduce items per entry (max 50 items recommended)
- [ ] Disable auto-stock-update (Settings → Automation)
- [ ] Free up device RAM (close other apps)
- [ ] Ensure >500MB free storage

## 📝 **What Changed**

### Code Changes
```diff
# src/services/api.ts
- const WRITE_TIMEOUT_MS = 8_000;
+ const WRITE_TIMEOUT_MS = 15_000;  // Handle Android GC pauses

# src/components/modals/ManualEntryModal.tsx
- showToast('Save failed', 'error');
+ // Now shows specific error: timeout, permission, offline, etc.

# src/App.tsx
+ import DiagnosticsPanel from './components/common/DiagnosticsPanel';
+ <DiagnosticsPanel />  // Added debug panel
```

### New Files
- `src/utils/diagnosticLogger.ts` — Error capture system
- `src/components/common/DiagnosticsPanel.tsx` — Debug UI
- `ANDROID_ADD_EDIT_TROUBLESHOOTING.md` — Full troubleshooting guide
- `ANDROID_FIX_SUMMARY.md` — Detailed fix analysis

## 🔧 **Advanced Debugging**

### View All Logs in Console
```javascript
// In browser console:
import { diagnosticLogger } from './utils/diagnosticLogger';
diagnosticLogger.dumpToConsole();
```

### Check IndexedDB
Chrome DevTools → Application → IndexedDB → firestore_db
- Verify `ledger_entries`, `parties`, `inventory` collections exist
- Check total size (>10MB might be issue)

### Monitor Real-time Errors
```javascript
// In console:
const logs = [];
const origError = console.error;
console.error = (...args) => {
  logs.push(args);
  origError(...args);
};
console.table(logs);
```

## 📞 **Support Info**

When reporting issues, include:

✅ Device: Android version + model
✅ App version: Settings → About
✅ Steps to reproduce: Exact entry that fails
✅ Diagnostic logs: Output from DiagnosticsPanel or logcat
✅ Error message: Exact text shown in toast
✅ Data size: Number of items in entry

---

## 🎯 **Key Takeaway**

The app now handles **Android memory pressure better** by:
1. Waiting longer for IndexedDB to complete (15s vs 8s)
2. Showing clear error messages instead of generic failures
3. Providing debug visibility via DiagnosticsPanel

**For most users**: Just rebuild and deploy — no config changes needed.
**For low-memory devices**: The longer timeout should fix save failures.
**For debugging**: Use the DiagnosticsPanel (Ctrl+Shift+D) to see what's happening.

---

**Last Updated**: 2026-06-18  
**Status**: ✅ Ready for Production  
**Compatibility**: Android 8.0+, Capacitor 3.0+
