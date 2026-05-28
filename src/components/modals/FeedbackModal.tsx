/**
 * FeedbackModal — lightweight in-app feedback collector.
 *
 * Three modes (the spec asks for bug / feature / rating in one entry point):
 *   - Bug      : description of a problem
 *   - Feature  : something the user wishes existed
 *   - Rating   : 1-5 stars + optional comment
 *
 * Submission goes through TelemetryService which writes to Firestore
 * (users/{uid}/feedback) — fire-and-forget with a success / failure toast.
 */

import React, { useState } from 'react';
import { X, Bug, Sparkles, Star, Send, Loader2 } from 'lucide-react';
import { useUI } from '../../context/UIContext';
import { TelemetryService, FeedbackType } from '../../services/telemetryService';
import { APP_VERSION } from '../../constants/appVersion';

interface Props {
  open    : boolean;
  onClose : () => void;
  userId  : string;
  screen ?: string;
}

const TABS: Array<{ id: FeedbackType; label: string; icon: React.ElementType; color: string }> = [
  { id: 'bug',     label: 'Report Bug',     icon: Bug,      color: '#ef4444' },
  { id: 'feature', label: 'Suggest Idea',   icon: Sparkles, color: '#a78bfa' },
  { id: 'rating',  label: 'Rate App',       icon: Star,     color: '#fbbf24' },
];

export const FeedbackModal: React.FC<Props> = ({ open, onClose, userId, screen }) => {
  const { showToast } = useUI();
  const [type, setType]       = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [rating, setRating]   = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const reset = () => {
    setMessage('');
    setRating(0);
    setType('bug');
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    // Validation: rating mode needs a star, others need a message.
    if (type === 'rating' && rating === 0) {
      showToast('Please pick a rating (1–5 stars)', 'error');
      return;
    }
    if (type !== 'rating' && message.trim().length < 5) {
      showToast('Please describe it in a few words', 'error');
      return;
    }

    setSubmitting(true);
    const ok = await TelemetryService.submitFeedback(userId, {
      type,
      message : message.trim(),
      rating  : type === 'rating' ? rating : undefined,
      screen,
    });
    setSubmitting(false);

    if (ok) {
      showToast('Thanks for your feedback!', 'success');
      reset();
      onClose();
    } else {
      // Telemetry swallows network errors so this is rare — still tell the user.
      showToast('Could not send feedback. Please try again.', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
      onClick={handleClose}
    >
      <div
        className="feedback-modal-root w-full max-w-md rounded-3xl overflow-hidden flex flex-col"
        style={{
          background: 'linear-gradient(180deg, #161a2e 0%, #0f1322 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          maxHeight: '90vh',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <div>
            <h2 className="text-lg font-black text-white">Send Feedback</h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'rgba(148,163,184,0.55)' }}>
              v{APP_VERSION} · helps us improve the app
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-transform disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.06)' }}
            aria-label="Close"
          >
            <X size={18} className="text-white" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 pt-4">
          <div className="grid grid-cols-3 gap-2">
            {TABS.map(tab => {
              const active = tab.id === type;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setType(tab.id)}
                  disabled={submitting}
                  className="py-2.5 rounded-2xl flex flex-col items-center gap-1 transition-all active:scale-95 disabled:opacity-40"
                  style={{
                    background: active ? `${tab.color}1f` : 'rgba(255,255,255,0.04)',
                    border    : `1px solid ${active ? tab.color + '55' : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <Icon size={16} style={{ color: active ? tab.color : 'rgba(148,163,184,0.55)' }} />
                  <span className="text-[10px] font-bold" style={{ color: active ? tab.color : 'rgba(148,163,184,0.7)' }}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-5 flex-1 overflow-y-auto">
          {/* Star picker (only for rating mode) */}
          {type === 'rating' && (
            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-wider block mb-2"
                style={{ color: 'rgba(148,163,184,0.55)' }}>
                How would you rate the app?
              </label>
              <div className="flex items-center gap-2 justify-center py-3 rounded-2xl"
                style={{ background: 'rgba(255,255,255,0.04)' }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    disabled={submitting}
                    className="active:scale-90 transition-transform p-2 disabled:opacity-40"
                    style={{ minWidth: 44, minHeight: 44 }}
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                  >
                    <Star
                      size={28}
                      strokeWidth={1.5}
                      style={{
                        color: n <= rating ? '#fbbf24' : 'rgba(148,163,184,0.3)',
                        fill : n <= rating ? '#fbbf24' : 'transparent',
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message field */}
          <label className="text-[10px] font-black uppercase tracking-wider block mb-2"
            style={{ color: 'rgba(148,163,184,0.55)' }}>
            {type === 'rating' ? 'Anything else? (optional)' :
             type === 'bug'    ? 'What went wrong?' :
                                 'What would you like to see?'}
          </label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            disabled={submitting}
            rows={5}
            maxLength={2000}
            placeholder={
              type === 'bug'     ? 'e.g. The invoice PDF crashes when I add 20+ items…' :
              type === 'feature' ? 'e.g. I wish I could schedule daily reminders for…' :
                                   'e.g. Love the offline mode, but…'
            }
            className="w-full px-4 py-3 rounded-2xl text-sm font-medium outline-none resize-none disabled:opacity-40"
            style={{
              background: 'rgba(255,255,255,0.05)',
              border    : '1px solid rgba(255,255,255,0.08)',
              color     : 'rgba(240,244,255,0.95)',
              minHeight : '120px',
            }}
          />
          <p className="text-[9px] mt-1.5 text-right" style={{ color: 'rgba(148,163,184,0.4)' }}>
            {message.length}/2000
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3.5 rounded-2xl font-black text-white text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', boxShadow: '0 8px 20px rgba(99,102,241,0.3)' }}
          >
            {submitting ? (
              <><Loader2 size={16} className="animate-spin" /> Sending…</>
            ) : (
              <><Send size={14} /> Send Feedback</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
