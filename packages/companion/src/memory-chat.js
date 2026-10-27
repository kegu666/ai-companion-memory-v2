/** Terminal trial using configured real models; no QQ bridge needed. */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './index.js';
import { createMemoryV2 } from './sqlite-memory.js';
import { Brain } from './brain.js';
import { Role } from './role.js';

const args = process.argv.slice(2);
const configAt = args.indexOf('--config');
if (configAt < 0 || !args[configAt + 1]) throw new Error('需要 --config <config.json>，示例见 docs/MEMORY-V2.md');
const cfg = loadConfig(args[configAt + 1]);
if (!cfg.apiKey && !/localhost|127\.0\.0\.1/.test(cfg.baseUrl)) throw new Error('请配置对话模型 API Key 环境变量');
const scope = 'private:trial', userId = 'trial';
const memory = await createMemoryV2({ dir: cfg.dataDir, config: { ...cfg.memory, ownerIds: [...(cfg.memory.ownerIds || []), userId] } });
const brain = new Brain({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model,
  memory, role: new Role({ cardPath: cfg.roleCard, maxChars: cfg.roleMaxChars }) });
const terminal = createInterface({ input: stdin, output: stdout });
console.log('真实模型终端试聊。内容将发给配置的模型服务。\n/compact 整理 /memories 候选 /approve ID 确认 /reject ID 拒绝 /search 问题 /exit 退出');
try {
  while (true) {
    const text = (await terminal.question('你 > ')).trim();
    if (!text) continue;
    if (text === '/exit') break;
    try {
      if (text === '/compact') {
        await memory.flush({ force: true });
        console.log(memory.summary(scope)?.content || '消息数量不足，保留最近原文中。');
      } else if (text === '/memories') {
        console.log(JSON.stringify(memory.list({ scope, userId }), null, 2));
      } else if (text.startsWith('/approve ')) {
        memory.approve(Number(text.slice(9))); console.log('已确认。');
      } else if (text.startsWith('/reject ')) {
        memory.reject(Number(text.slice(8))); console.log('已拒绝。');
      } else if (text.startsWith('/search ')) {
        console.log(JSON.stringify(await memory.search(text.slice(8), { scope, userId }), null, 2));
      } else {
        const reply = await brain.reply({ key: scope, userId, userName: '试用者', text });
        console.log('鲸鱼 > ' + reply.text);
        memory.markDelivery(reply.memoryTurnIds, true);
      }
    } catch { console.error('本次操作失败，请检查配置和模型服务；原文保留在数据库。'); }
  }
} finally { terminal.close(); await memory.close(); }
