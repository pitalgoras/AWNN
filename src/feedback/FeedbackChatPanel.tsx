import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Loader2, MessageCircle, ChevronDown } from 'lucide-react';
import { SidebarPanel } from './SidebarPanel';

interface FeedbackMessage {
  id: string;
  userId: string;
  text: string;
  ts: string;
  isDev: boolean;
}

const USER_ID_KEY = 'feedbackUserId';
const DEV_MESSAGES_KEY = 'feedbackDevMessages';
const POLL_OPEN_MS = 3000;
const POLL_CLOSED_MS = 10 * 60 * 1000;

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=31536000;SameSite=Lax`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function getUserId(): string {
  let id = localStorage.getItem(USER_ID_KEY);
  id ||= getCookie(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
  }
  localStorage.setItem(USER_ID_KEY, id);
  setCookie(USER_ID_KEY, id);
  return id;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return (
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

const isDev = import.meta.env.DEV;

interface FeedbackChatPanelProps {
  show: boolean;
  onClose: () => void;
}

export function FeedbackChatPanel({ show, onClose }: FeedbackChatPanelProps) {
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userId = useRef(getUserId());
  const lastTsRef = useRef<string>('');

  const scrollToBottom = useCallback(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      let msgs: FeedbackMessage[] = [];
      if (isDev) {
        const stored = localStorage.getItem(DEV_MESSAGES_KEY);
        msgs = stored ? JSON.parse(stored) : [];
      } else {
        const res = await fetch(`/api/feedback/messages?userId=${encodeURIComponent(userId.current)}`);
        const data = await res.json();
        msgs = data.messages || [];
      }
      msgs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      setMessages(prev => {
        const serverIds = new Set(msgs.map(m => m.id));
        const local = prev.filter(m => !serverIds.has(m.id));
        return [...msgs, ...local].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      });
      if (msgs.length > 0) {
        lastTsRef.current = msgs[msgs.length - 1].ts;
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const text = inputText.trim();
    if (!text || sending) return;

    setSending(true);
    const optimistic: FeedbackMessage = {
      id: crypto.randomUUID(),
      userId: userId.current,
      text,
      ts: new Date().toISOString(),
      isDev: false,
    };

    setMessages(prev => [...prev, optimistic]);
    setInputText('');
    setTimeout(scrollToBottom, 50);

    try {
      if (isDev) {
        const stored = localStorage.getItem(DEV_MESSAGES_KEY);
        const msgs: FeedbackMessage[] = stored ? JSON.parse(stored) : [];
        msgs.push(optimistic);
        localStorage.setItem(DEV_MESSAGES_KEY, JSON.stringify(msgs));
      } else {
        const res = await fetch('/api/feedback/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, userId: userId.current }),
        });
        if (!res.ok) throw new Error('Failed to send');
        const data = await res.json();
        setMessages(prev =>
          prev.map(m => (m.id === optimistic.id ? { ...m, id: data.id, ts: data.ts } : m))
        );
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  }, [inputText, sending, scrollToBottom]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const interval = show ? POLL_OPEN_MS : POLL_CLOSED_MS;
    if (interval > 0) {
      pollRef.current = setInterval(fetchMessages, interval);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [show, fetchMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <SidebarPanel
      show={show}
      title="Feedback"
      headerRight={
        <button
          onClick={onClose}
          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors"
        >
          <X size={14} />
        </button>
      }
    >
      <div className="flex flex-col h-full min-h-0">
        {/* Messages */}
        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3 scroll-smooth">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-2">
              <MessageCircle size={24} className="text-zinc-700 mb-2" />
              <p className="text-[11px] text-zinc-500">No messages yet.</p>
              <p className="text-[10px] text-zinc-600 mt-1">Tap send to leave feedback.</p>
            </div>
          ) : (
            messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.isDev ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[85%] px-2.5 py-1.5 rounded-xl ${
                    msg.isDev
                      ? 'bg-zinc-800 text-zinc-200 rounded-bl-sm'
                      : 'bg-blue-600 text-white rounded-br-sm'
                  }`}
                >
                  {msg.isDev && (
                    <p className="text-[9px] font-semibold text-blue-400 mb-0.5">Dev</p>
                  )}
                  <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                    {msg.text}
                  </p>
                  <p
                    className={`text-[9px] mt-1 ${msg.isDev ? 'text-zinc-500' : 'text-blue-200'}`}
                  >
                    {formatTime(msg.ts)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Input */}
        <div className="border-t border-zinc-800 p-2 shrink-0">
          <div className="flex items-end gap-1.5">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              rows={1}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 transition-colors min-h-[30px] max-h-[80px]"
            />
            <button
              onClick={sendMessage}
              disabled={!inputText.trim() || sending}
              className="shrink-0 w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white flex items-center justify-center transition-colors"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          </div>
        </div>
      </div>
    </SidebarPanel>
  );
}
