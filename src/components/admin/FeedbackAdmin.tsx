import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader2, ArrowLeft, MessageCircle } from 'lucide-react';

const BLOB_URL_KEY = 'feedbackAdminBlobUrl';
const POLL_FAST_MS = 6000;
const POLL_SLOW_MS = 120000;
const FAST_WINDOW_MS = 120000;

interface FeedbackMessage {
  id: string;
  userId: string;
  text: string;
  ts: string;
  isDev: boolean;
}

interface Thread {
  userId: string;
  messageCount: number;
  lastTs: string;
  lastMessage: string;
  unread: number;
}

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FeedbackAdmin() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const blobUrlRef = useRef<string | null>(localStorage.getItem(BLOB_URL_KEY));
  const lastTsRef = useRef<string>('');
  const fetchThreadsRef = useRef<() => Promise<void>>(async () => {});
  const fetchMsgsRef = useRef<(userId: string) => Promise<void>>(async () => {});

  const fetchThreads = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (blobUrlRef.current) params.set('url', blobUrlRef.current);
      const qs = params.toString();
      const res = await fetch(`/api/feedback/admin/threads${qs ? `?${qs}` : ''}`);
      const data = await res.json();
      setThreads(data.threads || []);
      if (data.url && data.url !== blobUrlRef.current) {
        blobUrlRef.current = data.url;
        localStorage.setItem(BLOB_URL_KEY, data.url);
      }
    } catch (err) {
      console.error('Failed to fetch threads:', err);
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  fetchThreadsRef.current = fetchThreads;

  const fetchMessages = useCallback(async (userId: string) => {
    try {
      const params = new URLSearchParams({ userId });
      if (blobUrlRef.current) params.set('url', blobUrlRef.current);
      const res = await fetch(`/api/feedback/messages?${params}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Server error ${res.status}: ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      const msgs = (data.messages || []).sort(
        (a: FeedbackMessage, b: FeedbackMessage) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
      );
      setMessages(prev => {
        const serverIds = new Set(msgs.map(m => m.id));
        const local = prev.filter(m => !serverIds.has(m.id));
        return [...msgs, ...local].sort(
          (a: FeedbackMessage, b: FeedbackMessage) => new Date(a.ts).getTime() - new Date(b.ts).getTime()
        );
      });
      if (data.url && data.url !== blobUrlRef.current) {
        blobUrlRef.current = data.url;
        localStorage.setItem(BLOB_URL_KEY, data.url);
      }
      if (msgs.length > 0) {
        lastTsRef.current = msgs[msgs.length - 1].ts;
      }
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  }, []);

  fetchMsgsRef.current = fetchMessages;

  useEffect(() => {
    fetchThreads();
    let timeoutId: ReturnType<typeof setTimeout>;
    const poll = () => {
      fetchThreadsRef.current?.();
      const lastTs = lastTsRef.current;
      const elapsed = lastTs
        ? Date.now() - new Date(lastTs).getTime()
        : Infinity;
      const interval = elapsed < FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;
      timeoutId = setTimeout(poll, interval);
    };
    timeoutId = setTimeout(poll, POLL_FAST_MS);
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!selectedUserId) return;
    fetchMessages(selectedUserId);
    let timeoutId: ReturnType<typeof setTimeout>;
    const poll = () => {
      if (selectedUserId) fetchMsgsRef.current?.(selectedUserId);
      const lastTs = lastTsRef.current;
      const elapsed = lastTs
        ? Date.now() - new Date(lastTs).getTime()
        : Infinity;
      const interval = elapsed < FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;
      timeoutId = setTimeout(poll, interval);
    };
    timeoutId = setTimeout(poll, POLL_FAST_MS);
    return () => clearTimeout(timeoutId);
  }, [selectedUserId]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedUserId || sending) return;
    setSending(true);
    const text = replyText.trim();
    setReplyText('');

    const optimistic: FeedbackMessage = {
      id: crypto.randomUUID(),
      userId: selectedUserId,
      text,
      ts: new Date().toISOString(),
      isDev: true,
    };

    setMessages(prev => [...prev, optimistic]);
    setThreads(prev => prev.map(t =>
      t.userId === selectedUserId ? { ...t, lastMessage: text, lastTs: optimistic.ts, messageCount: t.messageCount + 1, unread: 0 } : t
    ));

    try {
      const res = await fetch('/api/feedback/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          userId: selectedUserId,
          url: blobUrlRef.current || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      if (data.url && data.url !== blobUrlRef.current) {
        blobUrlRef.current = data.url;
        localStorage.setItem(BLOB_URL_KEY, data.url);
      }
      setMessages(prev =>
        prev.map(m => (m.id === optimistic.id ? { ...m, id: data.id, ts: data.ts } : m))
      );
    } catch (err) {
      console.error('Failed to send reply:', err);
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  const selectThread = (userId: string) => {
    setSelectedUserId(userId);
    setThreads(prev => prev.map(t =>
      t.userId === userId ? { ...t, unread: 0 } : t
    ));
  };

  if (loadingThreads) {
    return (
      <div className="h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-zinc-500" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-zinc-800 px-4 py-3 flex items-center gap-3 shrink-0 bg-zinc-900/90">
        {selectedUserId ? (
          <button onClick={() => setSelectedUserId(null)} className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-100 transition-colors">
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <h1 className="text-sm font-semibold">Feedback — Admin</h1>
        <button
          onClick={fetchThreads}
          className="ml-auto text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Refresh
        </button>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {selectedUserId ? (
          /* Conversation view */
          <div className="flex-1 flex flex-col">
            <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
                  No messages
                </div>
              ) : (
                messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.isDev ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] px-3 py-2 rounded-xl ${msg.isDev ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-zinc-800 text-zinc-200 rounded-bl-sm'}`}>
                      {!msg.isDev && <p className="text-[10px] font-semibold text-zinc-400 mb-0.5">User</p>}
                      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.text}</p>
                      <p className={`text-[10px] mt-1 ${msg.isDev ? 'text-blue-200' : 'text-zinc-500'}`}>{formatTime(msg.ts)}</p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Reply input */}
            <div className="border-t border-zinc-800 p-3 shrink-0">
              <div className="flex items-end gap-2">
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your reply..."
                  rows={1}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:border-zinc-500 min-h-[36px] max-h-[120px]"
                />
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || sending}
                  className="shrink-0 w-9 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white flex items-center justify-center transition-colors"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Thread list */
          <div className="flex-1 overflow-y-auto">
            {threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <MessageCircle size={32} className="text-zinc-700 mb-3" />
                <p className="text-sm text-zinc-500">No feedback threads yet.</p>
                <p className="text-[10px] text-zinc-600 mt-1">Messages from users will appear here.</p>
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/50">
                {threads.map(t => (
                  <button
                    key={t.userId}
                    onClick={() => selectThread(t.userId)}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${t.unread > 0 ? 'bg-blue-500' : 'bg-zinc-700'}`} />
                        <span className="text-xs font-mono text-zinc-400 truncate">{t.userId.slice(0, 8)}...</span>
                        <span className="text-[10px] text-zinc-600 shrink-0">({t.messageCount})</span>
                      </div>
                      <span className="text-[10px] text-zinc-600 shrink-0">{timeAgo(t.lastTs)}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 truncate pl-4">{t.lastMessage || '(no text)'}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
