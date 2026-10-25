/** Finger steering and independent, captured pedal touches. No keyboard bindings. */
export function createTouchControls({isDriving=()=>true,onReverse=()=>true,onDrive=()=>true}={}) {
  const held = {throttle:0,brake:0,steer:0,handbrake:0};
  const wheel = document.getElementById('steering-wheel');
  const rotor = document.getElementById('wheel-rotor');
  const pointers = new Map();
  const removers = [];
  const maxAngle = 135;
  let wheelPointer = null;
  let wheelAngle = 0;
  let previousAngle = 0;
  let frame = 0;
  let lastTime = 0;
  let destroyed = false;

  const listen = (target,type,fn,options) => {
    target.addEventListener(type,fn,options);
    removers.push(()=>target.removeEventListener(type,fn,options));
  };
  const clamp = (n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const driving = ()=>!destroyed&&isDriving();
  function setWheel(angle) {
    wheelAngle=clamp(angle,-maxAngle,maxAngle);
    held.steer=wheelAngle/maxAngle;
    rotor.style.transform=`rotate(${wheelAngle.toFixed(2)}deg)`;
    wheel.setAttribute('aria-valuenow',String(Math.round(held.steer*100)));
    wheel.setAttribute('aria-valuetext',Math.abs(held.steer)<.02?'Centered':`${Math.round(Math.abs(held.steer)*100)} percent ${held.steer<0?'left':'right'}`);
  }
  function refreshPedals() {
    held.throttle=0;held.brake=0;held.handbrake=0;
    for(const {action} of pointers.values()) {
      if(action==='accelerator'||action==='reverse')held.throttle=1;
      if(action==='brake')held.brake=1;
      if(action==='handbrake')held.handbrake=1;
    }
    for(const [id,action] of [['accelerator','accelerator'],['reverse-pedal','reverse'],['brake','brake'],['handbrake','handbrake']]) {
      const pressed=[...pointers.values()].some(p=>p.action===action);
      const element=document.getElementById(id);
      element.classList.toggle('pressed',pressed);
      element.setAttribute('aria-pressed',String(pressed));
    }
  }
  function animate(time) {
    frame=0;
    if(!driving()){clear();return;}
    const dt=Math.min(.05,Math.max(0,(time-lastTime)/1000));lastTime=time;
    if(wheelPointer===null&&Math.abs(wheelAngle)>.05) {
      // The rim springs smoothly to center when the steering finger lifts.
      setWheel(wheelAngle*Math.exp(-dt*8));
      if(Math.abs(wheelAngle)<.1)setWheel(0);
    }
    if(pointers.size||Math.abs(wheelAngle)>.05)frame=requestAnimationFrame(animate);
  }
  function ensureFrame() {
    if(!frame){lastTime=performance.now();frame=requestAnimationFrame(animate);}
  }
  function capture(element,event,action) {
    pointers.set(event.pointerId,{element,action});
    try{element.setPointerCapture(event.pointerId);}catch{/* Pointer can end before capture. */}
    ensureFrame();
  }
  function endPointer(event) {
    const pointer=pointers.get(event.pointerId);
    if(!pointer)return;
    pointers.delete(event.pointerId);
    if(wheelPointer===event.pointerId) {
      wheelPointer=null;
      wheel.classList.remove('dragging');
      ensureFrame();
    }
    refreshPedals();
    try{if(pointer.element.hasPointerCapture(event.pointerId))pointer.element.releasePointerCapture(event.pointerId);}catch{}
  }
  function fingerAngle(event) {
    const bounds=wheel.getBoundingClientRect();
    const x=event.clientX-bounds.left-bounds.width/2;
    const y=event.clientY-bounds.top-bounds.height/2;
    if(Math.hypot(x,y)<bounds.width*.08)return null;
    return Math.atan2(y,x)*180/Math.PI;
  }
  listen(wheel,'pointerdown',event=>{
    if(!driving()||wheelPointer!==null||event.button>0)return;
    event.preventDefault();
    wheelPointer=event.pointerId;
    previousAngle=fingerAngle(event);
    capture(wheel,event,'steer');
    wheel.classList.add('dragging');
  });
  listen(wheel,'pointermove',event=>{
    if(event.pointerId!==wheelPointer)return;
    event.preventDefault();
    if(!driving()){clear();return;}
    const angle=fingerAngle(event);
    if(angle===null){previousAngle=null;return;}
    if(previousAngle!==null) {
      let delta=angle-previousAngle;
      if(delta>180)delta-=360;
      if(delta< -180)delta+=360;
      setWheel(wheelAngle+delta);
    }
    previousAngle=angle;
  });
  for(const [id,action] of [['accelerator','accelerator'],['reverse-pedal','reverse'],['brake','brake'],['handbrake','handbrake']]) {
    const element=document.getElementById(id);
    listen(element,'pointerdown',event=>{
      if(!driving()||event.button>0)return;
      event.preventDefault();
      if(action==='reverse'&&onReverse()===false)return;
      if(action==='accelerator'&&onDrive()===false)return;
      capture(element,event,action);
      refreshPedals();
    });
    listen(element,'contextmenu',event=>event.preventDefault());
  }
  for(const element of [wheel,...['accelerator','reverse-pedal','brake','handbrake'].map(id=>document.getElementById(id))]) {
    listen(element,'pointerup',endPointer);
    listen(element,'pointercancel',endPointer);
    listen(element,'lostpointercapture',endPointer);
    listen(element,'dragstart',event=>event.preventDefault());
  }
  listen(wheel,'contextmenu',event=>event.preventDefault());
  listen(window,'blur',clear);
  listen(window,'pagehide',clear);
  listen(document,'visibilitychange',()=>{if(document.hidden)clear();});

  function clear() {
    if(frame)cancelAnimationFrame(frame);
    frame=0;wheelPointer=null;previousAngle=null;
    const pending=[...pointers];pointers.clear();
    wheel.classList.remove('dragging');setWheel(0);refreshPedals();
    for(const [id,{element}] of pending) {
      try{if(element.hasPointerCapture(id))element.releasePointerCapture(id);}catch{}
    }
  }
  function destroy() {
    clear();destroyed=true;removers.splice(0).forEach(remove=>remove());
  }
  setWheel(0);refreshPedals();
  return {held,clear,destroy};
}
