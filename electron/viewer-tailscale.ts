import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
export const VIEWER_HTTPS_PORT=8443
export function tailscaleCommand():string {
 const installed=path.join(process.env.ProgramFiles??'C:\\Program Files','Tailscale','tailscale.exe')
 return process.platform==='win32'&&fs.existsSync(installed)?installed:'tailscale'
}
function call(args:string[]):Promise<string>{return new Promise((resolve,reject)=>execFile(tailscaleCommand(),args,{timeout:20000,windowsHide:true,maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(Error(`Tailscale: ${stderr||stdout||error.message}`)):resolve(stdout)))}
export function tailnetName(raw:string):string {
 const status=JSON.parse(raw) as {BackendState?:string;Self?:{DNSName?:string}}
 const name=status.Self?.DNSName?.replace(/\.$/,'')??''
 if(status.BackendState!=='Running'||!/^[a-z0-9.-]+\.ts\.net$/i.test(name))throw Error('Tailscale bağlı değil veya MagicDNS adı bulunamadı. PC ve tablette Tailscale bağlantısını aç.')
 return name
}
export async function configureViewerTailscale(port:number):Promise<string>{
 const name=tailnetName(await call(['status','--json'])),target=`http://127.0.0.1:${port}`
 const status=(JSON.parse(await call(['serve','status','--json']))??{}) as {Web?:Record<string,{Handlers?:Record<string,{Proxy?:string}>}>}
 const existing=status.Web?.[`${name}:${VIEWER_HTTPS_PORT}`]
 if(existing&&!(Object.keys(existing.Handlers??{}).length===1&&existing.Handlers?.['/']?.Proxy===target))throw Error('Tailscale 8443 adresinde başka bir yayın var; üzerine yazılmadı.')
 await call(['serve','--bg',`--https=${VIEWER_HTTPS_PORT}`,'--yes',target])
 return `https://${name}:${VIEWER_HTTPS_PORT}`
}
