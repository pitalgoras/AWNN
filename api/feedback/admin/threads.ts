import { list } from '@vercel/blob';
import type { IncomingMessage, ServerResponse } from 'http';

const BLOB_PATH = 'feedback.json';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    let messages: any[] = [];
    try {
      const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
      if (blobs.length > 0) {
        const blob = await fetch(blobs[0].url).then(r => r.json());
        messages = Array.isArray(blob) ? blob : [];
      }
    } catch {
      // No messages yet
    }

    // Group by userId
    const threadMap = new Map<string, { messages: any[]; lastTs: string; unread: number }>();

    for (const msg of messages) {
      if (!threadMap.has(msg.userId)) {
        threadMap.set(msg.userId, { messages: [], lastTs: msg.ts, unread: 0 });
      }
      const thread = threadMap.get(msg.userId)!;
      thread.messages.push(msg);
      if (msg.ts > thread.lastTs) thread.lastTs = msg.ts;
      if (msg.isDev && !msg.isRead) thread.unread++;
    }

    const threads = Array.from(threadMap.entries())
      .map(([userId, data]) => ({
        userId,
        messageCount: data.messages.length,
        lastTs: data.lastTs,
        lastMessage: data.messages.sort(
          (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()
        )[0]?.text || '',
        unread: data.unread,
      }))
      .sort((a, b) => new Date(b.lastTs).getTime() - new Date(a.lastTs).getTime());

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ threads }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}
