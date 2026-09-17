from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
index_path = root / 'index.html'
sw_path = root / 'sw.js'

index = index_path.read_text(encoding='utf-8')
if '/v12.css' not in index:
    index = index.replace('  <link rel="stylesheet" href="/v11fix.css">', '  <link rel="stylesheet" href="/v11fix.css">\n  <link rel="stylesheet" href="/v12.css">')
if '/v12.js' not in index:
    index = index.replace('  <script src="/v11fix.js"></script>', '  <script src="/v11fix.js"></script>\n  <script src="/v12.js"></script>')
index_path.write_text(index, encoding='utf-8')

sw = sw_path.read_text(encoding='utf-8')
sw = re.sub(r"const CACHE_NAME = '[^']+';", "const CACHE_NAME = 'pokemon-binder-v12-0';", sw, count=1)
if "'/v12.css'" not in sw:
    sw = sw.replace("  '/v11fix.css',", "  '/v11fix.css',\n  '/v12.css',")
if "'/v12.js'" not in sw:
    sw = sw.replace("  '/v11fix.js',", "  '/v11fix.js',\n  '/v12.js',")
sw_path.write_text(sw, encoding='utf-8')

print('V12.0 links/cache applied')
