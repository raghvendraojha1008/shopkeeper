import { collection, addDoc, getDocs, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../config/firebase';

export interface AuditLog {
  id?: string;
  timestamp: string;
  action: 'create' | 'update' | 'delete' | 'restore';
  collection: string;
  document_id: string;
  user_email?: string;
  user_name?: string;
  summary: string;
  changes?: {
    field: string;
    old_value?: any;
    new_value?: any;
  }[];
  metadata?: Record<string, any>;
}

export const AuditService = {
  /**
   * Log an action to the audit trail
   */
  log: async (
    uid: string, 
    action: AuditLog['action'], 
    collectionName: string, 
    documentId: string, 
    summary: string,
    options?: {
      userEmail?: string;
      userName?: string;
      changes?: AuditLog['changes'];
      metadata?: Record<string, any>;
    }
  ) => {
    try {
      const raw: Omit<AuditLog, 'id'> = {
        timestamp: new Date().toISOString(),
        action,
        collection: collectionName,
        document_id: documentId,
        summary,
        user_email: options?.userEmail,
        user_name: options?.userName,
        changes: options?.changes,
        metadata: options?.metadata
      };

      // Firestore rejects documents with `undefined` field values — strip them out
      const logEntry = Object.fromEntries(
        Object.entries(raw).filter(([, v]) => v !== undefined)
      ) as Omit<AuditLog, 'id'>;

      await addDoc(collection(db, `users/${uid}/audit_logs`), logEntry);
    } catch (e) {
      console.error('Audit log failed:', e);
      // Don't throw - audit logging should not break the main operation
    }
  },

  /**
   * Get recent audit logs
   */
  getRecent: async (uid: string, count: number = 50) => {
    try {
      const q = query(
        collection(db, `users/${uid}/audit_logs`),
        orderBy('timestamp', 'desc'),
        limit(count)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() })) as AuditLog[];
    } catch (e) {
      console.error('Failed to fetch audit logs:', e);
      return [];
    }
  },

  /**
   * Get audit logs for a specific document
   */
  getForDocument: async (uid: string, collectionName: string, documentId: string) => {
    try {
      const q = query(
        collection(db, `users/${uid}/audit_logs`),
        where('collection', '==', collectionName),
        where('document_id', '==', documentId),
        orderBy('timestamp', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() })) as AuditLog[];
    } catch (e) {
      console.error('Failed to fetch document audit logs:', e);
      return [];
    }
  },

  /**
   * Get audit logs by action type
   */
  getByAction: async (uid: string, action: AuditLog['action'], count: number = 50) => {
    try {
      const q = query(
        collection(db, `users/${uid}/audit_logs`),
        where('action', '==', action),
        orderBy('timestamp', 'desc'),
        limit(count)
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() })) as AuditLog[];
    } catch (e) {
      console.error('Failed to fetch audit logs by action:', e);
      return [];
    }
  },

  /**
   * Helper to generate change summary
   */
  generateChangeSummary: (oldData: any, newData: any): AuditLog['changes'] => {
    const changes: AuditLog['changes'] = [];
    const allKeys = new Set([...Object.keys(oldData || {}), ...Object.keys(newData || {})]);
    
    allKeys.forEach(key => {
      if (key === 'id' || key === 'created_at') return;
      
      const oldVal = oldData?.[key];
      const newVal = newData?.[key];
      
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changes.push({
          field: key,
          old_value: oldVal,
          new_value: newVal
        });
      }
    });
    
    return changes;
  }
};







