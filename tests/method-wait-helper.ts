import {expect,vi} from 'vitest'
import {setStopCheck} from '../electron/openrouter'
import {StoppedError} from '../electron/runner'
export async function waitThenStop(start:()=>Promise<unknown>,stopHook=()=>{}):Promise<void>{
 vi.useFakeTimers();let stop=false,settled=false;setStopCheck(()=>stop)
 try {const pending=start().finally(()=>{settled=true});const checked=expect(pending).rejects.toBeInstanceOf(StoppedError)
 await vi.advanceTimersByTimeAsync(6100);expect(settled).toBe(false);stop=true;stopHook();await vi.advanceTimersByTimeAsync(3500);await checked
 }finally{setStopCheck(()=>false);vi.useRealTimers()}
}
