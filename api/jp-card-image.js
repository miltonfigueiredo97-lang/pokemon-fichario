'use strict';

const {searchOfficialJapaneseCards}=require('../lib/jp-official');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=604800, stale-while-revalidate=2592000');
  const name=String(req.query?.name||'').trim();
  const number=String(req.query?.localId||req.query?.number||'').trim();
  const set=String(req.query?.set||'').trim();
  const hp=String(req.query?.hp||'').trim();
  const rarity=String(req.query?.rarity||'').trim();
  if(!name)return res.status(400).json({ok:false,error:'name_required'});

  try{
    let cards=await searchOfficialJapaneseCards({name,number,set,hp,rarity,limit:4});
    // TCGdex set ids often describe the Western printing and therefore do not
    // equal the Japanese set code. Retry without the Western set instead of
    // returning a wrong card solely because both happen to share a number.
    if(!cards.length&&set)cards=await searchOfficialJapaneseCards({name,number,hp,rarity,limit:4});
    const best=cards.find(c=>c.imageUrl);
    if(!best)return res.status(404).json({ok:false,error:'image_not_found'});
    res.statusCode=302;
    res.setHeader('Location',best.imageUrl);
    res.setHeader('X-Pokemon-JP-Card-ID',best.officialId||'');
    return res.end();
  }catch(error){
    console.error('[jp-card-image]',error);
    return res.status(502).json({ok:false,error:'jp_source_failed',message:error?.message||String(error)});
  }
};

module.exports.config={maxDuration:30};
