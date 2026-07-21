import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

/**
 * Detect if running inside a real native Capacitor shell.
 * Avoids calling Capacitor Filesystem/Share on web where they throw.
 */
const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/**
 * Subfolder inside the app Documents storage where ALL exported files are written.
 *
 * WHY DOCUMENTS (under the backup root):
 *   The backup service already uses Directory.Documents at this same root
 *   (ShopkeeperLedger_backups/...) and it works reliably on all tested devices.
 *   Using the same parent directory ensures:
 *   1. The folder is already created by the backup flow on first run.
 *   2. Files are permanently saved and visible in the device file manager.
 *   3. The FileProvider's <external-path> in file_paths.xml covers the entire
 *      external-files path so Share can still produce a content:// URI.
 *
 *   IMPORTANT: Files written here are PERMANENTLY saved to the device.
 *   The share sheet then opens so the user can optionally forward the file.
 *   Closing the share sheet does NOT remove the saved file.
 */
const EXPORT_FOLDER = 'ShopkeeperLedger_backups/Exports';

/**
 * Web-only: trigger a file download via hidden anchor tag.
 */
function webDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/**
 * Web Share API — shows the native share sheet on mobile browsers that support it.
 * Falls back to webDownload if not supported or if sharing fails.
 */
async function webShare(blob: Blob, filename: string): Promise<void> {
  try {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    ) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') console.warn('webShare fallback to download:', e);
  }
  webDownload(blob, filename);
}

/**
 * Encode a Uint8Array slice to base64 without spread/apply.
 * Avoids call-stack overflow for large buffers.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Ensure the shared export subfolder exists in the app Documents storage.
 * Errors from "already exists" are silently swallowed — that is expected.
 */
async function ensureExportFolder(): Promise<void> {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.mkdir({
      path: EXPORT_FOLDER,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch { /* folder already exists — fine */ }
}

/**
 * Native binary (PDF / blob) sharing.
 *
 * LARGE-FILE FIX (Binder IPC 1 MB limit):
 *   Android's Binder IPC drops payloads > ~1 MB silently. A bulk-party PDF
 *   is typically 2–5 MB raw (3–7 MB base64). Fix: write in 49 152-byte raw
 *   chunks (= 65 536 base64 chars). Each chunk is a multiple of 3 raw bytes
 *   so base64 has no mid-stream padding — the native layer decodes each chunk
 *   independently and appends the correct binary bytes.
 *
 * PERMISSION FIX (EACCES on Android 10+):
 *   Writes to Directory.Cache (app-private, zero permission required).
 *   file_paths.xml already includes <cache-path> so the FileProvider can
 *   expose the file as a content:// URI for the share intent.
 */
async function nativeShareBlob(blob: Blob, filename: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  await ensureExportFolder();
  const filePath = `${EXPORT_FOLDER}/${filename}`;

  // arrayBuffer() is faster + more memory-efficient than FileReader for large blobs
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 3 × 16 384 = 49 152 raw bytes → 65 536 base64 chars (~64 KB) per IPC call
  const CHUNK = 3 * 16384;

  const result = await Filesystem.writeFile({
    path: filePath,
    data: uint8ToBase64(bytes.subarray(0, Math.min(CHUNK, bytes.length))),
    directory: Directory.Documents, // ← Documents: permanently saved to device
    recursive: true,
  });

  for (let i = CHUNK; i < bytes.length; i += CHUNK) {
    await Filesystem.appendFile({
      path: filePath,
      data: uint8ToBase64(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))),
      directory: Directory.Documents, // ← Documents: permanently saved to device
    });
  }

  let fileUri = result.uri;
  if (!fileUri) {
    try {
      const uriResult = await Filesystem.getUri({
        path: filePath,
        directory: Directory.Documents, // ← Documents: permanently saved to device
      });
      fileUri = uriResult.uri;
    } catch {
      throw new Error('Could not resolve file URI for: ' + filePath);
    }
  }

  // File is already permanently saved to Documents. Share sheet is optional —
  // user dismissing it (AbortError) does NOT delete the saved file.
  try {
    await Share.share({ title: filename, dialogTitle: filename, files: [fileUri] });
  } catch (e: any) {
    if (e?.name !== 'AbortError') throw e;
  }
}

/**
 * Native text (CSV / JSON / plain text) sharing.
 *
 * Same chunked approach as nativeShareBlob — large CSVs can exceed the
 * Binder 1 MB limit when passed as a single UTF-8 string.
 * Written to Cache/Shopkeeper/Exports (no storage permission required).
 */
