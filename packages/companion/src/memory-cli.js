/** Local-only administration; not exposed as a QQ model tool. */
import path from 'node:path';
import { loadConfig } from './index.js';
import { createMemoryV2 } from './sqlite-memory.js';

const args = process.argv.slice(2);
const at = args.indexOf('--config');
const configFile = at >= 0 ? args.splice(at, 2)[1] : undefined;
const cfg = loadConfig(configFile);
const [command, ...rest] = args;
const offline = ['list', 'approve', 'reject', 'forget', 'stats', 'source'].includes(command);
const memory = await createMemoryV2({
  dir: cfg.dataDir, config: cfg.memory,
  ...(offline ? { organizer: null, embedder: null } : {}),
});
try {
  let result;
  const [scope, userId] = rest;
  switch (command) {
    case 'stats': result = memory.stats(); break;
    case 'list': result = memory.list({ scope, userId, status: rest[2] }); break;
    case 'source': result = memory.sourceTurns(rest.slice(2).map(Number), { scope, userId }); break;
    case 'approve': result = memory.approve(Number(rest[0])); break;
    case 'reject': result = memory.reject(Number(rest[0])); break;
    case 'forget': result = memory.forget(Number(rest[0])); break;
    case 'search': result = await memory.search(rest.slice(2).join(' '), { scope, userId }); break;
    case 'context': result = await memory.context({ key: scope, userId, text: rest.slice(2).join(' ') }); break;
    case 'flush': await memory.flush({ force: true }); result = memory.stats(); break;
    default: result = [
      '用法：node packages/companion/src/memory-cli.js --config <config.json> <命令>',
      'stats | flush',
      'list <private:QQ号|group:群号> <当前QQ号> [candidate|active|superseded]',
      'approve <记忆ID> | reject <记忆ID> | forget <记忆ID>',
      'search <scope> <当前QQ号> <问题> | context <scope> <当前QQ号> <问题>',
      'source <scope> <当前QQ号> <消息ID> ...',
      '数据库：' + path.join(cfg.dataDir, 'memory.db'),
    ].join('\n');
  }
  console.log(typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { await memory.close(); }
