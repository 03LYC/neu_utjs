import {it,expect} from 'vitest';
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SecretStore} from '../electron/secrets';
it('no_plaintext_persistence_when_encryption_unavailable',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'qc-secret-'));
 try{const file=path.join(dir,'key');const store=new SecretStore(file,{isEncryptionAvailable:()=>false,encryptString:()=>Buffer.alloc(0),decryptString:()=>''});store.save('synthetic-secret');expect(store.read()).toBe('synthetic-secret');expect(existsSync(file)).toBe(false);}finally{rmSync(dir,{recursive:true,force:true});}
});
it('encrypted_storage_and_clear',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'qc-secret-'));
 try{const file=path.join(dir,'key');const crypto={isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(s.split('').reverse().join('')),decryptString:(b:Buffer)=>b.toString().split('').reverse().join('')};const store=new SecretStore(file,crypto);store.save('synthetic-secret');expect(readFileSync(file,'utf8')).not.toContain('synthetic-secret');expect(new SecretStore(file,crypto).read()).toBe('synthetic-secret');store.clear();expect(store.read()).toBe('');expect(existsSync(file)).toBe(false);}finally{rmSync(dir,{recursive:true,force:true});}
});
