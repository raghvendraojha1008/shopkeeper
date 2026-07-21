import React, { useState } from 'react';
import { MessageSquare, AlertCircle, Loader2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

interface WhatsAppReminderProps {
  partyName: string;
  pendingAmount: number;
  phoneNumber?: string;
  businessName?: string;
  buttonSize?: 'sm' | 'md' | 'lg';
  variant?: 'icon' | 'button';
  className?: string;
}

// FIX: Normalise a raw phone string into the E.164 format expected by wa.me
// deep-links (digits only, with country code, no leading +).
// The old code only handled two cases; this handles the common variants that
// appear in party records:
//   "98765 43210"       → "9198765432​10"
//   "+91-98765-43210"   → "9198765432​10"
//   "091-98765-43210"   → "9198765432​10"
//   "919876543210"      → "9198765432​10" (already correct)
//   "9876543210"        → "9198765432​10" (10-digit, prepend 91)
function normalisePhone(raw: string): string {
  // Strip everything that is not a digit
  let digits = raw.replace(/\D/g, '');

  // Remove leading zero trunk prefix (STD-style: 0XXXXXXXXXX)
  if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.slice(1);
  }

  // 10-digit number without country code → prepend India's 91
  if (digits.length === 10) {
    return '91' + digits;
  }

  // Already includes 91 prefix (12 digits starting with 91)
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }

  // Return whatever we have — validation will catch bad numbers
  return digits;
}

function isValidIndianMobile(digits: string): boolean {
  // After normalisation: 12 digits starting with 91, mobile starts with 6-9
  return /^91[6-9]\d{9}$/.test(digits);
}

const WhatsAppReminder: React.FC<WhatsAppReminderProps> = ({
  partyName,
  pendingAmount,
  phoneNumber,
  businessName = 'Our Firm',
  buttonSize = 'md',
  variant = 'icon',
  className = '',
}) => {
  const [showPhoneInput, setShowPhoneInput] = useState(!phoneNumber);
  const [inputPhone, setInputPhone] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSendReminder = (rawPhone?: string) => {
    const source = rawPhone || phoneNumber || inputPhone;

    if (!source) {
      setError('Phone number is required');
      return;
    }

    // FIX: normalise before validation so "+91 98765 43210" passes correctly.
    const normalised = normalisePhone(source);

    if (!isValidIndianMobile(normalised)) {
      setError('Please enter a valid 10-digit Indian mobile number');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const message =
        `Hello ${partyName}, this is a reminder regarding your pending balance of ` +
        `₹${pendingAmount.toLocaleString('en-IN')} in our records. ` +
        `Please clear it at the earliest. - ${businessName}`;

      if (Capacitor.isNativePlatform()) {
        try { await Share.share({ text: message }); } catch (_) {}
      } else {
        const whatsappUrl = `https://wa.me/${normalised}?text=${encodeURIComponent(message)}`;
        window.open(whatsappUrl, '_blank');
      }
      setShowPhoneInput(false);
      setInputPhone('');
    } catch (err) {
      setError('Failed to open WhatsApp');
      console.error('WhatsApp error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const sizeClasses = { sm: 'p-1 text-xs', md: 'p-1.5 text-sm', lg: 'p-2 text-base' };
  const iconSizes   = { sm: 12, md: 16, lg: 20 };

  if (showPhoneInput) {
    return (
      <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 ${className}`}>
        <div className="rounded-2xl shadow-xl p-6 max-w-sm w-full animate-in fade-in zoom-in duration-200">
          <h3 className="text-lg font-bold mb-2">Send WhatsApp Reminder</h3>
          <p className="text-sm text-[var(--text-muted)] mb-4">
            To: <span className="font-bold">{partyName}</span>
          </p>

          {error && (
            <div className="bg-[var(--col-danger-15)] text-red-400 p-3 rounded-lg text-sm mb-4 flex items-center gap-2">
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-2">
              Phone Number
            </label>
            <input
              type="tel"
              placeholder="+91 98765 43210"
              value={inputPhone}
              onChange={(e) => setInputPhone(e.target.value)}
              className="w-full px-3 py-2 border border-white/12 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-green-500"
              disabled={isLoading}
            />
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Pending Amount: ₹{pendingAmount.toLocaleString('en-IN')}
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => { setShowPhoneInput(false); setInputPhone(''); setError(''); }}
              disabled={isLoading}
              className="flex-1 px-3 py-2 text-sm font-bold text-[var(--text-secondary)] rounded-lg hover:bg-[var(--rgba-white-10)] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSendReminder(inputPhone)}
              disabled={isLoading || !inputPhone.trim()}
              className="flex-1 px-3 py-2 text-sm font-bold text-white bg-green-500 rounded-lg hover:bg-green-600 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? <Loader2 size={14} className="animate-spin" /> : <MessageSquare size={14} />}
              Send
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'button') {
    return (
      <button
        onClick={() => setShowPhoneInput(true)}
        className={`flex items-center gap-2 text-white bg-green-500 hover:bg-green-600 active:scale-95 rounded-lg font-bold transition-all ${sizeClasses[buttonSize]} ${className}`}
      >
        <MessageSquare size={iconSizes[buttonSize]} />
        WhatsApp Reminder
      </button>
    );
  }

  return (
    <button
      onClick={() => setShowPhoneInput(true)}
      className={`text-emerald-400 hover:text-emerald-300 glass-icon-btn rounded-full active:scale-95 transition-all ${sizeClasses[buttonSize]} ${className}`}
      title="Send WhatsApp reminder"
    >
      <MessageSquare size={iconSizes[buttonSize]} />
    </button>
  );
};

export default WhatsAppReminder;

