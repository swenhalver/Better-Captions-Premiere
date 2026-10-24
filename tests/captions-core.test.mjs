import assert from 'node:assert/strict';
import test from 'node:test';
import {CaptionRenderer, wordState} from '../webview-ui/src/lib/canvas/engine.ts';
import {parseTranscript, groupCaptionWords, getCaptionAtTime, formatTime} from '../webview-ui/src/lib/transcript/parser.ts';
import {replaceText, retime, split, validateCaptions} from '../webview-ui/src/lib/transcript/edit.ts';
import {DEFAULT_STYLE, DEFAULT_ANIMATION} from '../webview-ui/src/lib/types.ts';

const word = (text, startTime, endTime) => ({text, startTime, endTime, isActive:false});
const caption = words => ({id:'caption', text:words.map(w=>w.text).join(' '), startTime:words[0].startTime, endTime:words.at(-1).endTime+.15, words});
const style = () => structuredClone(DEFAULT_STYLE);
const animation = {...DEFAULT_ANIMATION, preset:'karaoke', fadeInDuration:0, fadeOutDuration:0};

// Tracks the actual paint positions and saved canvas state. A wider test font
// deliberately exposes layouts that were measured only with the base font.
class CanvasRecorder {
  font='700 64px "Arial"'; globalAlpha=1; fillStyle='#000000'; strokeStyle='#000000';
  shadowBlur=0; shadowColor='transparent'; shadowOffsetX=0; shadowOffsetY=0;
  lineWidth=1; lineJoin='round'; textAlign='left'; textBaseline='middle';
  transform=[1,0,0,1,0,0]; stack=[]; paints=[]; points=[];
  clearRect(){ this.paints=[]; }
  save(){ this.stack.push(Object.fromEntries(['font','globalAlpha','fillStyle','strokeStyle','shadowBlur','shadowColor','shadowOffsetX','shadowOffsetY','lineWidth','lineJoin','textAlign','textBaseline','transform'].map(k=>[k,structuredClone(this[k])]))); }
  restore(){ Object.assign(this,this.stack.pop()); }
  translate(x,y){const [a,b,c,d,e,f]=this.transform;this.transform=[a,b,c,d,e+a*x+c*y,f+b*x+d*y];}
  scale(x,y){const [a,b,c,d,e,f]=this.transform;this.transform=[a*x,b*x,c*y,d*y,e,f];}
  point(x,y){const [a,b,c,d,e,f]=this.transform;return [a*x+c*y+e,b*x+d*y+f];}
  measureText(text){const size=Number(this.font.match(/([\d.]+)px/)[1]);const factor=this.font.includes('Wide')?1.7:1;return {width:[...text].length*size*.55*factor};}
  beginPath(){this.points=[];}
  moveTo(x,y){this.points.push(this.point(x,y));}
  lineTo(x,y){this.points.push(this.point(x,y));}
  quadraticCurveTo(cx,cy,x,y){this.points.push(this.point(cx,cy),this.point(x,y));}
  closePath(){}
  fill(){this.paints.push({kind:'bubble',fill:this.fillStyle,alpha:this.globalAlpha,bounds:this.bounds(this.points)});}
  bounds(points){return {left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};}
  drawText(kind,text,x,y){const width=this.measureText(text).width,size=Number(this.font.match(/([\d.]+)px/)[1]);this.paints.push({kind,text,font:this.font,fill:this.fillStyle,stroke:this.strokeStyle,alpha:this.globalAlpha,shadow:this.shadowColor,lineWidth:this.lineWidth,bounds:this.bounds([this.point(x,y-size*.6),this.point(x+width,y+size*.6)])});}
  fillText(text,x,y){this.drawText('text',text,x,y);}
  strokeText(text,x,y){this.drawText('stroke',text,x,y);}
}
function render(c,time,s=style(),width=1080,height=1920,a=animation){const ctx=new CanvasRecorder();new CaptionRenderer(ctx,width,height).renderFrame(c,time,s,a);assert.equal(ctx.stack.length,0,'canvas state is balanced');return ctx.paints;}
const texts = paints => paints.filter(p=>p.kind==='text');
const center = p => (p.bounds.left+p.bounds.right)/2;
test('all three word appearances render their own typography, case, stroke and shadow',()=>{
 const s=style();s.strokeEnabled=false;s.shadowEnabled=false;
 s.spokenWord={...s.spokenWord,fontSize:52,textTransform:'uppercase',strokeEnabled:true,strokeColor:'#ff0000',strokeOpacity:.5,strokeWidth:4,shadowEnabled:false};
 s.activeWord={...s.activeWord,fontSize:80,italic:true,strokeEnabled:false,shadowEnabled:true,shadowColor:'#00ff00',shadowOpacity:.6};
 s.upcomingWord={fontFamily:'Next',fontSize:40,color:'#0000ff',opacity:.7,strokeEnabled:true,strokeColor:'#0000ff',strokeWidth:2,shadowEnabled:false};
 const paints=render(caption([word('past',0,.3),word('now',.5,.9),word('next',1.1,1.5)]),.7,s);
 const [past,now,next]=texts(paints);assert.equal(past.text,'PAST');assert.match(past.font,/52px/);assert.match(now.font,/italic.*80px/);assert.match(next.font,/40px "Next"/);assert.equal(next.fill,'#0000ff');
 assert.equal(now.shadow,'rgba(0,255,0,0.6)');assert.equal(next.shadow,'transparent');
 assert.deepEqual(paints.filter(p=>p.kind==='stroke').map(p=>[p.text,p.stroke,p.lineWidth]),[['PAST','rgba(255,0,0,0.5)',8],['next','rgba(0,0,255,1)',4]]);
});

