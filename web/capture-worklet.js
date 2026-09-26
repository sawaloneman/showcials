// Continuous linear resampling to 16 kHz; 320 samples per 20 ms PCM frame.
class OrbitCapture extends AudioWorkletProcessor {
 constructor(){super();this.tail=new Float32Array(0);this.position=0;this.frame=new Int16Array(320);this.used=0;this.step=sampleRate/16000}
 process(inputs,outputs){for(const output of outputs)for(const channel of output)channel.fill(0);const x=inputs[0]?.[0];if(!x?.length)return true;const b=new Float32Array(this.tail.length+x.length);b.set(this.tail);b.set(x,this.tail.length);while(this.position+1<b.length){const n=Math.floor(this.position),f=this.position-n;const v=Math.max(-1,Math.min(1,b[n]*(1-f)+b[n+1]*f));this.frame[this.used++]=Math.round(v*(v<0?32768:32767));if(this.used===320){this.port.postMessage(this.frame.buffer,[this.frame.buffer]);this.frame=new Int16Array(320);this.used=0}this.position+=this.step}const consumed=Math.min(Math.floor(this.position),b.length-1);this.tail=b.slice(consumed);this.position-=consumed;return true}
}
registerProcessor('orbit-capture',OrbitCapture);
