import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.argv[2] || 'http://localhost:8080';
if (process.env.TRELLO_SMOKE_ENV !== 'dev') throw new Error('Run only on Dev with TRELLO_SMOKE_ENV=dev.');
const email = process.env.SMOKE_USER_EMAIL;
const password = process.env.SMOKE_USER_PASSWORD;
if (!email || !password) throw new Error('Supply a dedicated verified Dev account privately in SMOKE_USER_EMAIL and SMOKE_USER_PASSWORD.');
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

const account = await request('/auth/login', {
  method: 'POST',
  body: { email, password },
});
token = account.accessToken;
assert.equal((await request('/auth/me')).id, account.user.id);
await request('/me', { method: 'PATCH', body: { displayName: 'Dev smoke check', theme: 'dark' } });
assert.equal((await request('/auth/me')).theme, 'dark');
await request('/me', { method: 'PATCH', body: { theme: 'system' } });
assert.deepEqual(await request('/notifications'), { items: [], unreadCount: 0 });
const workspace = await request('/workspaces', { method: 'POST', body: { name: 'Dev acceptance check' } });
const board = await request(`/workspaces/${workspace.id}/boards`, { method: 'POST', body: { title: 'MVP verification', color: '#0065ff' } });
const first = await request(`/boards/${board.id}/lists`, { method: 'POST', body: { title: 'To do' } });
const second = await request(`/boards/${board.id}/lists`, { method: 'POST', body: { title: 'Done' } });
const card = await request(`/lists/${first.id}/cards`, { method: 'POST', body: { title: 'Verify persisted move' } });
const label = await request(`/boards/${board.id}/labels`, { method: 'POST', body: { name: 'Smoke verified', color: '#0055cc' } });
await request(`/cards/${card.id}`, { method: 'PATCH', body: { labelIds: [label.id], assigneeIds: [account.user.id], coverColor: '#deebff', dueDate: '2030-01-15T12:00:00.000Z', completed: true } });
let myTask = (await request('/me/tasks')).find(task => task.id === card.id);
assert.equal(myTask.boardId, board.id);
assert.equal(myTask.completed, true);
await request(`/cards/${card.id}`, { method: 'PATCH', body: { completed: false } });
assert.equal((await request('/me/tasks')).find(task => task.id === card.id).completed, false);
await request(`/cards/${card.id}`, { method: 'PATCH', body: { completed: true } });
const checklist = await request(`/cards/${card.id}/checklists`, { method: 'POST', body: { title: 'Release checks' } });
const item = await request(`/checklists/${checklist.id}/items`, { method: 'POST', body: { title: 'Verify rich card persistence' } });
await request(`/checklist-items/${item.id}`, { method: 'PATCH', body: { completed: true } });
const nextItem = await request(`/checklists/${checklist.id}/items`, { method: 'POST', body: { title: 'Verify reordered item' } });
await request(`/checklist-items/${nextItem.id}`, { method: 'PATCH', body: { position: 0 } });
await request(`/cards/${card.id}/comments`, { method: 'POST', body: { body: 'Verified through the Dev Nginx proxy.' } });
await request(`/lists/${second.id}`, { method: 'PATCH', body: { wipLimit: 2 } });
const view = await request(`/boards/${board.id}/views`, { method: 'POST', body: { name: 'Smoke view', filters: { labelIds: [label.id], due: 'completed' } } });
assert.ok((await request(`/boards/${board.id}/views`)).some(saved => saved.id === view.id));
await request(`/cards/${card.id}`, { method: 'PATCH', body: { description: 'Created through Nginx against real PostgreSQL.' } });
await request(`/cards/${card.id}/move`, { method: 'POST', body: { listId: second.id, position: 0 } });
await request(`/cards/${card.id}`, { method: 'PATCH', body: { archived: true } });
assert.ok(!(await request('/me/tasks')).some(task => task.id === card.id));
await request(`/cards/${card.id}`, { method: 'PATCH', body: { archived: false } });
assert.ok((await request('/me/tasks')).some(task => task.id === card.id));

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
const dashboard = await request(`/boards/${board.id}/dashboard?today=2030-01-16`);
assert.equal(dashboard.total, 1);
assert.equal(dashboard.completed, 1);
assert.equal(dashboard.overdue, 0);
assert.equal(dashboard.byList.find(list => list.id === second.id).total, 1);
assert.equal(dashboard.byAssignee.find(person => person.id === account.user.id).completed, 1);
await request(`/cards/${card.id}`, { method: 'PATCH', body: { dueDate: '2030-01-18' } });
const rescheduled = await request(`/cards/${card.id}`);
assert.equal(rescheduled.id, card.id);
assert.equal(rescheduled.dueDate, '2030-01-18T00:00:00.000Z');
assert.equal(rescheduled.completed, true);
assert.equal((await request(`/boards/${board.id}`)).lists.flatMap(list => list.cards).filter(row => row.id === card.id).length, 1);
assert.equal(persisted.lists.find(list => list.id === second.id).wipLimit, 2);
const details = await request(`/cards/${card.id}`);
assert.equal(details.checklists[0].items[0].id, nextItem.id);
assert.equal(details.checklists[0].items.find(value => value.id === item.id).completed, true);
assert.match(details.comments[0].body, /Nginx/);
assert.ok(details.activity.length > 0);
assert.deepEqual(await request('/inbox'), []);
const capture = { id: randomUUID(), title: 'Capture a private idea', description: 'Keep this text when moving to a board.' };
const captured = await request('/inbox', { method: 'POST', body: capture });
assert.equal((await request('/inbox', { method: 'POST', body: capture })).id, captured.id);
const otherCapture = await request('/inbox', { method: 'POST', body: { id: randomUUID(), title: 'A second private idea', description: '' } });
await request(`/inbox/${captured.id}`, { method: 'PATCH', body: { title: 'Ready for a board', description: capture.description } });
const reordered = await request('/inbox/reorder', { method: 'POST', body: { ids: [otherCapture.id, captured.id] } });
assert.deepEqual(reordered.map(item => item.id), [otherCapture.id, captured.id]);
const converted = await request(`/inbox/${captured.id}/move`, { method: 'POST', body: { listId: first.id } });
assert.equal((await request(`/inbox/${captured.id}/move`, { method: 'POST', body: { listId: first.id } })).cardId, converted.cardId);
const inboxCard = await request(`/cards/${converted.cardId}`);
assert.equal(inboxCard.title, 'Ready for a board');
assert.equal(inboxCard.description, capture.description);
assert.equal((await request(`/boards/${board.id}`)).lists.flatMap(list => list.cards).filter(card => card.id === converted.cardId).length, 1);
await request(`/inbox/${otherCapture.id}`, { method: 'DELETE', body: { confirm: true } });
assert.deepEqual(await request('/inbox'), []);
const focus = { id: randomUUID(), title: 'Focus on the next step', notes: '  Keep useful context\nA private block  ', startsAt: '2030-01-18T09:00:00.000Z', endsAt: '2030-01-18T10:00:00.000Z' };
const focused = await request('/planner', { method: 'POST', body: focus });
assert.equal((await request('/planner', { method: 'POST', body: focus })).id, focused.id);
const range = '/planner?from=2030-01-18T00:00:00Z&to=2030-01-20T00:00:00Z';
assert.equal((await request(range)).find(row => row.id === focused.id).notes, focus.notes);
const planned = await request(`/planner/${focused.id}`, { method: 'PATCH', body: { ...focus, startsAt: '2030-01-19T09:00:00.000Z', endsAt: '2030-01-19T10:00:00.000Z', revision: focused.revision } });
assert.equal(planned.startsAt, '2030-01-19T09:00:00.000Z');
assert.equal((await request(`/cards/${card.id}`)).dueDate, rescheduled.dueDate);
await request(`/planner/${focused.id}`, { method: 'DELETE', body: { confirm: true, revision: planned.revision } });
assert.ok(!(await request(range)).some(row => row.id === focused.id));
await request('/auth/logout', { method: 'POST', body: {}, csrf });
const signedOut = await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
assert.equal(signedOut.status, 401);
console.log('PASS: frontend assets, proxy health, login, workspace/board/list/card creation, rich metadata, my tasks/completion, private inbox capture/edit/reorder/idempotent conversion, private planner capture/reschedule/delete with unchanged card due dates, checklist, comments/activity, saved views, WIP limit, move, archive/restore, refresh, persistence, and logout.');