test('active word has exact half-open boundaries and remains spoken through a pause',()=>{
  const w=word('hello',1,1.4);
  assert.equal(wordState(w,.99),'upcoming');
  assert.equal(wordState(w,1),'active');
  assert.equal(wordState(w,1.3999),'active');
  assert.equal(wordState(w,1.4),'spoken');
  assert.equal(wordState(w,1.7),'spoken');
});

test('active, spoken and upcoming words paint with independent appearances',()=>{
  const s=style();Object.assign(s,{strokeEnabled:false,fontFamily:'Base',fontWeight:400,textColor:'#aaaaaa'});
  Object.assign(s.activeWord,{fontFamily:'Wide Active',fontWeight:900,sizeScale:1.5,color:'#ff0000',opacity:.8,bubble:true,bubbleColor:'#00ff00',bubbleOpacity:.5});
  Object.assign(s.spokenWord,{fontFamily:'Past',fontWeight:300,sizeScale:.8,color:'#0000ff',opacity:.4,bubble:true,bubbleColor:'#ffffff',bubbleOpacity:.25});
  const paints=render(caption([word('past',0,.3),word('now',.5,.9),word('next',1.1,1.5)]),.7,s);
  const [past,now,next]=texts(paints);
  assert.match(past.font,/300 51\.2px "Past"/);assert.equal(past.fill,'#0000ff');assert.equal(past.alpha,.4);
  assert.match(now.font,/900 96px "Wide Active"/);assert.equal(now.fill,'#ff0000');assert.equal(now.alpha,.8);
  assert.match(next.font,/400 64px "Base"/);assert.equal(next.fill,'#aaaaaa');assert.equal(next.alpha,1);
  assert.deepEqual(paints.filter(p=>p.kind==='bubble').map(p=>[p.fill,p.alpha]),[['rgba(255,255,255,0.25)',.4],['rgba(0,255,0,0.5)',.8]]);
});

test('the word at the end of speech changes to past styling before the next word begins',()=>{
  const s=style(),c=caption([word('first',0,.3),word('second',.7,1)]);
  assert.deepEqual(texts(render(c,.5,s)).map(p=>p.fill),[s.spokenWord.color,s.textColor]);
});

test('enlarged active and past fonts keep every reserved word center and line stable',()=>{
  const s=style();s.activeWord.fontFamily='Wide';s.activeWord.sizeScale=1.8;s.spokenWord.sizeScale=1.3;
  const c=caption([word('one',0,.4),word('two',.5,.9),word('three',1,1.4)]);
  const frames=[.2,.45,.7,1.2].map(t=>texts(render(c,t,s,640,360)));
  for(let i=1;i<frames.length;i++)for(let j=0;j<frames[0].length;j++){
    assert.ok(Math.abs(center(frames[i][j])-center(frames[0][j]))<1e-8);
    assert.ok(Math.abs(frames[i][j].bounds.top+frames[i][j].bounds.bottom-frames[0][j].bounds.top-frames[0][j].bounds.bottom)<1e-8);
  }
});

