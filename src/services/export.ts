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
    // User cancelled share or API failed — fall through to download
    if (e?.name !== 'AbortError') console.warn('webShare fallback to download:', e);
  }
  webDownload(blob, filename);
}

/**
 * Native-only helpers — lazily imported so they don't break on web.
 */
async function nativeShareBlob(blob: Blob, filename: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  // Convert blob → base64
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const result = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });

  let fileUri = result.uri;
  if (!fileUri) {
    try {
      const uriResult = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      fileUri = uriResult.uri;
    } catch {
      throw new Error('Could not resolve file URI');
    }
  }

  // Share as a real file attachment (uses Android FileProvider + correct MIME by extension)
  // WhatsApp/Drive/Gmail reject `url:` for local files with "not a document" — must use `files:`.
  await Share.share({ title: filename, dialogTitle: filename, files: [fileUri] });
}

async function nativeShareText(content: string, filename: string): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');

  const result = await Filesystem.writeFile({
    path: filename,
    data: content,
    directory: Directory.Cache,
    encoding: 'utf8' as any,
  });

  let fileUri = result.uri;
  if (!fileUri) {
    try {
      const uriResult = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
      fileUri = uriResult.uri;
    } catch {
      throw new Error('Could not resolve file URI');
    }
  }

  // Share as a real file attachment (uses Android FileProvider + correct MIME by extension)
  // WhatsApp/Drive/Gmail reject `url:` for local files with "not a document" — must use `files:`.
  await Share.share({ title: filename, dialogTitle: filename, files: [fileUri] });
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
   * Cross-platform PDF/file Export & Share
   * Web: downloads file. Android: writes to cache + native share sheet.
   */
  sharePdfBlob: async (blob: Blob, filename: string): Promise<boolean> => {
    try {
      if (isNative()) {
        await nativeShareBlob(blob, filename);
      } else {
        await webShare(blob, filename);
      }
      return true;
    } catch (error) {
      console.error('❌ sharePdfBlob failed:', error);
      // Fallback: try web download even on native if share fails
      try {
        webDownload(blob, filename);
        return true;
      } catch (e2) {
        console.error('❌ Web fallback also failed:', e2);
        return false;
      }
    }
  },

  /** Save Base64 string and share/download */
  saveBase64File: async (base64: string, filename: string): Promise<void> => {
    try {
      if (isNative()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');
        const result = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        let fileUri = result.uri;
        if (!fileUri) {
          const uriResult = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
          fileUri = uriResult.uri;
        }
        // Use files[] (not url) so WhatsApp/Drive treat this as a real document attachment.
        await Share.share({ title: filename, dialogTitle: filename, files: [fileUri] });
      } else {
        // Web: convert base64 to blob, then try Web Share API, fallback to download
        const byteChars = atob(base64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteNumbers[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
        await webShare(blob, filename);
      }
    } catch (error) {
      console.error('❌ saveBase64File failed:', error);
      // Fallback: try direct data URI download
      const a = document.createElement('a');
      a.href = 'data:application/pdf;base64,' + base64;
      a.download = filename;
      a.click();
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

  /** Generic share or download (text content like CSV) */
  shareOrDownload: async (content: string, filename: string, mimeType: string): Promise<void> => {
    try {
      if (isNative()) {
        await nativeShareText(content, filename);
      } else {
        const blob = new Blob([content], { type: mimeType });
        await webShare(blob, filename);
      }
    } catch (error) {
      console.error('❌ shareOrDownload failed:', error);
      const blob = new Blob([content], { type: mimeType });
      webDownload(blob, filename);
    }
  },

  /** CSV Export */
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
  }
};
