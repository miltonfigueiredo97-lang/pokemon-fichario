'use strict';

const {searchOfficialJapaneseCards}=require('../lib/jp-official');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','public, s-maxage=900, stale-while-revalidate=86400');
  const name=String(req.query?.name||'').trim();
  const number=String(req.query?.number||'').trim();
  const set=String(req.query?.set||'').trim();
  const hp=String(req.query?.hp||'').trim();
  const rarity=String(req.query?.rarity||'').trim();
  const limit=Math.max(1,Math.min(80,Number(req.query?.limit)||40));

  if(!name){
    return res.status(200).json({
      ok:true,
      cards:[],
      message:'A fonte oficial japonesa precisa do nome para localizar a família da carta. Número e coleção continuam sendo filtros exatos depois disso.'
    });
  }

  try{
    const cards=await searchOfficialJapaneseCards({name,number,set,hp,rarity,limit});
    return res.status(200).json({ok:true,source:'pokemon-card.com',cards});
  }catch(error){
    console.error('[jp-card-search]',error);
    return res.status(502).json({ok:false,error:'jp_search_failed',cards:[],message:error?.message||String(error)});
  }
};

module.exports.config={maxDuration:30};
