import { put, list } from '@vercel/blob';
import type { IncomingMessage, ServerResponse } from 'http';

interface FeedbackMessage {
  id: string;
  userId: string;
  text: string;
  ts: string;
  deploy: { id: string; sha: string; url: string };
  isDev: boolean;
}

const BLOB_PATH = 'feedback.json';

function uuid(): string {
  return crypto.randomUUID();
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

    const { text, userId: clientUserId } = body;
    if (!text || !clientUserId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing text or userId' }));
      return;
    }

    let messages: FeedbackMessage[] = [];
    try {
      const { blobs } = await list({ prefix: BLOB_PATH, limit: 1 });
      if (blobs.length > 0) {
        const blob = await fetch(blobs[0].url).then(r => r.json());
        messages = Array.isArray(blob) ? blob : [];
      }
    } catch {
      // No blob yet — start fresh
    }

    const message: FeedbackMessage = {
      id: uuid(),
      userId: clientUserId,
      text,
      ts: new Date().toISOString(),
      deploy: {
        id: process.env.VERCEL_DEPLOYMENT_ID || 'dev',
        sha: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
        url: process.env.VERCEL_URL || 'localhost',
      },
      isDev: false,
    };

    messages.push(message);

    await put(BLOB_PATH, JSON.stringify(messages), {
      contentType: 'application/json',
      access: 'public',
      allowOverwrite: true,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: message.id, ts: message.ts }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: String(err) }));
  }
}