test('viewport size and edge placement never split or reduce an authored caption line',()=>{
  for(const [width,height] of [[1920,1080],[1080,1920],[640,360]])for(const textAlign of ['left','center','right']){
    const s=style();Object.assign(s,{fontSize:100,positionX:1,positionY:1,maxWidth:.7,textAlign,backgroundEnabled:true,backgroundPadding:35});
    for(const key of ['activeWord','spokenWord','upcomingWord'])s[key]={...s[key],fontSize:100,sizeScale:1,fontFamily:'Fixture',bubble:false};
    const c=caption(['An','exceptionallylongcaptionword','that','overflows'].map((text,i)=>word(text,i*.5,i*.5+.4)));
    const painted=texts(render(c,.7,s,width,height));
    assert.deepEqual(painted.map(p=>p.text),c.words.map(w=>w.text));
    assert.equal(new Set(painted.map(p=>(p.bounds.top+p.bounds.bottom)/2)).size,1,'every grouped word stays on one baseline');
    for(const p of painted)assert.ok(Math.abs(p.bounds.right-p.bounds.left-[...p.text].length*100*.55)<1e-6,'viewport width cannot shrink authored font size');
    assert.ok(painted.some(p=>p.bounds.left<0||p.bounds.right>width),'oversized text is allowed to overflow the frame');
  }
});

test('a caption background surrounds text under left and right alignment',()=>{
  for(const textAlign of ['left','right']){
    const s=style();Object.assign(s,{backgroundEnabled:true,textAlign,strokeEnabled:false});
    const paints=render(caption([word('Short',0,1)]),.5,s);
    const bg=paints.find(p=>p.kind==='bubble'),text=texts(paints)[0];
    assert.ok(bg.bounds.left<=text.bounds.left&&bg.bounds.right>=text.bounds.right);
    assert.ok(bg.bounds.top<=text.bounds.top&&bg.bounds.bottom>=text.bounds.bottom);
  }
});

test('canvas is empty outside a caption and fading multiplies word opacity',()=>{
  const c=caption([word('hi',1,2)]),s=style();s.activeWord.opacity=.4;
  assert.deepEqual(render(c,.5,s),[]);assert.deepEqual(render(c,c.endTime,s),[]);
  const p=texts(render(c,1.1,s,1080,1920,{...animation,fadeInDuration:.2}))[0];
  assert.ok(Math.abs(p.alpha-.2)<1e-8);
});

test('pop scales the active bubble and its text together without moving the caption layout',()=>{
  const s=style(),c=caption([word('past',0,.3),word('now',.5,1.1),word('next',1.3,1.7)]),a={...animation,preset:'pop'};
  const start=render(c,.5,s,1080,1920,a),settled=render(c,.7,s,1080,1920,a);
  const startText=texts(start).find(p=>p.text==='now'),settledText=texts(settled).find(p=>p.text==='now');
  const startBubble=start.find(p=>p.kind==='bubble'),settledBubble=settled.find(p=>p.kind==='bubble');
  const width=p=>p.bounds.right-p.bounds.left,cy=p=>(p.bounds.top+p.bounds.bottom)/2;
  assert.ok(Math.abs(width(startText)/width(settledText)-.85)<1e-8);
  assert.ok(Math.abs(width(startBubble)/width(settledBubble)-.85)<1e-8);
  assert.ok(Math.abs(center(startBubble)-center(startText))<1e-8);assert.ok(Math.abs(cy(startBubble)-cy(startText))<1e-8);
  assert.ok(Math.abs(center(startText)-center(settledText))<1e-8);
  assert.deepEqual(texts(start).find(p=>p.text==='past').bounds,texts(settled).find(p=>p.text==='past').bounds);
  assert.equal(texts(start).some(p=>p.text==='next'),false);
});

test('bounce moves bubble and active text through a landing and rebound while neighboring words stay fixed',()=>{
  const s=style(),c=caption([word('past',0,.3),word('now',.5,1.1),word('next',1.3,1.7)]),a={...animation,preset:'bounce'};
  const frames=[.5,.5+.28/2.75,.64,.8].map(t=>render(c,t,s,1080,1920,a));
  const active=frames.map(frame=>texts(frame).find(p=>p.text==='now')),bubbles=frames.map(frame=>frame.find(p=>p.kind==='bubble'));
  const cy=p=>(p.bounds.top+p.bounds.bottom)/2;
  assert.ok(cy(active[0])<cy(active[3])-1,'the word starts above its baseline');
  assert.ok(Math.abs(cy(active[1])-cy(active[3]))<1e-8,'the word lands at its baseline');
  assert.ok(cy(active[2])<cy(active[1])-1,'the word rebounds after landing');
  for(let i=0;i<frames.length;i++){
    assert.ok(Math.abs(cy(active[i])-cy(bubbles[i]))<1e-8,'the bubble follows the complete bounce');
    assert.deepEqual(texts(frames[i]).find(p=>p.text==='past').bounds,texts(frames[0]).find(p=>p.text==='past').bounds);
    assert.ok(Math.abs(center(active[i])-center(active[0]))<1e-8,'horizontal layout remains reserved');
  }
});

