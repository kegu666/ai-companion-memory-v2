/**
 * Offline, deterministic demonstration. The organizer and vectors below are fixtures,
 * not a real model, and do not demonstrate model extraction accuracy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteMemory } from '../src/sqlite-memory.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const dir = path.join(root, 'data', 'memory-v2-demo-' + Date.now());
const scope = 'private:10001', userId = '10001';
const embedder = {
  key: 'offline-fixture-v1',
  async embed(text) { return /咖啡|拿铁|饮料/.test(text) ? [1, 0, 0] : /城市|深圳|上海/.test(text) ? [0, 1, 0] : [0, 0, 1]; },
};
const organizer = {
  async organize({ turns }) {
    return {
      summary: '小明喜欢无糖咖啡，当前住深圳。讨论过搬家，但还没有决定，不能认定已搬到上海。',
      memories: turns.filter((t) => t.text === '我喜欢喝无糖咖啡。').map((t) => ({
        kind: 'preference', slot: 'drink', content: '小明喜欢喝无糖咖啡。',
        sourceIds: [t.id], quote: '我喜欢喝无糖咖啡。',
      })),
    };
  },
};
const memory = new SqliteMemory({ dir, organizer, embedder, options: { recentTurns: 2 } });
try {
  console.log('Memory V2 离线演示（固定整理结果 + 测试向量，不调用真实模型）\n');
  for (const text of ['我喜欢喝无糖咖啡。', '我目前住深圳。', '可能下个月搬上海，还没定。',
    '刚才只是计划，不是说已经搬了。', '今晚先不讨论搬家。', '你还记得我喜欢喝什么吗？']) {
    memory.recordConversation({ key: scope, userId, userName: '小明', text, reply: '收到。' });
  }
  const secretId = memory.addMemory({ scope: 'private:20002', userId: '20002', kind: 'fact',
    content: '另一个用户的私聊秘密：喜欢咖啡。', status: 'active', origin: 'demo' });
  await memory.flush({ force: true });
  const summary = memory.summary(scope);
  const candidate = memory.list({ scope, userId, status: 'candidate' })[0];
  console.log('① 已保存 6 轮完整原文；较早 4 轮压缩，最近 2 轮保持原文。');
  console.log('   摘要：' + summary.content);
  console.log('② 提取为候选记忆，需要明确确认：' + candidate.content);
  console.log('   确认前问“拿铁” → ' + (await memory.search('拿铁', { scope, userId })).length + ' 条。');
  memory.approve(candidate.id);
  const hits = await memory.search('拿铁', { scope, userId });
  console.log('③ 确认后问“拿铁” → ' + hits.map((r) => r.content).join('；'));
  console.log('   说明：这里用固定测试向量验证检索链路，并非实测语义模型能力。');
  const oldCity = memory.addMemory({ scope, userId, kind: 'fact', slot: 'city', content: '当前住深圳' });
  memory.approve(oldCity);
  const newCity = memory.addMemory({ scope, userId, kind: 'fact', slot: 'city', content: '现在已搬到上海' });
  memory.approve(newCity);
  console.log('④ 显式确认新城市后旧城市退役：' +
    memory.list({ scope, userId }).filter((r) => r.slot === 'city').map((r) => r.content + '=' + r.status).join('；'));
  const isolated = await memory.search('咖啡', { scope: 'group:555', userId });
  console.log('⑤ 群聊搜索“咖啡” → ' + isolated.length + ' 条（没有授权共享私聊）。');
  const context = await memory.context({ key: scope, userId, text: '饮料' });
  const report = {
    mode: 'offline-fixture-not-a-real-model',
    database: 'memory.db', summary, candidateBeforeApproval: { ...candidate },
    semanticSearch: hits, groupSearch: isolated, stats: memory.stats(),
    otherUserSecretExcluded: !hits.some((r) => r.id === secretId), injectedContext: context,
  };
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'context.txt'), context);
  console.log('\n数据库与报告：' + dir);
  console.log('全部留在本机；没有连接 QQ、没有外部模型调用。');
} finally { await memory.close(); }
