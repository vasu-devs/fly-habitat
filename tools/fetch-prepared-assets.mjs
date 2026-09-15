import {createReadStream,createWriteStream,existsSync} from 'node:fs';
import {mkdir,rename,writeFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
const base='https://pub-ef7218dea0984ac4885f76155c1e058a.r2.dev';
const manifest={'brain.bin':'6419c41e66e2','brain.meta.json':'bddb3b20a390','vnc.bin':'32f66b946a16','vnc.meta.json':'0918ccfa0fa8','flybody.bundle.bin':'f1e9edf29fb7'};
await mkdir('public',{recursive:true});
const receipts=[];
for(const [file,expected] of Object.entries(manifest)) {
  const dest='public/'+file,url=base+'/'+file+'?v='+expected;
  const hash=createHash('sha256');let bytes=0;
  if(existsSync(dest)) {
    for await (const chunk of createReadStream(dest)){hash.update(chunk);bytes+=chunk.length;}
  } else {
    const response=await fetch(url);if(!response.ok)throw new Error(file+': HTTP '+response.status);
    let reported=0;const stream=Readable.fromWeb(response.body);
    stream.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length;if(bytes-reported>25*1024*1024){console.log(file+': '+Math.round(bytes/1024/1024)+' MiB');reported=bytes;}});
    await pipeline(stream,createWriteStream(dest+'.partial'));
  }
  const sha256=hash.digest('hex');
  if(!sha256.startsWith(expected))throw new Error('Checksum mismatch: '+file+'; original file has not been overwritten');
  if(!existsSync(dest))await rename(dest+'.partial',dest);
  receipts.push({file,url,bytes,sha256});console.log('Verified '+file+': '+bytes+' bytes');
}
await writeFile('public/assets.json',JSON.stringify(manifest,null,2));
await writeFile('asset-receipts.json',JSON.stringify({source:'https://github.com/abgnydn/webgpu-fly',assets:receipts},null,2));
