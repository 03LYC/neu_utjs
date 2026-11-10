import {afterEach,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildWorkerEnv,loadRuntime} from '../electron/worker';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function writeConfig(relativeFile:string,config:unknown){
 const root=mkdtempSync(path.join(tmpdir(),'qc-runtime-'));roots.push(root);
 const file=path.join(root,relativeFile);mkdirSync(path.dirname(file),{recursive:true});
 writeFileSync(file,'\uFEFF'+JSON.stringify(config));
 return {root,file};
}
it.each(['.runtime/config.json','dist/win-unpacked/resources/runtime.json'])('resolves_relocated_project_paths_from_root_for_%s',relativeFile=>{
 const {root,file}=writeConfig(relativeFile,{pythonPath:'.venv/Scripts/python.exe',ocrSource:'../PaddleOCR',modelCache:'.runtime/models',device:'gpu:0'});
 expect(loadRuntime(file,root)).toEqual({
  pythonPath:path.join(root,'.venv','Scripts','python.exe'),
  ocrSource:path.resolve(root,'..','PaddleOCR'),
  modelCache:path.join(root,'.runtime','models'),device:'gpu:0',projectRoot:root,
 });
});
it('preserves_explicit_absolute_paths',()=>{
 const paths={pythonPath:path.resolve('external/python.exe'),ocrSource:path.resolve('external/PaddleOCR'),modelCache:path.resolve('external/models'),device:'cpu'};
 const {root,file}=writeConfig('.runtime/config.json',paths);
 expect(loadRuntime(file,root)).toEqual({...paths,projectRoot:root});
});
it('defaults_to_the_current_project_root',()=>{
 const {file}=writeConfig('.runtime/config.json',{pythonPath:'.venv/Scripts/python.exe',ocrSource:'../PaddleOCR',modelCache:'.runtime/models',device:'cpu'});
 expect(loadRuntime(file).pythonPath).toBe(path.resolve('.venv/Scripts/python.exe'));
});
it.each(['.runtime/config.json','dist/win-unpacked/resources/runtime.json'])('keeps_relocated_paths_with_chinese_and_spaces_independent_of_cwd_for_%s',relativeFile=>{
 const {root,file}=writeConfig(path.join('项目 迁移','超声 报告',relativeFile),{
  pythonPath:'.venv/Scripts/python.exe',ocrSource:'../OCR 源码',modelCache:'.runtime/models',device:'gpu:0',
  projectRoot:path.resolve('stale-project'),
 });
 const projectRoot=path.join(root,'项目 迁移','超声 报告');
 const config=loadRuntime(file,projectRoot);
 expect(config.projectRoot).toBe(projectRoot);
 expect(config.pythonPath).toBe(path.join(projectRoot,'.venv','Scripts','python.exe'));
 expect(config.ocrSource).toBe(path.resolve(projectRoot,'..','OCR 源码'));
 expect(config.modelCache).toBe(path.join(projectRoot,'.runtime','models'));
});
it('sets_worker_caches_and_import_paths_without_launcher_environment',()=>{
 const {root,file}=writeConfig(path.join('项目 迁移','.runtime/config.json'),{
  pythonPath:'.venv/Scripts/python.exe',ocrSource:'../OCR 源码',modelCache:'.runtime/models',device:'gpu:0',
 });
 const projectRoot=path.join(root,'项目 迁移');
 const config=loadRuntime(file,projectRoot);
 const workerRoot=path.join(projectRoot,'dist','win-unpacked','resources');
 const inherited={PATH:'system-path',USERPROFILE:'existing-user',HTTP_PROXY:'existing-proxy',
  TEMP:path.resolve('external/tmp'),Temp:path.resolve('other/tmp'),HF_HUB_CACHE:path.resolve('external/hf'),
  Paddle_Home:path.resolve('external/paddle'),PADDLE_CACHE:path.resolve('external/paddle-cache'),
  PADDLE_PDX_CACHE_HOME:path.resolve('external/models'),PYTHONPATH:'unrelated-source',PYTHONHOME:'old-python'};
 const original={...inherited};
 const env=buildWorkerEnv(config,workerRoot,inherited);
 const runtimeRoot=path.join(projectRoot,'.runtime');
 for(const key of ['TEMP','TMP','TMPDIR','UV_CACHE_DIR','UV_PYTHON_INSTALL_DIR','UV_TOOL_DIR','UV_TOOL_BIN_DIR',
  'PIP_CACHE_DIR','npm_config_cache','npm_config_devdir','ELECTRON_CACHE','ELECTRON_BUILDER_CACHE','XDG_CACHE_HOME',
  'HF_HOME','HF_HUB_CACHE','HUGGINGFACE_HUB_CACHE','HF_ASSETS_CACHE','HUGGINGFACE_ASSETS_CACHE','HF_XET_CACHE',
  'MODELSCOPE_CACHE','AISTUDIO_CACHE_HOME','AISTUDIO_CACHE','PADDLE_HOME','PADDLE_CACHE','PADDLE_PDX_CACHE_HOME','PYTHONPYCACHEPREFIX']){
  const relative=path.relative(runtimeRoot,env[key]!);
  expect(relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep)),key).toBe(true);
 }
 expect(env.PADDLE_PDX_CACHE_HOME).toBe(config.modelCache);
 expect(env.PYTHONPATH).toBe([workerRoot,config.ocrSource].join(path.delimiter));
 expect(env.PYTHONIOENCODING).toBe('utf-8');
 expect(env.PYTHONNOUSERSITE).toBe('1');
 expect(env.UV_PYTHON_INSTALL_BIN).toBe('0');
 expect(env.UV_PYTHON_INSTALL_REGISTRY).toBe('0');
 expect(env.PADDLE_PDX_MODEL_SOURCE).toBe('bos');
 expect(env.Temp).toBeUndefined();expect(env.Paddle_Home).toBeUndefined();expect(env.PYTHONHOME).toBeUndefined();
 expect(env.PATH).toBe(inherited.PATH);expect(env.USERPROFILE).toBe(inherited.USERPROFILE);expect(env.HTTP_PROXY).toBe(inherited.HTTP_PROXY);
 expect(inherited).toEqual(original);
});
it('keeps_the_configured_model_cache_consistent_with_the_worker_environment',()=>{
 const {root,file}=writeConfig('.runtime/config.json',{
  pythonPath:'.venv/Scripts/python.exe',ocrSource:'../PaddleOCR',modelCache:'.runtime/models/custom',device:'cpu',
 });
 const config=loadRuntime(file,root);
 const env=buildWorkerEnv(config,path.join(root,'python'),{PADDLE_PDX_CACHE_HOME:path.resolve('unrelated/models')});
 expect(env.PADDLE_PDX_CACHE_HOME).toBe(config.modelCache);
 expect(env.HF_HUB_CACHE).toBe(path.join(root,'.runtime','cache','huggingface','hub'));
});
