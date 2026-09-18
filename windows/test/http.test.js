import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { request, localRequest, isLocalhost } from '../src/core/http.js';

async function server(t, handler) {
  const instance = http.createServer(handler);
  await new Promise((resolve) => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { instance.close(resolve); instance.closeAllConnections(); }));
  return `http://127.0.0.1:${instance.address().port}`;
}

test('HTTP helpers preserve POST body, headers, status and chunked response', async (t) => {
  const url = await server(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.writeHead(429);
    res.write(JSON.stringify({ method: req.method, path: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString() }));
    res.end('\n');
  });
  for (const send of [request, localRequest]) {
    const result = await send(`${url}/usage?q=1`, { method: 'POST', headers: { Authorization: 'REDACTED' }, body: 'payload' });
    assert.equal(result.status, 429);
    assert.deepEqual(JSON.parse(result.text), { method: 'POST', path: '/usage?q=1', auth: 'REDACTED', body: 'payload' });
  }
});

test('HTTP requests time out; local failures return null', async (t) => {
  const url = await server(t, () => {});
  await assert.rejects(request(url, { timeoutMs: 30 }), /timeout|aborted/i);
  assert.equal(await localRequest(url, { timeoutMs: 30 }), null);
  assert.equal(await localRequest('invalid URL'), null);
});

for (const [host, local] of [['127.0.0.1', true], ['localhost', true], ['::1', true], ['example.com', false], ['localhost.example.com', false], ['127.0.0.2', false]]) {
  test(`TLS validation is relaxed only for loopback: ${host}`, async (t) => {
    assert.equal(isLocalhost(host), local);
    let captured;
    t.mock.method(https, 'request', (options) => {
      captured = options;
      const req = new EventEmitter();
      req.setTimeout = () => {};
      req.end = () => queueMicrotask(() => req.emit('error', new Error('synthetic transport failure')));
      return req;
    });
    const urlHost = host.includes(':') ? `[${host}]` : host;
    assert.equal(await localRequest(`https://${urlHost}/usage`), null);
    assert.equal(captured.hostname, host);
    assert.equal(captured.rejectUnauthorized, !local);
  });
}
