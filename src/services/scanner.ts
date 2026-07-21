import { Capacitor } from '@capacitor/core';

// Barcode Scanner Service
export const ScannerService = {
  isAvailable: (): boolean => {
    return Capacitor.isNativePlatform();
  },

  scan: async (): Promise<string | null> => {
    if (!Capacitor.isNativePlatform()) {
      console.warn('Barcode scanning is only available on native platforms');
      return null;
    }

    try {
      // Dynamic import to avoid errors on web
      
      // @ts-ignore
      const { BarcodeScanner } = await import('@capacitor-community/barcode-scanner');
      
      // Check permission
      const status = await BarcodeScanner.checkPermission({ force: true });
      
      if (!status.granted) {
        console.warn('Camera permission not granted');
        return null;
      }

      // Hide webview background for camera view
      document.querySelector('body')?.classList.add('scanner-active');
      
      // Start scanning
      const result = await BarcodeScanner.startScan();
      
      // Show webview again
      document.querySelector('body')?.classList.remove('scanner-active');
      
      if (result.hasContent) {
        return result.content;
      }
      
      return null;
    } catch (error) {
      console.error('Scanning error:', error);
      document.querySelector('body')?.classList.remove('scanner-active');
      return null;
    }
  },

  stopScan: async () => {
    if (!Capacitor.isNativePlatform()) return;
    
    try {
      // @ts-ignore
      const { BarcodeScanner } = await import('@capacitor-community/barcode-scanner');
      await BarcodeScanner.stopScan();
      document.querySelector('body')?.classList.remove('scanner-active');
    } catch (error) {
      console.error('Stop scan error:', error);
    }
  },
};

// Contact Picker Service
export const ContactService = {
  isAvailable: (): boolean => {
    return Capacitor.isNativePlatform();
  },

  pickContact: async (): Promise<{ name: string; phone: string } | null> => {
    if (!Capacitor.isNativePlatform()) {
      console.warn('Contact picking is only available on native platforms');
      return null;
    }

    try {
      
      // @ts-ignore
      const { Contacts } = await import('@capacitor-community/contacts');
      
      // Request permission
      const permission = await Contacts.requestPermissions();
      if (permission.contacts !== 'granted') {
        console.warn('Contacts permission not granted');
        return null;
      }

      // Pick a contact — use getContacts + return first match
      // (pickContact API differs between plugin versions; getContacts is stable)
      const result: any = await (Contacts as any).getContacts({
        projection: { name: true, phones: true },
      });

      const first = result?.contacts?.[0];
      if (first) {
        const name  = first.name?.display || first.name?.given || '';
        const phone = first.phones?.[0]?.number || '';
        return {
          name: name.trim(),
          phone: phone.replace(/\s+/g, ''),
        };
      }

      return null;
    } catch (error) {
      console.error('Contact picker error:', error);
      return null;
    }
  },
};







