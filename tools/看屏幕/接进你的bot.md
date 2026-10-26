# 接进你自己的 bot

`ocr.json` 每 2 秒刷新一次，长这样：

```json
{
  "t": 1792943210.5,
  "lines": [
    "文件  编辑  查看",
    "main.py - Visual Studio Code",
    "def hello(name):",
    "print('hi', name)",
    "终端   Python 3.11"
  ]
}
```

**它已经把整屏的字压到 60 行以内了**，你直接拼进提示词就行。

---

## Node.js 版

```js
import fs from 'node:fs';

const OCR = 'C:/path/to/ocr.json';

function screenBlock() {
  try {
    const j = JSON.parse(fs.readFileSync(OCR, 'utf8'));
    // 超过 30 秒没更新，就当没开
    if (Date.now() / 1000 - j.t > 30) return '';
    if (!j.lines?.length) return '';
    return [
      '',
      '【你刚看了一眼他的屏幕】',
      ...j.lines.map(l => '- ' + l),
      '',
      '★这是你"看见"的，不是他告诉你的。',
      '★别装作能看清整屏：只说你确实看到的那几行。',
      '★他问"我在干嘛"，你只能从这些字里推。',
    ].join('\n');
  } catch {
    return '';
  }
}

// 拼进你的 system prompt / 每次 user message 前面
const prompt = (memory || '') + screenBlock() + '\n\n' + userMessage;
```

---

## Python 版

```python
import json, os, time

OCR = r'C:\path\to\ocr.json'

def screen_block():
    try:
        with open(OCR, encoding='utf-8') as f:
            j = json.load(f)
    except Exception:
        return ''
    if time.time() - j.get('t', 0) > 30:
        return ''
    lines = j.get('lines') or []
    if not lines:
        return ''
    body = '\n'.join('- ' + l for l in lines)
    return f"""

【你刚看了一眼他的屏幕】
{body}

★这是你"看见"的，不是他告诉你的。
★别装作能看清整屏：只说你确实看到的那几行。
★他问"我在干嘛"，你只能从这些字里推。
"""

prompt = memory + screen_block() + '\n\n' + user_message
```

---

## 三个必须注意的

**① 别 2 秒注入一次**

`ocr.json` 是 2 秒一刷，但**你的请求不用跟着刷**。建议：

- 每次用户发消息时才读一次
- 或者最多 30 秒读一次

**不然一小时能烧掉几十块。**

**② 超过 30 秒没更新就当没开**

用户关了截图程序，`ocr.json` 还在，内容却是旧的。**你的 bot 会拿着十分钟前的屏幕说话。**

上面的代码里都有这个判断。

**③ 只留 60 行 1600 字**

包里写死了 `MAX_LINES = 60` / `MAX_CHARS = 1600`（`screen_ocr.py` 开头）。

整屏 1080P 的字全塞是 **3000~5000 token**，一次就吃掉你不少预算。

**1600 字大概 400 token，够用。**

想改就改那两个数字。

---

## 一句实在话

**它不是"看见"，是"读到字"。**

所以：

| 你问 | 她能不能答 |
|---|---|
| 「我屏幕上写着什么」 | ✅ 准 |
| 「这个报错是什么意思」 | ✅ 能看 |
| 「我在打什么游戏」 | ⚠️ 只能从字里猜 |
| 「我表情是不是很难看」 | ❌ 完全不行 |

**知道这个边界，你就不会失望。**
