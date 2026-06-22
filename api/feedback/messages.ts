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
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host}`);
    const userId = parsedUrl.searchParams.get('userId');
    const cachedUrl = parsedUrl.searchParams.get('url');

    let messages: any[] = [];
    let blobUrl: string | undefined;

    if (cachedUrl) {
      const res2 = await fetch(cachedUrl);
      const data = await res2.json();
      messages = Array.isArray(data) ? data : [];
      blobUrl = cachedUrl;
    } else {
      const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
      if (blobs.length > 0) {
        const res2 = await fetch(blobs[0].url);
        const data = await res2.json();
        messages = Array.isArray(data) ? data : [];
        blobUrl = blobs[0].url;
      }
    }

    if (userId) {
      messages = messages.filter(m => m.userId === userId);
    }

    messages.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ messages, url: blobUrl }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}
