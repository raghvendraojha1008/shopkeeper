---
name: Android export large-file fix
description: Why large PDFs/CSVs silently fail to share on Android Capacitor and how to fix it everywhere.
---

## The problem
Android's Binder IPC has a hard ~1 MB per-transaction limit. `Filesystem.writeFile` passes the entire file as a base64 string through this channel. A PDF for 50+ records is typically 2–5 MB raw (3–7 MB base64) — it silently fails without throwing a catchable JS error, so the share sheet never opens.

**Why:** `FileReader.readAsDataURL` on a large Blob is also slow and memory-hungry on the WebView thread; the Binder call to `Filesystem.writeFile` then drops the oversized payload silently.

## The fix (in `src/services/export.ts`)
1. Use `blob.arrayBuffer()` instead of `FileReader` (faster, non-blocking).
2. Write the first 49 152-byte chunk with `Filesystem.writeFile`.
3. Append remaining chunks with `Filesystem.appendFile` in a loop.
4. **Chunk size must be a multiple of 3 bytes** (e.g., `3 × 16384 = 49152`). This ensures every intermediate chunk encodes to base64 without padding (`=`). The Android native layer decodes each chunk independently and appends the binary bytes — with padding only on the last chunk, the output file is always correct.

Same chunked approach applied to `nativeShareText` for large CSV exports (500 KB text chunks).

## ⚠️ Directory: USE CACHE, NOT DOCUMENTS

**CRITICAL — do not revert this:** `Directory.Documents` maps to the PUBLIC external Documents folder (`/storage/emulated/0/Documents/`). On Android 10+ (API 29+), writing there requires `WRITE_EXTERNAL_STORAGE`. The AndroidManifest declares that permission only with `maxSdkVersion="28"`, so EVERY write to Directory.Documents fails with EACCES on API 29+.

**The fix:** Use `Directory.Cache` everywhere in `export.ts`.
- `Directory.Cache` = `getCacheDir()` — app-private, zero storage permission required on all API levels.
- `file_paths.xml` already has `<cache-path name="cache" path="." />` so the FileProvider exposes cache files as `content://` URIs.
- `@capacitor/share` wraps the `file://` URI through the FileProvider automatically — the share sheet opens correctly.
- Users can save the file from the share sheet (Downloads, Drive, etc.).

**Why Documents seemed to work before:** The directory was created during an older APK run when permissions were different, but file writes always fail on modern Android.

## Silent-failure pattern (now fixed)
Previously, errors in `nativeShareBlob`/`nativeShareText` were caught at the `sharePdfBlob`/`shareOrDownload` layer, fell back silently to a no-op `webDownload`, and the calling code still showed a success toast. **Fix:** Let errors propagate from `sharePdfBlob` and `shareOrDownload` so callers must wrap in try/catch and show real error toasts. `AbortError` (user dismissed share sheet) should be treated as non-error.

## How to apply
Any new native file write that may exceed ~750 KB (blob or text) must:
1. Use the chunked writeFile+appendFile pattern
2. Target `Directory.Cache` with the `Shopkeeper/Exports/` subfolder path
3. Wrap the caller in try/catch that handles `AbortError` silently and shows error toast otherwise
