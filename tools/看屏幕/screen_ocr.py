"""让她看见你的屏幕 · OCR 版

每隔几秒截一次屏，认出上面的字，写成 ocr.json。
别的程序读这个文件，就能"看见"你在干什么。

依赖：pip install rapidocr_onnxruntime pillow
不需要 ffmpeg —— 截屏用 Pillow 自带的 ImageGrab。
"""

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, 'latest.jpg')
OUT = os.path.join(HERE, 'ocr.json')

INTERVAL = float(os.environ.get('OCR_INTERVAL', '2'))
MAX_LINES = 60
MAX_CHARS = 1600
MAX_FAILS = 5

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR()
    return _engine


def grab():
    """截一张全屏，存成 latest.jpg。返回 True/False。"""
    try:
        from PIL import ImageGrab
        im = ImageGrab.grab(all_screens=True)
        w, h = im.size
        if max(w, h) > 1600:
            k = 1600.0 / max(w, h)
            im = im.resize((int(w * k), int(h * k)))
        im = im.convert('RGB')
        im.save(IMG, 'JPEG', quality=85)
        return True
    except Exception as e:
        print('[X] 截屏失败：%s' % e, flush=True)
        return False


def read_lines():
    from PIL import Image
    im = Image.open(IMG).convert('RGB')
    result, _ = get_engine()(im)
    if not result:
        return []
    rows = []
    for item in result:
        box, text = item[0], item[1]
        t = (text or '').strip()
        if t:
            rows.append((box[0][1], box[0][0], t))
    rows.sort()
    return rows


def compact(rows):
    """只保留有限的行数和字数 —— 全塞进去会吃掉几千 token"""
    lines, total = [], 0
    for _, _, t in rows:
        if total + len(t) > MAX_CHARS or len(lines) >= MAX_LINES:
            break
        lines.append(t)
        total += len(t)
    return lines


def once(verbose=True):
    if not grab():
        return []
    rows = read_lines()
    lines = compact(rows)
    rec = {'t': time.time(), 'lines': lines}
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(rec, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)
    if verbose:
        print('[%s] %d 行' % (time.strftime('%H:%M:%S'), len(lines)), flush=True)
    return lines


def main():
    print('=' * 46, flush=True)
    print('  让她看见你的屏幕', flush=True)
    print('=' * 46, flush=True)
    print('  截图 → latest.jpg', flush=True)
    print('  认字 → ocr.json', flush=True)
    print('  每隔 %.1f 秒一次，Ctrl+C 停' % INTERVAL, flush=True)
    print('', flush=True)

    print('第一次要加载模型，等十几秒……', flush=True)
    t0 = time.time()
    try:
        get_engine()
    except Exception as e:
        print('[X] 模型加载失败：%s' % e, flush=True)
        print('    先双击 安装.bat', flush=True)
        input('按回车退出...')
        return 1
    print('模型好了（%.1f 秒）' % (time.time() - t0), flush=True)
    print('', flush=True)

    fails = 0
    while True:
        try:
            lines = once()
            if lines:
                fails = 0
        except KeyboardInterrupt:
            print('\n停了。', flush=True)
            return 0
        except Exception as e:
            fails += 1
            print('[X] 出错（第 %d 次）：%s' % (fails, e), flush=True)
            if fails >= MAX_FAILS:
                print('[X] 连续失败 %d 次，退出。' % MAX_FAILS, flush=True)
                return 1
        time.sleep(INTERVAL)


if __name__ == '__main__':
    sys.exit(main())
