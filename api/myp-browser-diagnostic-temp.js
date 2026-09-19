'use strict';
const { findAndScrapeMypBrowser } = require('../lib/myp-browser');

module.exports=async function handler(req,res){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  const result=await findAndScrapeMypBrowser('',{
    name:'Lugia V',
    number:'138/195',
    set:'Tempestade Prateada',
    setId:'swsh12',
    lang:'pt-br',
    finish:'Foil',
    condition:'Nova'
  });
  res.status(200).json(result);
};
module.exports.config={maxDuration:60};
