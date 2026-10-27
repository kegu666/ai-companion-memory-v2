import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { SqliteMemory, createMemoryV2 } from '../src/sqlite-memory.js';
import { createOrganizer, createEmbedder } from '../src/memory-models.js';
import { Brain } from '../src/brain.js';
import { handleTurn } from '../src/index.js';

const priv = { scope: 'private:10001', userId: '10001' };
const group = { scope: 'group:555', userId: '10001' };
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-memory-test-'));
  const memory = new SqliteMemory({ dir, organizer: null, embedder: null, logger: () => {}, ...options });
  t.after(async () => { if (!memory.closed) await memory.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return memory;
}
const add = (m, text, extra = {}) => m.logTurn({ where: priv.scope, userId: priv.userId, who: '小明', text, reply: '知道了', ...extra });
const confirmed = (m, content, extra = {}) => m.addMemory({ ...priv, kind: 'fact', content, status: 'active', ...extra });
const organizer = {
  async organize({ previousSummary, turns }) {
    const first = turns[0];
    return { summary: (previousSummary + '\n' + turns.map((r) => r.userId + ':' + r.text).join('\n')).slice(-1000),
      memories: [{ kind: 'preference', slot: 'drink', content: '喜欢无糖咖啡', sourceIds: [first.id], quote: first.text }] };
  },
};
// Deterministic fixture vectors, NOT a trained embedding model.
const embedder = {
  key: 'test-fixture-v1',
  async embed(text) {
    return /咖啡|拿铁|饮料/.test(text) ? [1, 0, 0] : /猫|宠物/.test(text) ? [0, 1, 0] : [0, 0, 1];
  },
};

test('完整原文持久化，重启仍可读取，原 Memory 方法可用', async (t) => {
  const m = await fixture(t);
  const text = '长消息'.repeat(1000);
  const id = add(m, text);
  m.remember('10001', { name: '小明', fact: '养了一只猫', trait: '爱喝茶' });
  const dbPath = path.join(m.dir, 'memory.db');
  await m.close();
  const reopened = new SqliteMemory({ dir: m.dir, dbPath, organizer: null, embedder: null });
  try {
    assert.equal(reopened.sourceTurns([id], priv)[0].text, text);
    assert.ok(reopened.person('10001').facts.includes('养了一只猫'));
    assert.match(reopened.renderPerson('10001'), /小明/);
  } finally { await reopened.close(); }
});

test('摘要压缩仅覆盖较早消息，原文不删，摘要版本与来源可追查', async (t) => {
  const m = await fixture(t, { organizer, options: { recentTurns: 2 } });
  for (const text of ['喜欢无糖咖啡', '暂未决定搬家', '预算还没确定', '最后一句']) add(m, text);
  await m.flush({ force: true });
  assert.equal(m.summary(priv.scope).through_id, 2);
  assert.equal(m.summary(priv.scope).first_id, 1);
  assert.equal(m.stats().turns, 4);
  assert.match(m.summary(priv.scope).content, /暂未决定搬家/);
  assert.equal(m.db.prepare('SELECT count(*) AS n FROM summary_versions').get().n, 1);
  const candidates = m.list({ ...priv, status: 'candidate' });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].sourceIds, [1]);
  assert.equal((await m.search('无糖咖啡', priv)).length, 0);
});

test('混合检索：确认后向量可以召回没有相同关键词的记忆', async (t) => {
  const m = await fixture(t, { embedder });
  const id = m.addMemory({ ...priv, kind: 'preference', content: '每天喝无糖咖啡' });
  await m.flush();
  assert.equal((await m.search('拿铁', priv)).length, 0);
  m.approve(id);
  const hits = await m.search('拿铁', priv);
  assert.equal(hits[0].id, id);
  assert.ok(hits[0].score > 0.7);
});

test('私聊、其他用户、不同群之间均不串记忆或摘要', async (t) => {
  const m = await fixture(t, { embedder, organizer, options: { recentTurns: 1 } });
  confirmed(m, '私聊秘密：喜欢咖啡');
  confirmed(m, '别人秘密：喜欢咖啡', { scope: 'private:20002', userId: '20002' });
  confirmed(m, '群A聊过咖啡', group);
  confirmed(m, '群B聊过咖啡', { scope: 'group:666', userId: '20002' });
  add(m, '私聊秘密聊天');
  add(m, '最新私聊');
  await m.flush({ force: true });
  const hits = await m.search('咖啡', group);
  assert.equal(hits.length, 1);
  assert.match(hits[0].content, /群A/);
  const context = await m.context({ key: group.scope, userId: group.userId, text: '咖啡' });
  assert.doesNotMatch(context, /私聊秘密|别人秘密|群B/);
  await assert.rejects(() => m.search('咖啡', { scope: 'private:20002', userId: '10001' }));
});

