# Android Add/Edit Entry Troubleshooting Guide

## Issue
Unable to add or edit entries in the Android app built with Capacitor. Saves fail with generic errors or no visible error messages.

## Root Causes Identified

### 1. **Memory Pressure & Write Timeouts** (Most Common on Low-Memory Devices)
- **Symptom**: Save appears to hang, then fails with "Save timed out" or "Save failed"
- **Cause**: Android devices with low available RAM trigger aggressive garbage collection (GC) pauses that block IndexedDB writes for several seconds
- **Evidence**: Logcat shows `MALI GPU` memory allocation errors and `Null anb` warnings
- **Fixed in**: Increased `WRITE_TIMEOUT_MS` from 8s to 15s in `/src/services/api.ts`

### 2. **Inadequate Error Reporting**
- **Symptom**: "Save failed" toast with no details about what went wrong
- **Cause**: Previous error handling didn't distinguish between different failure types
- **Fixed in**: Added detailed error messages in `ManualEntryModal.tsx` (lines 837-853)

### 3. **Firestore Persistence Cache Issues**
- **Symptom**: Save succeeds locally but never syncs to Firestore
- **Cause**: IndexedDB corruption or storage quota exceeded
- **Fixed in**: Added diagnostic logging to detect persistence layer failures

## How to Debug

### Step 1: Enable Diagnostics Panel
1. **On Android WebView**: Press `Ctrl+Shift+D` (if USB debugging is enabled with DevTools)
2. **Or**: Open the app and look for a "📋 Debug Logs" button in the bottom-right (press to expand)

### Step 2: Attempt the Add/Edit Operation
1. Fill in entry form completely
2. Click Save
3. Note any error messages that appear
4. Check the Diagnostics Panel for detailed error logs

### Step 3: Capture Logcat Output
```bash
# On your development machine:
adb logcat -s "com.shopledger.india" > debug_logs.txt

# Then reproduce the issue and let it run for 30 seconds
# Copy the output for analysis
```

### Step 4: Check Console Errors (Developer Tools)
If using Capacitor Dev App or remote debugging:
1. Run: `adb forward tcp:9223 localabstract:WebViewDebugger`
2. Open Chrome: `chrome://inspect`
3. Look for JavaScript errors in the Console tab
4. Check the Network tab for failed API calls

## Solutions by Error Type

### Error: "Save timed out — queued for background sync"
**What it means**: The write took longer than expected (>15 seconds)

**Solutions** (try in order):
1. **Clear app cache**: Settings → Apps → ShopLedger → Storage → Clear Cache
2. **Restart device**: Often resolves memory pressure issues
3. **Close other apps**: Free up RAM before saving
4. **Check storage**: Ensure device has >500MB free space
5. **Update app**: Latest version has better memory management

### Error: "Permission denied — check authentication"
**What it means**: Firestore denied the write (authentication/authorization issue)

**Solutions**:
1. Logout and login again
2. Check Firebase Security Rules in the console
3. Verify user has correct role permissions

### Error: "Offline — will sync when connection restored"
**What it means**: Device lost connectivity during save

**Solutions**:
1. Check WiFi/mobile connection
2. Try again when connection is stable
3. Entry should auto-sync when back online

### Error: "Save failed: [specific error message]"
**What it means**: A specific Firestore error occurred

**Solutions**:
1. Read the error message carefully (the main message after "Save failed:")
2. Check Firebase console for any security rule violations
3. Verify data is valid (all required fields filled)

## Performance Optimization

### Reduce Memory Pressure
1. **Enable Auto-Cleanup**: Settings → Data Management → Auto-clean old records
2. **Reduce Page Size**: Settings → Display → Reduce list item detail
3. **Disable Auto-Sync**: Temporarily disable background sync if device is very low on memory

### Speed Up Saves
1. **Minimize Item Lines**: Fewer items in a single entry = faster save
2. **Disable Auto-Stock-Update**: Settings → Automation → uncheck "Auto-update inventory"
3. **Reduce Batch Size**: Don't add >50 items in one bulk import

## Advanced Debugging

### View Diagnostic Logs in Code
```typescript
// In browser console or DevTools:
import { diagnosticLogger } from './utils/diagnosticLogger';
diagnosticLogger.dumpToConsole();  // Dumps all recent errors
diagnosticLogger.getLogs();         // Returns formatted string of all logs
```

### Monitor Writes in Real-time
```typescript
// Add to your DevTools console:
const logs = [];
const originalError = console.error;
console.error = function(...args) {
  logs.push(args);
  originalError.apply(console, args);
};
console.table(logs);
```

### Check IndexedDB Status
1. Open Chrome DevTools (Capacitor Dev App)
2. Go to Application → IndexedDB
3. Look for `firestore_db` 
4. Check if collections (ledger_entries, parties, etc.) are present
5. Inspect collection size — if >10MB, may need cleanup

## Firestore Rules to Check

If getting "Permission denied" errors, verify these rules exist:

```javascript
// All users can read/write their own subcollections:
match /users/{uid}/{document=**} {
  allow read, write: if request.auth.uid == uid;
}

// Settings require authentication:
match /users/{uid}/settings/{document=**} {
  allow read, write: if request.auth.uid == uid;
}
```

## When to Contact Support

Provide these details if the issue persists:

1. **Device Info**: Android version, RAM, device model
2. **App Version**: Check Settings → About
3. **Steps to Reproduce**: Exact steps that cause the failure
4. **Diagnostic Logs**: Output from DiagnosticsPanel or logcat
5. **Console Errors**: JavaScript errors from DevTools if available
6. **Entry Type**: What type of entry fails (sales, purchases, inventory, etc.)
7. **Data Size**: How many items/fields in the entry

## Latest Fixes (This Version)

- ✅ Increased write timeout from 8s to 15s to handle Android GC pauses
- ✅ Added detailed error messages distinguishing between timeout/permission/offline errors
- ✅ Implemented DiagnosticsPanel for real-time error visibility
- ✅ Added diagnostic logging to all Firestore writes
- ✅ Better error categorization in catch blocks

## References

- [Firebase Firestore Android Best Practices](https://firebase.google.com/docs/firestore/best-practices)
- [Android Memory Management](https://developer.android.com/topic/performance/memory)
- [Capacitor WebView Debugging](https://capacitorjs.com/docs/guides/debugging)
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

---

**Last Updated**: 2026-06-18
**Applies To**: ShopLedger v3.0+, Android 8.0+
