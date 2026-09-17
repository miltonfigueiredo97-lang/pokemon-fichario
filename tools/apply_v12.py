from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
index_path = root / 'index.html'
sw_path = root / 'sw.js'

index = index_path.read_text(encoding='utf-8')
if '/v12.css' not in index:
    index = index.replace('  <link rel="stylesheet" href="/v11fix.css">', '  <link rel="stylesheet" href="/v11fix.css">\n  <link rel="stylesheet" href="/v12.css">')
if '/v122.css' not in index:
    index = index.replace('  <link rel="stylesheet" href="/v12.css">', '  <link rel="stylesheet" href="/v12.css">\n  <link rel="stylesheet" href="/v122.css">')
if '/v12.js' not in index:
    index = index.replace('  <script src="/v11fix.js"></script>', '  <script src="/v11fix.js"></script>\n  <script src="/v12.js"></script>')
if '/v122.js' not in index:
    index = index.replace('  <script src="/v12.js"></script>', '  <script src="/v12.js"></script>\n  <script src="/v122.js"></script>')
index_path.write_text(index, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = re.sub(r"const CACHE_NAME = '[^']+';", "const CACHE_NAME = 'pokemon-binder-v12-2';", sw, count=1)
for anchor, item in [
    ("  '/v11fix.css',", "  '/v12.css',"),
    ("  '/v12.css',", "  '/v122.css',"),
    ("  '/v11fix.js',", "  '/v12.js',"),
    ("  '/v12.js',", "  '/v122.js',"),
]:
    if item not in sw:
        sw = sw.replace(anchor, anchor + '\n' + item)
sw_path.write_text(sw, encoding='utf-8')

print('V12.2 links/cache applied')
