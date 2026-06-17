import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';

const OAUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_BASE = 'https://gigachat.devices.sberbank.ru/api/v1';

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

function httpsRequest(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: options.method ?? 'GET',
        headers: options.headers,
        rejectUnauthorized: false,
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 500,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      },
    );

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }

  const authKey = process.env.GIGACHAT_AUTH_KEY;
  const scope = process.env.GIGACHAT_SCOPE ?? 'GIGACHAT_API_PERS';

  if (!authKey) {
    throw new Error('GIGACHAT_AUTH_KEY не задан в .env');
  }

  const body = new URLSearchParams({ scope }).toString();

  const response = await httpsRequest(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      RqUID: randomUUID(),
      Authorization: `Basic ${authKey}`,
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ошибка авторизации GigaChat (${response.status}): ${response.body}`);
  }

  const data = JSON.parse(response.body) as { access_token: string; expires_at?: number };
  const expiresAt = data.expires_at
    ? data.expires_at
    : Date.now() + 30 * 60 * 1000;

  tokenCache = { token: data.access_token, expiresAt };
  return data.access_token;
}

export async function chatCompletion(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
): Promise<string> {
  const token = await getAccessToken();
  const payload = JSON.stringify({
    model: 'GigaChat',
    messages,
    temperature: 0.3,
    max_tokens: 4096,
  });

  const response = await httpsRequest(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Length': String(Buffer.byteLength(payload)),
    },
    body: payload,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Ошибка GigaChat API (${response.status}): ${response.body}`);
  }

  const data = JSON.parse(response.body) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('GigaChat вернул пустой ответ');
  }

  return content;
}
