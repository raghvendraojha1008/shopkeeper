import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useBackHandler } from '../../services/useBackHandler';
import { User } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { 
  X, ArrowRight, Image as ImageIcon, Loader2, 
  CheckCircle2, Edit2, Sparkles,
  Send, WifiOff, RefreshCw, Mic, MicOff, StopCircle,
  ShoppingCart, ShoppingBag, CreditCard, Package, Users, 
  Wallet, Truck, ChevronDown, ChevronUp, Lightbulb
} from 'lucide-react';
import { GeminiService } from '../../services/gemini';
import { ApiService } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { useData } from '../../context/DataContext';
import { AppSettings } from '../../types';
import { haptic } from '../../utils/haptics';
import { OfflineQueueService } from '../../services/offlineQueue';
import { SyncQueueService } from '../../services/syncQueue';
import { getIDForEntry } from '../../utils/idGenerator';
import ManualEntryModal from '../modals/ManualEntryModal';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  data?: any[];
  timestamp: Date;
}

interface CommandModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  onSuccess?: () => void;
  appSettings?: AppSettings;
}

// Collection icon + label helper
const getCollectionMeta = (item: any) => {
  const col = item.collection || '';
  const type = item.type || '';
  if (col === 'ledger_entries' && type === 'sell')     return { icon: ShoppingCart,  label: 'Sale',     color: '#34d399', bg: 'rgba(52,211,153,0.12)' };
  if (col === 'ledger_entries' && type === 'purchase') return { icon: ShoppingBag,   label: 'Purchase', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' };
  if (col === 'transactions'   && type === 'received') return { icon: CreditCard,    label: 'Received', color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' };
  if (col === 'transactions'   && type === 'paid')     return { icon: CreditCard,    label: 'Paid',     color: '#f87171', bg: 'rgba(248,113,113,0.12)' };
  if (col === 'expenses')   return { icon: Wallet,  label: 'Expense',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' };
  if (col === 'inventory')  return { icon: Package, label: 'Item',     color: '#34d399', bg: 'rgba(52,211,153,0.12)' };
  if (col === 'parties')    return { icon: Users,   label: 'Party',    color: '#818cf8', bg: 'rgba(129,140,248,0.12)' };
  if (col === 'vehicles')   return { icon: Truck,   label: 'Vehicle',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' };
  return { icon: Package, label: 'Entry', color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
};

const QUICK_CHIPS = [
  'Sold 50 cement bags to Rahul for ₹18,000',
  'Received ₹5,000 from Suresh via UPI',
  'Add customer Amit Singh, contact 9876543210',
  'Spent ₹200 on fuel',
  'Add item Steel Rod, ₹45/kg',
  'Paid ₹10,000 to supplier Vinod',
];

// Auto-resize textarea util
function useAutoResize(value: string, maxLines = 5) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const lineH = 24; // px per line
    const padV  = 24; // top + bottom padding
    const maxH  = lineH * maxLines + padV;
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px';
    el.style.overflowY = el.scrollHeight > maxH ? 'auto' : 'hidden';
  }, [value, maxLines]);
  return ref;
}

const CommandModal: React.FC<CommandModalProps> = ({ isOpen, onClose, user, onSuccess, appSettings }) => {
  const { showToast } = useUI();
  const { useParties, useInventory, invalidateAll } = useData();

  useBackHandler(onClose, isOpen, 10);
  
  const { data: parties } = useParties(user.uid);
  const { data: inventory } = useInventory(user.uid);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useAutoResize(input);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [savingMsgIds, setSavingMsgIds] = useState<Set<string>>(new Set());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  
  const [editData, setEditData] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showChips, setShowChips] = useState(true);

  // ── Voice / Mic ────────────────────────────────────────────────────────────
  const isNative = useMemo(() => Capacitor.isNativePlatform(), []);

  // Web Speech API (non-native only)
  const speechSupported = useMemo(
    () => !isNative && !!(
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    ), []
  );

  // MediaRecorder API — works in Android WebView for native, and in Chrome for web
  const mediaSupported = useMemo(() => typeof MediaRecorder !== 'undefined', []);

  // We show mic if EITHER speech or media is supported
  const micSupported = speechSupported || mediaSupported;

  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micMode, setMicMode] = useState<'speech' | 'media' | null>(null);
  const recognitionRef   = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);
  const timerRef         = useRef<any>(null);
  const pendingVoiceRef  = useRef<string>('');

  const cancelledRef = useRef(false);

  const stopRecording = useCallback(() => {
    // Stop Speech Recognition
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    // Clear timer
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
    setRecordingSeconds(0);
    setMicMode(null);
  }, []);

  // Cancel recording without sending
  const cancelRecording = useCallback(() => {
    cancelledRef.current = true;
    pendingVoiceRef.current = '';
    // Abort Speech Recognition (no onend fired)
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    // Clear chunks so onstop skips processing
    audioChunksRef.current = [];
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setIsRecording(false);
    setRecordingSeconds(0);
    setMicMode(null);
    setInput('');
    haptic.light();
    // reset flag after a tick
    setTimeout(() => { cancelledRef.current = false; }, 200);
  }, []);

  // Start mic — prefer Speech API on web (gives live transcript), fall back to MediaRecorder
  const startRecording = useCallback(async () => {
    haptic.medium();

    // ── Path A: Web Speech API (non-native only) ──────────────────────────
    if (speechSupported) {
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SR();
      recognition.lang = 'en-IN';
      recognition.interimResults = true;
      recognition.continuous = false;

      let finalTranscript = '';

      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += t;
          else interim += t;
        }
        setInput(finalTranscript + interim);
      };

      recognition.onend = () => {
        setIsRecording(false);
        setMicMode(null);
        recognitionRef.current = null;
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setRecordingSeconds(0);
        if (finalTranscript.trim()) {
          pendingVoiceRef.current = finalTranscript.trim();
          setTimeout(() => {
            if (pendingVoiceRef.current) {
              handleSendWithText(pendingVoiceRef.current);
              pendingVoiceRef.current = '';
            }
          }, 100);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech error:', event.error);
        if (event.error === 'not-allowed') showToast('Microphone permission denied', 'error');
        stopRecording();
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsRecording(true);
      setMicMode('speech');
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
      return;
    }

    // ── Path B: MediaRecorder (native Android / Chrome without Speech API) ─
    if (mediaSupported) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
          : '';
        
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        audioChunksRef.current = [];

        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        recorder.onstop = async () => {
          // Release mic
          stream.getTracks().forEach(t => t.stop());
          setIsRecording(false);
          setMicMode(null);
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
          setRecordingSeconds(0);

          // If cancelled, chunks were cleared — skip processing
          const chunks = audioChunksRef.current;
          if (chunks.length === 0 || cancelledRef.current) return;

          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const ext  = recorder.mimeType?.includes('mp4') ? 'mp4' : 'webm';
          const audioFile = new File([blob], `voice_note.${ext}`, { type: blob.type });

          // Send to Gemini with a prompt to transcribe + extract
          const promptText = input.trim()
            ? `Audio note + context: ${input.trim()}`
            : 'Process this audio and extract all business entries (sales, purchases, payments, expenses, parties, inventory items, vehicles) mentioned.';

          setAiLoading(true);
          setInput('');
          const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: `🎤 Voice note (${recordingSeconds}s)${input.trim() ? ` + "${input.trim()}"` : ''}`,
            timestamp: new Date(),
          };
          setMessages(prev => [...prev, userMessage]);

          if (!navigator.onLine) {
            await OfflineQueueService.enqueue(promptText, audioFile);
            setPendingCount(OfflineQueueService.getPendingCount());
            setMessages(prev => [...prev, {
              id: Date.now().toString(), role: 'assistant',
              content: "📴 Offline. Saved voice note — will process when you're back online.",
              timestamp: new Date(),
            }]);
            setAiLoading(false);
            return;
          }

          try {
            const commands = await GeminiService.processInput(promptText, audioFile, buildContext());
            processCommands(commands);
          } catch (e: any) {
            handleAiError(e);
          } finally {
            setAiLoading(false);
          }
        };

        mediaRecorderRef.current = recorder;
        recorder.start(1000); // collect chunks every second
        setIsRecording(true);
        setMicMode('media');
        setRecordingSeconds(0);
        timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
      } catch (e: any) {
        const errName = e?.name ?? '';
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          if (isNative) {
            // Check the actual OS-level permission state before advising the user
            try {
              const perm = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName });
              if (perm?.state === 'granted') {
                // OS granted but WebView still blocked — likely a fresh install or
                // WebView cache issue; retry usually works after first prompt.
                showToast('Microphone access failed — please try again', 'error');
                return;
              }
            } catch (_) { /* permissions API not supported — fall through */ }
            showToast('Mic blocked — open Android Settings › Apps › Shopkeeper › Permissions › Microphone', 'error');
          } else {
            showToast('Microphone blocked — tap the lock icon in your browser address bar to allow it', 'error');
          }
        } else if (errName === 'NotFoundError') {
          showToast('No microphone found on this device', 'error');
        } else {
          showToast('Could not access microphone', 'error');
        }
      }
    }
  }, [speechSupported, mediaSupported, isNative, input, showToast]);

  const toggleRecording = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, stopRecording, startRecording]);

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setMessages([{
        id: 'welcome', role: 'assistant',
        content: 'Hi! Describe your sales, purchases, payments, parties, or any business entry — in any language. You can also tap the mic to speak.',
        timestamp: new Date()
      }]);
      setInput('');
      setFile(null);
      setShowChips(true);
      setPendingCount(OfflineQueueService.getPendingCount());
    } else {
      stopRecording();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, aiLoading]);

  useEffect(() => {
    const handleOnline  = () => { setIsOnline(true);  processOfflineQueue(); };
    const handleOffline = () =>   setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Context helpers ────────────────────────────────────────────────────────
  const buildContext = () => ({
    customers:    parties.filter(p => p.role === 'customer').map(p => p.name),
    suppliers:    parties.filter(p => p.role === 'supplier').map(p => p.name),
    items:        inventory.map(i => i.name),
    expenseTypes: appSettings?.custom_lists?.expense_types || []
  });

  const enrichEntry = (entry: any) => {
    const enriched = { ...entry };
    if (enriched.party_name) {
      const match = parties.find(p => (p.name || '').toLowerCase() === enriched.party_name.toLowerCase());
      if (match) { enriched.party_name = match.name; enriched.gstin = match.gstin; enriched.address = match.address; }
    }
    if (enriched.items && Array.isArray(enriched.items)) {
      enriched.items = enriched.items.map((item: any) => {
        const match = inventory.find(i => (i.name || '').toLowerCase() === (item.item_name || '').toLowerCase());
        if (match) {
          const isSell = enriched.type === 'sell';
          const dbRate = isSell ? match.sale_rate : match.purchase_rate;
          const newItem = { ...item, item_name: match.name, hsn_code: match.hsn_code || '', gst_percent: match.gst_percent || '', unit: match.unit || 'Pcs', price_type: match.price_type || 'exclusive', rate: Number(item.rate) || Number(dbRate) || 0 };
          const qty = Number(newItem.quantity) || 0;
          const rate = Number(newItem.rate) || 0;
          const gst  = Number(newItem.gst_percent) || 0;
          newItem.total = newItem.price_type === 'inclusive' ? qty * rate : (qty * rate) * (1 + gst / 100);
          return newItem;
        }
        return item;
      });
      if (enriched.items.length > 0) enriched.total_amount = enriched.items.reduce((s: number, i: any) => s + (Number(i.total) || 0), 0);
    }
    return enriched;
  };

  // ── AI response processing helpers ────────────────────────────────────────
  const processCommands = (commands: any[]) => {
    if (!commands || commands.length === 0) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(), role: 'assistant',
        content: `I couldn't extract any entries from that. Try: "Sold 50 cement bags to Rahul for ₹18,000" or tap the mic and speak clearly.`,
        timestamp: new Date()
      }]);
    } else {
      const enriched = commands.map((cmd: any) => enrichEntry(cmd));
      setMessages(prev => [...prev, {
        id: Date.now().toString(), role: 'assistant',
        content: `Found ${enriched.length} entr${enriched.length === 1 ? 'y' : 'ies'}. Review and save:`,
        data: enriched, timestamp: new Date()
      }]);
    }
    haptic.success();
    setShowChips(false);
  };

  const handleAiError = (e: any) => {
    console.error(e);
    haptic.error();
    setMessages(prev => [...prev, {
      id: Date.now().toString(), role: 'assistant',
      content: `❌ ${e.message || 'Processing failed'}. Please try again.`,
      timestamp: new Date()
    }]);
  };

  const processOfflineQueue = async () => {
    if (!isOnline) return;
    await OfflineQueueService.processQueue(
      async (text, file) => GeminiService.processInput(text, file, buildContext()),
      async (commands) => {
        for (const cmd of commands) {
          const { collection, ...data } = enrichEntry(cmd);
          if (collection) await ApiService.add(user.uid, collection, { ...data, created_at: new Date().toISOString() });
        }
        invalidateAll(user.uid);
      }
    );
    setPendingCount(OfflineQueueService.getPendingCount());
  };

  // ── Send ──────────────────────────────────────────────────────────────────
  const handleSendWithText = async (text: string, fileArg?: File | null) => {
    const currentInput = text;
    const currentFile  = fileArg ?? null;
    if (!currentInput.trim() && !currentFile) return;

    const userMessage: Message = {
      id: Date.now().toString(), role: 'user',
      content: currentFile ? `📎 ${currentFile.name}\n${currentInput}` : currentInput,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setFile(null);
    setAiLoading(true);
    setShowChips(false);
    haptic.medium();

    if (!isOnline) {
      await OfflineQueueService.enqueue(currentInput, currentFile || undefined);
      setPendingCount(OfflineQueueService.getPendingCount());
      setMessages(prev => [...prev, {
        id: Date.now().toString(), role: 'assistant',
        content: "📴 You're offline. I've saved your command and will process it when you're back online.",
        timestamp: new Date()
      }]);
      setAiLoading(false);
      return;
    }

    try {
      const commands = await GeminiService.processInput(currentInput, currentFile, buildContext());
      processCommands(commands);
    } catch (e: any) {
      handleAiError(e);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSend = () => handleSendWithText(input, file);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSaveAll = async (msgId: string, data: any[]) => {
    setSavingMsgIds(prev => new Set(prev).add(msgId));
    const offline = !navigator.onLine;
    try {
      let count = 0;
      for (const cmd of data) {
        const { collection, _linkedPayments, ...rest } = cmd;
        if (collection) {
          const payload = { ...rest, created_at: new Date().toISOString() };
          if (offline) SyncQueueService.addToQueue(user.uid, 'create', collection, payload);
          else await ApiService.add(user.uid, collection, payload);
          count++;

          if (_linkedPayments && _linkedPayments.length > 0) {
            const isSale = collection === 'ledger_entries' && rest.type === 'sell';
            const txType = isSale ? 'received' : 'paid';
            for (const pay of _linkedPayments) {
              const transPayload = {
                date: pay.date, amount: Number(pay.amount) || 0,
                payment_mode: pay.payment_mode || 'Cash',
                payment_purpose: pay.payment_purpose || '',
                party_name: pay.party_name || rest.party_name || '',
                bill_no: pay.bill_no || rest.invoice_no || rest.bill_no || '',
                notes: pay.notes || '', type: txType,
                transaction_id: getIDForEntry(txType),
                created_at: new Date().toISOString()
              };
              if (offline) SyncQueueService.addToQueue(user.uid, 'create', 'transactions', transPayload);
              else await ApiService.add(user.uid, 'transactions', transPayload);
              count++;
            }
          }
        }
      }
      invalidateAll(user.uid);
      setMessages(prev => [...prev, {
        id: Date.now().toString(), role: 'assistant',
        content: offline
          ? `📴 Saved ${count} entr${count === 1 ? 'y' : 'ies'} offline — will sync when online`
          : `✅ Saved ${count} entr${count === 1 ? 'y' : 'ies'}! Need anything else?`,
        timestamp: new Date()
      }]);
      haptic.success();
      if (onSuccess) onSuccess();
    } catch (e) {
      console.error(e);
      showToast('Save failed', 'error');
    } finally {
      setSavingMsgIds(prev => { const s = new Set(prev); s.delete(msgId); return s; });
    }
  };

  const handleEditItem = (item: any) => { setEditData(item); setShowEditModal(true); };

  const getModalType = (item: any) => {
    if (!item) return 'sales';
    if (item.collection === 'ledger_entries') return item.type === 'sell' ? 'sales' : 'purchases';
    if (item.collection === 'transactions') return 'transactions';
    if (item.collection === 'inventory') return 'inventory';
    if (item.collection === 'expenses') return 'expenses';
    if (item.collection === 'vehicles') return 'vehicles';
    if (item.collection === 'parties') return 'parties';
    return 'sales';
  };

  if (!isOpen) return null;

  const isFirstMessage = messages.length <= 1;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Full-screen overlay */}
      <div
        className="fixed inset-0 z-50 flex flex-col"
        style={{ background: 'var(--app-bg)' }}
      >
        {/* ── Header ── */}
        <div
          className="flex-shrink-0 px-4 py-3 flex items-center gap-3 border-b border-white/08"
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
        >
          <button
            onClick={onClose}
            className="p-2 rounded-xl transition-all active:scale-90"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <X size={18} style={{ color: 'rgba(148,163,184,0.7)' }} />
          </button>

          <div className="flex items-center gap-2 flex-1">
            <div
              className="p-2 rounded-xl"
              style={{ background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.25)' }}
            >
              <Sparkles size={16} style={{ color: '#a78bfa' }} />
            </div>
            <div>
              <h2 className="font-black text-base leading-tight">AI Assistant</h2>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-400'}`} />
                <span className="text-[10px]" style={{ color: 'rgba(148,163,184,0.55)' }}>
                  {isOnline ? 'Online' : 'Offline'}
                  {pendingCount > 0 && ` · ${pendingCount} queued`}
                </span>
              </div>
            </div>
          </div>

          {pendingCount > 0 && isOnline && (
            <button
              onClick={processOfflineQueue}
              className="p-2 rounded-xl"
              style={{ background: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}
            >
              <RefreshCw size={16} />
            </button>
          )}
        </div>

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div
                  className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0 mr-2 mt-0.5"
                  style={{ background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.2)' }}
                >
                  <Sparkles size={13} style={{ color: '#a78bfa' }} />
                </div>
              )}

              <div className={`max-w-[82%] ${msg.role === 'user' ? '' : 'flex-1'}`}>
                <div
                  className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'rounded-tr-sm text-white'
                      : 'rounded-tl-sm'
                  }`}
                  style={msg.role === 'user'
                    ? { background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }
                    : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }
                  }
                >
                  {msg.content}
                </div>

                {/* Entry cards */}
                {msg.data && msg.data.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {msg.data.map((item: any, idx: number) => {
                      const meta = getCollectionMeta(item);
                      const IconComp = meta.icon;
                      const amount = item.total_amount || item.amount || 0;
                      const label  = item.party_name || item.name || item.category || item.number || 'Entry';
                      return (
                        <div
                          key={idx}
                          className="rounded-2xl p-3 flex items-center gap-3"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)' }}
                        >
                          {/* Icon */}
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ background: meta.bg, border: `1px solid ${meta.color}22` }}
                          >
                            <IconComp size={16} style={{ color: meta.color }} />
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span
                                className="text-[9px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded-md"
                                style={{ background: meta.bg, color: meta.color }}
                              >
                                {meta.label}
                              </span>
                            </div>
                            <p className="font-bold text-sm mt-0.5 truncate" style={{ color: 'rgba(240,244,255,0.9)' }}>
                              {label}
                            </p>
                            {item.date && (
                              <p className="text-[10px] mt-0.5" style={{ color: 'rgba(148,163,184,0.5)' }}>{item.date}</p>
                            )}
                          </div>

                          {/* Amount */}
                          {amount > 0 && (
                            <div className="text-right flex-shrink-0">
                              <p className="font-black text-base tabular-nums" style={{ color: meta.color }}>
                                ₹{Number(amount).toLocaleString('en-IN')}
                              </p>
                              {item.items && item.items.length > 0 && (
                                <p className="text-[9px]" style={{ color: 'rgba(148,163,184,0.45)' }}>
                                  {item.items.length} item{item.items.length > 1 ? 's' : ''}
                                </p>
                              )}
                            </div>
                          )}

                          {/* Edit */}
                          <button
                            onClick={() => handleEditItem(item)}
                            className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                            style={{ background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.2)', color: '#a78bfa' }}
                          >
                            <Edit2 size={13} />
                          </button>
                        </div>
                      );
                    })}

                    {/* Save All button */}
                    <button
                      onClick={() => handleSaveAll(msg.id, msg.data!)}
                      disabled={savingMsgIds.has(msg.id)}
                      className="w-full py-3 rounded-2xl text-white font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-60"
                      style={{
                        background: 'linear-gradient(135deg,#059669,#10b981)',
                        boxShadow: '0 4px 16px rgba(16,185,129,0.3)'
                      }}
                    >
                      {savingMsgIds.has(msg.id)
                        ? <Loader2 size={16} className="animate-spin" />
                        : <CheckCircle2 size={16} />
                      }
                      {savingMsgIds.has(msg.id) ? 'Saving…' : `Save ${msg.data!.length} Entr${msg.data!.length === 1 ? 'y' : 'ies'}`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* AI loading indicator */}
          {aiLoading && (
            <div className="flex justify-start items-center gap-2">
              <div
                className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.2)' }}
              >
                <Sparkles size={13} style={{ color: '#a78bfa' }} />
              </div>
              <div
                className="px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-2"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
              >
                <Loader2 size={15} className="animate-spin" style={{ color: '#a78bfa' }} />
                <span className="text-sm" style={{ color: 'rgba(148,163,184,0.7)' }}>Thinking…</span>
              </div>
            </div>
          )}

          {/* Quick prompt chips — only on first load */}
          {isFirstMessage && showChips && !aiLoading && (
            <div className="pt-2">
              <div className="flex items-center gap-1.5 mb-2">
                <Lightbulb size={12} style={{ color: 'rgba(148,163,184,0.4)' }} />
                <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'rgba(148,163,184,0.4)' }}>Try saying</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_CHIPS.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendWithText(chip)}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-xl text-left transition-all active:scale-95"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: 'rgba(203,213,225,0.75)'
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── Input area ── */}
        <div
          className="flex-shrink-0 border-t border-white/08 px-3 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
        >
          {/* Offline warning */}
          {!isOnline && (
            <div className="mb-2 flex items-center gap-2 text-orange-400 text-xs font-semibold">
              <WifiOff size={13} />
              Offline — commands will be queued
            </div>
          )}

          {/* Attached file pill */}
          {file && !isRecording && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl"
              style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <ImageIcon size={13} style={{ color: '#60a5fa' }} />
              <span className="text-xs font-medium flex-1 truncate" style={{ color: '#93c5fd' }}>{file.name}</span>
              <button onClick={() => setFile(null)} style={{ color: '#f87171' }}><X size={13} /></button>
            </div>
          )}

          {/* Input row — ChatGPT style */}
          <div className="flex gap-2 items-end">

            {/* Cancel button — only while recording */}
            {isRecording && (
              <button
                onClick={cancelRecording}
                title="Cancel recording"
                className="p-2 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(148,163,184,0.7)' }}
              >
                <X size={16} />
              </button>
            )}

            {/* Textarea container */}
            <div
              className="flex-1 relative rounded-2xl overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${isRecording ? 'rgba(239,68,68,0.35)' : 'rgba(255,255,255,0.12)'}` }}
            >
              {/* Attach image icon — inside textarea, hidden while recording */}
              {!isRecording && (
                <label className="absolute left-2.5 bottom-2.5 cursor-pointer transition-all active:scale-90 z-10">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="image/*,audio/*"
                    onChange={e => setFile(e.target.files?.[0] || null)}
                  />
                  <ImageIcon size={15} style={{ color: 'rgba(148,163,184,0.35)' }} />
                </label>
              )}

              {/* Recording pulse dot inside textarea */}
              {isRecording && (
                <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  <span className="text-xs font-semibold tabular-nums" style={{ color: '#fca5a5' }}>
                    {micMode === 'speech' ? 'Listening…' : `${String(Math.floor(recordingSeconds / 60)).padStart(2,'0')}:${String(recordingSeconds % 60).padStart(2,'0')}`}
                  </span>
                </div>
              )}

              <textarea
                ref={textareaRef}
                rows={1}
                className="w-full py-3 text-sm font-medium outline-none resize-none bg-transparent"
                style={{
                  color: isRecording ? 'transparent' : 'rgba(240,244,255,0.95)',
                  minHeight: '46px',
                  maxHeight: '140px',
                  lineHeight: '24px',
                  paddingLeft: isRecording ? '12px' : '32px',
                  paddingRight: '12px',
                  caretColor: isRecording ? 'transparent' : undefined,
                }}
                placeholder={isRecording ? '' : 'Describe your transaction…'}
                value={input}
                onChange={e => { if (!isRecording) setInput(e.target.value); }}
                onKeyDown={e => {
                  // Enter always inserts a newline on Android — user taps Send button
                  // (no Enter-to-send behaviour)
                  if (e.key === 'Enter' && !isRecording) {
                    // allow default — inserts newline
                  }
                }}
              />
            </div>

            {/* Right button:
                • While recording → Stop & Send (red, pulsing border)
                • No text + mic supported → Mic button
                • Text typed OR mic not supported → Send button            */}
            {isRecording ? (
              <button
                onClick={stopRecording}
                title="Stop & send"
                className="p-2.5 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                style={{
                  background: 'rgba(239,68,68,0.18)',
                  border: '1.5px solid rgba(239,68,68,0.5)',
                  color: '#f87171',
                  animation: 'recordPulse 1.4s ease-in-out infinite',
                }}
              >
                <StopCircle size={17} />
              </button>
            ) : (input.trim() || file) ? (
              <button
                onClick={handleSend}
                disabled={aiLoading}
                title="Send"
                className="p-2.5 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff', boxShadow: '0 3px 12px rgba(79,70,229,0.4)' }}
              >
                <Send size={17} />
              </button>
            ) : micSupported ? (
              <button
                onClick={startRecording}
                title="Voice input"
                className="p-2.5 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
                style={{ background: 'linear-gradient(135deg,rgba(99,102,241,0.75),rgba(139,92,246,0.75))', color: '#fff', boxShadow: '0 3px 12px rgba(99,102,241,0.3)' }}
              >
                <Mic size={17} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={aiLoading || (!input.trim() && !file)}
                title="Send"
                className="p-2.5 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90 disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', color: '#fff', boxShadow: '0 3px 12px rgba(79,70,229,0.4)' }}
              >
                <Send size={17} />
              </button>
            )}
          </div>

          {/* Hint */}
          <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(148,163,184,0.28)' }}>
            {isRecording
              ? 'Tap stop to send · Tap ✕ to cancel'
              : micSupported
                ? 'Tap mic to speak · Enter for new line'
                : 'Enter for new line · Tap send button'
            }
          </p>
        </div>
      </div>

      {/* ── Edit modal ── */}
      {showEditModal && editData && (
        <ManualEntryModal
          isOpen={true}
          onClose={() => setShowEditModal(false)}
          type={getModalType(editData) as any}
          user={user}
          initialData={editData}
          appSettings={appSettings || {} as any}
          onLocalSave={(updated) => {
            setMessages(prev => prev.map(msg => {
              if (msg.data) {
                const newData = msg.data.map(d => d === editData ? { ...updated, collection: editData.collection } : d);
                return { ...msg, data: newData };
              }
              return msg;
            }));
            setShowEditModal(false);
            setEditData(null);
          }}
        />
      )}
    </>
  );
};

export default CommandModal;
