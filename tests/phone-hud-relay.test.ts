import fs from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
import { expect,it,vi } from 'vitest'
const source=ts.createSourceFile('main.ts',fs.readFileSync(new URL('../electron/main.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true)
const declarations:string[]=[]
function visit(n:ts.Node){if(ts.isFunctionDeclaration(n)&&n.name&&['pushHud','hideHudSoon'].includes(n.name.text))declarations.push(n.getText(source));ts.forEachChild(n,visit)}visit(source)
const code=ts.transpileModule(declarations.join('\n')+'\n({pushHud,hideHudSoon})',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
it('relays the exact desktop card text/level and clears phone detail lines when desktop hides',()=>{
 const events=vi.fn(),deliverHud=vi.fn(),send=vi.fn(),hide=vi.fn();let scheduled!:()=>void
 const api=vm.runInNewContext(code,{running:true,hudWindow:{isDestroyed:()=>false,hide,webContents:{send}},hudHideTimer:null,viewerState:{event:events},deliverHud,clearTimeout:vi.fn(),setTimeout:(f:()=>void)=>{scheduled=f;return 1}}) as {pushHud(l:string,t:string):void;hideHudSoon():void}
 api.pushHud('warn','A '.repeat(200));const [channel,payload]=events.mock.calls[0];expect(channel).toBe('hud:status');expect(payload.text.length).toBeLessThanOrEqual(220);expect(payload.text.endsWith('…')).toBe(true);expect(deliverHud).toHaveBeenCalledExactlyOnceWith('hud:status',payload,true)
 api.hideHudSoon();scheduled();expect(events.mock.calls.slice(1)).toEqual([['hud:loop',{text:''}],['hud:method',{text:''}],['hud:countdown',{text:''}]]);expect(hide).toHaveBeenCalledTimes(1)
})
