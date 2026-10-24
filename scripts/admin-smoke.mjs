import assert from 'node:assert/strict';

const origin = process.argv[2] || 'http://localhost:8080';
const email = process.env.SMOKE_ADMIN_EMAIL;
const password = process.env.SMOKE_ADMIN_PASSWORD;
if (!email || !password) throw new Error('Set SMOKE_ADMIN_EMAIL and SMOKE_ADMIN_PASSWORD for a dedicated Dev administrator.');
let token;
const cookies = new Map();
async function request(path, { method = 'GET', body, csrf } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const split = pair.indexOf('=');
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${data.error?.code || ''}`);
  return data;
}

token = (await request('/auth/login', { method: 'POST', body: { email, password } })).accessToken;
const me = await request('/auth/me');
assert.equal(me.isAdmin, true);
const overview = await request('/admin/overview');
for (const name of ['users', 'activeUsers', 'suspendedUsers', 'admins', 'workspaces', 'archivedWorkspaces', 'boards', 'closedBoards']) assert.ok(Number.isInteger(overview[name]), `Overview ${name} is an integer`);
assert.ok(overview.admins > 0);
const users = await request(`/admin/users?q=${encodeURIComponent(email)}&page=1&pageSize=20`);
assert.ok(users.items.some(user => user.email === email && user.isAdmin));
for (const path of ['workspaces', 'boards', 'audit']) {
  const page = await request(`/admin/${path}?page=1&pageSize=20`);
  assert.ok(Array.isArray(page.items));
  assert.ok(Number.isInteger(page.total));
  assert.equal(page.page, 1);
  assert.equal(page.pageSize, 20);
}
const sessions = await request('/auth/sessions');
assert.ok(sessions.some(session => session.current));
for (const session of sessions) {
  assert.ok(session.id && session.createdAt && session.expiresAt);
  assert.equal('token' in session || 'tokenHash' in session || 'token_hash' in session, false);
}
const { csrfToken } = await request('/auth/csrf');
await request('/auth/logout', { method: 'POST', body: {}, csrf: csrfToken });
const signedOut = await fetch(`${origin}/api/admin/overview`, { headers: { Authorization: `Bearer ${token}` } });
assert.equal(signedOut.status, 401);
console.log('PASS: admin login/authorization, overview counts, paginated metadata/audit, session metadata, and logout revocation.');