test('确认新的同字段事实后旧事实退役，拒绝和遗忘内容不参与检索', async (t) => {
  const m = await fixture(t);
  const oldId = m.addMemory({ ...priv, kind: 'fact', slot: 'city', content: '现在住深圳' });
  m.approve(oldId);
  const newId = m.addMemory({ ...priv, kind: 'fact', slot: 'city', content: '现在住上海' });
  m.approve(newId);
  assert.equal(m.list({ ...priv, status: 'superseded' })[0].id, oldId);
  assert.equal(m.list({ ...priv, status: 'active' })[0].supersedes_id, oldId);
  assert.equal((await m.search('深圳', priv)).length, 0);
  const rejected = m.addMemory({ ...priv, kind: 'fact', content: '养了鲸鱼' });
  m.reject(rejected);
  assert.equal((await m.search('鲸鱼', priv)).length, 0);
  m.forget(newId);
  assert.equal((await m.search('上海', priv)).length, 0);
});

test('事实 A→B→A 可创建新的确认版本，不被旧内容去重挡住', async (t) => {
  const m = await fixture(t);
  const ids = [];
  for (const content of ['住深圳', '住上海', '住深圳']) {
    const id = m.addMemory({ ...priv, kind: 'fact', slot: 'city', content });
    ids.push(id); m.approve(id);
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal(m.list({ ...priv, status: 'active' }).length, 1);
  assert.equal(m.list({ ...priv, status: 'active' })[0].id, ids[2]);
  assert.equal(m.list({ ...priv, status: 'superseded' }).length, 2);
});

test('记忆标签、时间衰退和显式强化只影响检索，不删除原文', async (t) => {
  const m = await fixture(t, { embedder: { key: 'constant-test', embed: async () => [1, 0] } });
  const oldEvent = m.addMemory({ ...priv, kind: 'event', content: '上周吃过火锅', status: 'active',
    importance: 0.2, confidence: 0.8, temperature: 'cold', decayHalfLife: 1 });
  const stable = m.addMemory({ ...priv, kind: 'preference', content: '喜欢无糖咖啡', status: 'active',
    importance: 0.9, confidence: 0.9, temperature: 'warm', decayHalfLife: 365 });
  m.db.prepare('UPDATE memories SET last_reinforced=? WHERE id=?').run(Date.now() - 30 * 86400000, oldEvent);
  const hits = await m.search('咖啡', priv);
  assert.equal(hits[0].id, stable);
  assert.equal(m.db.prepare('SELECT count(*) AS n FROM memories').get().n, 2);
  assert.equal(m.db.prepare('SELECT temperature FROM memories WHERE id=?').get(oldEvent).temperature, 'cold');
  m.reinforce(oldEvent, { temperature: 'warm', importance: 0.8 });
  const reinforced = m.db.prepare('SELECT * FROM memories WHERE id=?').get(oldEvent);
  assert.equal(reinforced.temperature, 'warm');
  assert.equal(reinforced.recall_count, 1);
  assert.equal(m.list({ ...priv, status: 'active' }).length, 2);
});

test('计划过期后显示 expired 标签，仍保留记录和来源', async (t) => {
  const m = await fixture(t);
  const id = m.addMemory({ ...priv, kind: 'plan', content: '下周去看电影', status: 'active',
    expiresAt: Date.now() - 1000, temperature: 'warm' });
  const rows = await m.search('看电影', priv);
  assert.equal(rows[0].id, id);
  assert.equal(rows[0].temperature, 'expired');
  assert.equal(m.db.prepare('SELECT status,temperature FROM memories WHERE id=?').get(id).status, 'active');
});

test('整理失败不会推进摘要水位；恢复后继续，不重复覆盖或删除原文', async (t) => {
  const m = await fixture(t, { organizer: { organize: async () => { throw new Error('offline'); } }, options: { recentTurns: 1 } });
  add(m, '我喜欢咖啡'); add(m, '新消息');
  await m.flush({ force: true });
  assert.equal(m.summary(priv.scope), null);
  assert.equal(m.stats().turns, 2);
  assert.equal(m.db.prepare('SELECT attempts FROM work_queue').get().attempts, 1);
  m.organizer = organizer;
  await m.flush({ force: true });
  assert.equal(m.summary(priv.scope).through_id, 1);
});

test('无效来源、引用助手话语、多人混合记忆均被拒绝', async (t) => {
  const m = await fixture(t, {
    options: { recentTurns: 1 },
    organizer: { async organize({ turns }) {
      return { summary: '只是测试摘要', memories: [
        { kind: 'fact', content: '瞎编', quote: '不存在的原话', sourceIds: [turns[0].id] },
        { kind: 'fact', content: '助手的事实', quote: '知道了', sourceIds: [turns[0].id] },
        { kind: 'fact', content: '错的消息ID', quote: turns[0].text, sourceIds: [9999] },
        { kind: 'fact', content: '混合人物', quote: turns[0].text, sourceIds: [turns[0].id, turns[1].id] },
      ] };
    } },
  });
  for (const [id, text] of [['1', '我喜欢猫'], ['2', '我喜欢狗'], ['1', '最新']]) {
    add(m, text, { where: 'group:555', userId: id });
  }
  await m.flush({ force: true });
  assert.equal(m.stats().memories, 0);
  assert.equal(m.stats().summaries, 1);
});

test('群合批按原作者保存，不把整组对话算给最后一个人', async (t) => {
  const m = await fixture(t);
  m.recordConversation({ key: group.scope, sourceMessages: [
    { userId: '1', name: '小甲', text: '我养猫', time: 1000 },
    { userId: '2', name: '小乙', text: '我养狗', time: 2000 },
  ], reply: '你们分别养猫和狗' });
  const turns = m.recentTurns(10, group);
  assert.deepEqual(turns.map((r) => r.user_id), ['1', '2']);
  assert.deepEqual(turns.map((r) => r.text), ['我养猫', '我养狗']);
  assert.equal(turns[0].reply, '');
  assert.match(turns[1].reply, /猫和狗/);
});

test('embedding 模型更换后不混用旧向量，服务失败回退中文关键词', async (t) => {
  const m = await fixture(t, { embedder });
  confirmed(m, '每天喝无糖咖啡');
  await m.flush();
  m.embedder = { key: 'different-model', embed: async () => [1, 0] };
  assert.equal((await m.search('拿铁', priv)).length, 0);
  await m.flush();
  assert.equal(m.stats().vectors, 2);
  m.embedder.embed = async () => { throw new Error('offline'); };
  assert.match((await m.search('无糖咖啡', priv))[0].content, /无糖咖啡/);
});

test('导入旧 JSON/JSONL 幂等，保留源文件，群流水不伪造用户身份', async (t) => {
  const m = await fixture(t);
  const people = { '10001': { name: '小明', facts: ['以前住深圳'], interactions: 8 } };
  fs.writeFileSync(path.join(m.dir, 'people.json'), JSON.stringify(people));
  fs.writeFileSync(path.join(m.dir, 'turns.jsonl'), [
    { where: 'private:10001', who: '小明', text: '原始消息', reply: '原始回复' },
    { where: 'group:555', who: '旧昵称', text: '没可靠QQ号的旧记录', reply: '原始回复' },
  ].map((v) => JSON.stringify(v)).join('\n') + '\n');
  assert.deepEqual(m.importLegacy(), { people: 1, turns: 2 });
  assert.deepEqual(m.importLegacy(), { skipped: true });
  assert.equal(m.stats().turns, 2);
  assert.equal(m.recentTurns(1, group)[0].user_id, '');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(m.dir, 'people.json'))), people);
  assert.match(m.person('10001').facts[0], /深圳/);
});

