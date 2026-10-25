import test from 'node:test';
import assert from 'node:assert/strict';
import {createTouchControls} from '../dist/controls.js';

test('wheel drag and captured pedals stay independent, center safely, and respect gear changes',()=>{
  class Element extends EventTarget {
    style={};attributes={};captures=new Set();classes=new Set();
    classList={add:n=>this.classes.add(n),remove:n=>this.classes.delete(n),toggle:(n,on)=>on?this.classes.add(n):this.classes.delete(n)};
    setAttribute(n,v){this.attributes[n]=v;}
    getBoundingClientRect(){return {left:0,top:0,width:200,height:200};}
    setPointerCapture(id){this.captures.add(id);}
    hasPointerCapture(id){return this.captures.has(id);}
    releasePointerCapture(id){this.captures.delete(id);}
  }
  const elements=Object.fromEntries(['steering-wheel','wheel-rotor','accelerator','reverse-pedal','brake','handbrake'].map(id=>[id,new Element()]));
  const fakeDocument=new EventTarget();fakeDocument.getElementById=id=>elements[id];fakeDocument.hidden=false;
  const fakeWindow=new EventTarget();
  const saved=Object.fromEntries(['document','window','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));
  const frames=new Map();let nextFrame=1;
  globalThis.document=fakeDocument;globalThis.window=fakeWindow;
  globalThis.requestAnimationFrame=callback=>{const id=nextFrame++;frames.set(id,callback);return id;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const fire=(id,type,pointerId,x=180,y=100)=>{
    const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId,clientX:x,clientY:y,button:0});elements[id].dispatchEvent(event);
  };
  let playing=true,reverseAllowed=false,driveAllowed=true,reverseCalls=0;
  const controls=createTouchControls({isDriving:()=>playing,onReverse:()=>{reverseCalls++;return reverseAllowed;},onDrive:()=>driveAllowed});
  try {
    fire('steering-wheel','pointerdown',1);
    fire('steering-wheel','pointermove',1,100,180);
    assert.ok(Math.abs(controls.held.steer-2/3)<.001,'quarter-circle drag gives proportional steering');
    assert.equal(elements['steering-wheel'].hasPointerCapture(1),true);
    fire('accelerator','pointerdown',2);
    fire('brake','pointerdown',3);
    assert.equal(controls.held.throttle,1);assert.equal(controls.held.brake,1);
    assert.ok(controls.held.steer>.6,'pedal touches do not cancel steering');
    fire('reverse-pedal','pointerdown',4);
    assert.equal(reverseCalls,1);assert.equal(elements['reverse-pedal'].hasPointerCapture(4),false,'unsafe reverse request is rejected');
    fire('accelerator','pointerup',2);
    assert.equal(controls.held.throttle,0);assert.equal(controls.held.brake,1,'other pedal stays held');
    fire('steering-wheel','pointerup',1);
    const before=controls.held.steer;
    for(const [id,callback] of [...frames]){frames.delete(id);callback(performance.now()+50);}
    assert.ok(controls.held.steer<before&&controls.held.steer>0,'released wheel springs toward center');
    fire('brake','pointercancel',3);
    assert.equal(controls.held.brake,0,'cancelled touch releases its pedal');
    controls.clear();
    reverseAllowed=true;driveAllowed=false;
    fire('reverse-pedal','pointerdown',5);
    assert.equal(controls.held.throttle,1,'accepted reverse pedal powers the selected reverse gear');
    fire('accelerator','pointerdown',6);
    assert.equal(elements.accelerator.hasPointerCapture(6),false,'drive request may be rejected until stopped');
    fire('handbrake','pointerdown',7);assert.equal(controls.held.handbrake,1);
    fakeWindow.dispatchEvent(new Event('blur'));
    assert.deepEqual(controls.held,{throttle:0,brake:0,steer:0,handbrake:0},'focus loss releases every input');
    assert.equal(frames.size,0);
    fire('steering-wheel','pointerdown',8,20,102);
    fire('steering-wheel','pointermove',8,20,98);
    assert.ok(controls.held.steer>0&&controls.held.steer<.05,'dragging through atan2 wrap remains a small turn');
    controls.clear();playing=false;
    fire('accelerator','pointerdown',9);fire('steering-wheel','pointerdown',10);
    assert.deepEqual(controls.held,{throttle:0,brake:0,steer:0,handbrake:0},'paused controls ignore touches');
  } finally {
    controls.destroy();
    for(const [key,value] of Object.entries(saved)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
  }
});
