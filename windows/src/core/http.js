// Shared HTTP plumbing. Plain fetches go through undici's global fetch with
// per-request timeouts (the URLRequest.timeoutInterval equivalent). The
// local* variants are for Antigravity's self-signed localhost endpoint and
// mirror LocalhostTrustDelegate: certificate validation is relaxed ONLY for
// 127.0.0.1 / localhost / ::1, nowhere else.

import nodeHttp from 'node:http';
import nodeHttps from 'node:https';

export const LOCALHOST_HOSTS = ['127.0.0.1', 'localhost', '::1'];

export function isLocalhost(host) {
  return LOCALHOST_HOSTS.includes(host);
}

/// GET/POST any URL → { status, text } or throws Error(message).
export async function request(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const response = await fetch(url, {
    method,
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return { status: response.status, text };
}

/// Local (possibly self-signed HTTPS) request → { status, text } | null.
/// Returns null on any transport failure, like the Swift `try?` call sites.
export function localRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve(null);
      return;
    }
    const transport = parsed.protocol === 'https:' ? nodeHttps : nodeHttp;
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers,
        // Server-trust bypass, localhost only — checked before use.
        rejectUnauthorized: parsed.protocol === 'https:' && isLocalhost(parsed.hostname),
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    if (body !== undefined) req.write(body);
    req.end();
  });
}