test('损坏的旧数据导入失败回滚，不会留下成功标记', async (t) => {
  const m = await fixture(t);
  fs.writeFileSync(path.join(m.dir, 'turns.jsonl'), 'broken-json');
  assert.throws(() => m.importLegacy());
  assert.equal(m.db.prepare('SELECT value FROM meta WHERE key=?').get('legacy_imported'), undefined);
  assert.equal(m.stats().turns, 0);
});

test('上下文有长度预算，原始数据库仍保留超长消息', async (t) => {
  const m = await fixture(t, { options: { contextChars: 1200 } });
  add(m, '消息'.repeat(10000));
  const ctx = await m.context({ key: priv.scope, userId: priv.userId, text: '继续' });
  assert.ok(ctx.length <= 1200);
  assert.equal(m.recentTurns(1, priv)[0].text.length, 20000);
  add(m, '最新消息必须可见');
  assert.match(await m.context({ key: priv.scope, userId: priv.userId, text: '继续' }), /最新消息必须可见/);
});

async function server(t, handler) {
  const app = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      const result = await handler(req.url, JSON.parse(raw), req);
      res.writeHead(result?.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result?.body ?? result));
    } catch { res.writeHead(500); res.end('{}'); }
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { app.closeAllConnections(); app.close(resolve); }));
  return 'http://127.0.0.1:' + app.address().port + '/v1';
}

