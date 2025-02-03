#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {TextDecoder} from 'node:util';
import {rehearse,incomplete,LIMITS} from '../src/index.mjs';
function options(argv){if(argv.length!==4)return null;const out={};for(let i=0;i<argv.length;i+=2){if(!['--root','--input'].includes(argv[i])||Object.hasOwn(out,argv[i])||!argv[i+1])return null;out[argv[i]]=argv[i+1];}return Object.keys(out).length===2?out:null;}
function duplicateKeys(text){const stack=[];for(const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\],:]/gs)){const token=match[0],top=stack.at(-1);if(token==='{'){stack.push({kind:'object',key:true,seen:new Set()});continue;}if(token==='['){stack.push({kind:'array'});continue;}if(token==='}'||token===']'){stack.pop();continue;}if(token===','){if(top?.kind==='object')top.key=true;continue;}if(top?.kind==='object'&&top.key){const key=JSON.parse(token);if(top.seen.has(key))return true;top.seen.add(key);top.key=false;}}return false;}
function read(root,relative){if(path.isAbsolute(relative))return {error:'input-unreadable'};let target;try{target=fs.realpathSync(path.resolve(root,relative));if(target===root||!target.startsWith(root+path.sep)||!fs.statSync(target).isFile())return {error:'input-unreadable'};}catch{return {error:'input-unreadable'};}let raw;try{raw=fs.readFileSync(target);}catch{return {error:'input-unreadable'};}if(raw.length>LIMITS.bytes)return {error:'byte-limit'};try{const text=new TextDecoder('utf-8',{fatal:true}).decode(raw),value=JSON.parse(text);if(duplicateKeys(text))return {error:'input-invalid'};return {value};}catch{return {error:'input-invalid'};}}
export function main(argv,now=()=>performance.now()){
  if(argv.length===1&&argv[0]==='--help'){process.stdout.write('Usage: migration-rehearsal-runner --root DIR --input FILE\n');return 0;}
  const args=options(argv);if(!args){process.stderr.write('Usage: migration-rehearsal-runner --root DIR --input FILE\n');return 2;}
  let root;try{root=fs.realpathSync(args['--root']);if(!fs.statSync(root).isDirectory())throw Error();}catch{process.stderr.write('Invalid root.\n');return 2;}
  const input=read(root,args['--input']);const result=input.error?incomplete(input.error):rehearse(input.value,{now});process.stdout.write(JSON.stringify(result)+'\n');return result.status==='pass'?0:result.status==='fail'?1:2;
}
if(process.argv[1]&&fs.realpathSync(process.argv[1])===fs.realpathSync(new URL(import.meta.url)))process.exitCode=main(process.argv.slice(2));
