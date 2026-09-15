// Vercel downloads versioned, checksummed assets from this project's release
// at build time, then serves them from the same origin as the web application.
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../public/',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../release-assets.json',import.meta.url),'utf8'));
await mkdir(root,{recursive:true});
for(const asset of manifest.assets){
  if(!/^[a-zA-Z0-9.-]+$/.test(asset.file) || !/^[a-f0-9]{64}$/.test(asset.sha256))throw Error('Invalid release manifest');
  const dest=path.join(root,asset.file), hash=createHash('sha256');let bytes=0;
  if(existsSync(dest)){
    for await(const chunk of createReadStream(dest)){hash.update(chunk);bytes+=chunk.length;}
  }else{
    const response=await fetch(`${manifest.baseUrl}/${asset.file}`,{signal:AbortSignal.timeout(300_000)});
    if(!response.ok||!response.body)throw Error(`${asset.file}: HTTP ${response.status}`);
    const stream=Readable.fromWeb(response.body);
    stream.on('data',chunk=>{hash.update(chunk);bytes+=chunk.length;});
    await pipeline(stream,createWriteStream(dest+'.partial'));
  }
  if(bytes!==asset.bytes||hash.digest('hex')!==asset.sha256)throw Error(`Asset checksum mismatch: ${asset.file}`);
  if(!existsSync(dest))await rename(dest+'.partial',dest);
  console.log(`Verified ${asset.file}: ${bytes} bytes`);
}
