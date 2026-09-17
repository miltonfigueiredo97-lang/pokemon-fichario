from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'v122.js'
s = p.read_text(encoding='utf-8')
old = """  function desiredPosition(row,used){const p=Number(rowValue(row,'Página')),s=Number(rowValue(row,'Bolso'));if(p>=1&&s>=1&&s<=9&&!getCardAt(p,s)&&!used.has(`${p}:${s}`)){used.add(`${p}:${s}`);return{page:p,slot:s}}const pos=freePositions(currentPage,1).find(x=>!used.has(`${x.page}:${x.slot}`))||freePositions(1,1)[0];used.add(`${pos.page}:${pos.slot}`);return pos}
"""
new = """  function desiredPosition(row,used){
    const requestedPage=Number(rowValue(row,'Página')),requestedSlot=Number(rowValue(row,'Bolso'));
    const isFree=(page,slot)=>page>=1&&slot>=1&&slot<=9&&!getCardAt(page,slot)&&!used.has(`${page}:${slot}`);
    if(isFree(requestedPage,requestedSlot)){used.add(`${requestedPage}:${requestedSlot}`);return{page:requestedPage,slot:requestedSlot}}
    const basePages=Math.max(1,+settings.binder_pages||1);
    const start=Math.max(1,+currentPage||1);
    const scan=[];
    for(let page=start;page<=basePages;page++)scan.push(page);
    for(let page=1;page<start;page++)scan.push(page);
    for(const page of scan){for(let slot=1;slot<=9;slot++){if(isFree(page,slot)){used.add(`${page}:${slot}`);return{page,slot}}}}
    let page=basePages+1;
    while(true){for(let slot=1;slot<=9;slot++){if(!used.has(`${page}:${slot}`)){used.add(`${page}:${slot}`);return{page,slot}}}page++}
  }
"""
if old not in s:
    raise SystemExit('desiredPosition block not found')
p.write_text(s.replace(old,new,1), encoding='utf-8')
print('V12.2 import position allocation fixed')
