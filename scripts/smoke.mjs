import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.argv[2] || 'http://localhost:8080';
let token;
const cookies = new Map();

async function request(path, { method = 'GET', body, csrf } = {}) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0];
    const split = pair.indexOf('=');
    cookies.set(pair.slice(0, split), pair.slice(split + 1));
  }
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${data.error?.message || response.status}`);
  return data;
}

const page = await fetch(origin);
assert.equal(page.status, 200);
const html = await page.text();
const asset = html.match(/src="([^"]+\.js)"/);
assert.ok(asset, 'Compiled frontend script is linked');
assert.equal((await fetch(new URL(asset[1], origin))).status, 200);
assert.equal((await request('/health')).status, 'ok');

const account = await request('/auth/register', {
  method: 'POST',
  body: {
    email: `smoke-${randomUUID()}@trello.test`,
    displayName: 'Dev smoke check',
    password: randomUUID() + randomUUID(),
  },
});
token = account.accessToken;
assert.equal((await request('/auth/me')).id, account.user.id);
const workspace = await request('/workspaces', { method: 'POST', body: { name: 'Dev acceptance check' } });
const board = await request(`/workspaces/${workspace.id}/boards`, { method: 'POST', body: { title: 'MVP verification', color: '#0065ff' } });
const first = await request(`/boards/${board.id}/lists`, { method: 'POST', body: { title: 'To do' } });
const second = await request(`/boards/${board.id}/lists`, { method: 'POST', body: { title: 'Done' } });
const card = await request(`/lists/${first.id}/cards`, { method: 'POST', body: { title: 'Verify persisted move' } });
const label = await request(`/boards/${board.id}/labels`, { method: 'POST', body: { name: 'Smoke verified', color: '#0055cc' } });
await request(`/cards/${card.id}`, { method: 'PATCH', body: { labelIds: [label.id], assigneeIds: [account.user.id], coverColor: '#deebff', dueDate: '2030-01-15T12:00:00.000Z', completed: true } });
const checklist = await request(`/cards/${card.id}/checklists`, { method: 'POST', body: { title: 'Release checks' } });
const item = await request(`/checklists/${checklist.id}/items`, { method: 'POST', body: { title: 'Verify rich card persistence' } });
await request(`/checklist-items/${item.id}`, { method: 'PATCH', body: { completed: true } });
await request(`/cards/${card.id}/comments`, { method: 'POST', body: { body: 'Verified through the Dev Nginx proxy.' } });
await request(`/lists/${second.id}`, { method: 'PATCH', body: { wipLimit: 2 } });
const view = await request(`/boards/${board.id}/views`, { method: 'POST', body: { name: 'Smoke view', filters: { labelIds: [label.id], due: 'completed' } } });
assert.ok((await request(`/boards/${board.id}/views`)).some(saved => saved.id === view.id));
await request(`/cards/${card.id}`, { method: 'PATCH', body: { description: 'Created through Nginx against real PostgreSQL.' } });
await request(`/cards/${card.id}/move`, { method: 'POST', body: { listId: second.id, position: 0 } });
await request(`/cards/${card.id}`, { method: 'PATCH', body: { archived: true } });
await request(`/cards/${card.id}`, { method: 'PATCH', body: { archived: false } });

const csrf = (await request('/auth/csrf')).csrfToken;
const renewed = await request('/auth/renew', { method: 'POST', body: {}, csrf });
token = renewed.accessToken;
const persisted = await request(`/boards/${board.id}`);
const stored = persisted.lists.find(list => list.id === second.id).cards.find(item => item.id === card.id);
assert.equal(stored.title, 'Verify persisted move');
assert.equal(stored.archived, false);
assert.equal(stored.position, 0);
assert.match(stored.description, /PostgreSQL/);
assert.deepEqual(stored.labelIds, [label.id]);
assert.deepEqual(stored.assigneeIds, [account.user.id]);
assert.equal(stored.completed, true);
assert.equal(persisted.lists.find(list => list.id === second.id).wipLimit, 2);
const details = await request(`/cards/${card.id}`);
assert.equal(details.checklists[0].items[0].completed, true);
assert.match(details.comments[0].body, /Nginx/);
assert.ok(details.activity.length > 0);
await request('/auth/logout', { method: 'POST', body: {}, csrf });
const signedOut = await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
assert.equal(signedOut.status, 401);
console.log('PASS: frontend assets, proxy health, signup, workspace/board/list/card creation, rich metadata, checklist, comments/activity, saved views, WIP limit, move, archive/restore, refresh, persistence, and logout.');
