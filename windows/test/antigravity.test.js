import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { fetch, getUserStatusPath } from '../src/core/sources/antigravity.js';
import { fixture } from './helpers.js';

// Exercise the actual Windows command-output parsers without inspecting host processes.
function commands(t, outputs) {
  const calls = [];
  const original = childProcess.execFile;
  t.mock.method(childProcess, 'execFile', (file, args, options, callback) => {
    calls.push({ file, args, options });
    assert.ok(outputs.length, 'Unexpected process discovery command');
    const value = outputs.shift();
    queueMicrotask(() => callback(value === null ? new Error('synthetic command failure') : null, value));
  });
  syncBuiltinESMExports();
  t.after(() => {
    childProcess.execFile = original;
    syncBuiltinESMExports();
    assert.equal(outputs.length, 0);
  });
  return calls;
}

function responses(t, items) {
  const calls = [];
  const implementation = (options, callback) => {
    const call = { ...options, body: '' };
    calls.push(call);
    const req = new EventEmitter();
    req.setTimeout = () => {};
    req.write = (body) => { call.body += body; };
    req.end = () => queueMicrotask(() => {
      assert.ok(items.length, 'Unexpected local endpoint request');
      const item = items.shift();
      if (item === null) { req.emit('error', new Error('synthetic connection failure')); return; }
      const res = new EventEmitter();
      res.statusCode = item.status ?? 200;
      callback(res);
      res.emit('data', Buffer.from(JSON.stringify(item.body)));
      res.emit('end');
    });
    return req;
  };
  t.mock.method(http, 'request', implementation);
  t.mock.method(https, 'request', implementation);
  t.after(() => assert.equal(items.length, 0));
  return calls;
}

const win = { skip: process.platform !== 'win32' };
const processRow = { ProcessId: 4242, CommandLine: 'C:/Antigravity/language_server.exe --csrf_token REDACTED-csrf' };

test('Antigravity Windows discovery ignores unrelated language servers', win, async (t) => {
  commands(t, [JSON.stringify([{ ProcessId: 9, CommandLine: 'other/language_server.exe' }])]);
  responses(t, []);
  assert.match((await fetch()).errorMessage, /not running/);
});

test('Antigravity parses PowerShell process and port JSON, then sends local RPC', win, async (t) => {
  const calls = commands(t, [JSON.stringify([processRow]), '[54321,54321]']);
  const requests = responses(t, [{ body: fixture('antigravity-userstatus') }]);
  assert.equal((await fetch()).gauges.length, 2);
  assert.ok(calls.every((c) => c.file === 'powershell.exe' && c.options.windowsHide));
  assert.match(calls[1].args.at(-1), /OwningProcess 4242/);
  assert.equal(requests[0].hostname, '127.0.0.1');
  assert.equal(requests[0].port, '54321');
  assert.equal(requests[0].path, getUserStatusPath);
  assert.equal(requests[0].headers['X-Codeium-Csrf-Token'], 'REDACTED-csrf');
  assert.equal(requests[0].body, '{"metadata":{}}');
});

test('Antigravity netstat fallback filters other PIDs and deduplicates ports', win, async (t) => {
  const calls = commands(t, [JSON.stringify(processRow), null,
    'TCP 127.0.0.1:51000 0.0.0.0:0 LISTENING 9999\nTCP 127.0.0.1:52000 0.0.0.0:0 LISTENING 4242\nTCP [::1]:52000 [::]:0 LISTENING 4242']);
  const requests = responses(t, [{ body: fixture('antigravity-userstatus') }]);
  assert.equal((await fetch()).errorMessage, undefined);
  assert.equal(calls[2].file, 'netstat');
  assert.equal(requests[0].port, '52000');
});

test('Antigravity retries extension port after failed local TLS endpoint', win, async (t) => {
  commands(t, [JSON.stringify({ ...processRow, CommandLine: processRow.CommandLine + ' --extension_server_port=53000 --extension_server_csrf_token=REDACTED-extension' }), '[52000]']);
  const requests = responses(t, [null, { body: fixture('antigravity-userstatus') }]);
  assert.equal((await fetch()).errorMessage, undefined);
  assert.equal(requests[1].port, '53000');
  assert.equal(requests[1].headers['X-Codeium-Csrf-Token'], 'REDACTED-extension');
});

test('Antigravity reports missing endpoints and rejected RPC without throwing', win, async (t) => {
  commands(t, [JSON.stringify(processRow), '[]', JSON.stringify(processRow), '[52000]']);
  responses(t, [{ status: 403, body: {} }]);
  assert.match((await fetch()).errorMessage, /no local endpoint/);
  assert.match((await fetch()).errorMessage, /rejected the probe/);
});
