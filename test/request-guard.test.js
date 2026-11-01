import test from 'node:test';
import assert from 'node:assert/strict';

import { allowedNames, checkRequest } from '../lib/request-guard.js';

const names = allowedNames('mypc.lan');
const ok = (req) => assert.equal(checkRequest(req, names), null);
const blocked = (req) => assert.ok(checkRequest(req, names));

test('the app page can use the API', () => {
  ok({ method: 'GET', host: '127.0.0.1:8787' });
  ok({ method: 'POST', host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' });
  ok({ method: 'DELETE', host: 'localhost:8787', origin: 'http://localhost:8787' });
  ok({ method: 'POST', host: '[::1]:8787', origin: 'http://[::1]:8787' });
});

test('other devices on the network can use it by IP or allowed name', () => {
  ok({ method: 'POST', host: '192.168.1.20:8787', origin: 'http://192.168.1.20:8787' });
  ok({ method: 'POST', host: 'MyPC.lan:8787', origin: 'http://mypc.lan:8787' });
});

test('non-browser clients without Origin still work', () => {
  ok({ method: 'POST', host: '127.0.0.1:8787' });
});

test('other websites cannot start sims or updates', () => {
  blocked({ method: 'POST', host: '127.0.0.1:8787', origin: 'https://evil.example' });
  blocked({ method: 'DELETE', host: '127.0.0.1:8787', origin: 'http://127.0.0.1:9999' });
  blocked({ method: 'POST', host: '127.0.0.1:8787', origin: 'null' });
});

test('DNS rebinding through another domain name is refused', () => {
  blocked({ method: 'GET', host: 'evil.example:8787' });
  blocked({ method: 'POST', host: 'evil.example:8787', origin: 'http://evil.example:8787' });
});

test('a missing or broken Host header is refused', () => {
  blocked({ method: 'GET' });
  blocked({ method: 'GET', host: 'bad host' });
});
