/**
 * AnnouncementService — reads active announcements from the `announcements`
 * Firestore collection created and managed by the Super Admin Panel.
 *
 * The admin panel writes docs with this schema:
 *   title:          string
 *   message:        string
 *   type:           'info' | 'warning' | 'success' | 'maintenance'
 *   targetAudience: 'all' | 'active' | 'expired'
 *   isActive:       boolean
 *   createdBy:      string  (admin email)
 *   createdAt:      Timestamp
 *   expiresAt:      Timestamp | null
 *
 * Main app responsibilities:
 *  - Fetch only isActive === true docs
 *  - Filter client-side by targetAudience vs user's subscription status
 *  - Filter client-side by expiresAt > now() (or expiresAt === null)
 */

import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';

export interface Announcement {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'maintenance';
  targetAudience: 'all' | 'active' | 'expired';
  isActive: boolean;
  createdBy: string;
  createdAt: Timestamp | null;
  expiresAt: Timestamp | null;
}

/**
 * Fetch announcements relevant to a user based on their subscription status.
 * Returns at most 3 announcements to avoid overwhelming the UI.
 *
 * @param subscriptionStatus  - current user subscription status ('active' | 'trial' | 'expired' | 'grace' | undefined)
 */
export async function getActiveAnnouncements(
  subscriptionStatus?: string,
): Promise<Announcement[]> {
  try {
    const q = query(
      collection(db, 'announcements'),
      where('isActive', '==', true),
    );
    const snap = await getDocs(q);
    if (snap.empty) return [];

    const now = Date.now();

    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as Announcement))
      .filter(a => {
        // Expiry filter
        if (a.expiresAt && a.expiresAt.toMillis() < now) return false;

        // Audience filter
        if (a.targetAudience === 'all') return true;
        if (a.targetAudience === 'active') {
          return subscriptionStatus === 'active' || subscriptionStatus === 'trial';
        }
        if (a.targetAudience === 'expired') {
          return subscriptionStatus === 'expired' || subscriptionStatus === 'grace';
        }
        return true;
      })
      .slice(0, 3); // max 3 at a time
  } catch {
    // Non-fatal — announcements are supplementary
    return [];
  }
}