test('bounce motion preserves authored dimensions even when a caption exceeds a frame edge',()=>{
  const c=caption(['A','large','bouncing','caption'].map((text,i)=>word(text,i*.5,i*.5+.3)));
  for(const positionY of [0,1])for(const time of [0,.08,.2,.5,.58,.7,1,1.08,1.2]){
    const s=style();Object.assign(s,{fontSize:120,positionY,maxWidth:.65});s.activeWord.padding=22;s.activeWord.sizeScale=1.8;
    for(const p of texts(render(c,time,s,640,360,{...animation,preset:'bounce'}))){
      const size=Number(p.font.match(/([\d.]+)px/)[1]);
      assert.ok(Math.abs(p.bounds.right-p.bounds.left-[...p.text].length*size*.55)<1e-6,'neither a narrow frame nor bounce may shrink the glyphs');
    }
  }
});

const transcript = segments => ({language:'en',speakers:[],segments:segments.map(words=>({start:0,duration:10,language:'en',speaker:'',words}))});
const sourceWord=(text,start,duration=.25,type='word')=>({text,start,duration,type,confidence:1,eos:false,tags:[]});

test('transcripts split at sentence punctuation, pauses and limits without caption overlaps',()=>{
  const parsed=parseTranscript(transcript([[
    sourceWord('Dr.',0),sourceWord('Smith',.3),sourceWord('speaks',.6),sourceWord('.',0,0,'punctuation'),
    sourceWord('Then',1),sourceWord('waits',1.3),sourceWord('Again',2.5),sourceWord('now!',2.8),
  ]]));
  assert.deepEqual(parsed.map(c=>c.text),['Dr. Smith speaks.','Then waits','Again now!']);
  validateCaptions(parsed);
  const limited=parseTranscript(transcript([Array.from({length:7},(_,i)=>sourceWord(`w${i}`,i*.3))]),5);
  assert.deepEqual(limited.map(c=>c.words.length),[2,2,2,1]);validateCaptions(limited);
  for(let i=0;i<limited.length-1;i++)assert.equal(getCaptionAtTime(limited,limited[i+1].startTime),limited[i+1]);
});

test('malformed timing and overlapping transcription words cannot produce invalid caption timing',()=>{
  const parsed=parseTranscript(transcript([[
    sourceWord('negative',-1),sourceWord('zero',0,0),sourceWord('valid',0,.6),sourceWord('next',.4,.4),
    sourceWord('infinite',2,Infinity),sourceWord('overflow',Number.MAX_VALUE,Number.MAX_VALUE),
  ]]));
  assert.deepEqual(parsed.flatMap(c=>c.words.map(w=>w.text)),['valid','next']);
  validateCaptions(parsed);
  assert.equal(parsed[0].words[0].endTime,.4);
});

test('punctuation stays with its segment and opening quotes are retained',()=>{
  const parsed=parseTranscript(transcript([
    [sourceWord('first.',2)],
    [sourceWord('“',0,0,'punctuation'),sourceWord('quoted',0),sourceWord('”',0,0,'punctuation'),sourceWord('!',0,0,'punctuation')],
  ]));
  assert.deepEqual(parsed.map(c=>c.text),['“quoted”!','first.']);validateCaptions(parsed);
});

test('transcript sentence flags and readable character/duration limits split caption blocks',()=>{
  const first=sourceWord('without punctuation',0);first.eos=true;
  assert.deepEqual(parseTranscript(transcript([[first,sourceWord('new sentence',.3)]])).map(c=>c.text),['without punctuation','new sentence']);
  const chars=groupCaptionWords([word('long',0,.3),word('enough',.4,.7),word('sentence',.8,1.1)],12);
  assert.deepEqual(chars.map(c=>c.text),['long enough','sentence']);validateCaptions(chars);
  const duration=groupCaptionWords([word('slow',0,3),word('speech',3.1,6.2)]);
  assert.deepEqual(duration.map(c=>c.text),['slow','speech']);validateCaptions(duration);
});

