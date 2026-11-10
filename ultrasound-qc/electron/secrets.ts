import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs';
import path from 'node:path';
type Encryption={isEncryptionAvailable:()=>boolean;encryptString:(value:string)=>Buffer;decryptString:(value:Buffer)=>string};
export class SecretStore{
 private memory='';
 constructor(private file:string,private crypto:Encryption){}
 save(value:string):{persistent:boolean}{
  this.memory=value.trim();
  if(!this.memory){this.clear();return {persistent:false};}
  if(!this.crypto.isEncryptionAvailable())return {persistent:false};
  mkdirSync(path.dirname(this.file),{recursive:true});
  const temporary=this.file+'.tmp';writeFileSync(temporary,this.crypto.encryptString(this.memory));renameSync(temporary,this.file);
  return {persistent:true};
 }
 read():string{
  if(this.memory)return this.memory;
  if(existsSync(this.file)&&this.crypto.isEncryptionAvailable()){
   try{return this.crypto.decryptString(readFileSync(this.file));}catch{return '';}
  }
  return '';
 }
 clear(){this.memory='';if(existsSync(this.file))unlinkSync(this.file);}
 hasKey(){return !!this.read();}
}