test('真实 HTTP 协议链路：整理、embedding、Brain 回复、再提取和持久化', async (t) => {
  const paths = [];
  const baseUrl = await server(t, async (url, body) => {
    paths.push(url);
    if (url.endsWith('/embeddings')) return { data: [{ embedding: await embedder.embed(body.input) }] };
    if (body.model === 'organizer-test') {
      const input = JSON.parse(body.messages[1].content);
      return { choices: [{ message: { content: JSON.stringify(await organizer.organize(input)) } }] };
    }
    const sys = body.messages[0].content;
    assert.doesNotMatch(sys, /另一用户的秘密/);
    return { choices: [{ message: { content: '记得，你喜欢无糖咖啡。' } }] };
  });
  const m = await fixture(t, {
    organizer: createOrganizer({ baseUrl, model: 'organizer-test' }),
    embedder: createEmbedder({ baseUrl, model: 'embedding-test' }),
    options: { recentTurns: 1 },
  });
  confirmed(m, '另一用户的秘密', { scope: 'private:20002', userId: '20002' });
  add(m, '喜欢无糖咖啡'); add(m, '第二条');
  await m.flush({ force: true });
  const candidate = m.list({ ...priv, status: 'candidate' })[0];
  m.approve(candidate.id);
  const brain = new Brain({ apiKey: 'local-test-only', baseUrl, model: 'chat-test', memory: m, role: { build: (ctx) => ctx.memory } });
  const result = await brain.reply({ key: priv.scope, userId: priv.userId, userName: '小明', text: '我平常喝什么？' });
  assert.match(result.text, /无糖咖啡/);
  assert.equal(m.recentTurns(1, priv)[0].reply, result.text);
  assert.ok(paths.includes('/v1/embeddings'));
  assert.ok(paths.includes('/v1/chat/completions'));
});

test('同会话并发按顺序回复；模型 HTTP 失败仍保存来信', async (t) => {
  const observed = [];
  const baseUrl = await server(t, async (_url, body) => {
    const input = body.messages.at(-1).content;
    observed.push(input);
    if (input === '失败') return { status: 503, body: {} };
    if (input === '第二句') assert.match(body.messages[0].content, /第一句/);
    return { choices: [{ message: { content: '回复' + input } }] };
  });
  const m = await fixture(t);
  const brain = new Brain({ apiKey: 'local-test-only', baseUrl, memory: m, role: { build: (ctx) => ctx.memory } });
  const ask = (text) => brain.reply({ key: priv.scope, userId: priv.userId, text });
  await Promise.all([ask('第一句'), ask('第二句')]);
  await assert.rejects(() => ask('失败'));
  assert.deepEqual(observed, ['第一句', '第二句', '失败']);
  assert.equal(m.recentTurns(1, priv)[0].text, '失败');
  assert.equal(m.recentTurns(1, priv)[0].reply, '');
});

test('QQ dry-run 传递 record:false，不写记忆也不发消息', async () => {
  let input;
  await handleTurn({
    bot: { send: () => assert.fail('不可发送') },
    brain: { reply: async (value) => { input = value; return { text: '测试' }; } },
    memory: {}, human: {}, waker: {},
  }, [{ key: 'private:10001', userId: '10001', name: '小明', text: 'hello' }], { dryRun: true });
  assert.equal(input.record, false);
});

test('QQ 发送失败不会在记忆里标记成已送达', async (t) => {
  const m = await fixture(t);
  const ids = m.beginConversation({ key: priv.scope, userId: priv.userId, text: '收到没有？' });
  m.completeConversation(ids, '生成了但发送失败');
  assert.equal(m.recentTurns(1, priv)[0].delivery, 'generated');
  await handleTurn({
    bot: { setTyping: async () => {}, send: async () => ({ ok: false }) },
    brain: { reply: async () => ({ text: '生成了但发送失败', memoryTurnIds: ids }) },
    memory: m,
    human: { say: async (text, transport) => { await transport.send(text); return { sent: 0, parts: [] }; } },
    waker: { wake() {} },
  }, [{ key: priv.scope, userId: priv.userId, text: '收到没有？' }], { dryRun: false });
  assert.equal(m.recentTurns(1, priv)[0].delivery, 'send-failed');
});