test('separate parses create unique IDs even if the clock does not advance',()=>{
  const source=transcript([[sourceWord('hello.',0)]]),originalNow=Date.now;
  try{Date.now=()=>1000;assert.notEqual(parseTranscript(source)[0].id,parseTranscript(source)[0].id);}
  finally{Date.now=originalNow;}
});

test('time labels round through the minute boundary without displaying 60 seconds',()=>{
  assert.equal(formatTime(59.999),'01:00.00');assert.equal(formatTime(60.01),'01:00.01');assert.equal(formatTime(-1),'00:00.00');
});

test('corrections preserve timing, location and an existing estimated-timing warning',()=>{
  const c={...caption([word('the',0,.2),word('cat',.4,.8)]),position:{x:.3,y:.6},timingEstimated:true};
  const edited=replaceText(c,'the dog');
  assert.equal(edited.text,'the dog');assert.deepEqual(edited.words.map(w=>[w.startTime,w.endTime]),[[0,.2],[.4,.8]]);
  assert.deepEqual(edited.position,c.position);assert.equal(edited.timingEstimated,true);assert.equal(c.text,'the cat');
});

test('inserted words receive valid estimated timing and can be manually corrected',()=>{
  const c=caption([word('hello',0,.4),word('world',.7,1)]),edited=replaceText(c,'hello kind world');
  assert.equal(edited.timingEstimated,true);validateCaptions([edited]);
  assert.deepEqual(edited.words.map(w=>[w.startTime,w.endTime]),[[0,.4],[.4,.7],[.7,1]]);
  const corrected={...edited,timingEstimated:false,words:edited.words.map((w,i)=>i===1?{...w,startTime:.45,endTime:.65}:w)};
  validateCaptions([corrected]);assert.equal(corrected.words[1].startTime,.45);
});

test('deleting a word preserves surviving timings and insertion into continuous speech is explicitly estimated',()=>{
  const c=caption([word('one',0,.3),word('bad',.4,.6),word('three',.7,1)]),deleted=replaceText(c,'one three');
  assert.deepEqual(deleted.words.map(w=>[w.startTime,w.endTime]),[[0,.3],[.7,1]]);validateCaptions([deleted]);
  const inserted=replaceText(caption([word('one',0,.5),word('three',.5,1)]),'one two three');
  assert.equal(inserted.timingEstimated,true);assert.equal(inserted.words.length,3);validateCaptions([inserted]);
  assert.equal(inserted.words[0].startTime,0);assert.equal(inserted.words.at(-1).endTime,1);
});

test('retiming scales word gaps; invalid bounds are rejected before producing a broken caption',()=>{
  const c=caption([word('hello',1,1.5),word('world',2,2.5)]),edited=retime(c,4,4+(c.endTime-c.startTime)*2);
  assert.deepEqual(edited.words.map(w=>[w.startTime,w.endTime]),[[4,5],[6,7]]);validateCaptions([edited]);
  for(const [start,end] of [[-1,2],[1,1],[2,1],[NaN,2],[0,Infinity]])assert.throws(()=>retime(c,start,end));
});

test('splitting produces independent nonoverlapping captions with copied words',()=>{
  const c={...caption([word('one',0,.3),word('two',.5,.8),word('three',1,1.3)]),mediaPath:'/old.mov',clipNodeId:'clip',projectItemId:'item'},parts=split(c,1);
  validateCaptions(parts);assert.deepEqual(parts.map(p=>p.text),['one','two three']);
  assert.equal(parts[0].endTime,.3);assert.equal(parts[1].startTime,.5);
  assert.equal(parts[0].mediaPath,undefined);assert.equal(parts[1].clipNodeId,undefined);
  parts[0].words[0].text='changed';assert.equal(c.words[0].text,'one');
});

test('validation rejects overlapping manual caption and word timing edits',()=>{
  const c=caption([word('one',0,.3),word('two',.5,.8)]);
  assert.throws(()=>validateCaptions([{...c,words:[c.words[0],{...c.words[1],startTime:.2}]}]),/overlap/);
  assert.throws(()=>validateCaptions([c,{...c,id:'another',startTime:.2}]),/overlap/);
  assert.throws(()=>replaceText(c,' '),/empty/);
});
