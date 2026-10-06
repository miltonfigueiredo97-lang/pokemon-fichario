// Builds fx/pokemon-cards.css from simeydotme/pokemon-cards-css (GPL-3.0):
// only the shine/glare effect rules, scoped to .pfx instead of .card.
const fs=require('fs'),path=require('path');
const src=process.argv[2],out=process.argv[3];
const css=p=>fs.readFileSync(path.join(src,'public/css',p),'utf8');
const base=css('cards/base.css');
const rootVars=base.slice(base.indexOf(':root {'),base.indexOf('}',base.indexOf(':root {'))+1);
const effects=base.slice(base.lastIndexOf('/**',base.indexOf('Shine & Glare Effects')));
const files=['basic','reverse-holo','regular-holo','cosmos-holo','amazing-rare','radiant-holo','v-regular','v-full-art','v-max','v-star','trainer-full-art','rainbow-holo','rainbow-alt','secret-rare','trainer-gallery-holo','trainer-gallery-v-regular','trainer-gallery-v-max','trainer-gallery-secret-rare','shiny-rare','shiny-v','shiny-vmax'];
let all=[
  '/* Card foil effects ported from pokemon-cards-css by Simon Goellner (@simeydotme),',
  '   https://github.com/simeydotme/pokemon-cards-css, licensed GPL-3.0',
  '   (see fx/LICENSE-pokemon-cards-css). Built by scripts/build-fx.js: only the',
  '   shine/glare rules, scoped to .pfx (the card viewer) instead of .card. */',
  rootVars.replace(':root','.pfx'),
  css('cards.css').replace(/\.card__shine,\s*\.card__glare\s*\{[\s\S]*?\}/,''),
  effects,
  ...files.map(f=>'/* ---- '+f+' ---- */\n'+css('cards/'+f+'.css'))
].join('\n');
all=all
  .replace(/\.card(?![\w-])/g,'.pfx')
  .replace(/url\("\/img\//g,'url("./img/')
  .replace(/\/\*[\s\S]*?\*\//g,m=>m.startsWith('/* Card foil effects')?m:'')
  // Base rules without .card (".card__shine {") stay inside the viewer too.
  .replace(/(^|[\n,}]\s*)(\.card__(?:shine|glare|front|back))/g,'$1.pfx $2')
  .replace(/\n\s*\n+/g,'\n');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'pokemon-cards.css'),all);
const imgs=[...new Set([...all.matchAll(/url\("\.\/img\/([^"]+)"\)/g)].map(m=>m[1]))];
fs.mkdirSync(path.join(out,'img'),{recursive:true});
for(const i of imgs)fs.copyFileSync(path.join(src,'public/img',i),path.join(out,'img',i));
fs.copyFileSync(path.join(src,'LICENSE'),path.join(out,'LICENSE-pokemon-cards-css'));
console.log('css',all.length,'bytes; images',imgs.join(', '));
