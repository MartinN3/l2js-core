import BufferValue from '@fix/buffer-value';
import { FPrimitiveArray as Baseline } from '@base/unreal/un-array';
import { FPrimitiveArray as Candidate, FPrimitiveArrayLazy } from '@fix/unreal/un-array';

const assert = (x: any, text: string) => { if (!x) throw new Error(text); };
const types = [BufferValue.uint8, BufferValue.int8, BufferValue.uint16, BufferValue.int16, BufferValue.uint32, BufferValue.int32, BufferValue.float, BufferValue.uint64, BufferValue.int64];
function make(Cls: any, type: any, offset: number) {
  const bytes = type.dtype.BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(offset + bytes * 2 + 5);
  const a = new Cls(type); a.array = new DataView(buffer, offset, bytes * 2);
  return { a, buffer, bytes };
}
let cases = 0;
for (const Cls of [Baseline, Candidate, FPrimitiveArrayLazy]) for (const type of types) {
  for (const offset of [0, 1]) {
    const {a,buffer,bytes} = make(Cls,type,offset), v = a.getTypedArray();
    assert(v.length === 2 && v.byteLength === bytes*2, `${type.name} view length`);
    assert((offset % bytes === 0) === (v.buffer === buffer), `${type.name} sharing`);
    if (bytes > 1 && offset === 1) assert(v.byteOffset === 0, `${type.name} offset`);
    cases++;
  }
  const e = new Cls(type); e.array = null; assert(e.getTypedArray().length === 0, 'empty'); cases++;
}
const sentinel = new Error('constructor sentinel');
const bad:any = { ...BufferValue.uint32, dtype: class { static BYTES_PER_ELEMENT=4; constructor(){ throw sentinel; } } };
try { make(Candidate,bad,0).a.getTypedArray(); throw new Error('missing throw'); } catch(e) { assert(e===sentinel,'error must propagate'); }
function median(xs:number[]) { return xs.slice().sort((a,b)=>a-b)[Math.floor(xs.length/2)]; }
class MinimalVariant extends (Baseline as any) {
 getTypedArray():any {
  const array=this.getArray();
  try {return new this.Constructor.dtype(array.buffer,array.byteOffset,this.getElemCount());}
  catch(error) {
   if(error instanceof RangeError && array.byteOffset % this.Constructor.dtype.BYTES_PER_ELEMENT !== 0)
    return new this.Constructor.dtype(this.getArrayBufferSlice());
   throw error;
  }
 }
}
function bench(offset:number, count:number, rounds:number) {
 const variants = [{name:'baseline',a:make(Baseline,BufferValue.uint32,offset).a},{name:'baseline2',a:make(Baseline,BufferValue.uint32,offset).a},{name:'candidate',a:make(Candidate,BufferValue.uint32,offset).a},{name:'minimal',a:make(MinimalVariant,BufferValue.uint32,offset).a}];
 const samples:any={baseline:[],baseline2:[],candidate:[],minimal:[]}, errors:any={}, sinks:any={baseline:0,baseline2:0,candidate:0,minimal:0};
 function run(v:any) {let sink=sinks[v.name];const start=performance.now();for(let i=0;i<count;i++){const r=v.a.getTypedArray();sink=(sink+r.byteOffset+r.length)|0;}sinks[v.name]=sink;return performance.now()-start;}
 for(let i=0;i<3;i++) for(const v of variants) try{run(v)}catch(e){errors[v.name]=String(e);}
 for(let i=0;i<rounds;i++) for(const v of (i%2 ? [...variants].reverse() : variants)) if(!errors[v.name]) try{samples[v.name].push(run(v))}catch(e){errors[v.name]=String(e)}
 const out:any={};for(const v of variants) out[v.name]=errors[v.name]?{error:errors[v.name]}:{nsPerCall:median(samples[v.name])*1e6/count,samplesMs:samples[v.name],sink:sinks[v.name]};return out;
}
(globalThis as any).crossPlatformResult = {cases, aligned:bench(4,3000000,11),unaligned:bench(1,30000,9),userAgent:navigator.userAgent};
