import { GoogleAuthProvider, signInWithPopup, getAuth } from 'firebase/auth';
import { BackupService } from './backup';
import { LastBackupTracker } from './lastBackupTracker';
import { GoogleTokenService } from './googleTokenService';

const DRIVE_SCOPE    = 'https://www.googleapis.com/auth/drive.file';
const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';
const ALL_SCOPES     = [DRIVE_SCOPE, CONTACTS_SCOPE];

async function getDriveAccessToken(): Promise<string> {
  // 1. Reuse the token obtained at login (no popup needed)
  const stored = GoogleTokenService.get();
  if (stored && GoogleTokenService.hasScope(DRIVE_SCOPE)) return stored;

  // 2. Token expired / not stored → re-auth with both scopes.
  //    No 'consent' prompt: user already granted access at login.
  const auth = getAuth();
  const provider = new GoogleAuthProvider();
  ALL_SCOPES.forEach(s => provider.addScope(s));
  provider.setCustomParameters({ prompt: 'select_account' });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) throw new Error('Google sign-in succeeded but no access token was returned.');

  GoogleTokenService.set(credential.accessToken, 3600, ALL_SCOPES);
  return credential.accessToken;
}

async function findExistingFile(accessToken: string, fileName: string): Promise<string | null> {
  const query = encodeURIComponent(`name='${fileName}' and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

async function uploadFileToDrive(
  accessToken: string,
  fileName: string,
  content: string,
  existingFileId?: string | null,
): Promise<{ id: string; name: string }> {
  const metadata = {
    name: fileName,
    mimeType: 'application/json',
    description: `ShopKeeper Ledger backup — ${new Date().toLocaleString('en-IN')}`,
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([content], { type: 'application/json' }));

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name`;

  const method = existingFileId ? 'PATCH' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

export interface DriveBackupResult {
  success: boolean;
  fileName?: string;
  message: string;
}

export const GoogleDriveBackupService = {
  backupToGoogleDrive: async (uid: string, userEmail?: string): Promise<DriveBackupResult> => {
    try {
      const accessToken = await getDriveAccessToken();

      const backupData = await BackupService.createBackup(uid);
      const date = new Date().toISOString().split('T')[0];
      const emailPrefix = userEmail
        ? userEmail.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_')
        : 'user';
      const fileName = `ShopKeeper_Backup_${emailPrefix}_${date}.json`;
      const content = JSON.stringify(backupData, null, 2);

      const existingId = await findExistingFile(accessToken, fileName);
      const fileInfo = await uploadFileToDrive(accessToken, fileName, content, existingId);

      LastBackupTracker.markCompleted(uid, 'google-drive');

      return {
        success: true,
        fileName: fileInfo.name,
        message: `Saved to Google Drive: "${fileInfo.name}"`,
      };
    } catch (err: any) {
      console.error('[GoogleDriveBackup] error:', err);

      if (
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/cancelled-popup-request'
      ) {
        return { success: false, message: 'Sign-in was cancelled. Please try again.' };
      }
      if (err?.code === 'auth/popup-blocked') {
        return { success: false, message: 'Popup was blocked. Allow popups for this app and try again.' };
      }

      return { success: false, message: err?.message || 'Google Drive backup failed.' };
    }
  },
};
