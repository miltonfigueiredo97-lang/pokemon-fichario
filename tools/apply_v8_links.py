from pathlib import Path

# V8: ativa a camada segura depois da recuperação da tela preta.
index_path = Path('index.html')
sw_path = Path('sw.js')

html = index_path.read_text(encoding='utf-8')
sw = sw_path.read_text(encoding='utf-8')

if '/v8.css' not in html:
    html = html.replace(
        '<link rel="stylesheet" href="/style.css">',
        '<link rel="stylesheet" href="/style.css">\n  <link rel="stylesheet" href="/v8.css">'
    )

if '/v8.js' not in html:
    html = html.replace('</body>', '  <script src="/v8.js"></script>\n</body>')

html = html.replace('Ver carta 3D', 'Detalhes da carta')
index_path.write_text(html, encoding='utf-8')

sw = sw.replace("const CACHE_NAME = 'pokemon-binder-v7-recovery';", "const CACHE_NAME = 'pokemon-binder-v8';")
if "'/v8.css'" not in sw:
    sw = sw.replace("  '/style.css',", "  '/style.css',\n  '/v8.css',")
if "'/v8.js'" not in sw:
    sw = sw.replace("  '/script.js',", "  '/script.js',\n  '/v8.js',")
sw_path.write_text(sw, encoding='utf-8')