async function nativeShareText(content: string, filename: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  await ensureExportFolder();
  const filePath = `${EXPORT_FOLDER}/${filename}`;

  // 500 KB text chunks — safe headroom under the 1 MB Binder limit
  const CHUNK = 500 * 1024;

  const result = await Filesystem.writeFile({
    path: filePath,
    data: content.slice(0, CHUNK),
    directory: Directory.Documents, // ← Documents: permanently saved to device
    encoding: 'utf8' as any,
    recursive: true,
  });

  for (let i = CHUNK; i < content.length; i += CHUNK) {
    await Filesystem.appendFile({
      path: filePath,
      data: content.slice(i, i + CHUNK),
      directory: Directory.Documents, // ← Documents: permanently saved to device
      encoding: 'utf8' as any,
    });
  }

  let fileUri = result.uri;
  if (!fileUri) {
    try {
      const uriResult = await Filesystem.getUri({
        path: filePath,
        directory: Directory.Documents, // ← Documents: permanently saved to device
      });
      fileUri = uriResult.uri;
    } catch {
      throw new Error('Could not resolve file URI for: ' + filePath);
    }
  }

  // File is already permanently saved to Documents. Share sheet is optional —
  // user dismissing it (AbortError) does NOT delete the saved file.
  try {
    await Share.share({ title: filename, dialogTitle: filename, files: [fileUri] });
  } catch (e: any) {
    if (e?.name !== 'AbortError') throw e;
  }
}

export const exportService = {
  /** Convert Blob to Base64 (strips "data:..." prefix) */
  blobToBase64: (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  /**
   * Cross-platform PDF / blob Export & Share.
   * Web: downloads file directly.
   * Android: writes to Cache/Shopkeeper/Exports + opens native share sheet.
   * Works for any file size (chunked IPC writes on Android).
   *
   * Throws on failure — callers must catch and show a real error toast.
   * (Previously errors were swallowed, causing the success toast to fire
   *  even when nothing was actually downloaded.)
   */
  sharePdfBlob: async (blob: Blob, filename: string): Promise<boolean> => {
    if (isNative()) {
      // Let errors propagate so the caller's catch block shows an error toast
      await nativeShareBlob(blob, filename);
    } else {
      try {
        await webShare(blob, filename);
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          console.error('❌ sharePdfBlob webShare failed:', e);
          webDownload(blob, filename);
        }
      }
    }
    return true;
  },

  /**
   * Save a base64-encoded file and open the share sheet.
   * Written to Cache/Shopkeeper/Exports (no permission required on Android 10+).
   */
  saveBase64File: async (base64: string, filename: string): Promise<void> => {
    // Decode base64 → Uint8Array → Blob, then share via the unified path
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    if (isNative()) {
      await nativeShareBlob(blob, filename);
    } else {
      const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
      await webShare(pdfBlob, filename);
    }
  },

  /** Save and open/share a base64-encoded file */
  saveAndOpenFile: async (base64: string, filename: string, _mimeType?: string): Promise<void> => {
    await exportService.saveBase64File(base64, filename);
  },

  /** Share text via WhatsApp */
  shareToWhatsApp: async (text: string): Promise<void> => {
    if (isNative()) {
      try { await Share.share({ text }); } catch (_) {}
    } else {
      const encoded = encodeURIComponent(text);
      window.open(`https://wa.me/?text=${encoded}`, '_blank');
    }
  },

  /**
   * Generic share or download (text content like CSV / JSON).
   * On Android: writes to Cache/Shopkeeper/Exports then opens the native share sheet.
   * Throws on failure so callers can show a real error toast.
   */
  shareOrDownload: async (content: string, filename: string, mimeType: string): Promise<void> => {
    if (isNative()) {
      await nativeShareText(content, filename);
    } else {
      try {
        const blob = new Blob([content], { type: mimeType });
        await webShare(blob, filename);
      } catch (error) {
        console.error('❌ shareOrDownload failed:', error);
        const blob = new Blob([content], { type: mimeType });
        webDownload(blob, filename);
      }
    }
  },

  /** CSV Export — opens share sheet on Android after writing to Cache/Exports folder */
  exportToCSV: async (data: any[], headers: string[], filename: string): Promise<void> => {
    const rows = [
      headers.join(','),
      ...data.map(row => headers.map(h => {
        const val = row[h] ?? '';
        return `"${String(val).replace(/"/g, '""')}"`;
      }).join(','))
    ];
    const csvContent = rows.join('\n');
    await exportService.shareOrDownload(csvContent, filename, 'text/csv');
  },
};
