from pathlib import Path

js_path = Path('script.js')
css_path = Path('style.css')
sw_path = Path('sw.js')

js = js_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')
sw = sw_path.read_text(encoding='utf-8')

# V6 foi gravada com sequencias literais "\\n" no JS/CSS, o que invalida o JavaScript.
# Removemos apenas o bloco V6 quebrado e mantemos integralmente a V5 funcional.
js_markers = [
    r'\n\n// ===== V6 MOBILE UX + LIVE SCAN + DETAILS =====',
    '// ===== V6 MOBILE UX + LIVE SCAN + DETAILS =====',
]
for marker in js_markers:
    idx = js.find(marker)
    if idx != -1:
        # Se o marcador simples foi encontrado, remova tambem barras-n literais imediatamente antes.
        start = idx
        while start >= 2 and js[start-2:start] == r'\n':
            start -= 2
        js = js[:start].rstrip() + '\n'
        break

css_markers = [
    r'\n\n/* ===== V6 MOBILE/SCANNER/DETAILS ===== */',
    '/* ===== V6 MOBILE/SCANNER/DETAILS ===== */',
]
for marker in css_markers:
    idx = css.find(marker)
    if idx != -1:
        start = idx
        while start >= 2 and css[start-2:start] == r'\n':
            start -= 2
        css = css[:start].rstrip() + '\n'
        break

# Forca o PWA a abandonar o cache da versao quebrada.
import re
sw = re.sub(r"const CACHE_NAME = '[^']+';", "const CACHE_NAME = 'pokemon-binder-v7-recovery';", sw, count=1)

js_path.write_text(js, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
sw_path.write_text(sw, encoding='utf-8')
