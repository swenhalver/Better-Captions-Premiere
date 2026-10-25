#ifdef NDEBUG
#undef NDEBUG // Test checks remain active in Release builds.
#endif
// Line position styles: per-slot overrides of the visible caption window.
#include "../core/caption_core.hpp"
#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>
#include <map>
#include <stdexcept>
using namespace better_captions;
template<class F> void rejects(F f){bool rejected=false;try{f();}catch(const std::invalid_argument&){rejected=true;}assert(rejected);}
bool near(double a,double b,double tolerance=1e-9){return std::abs(a-b)<=tolerance;}
// Stub font: ascent 0.8 em, descent 0.2 em, half an em per byte.
Metrics measure(const std::string& text,const WordStyle& s){double px=s.fontSize*s.sizeScale;return {text.size()*px*0.5,px*0.8,px*0.2};}

// One single-word sentence per line; line i is spoken from i to i+0.8 s.
Document lineDocument(std::size_t count){
 Document d;d.containers.push_back({"lines",false,{}});
 for(std::size_t index=0;index<count;++index)d.containers[0].words.push_back({"w"+std::to_string(index),double(index),double(index)+.8,true});
 for(auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){s->fontSize=10;s->padding=0;}
 d.style.lineHeight=1;d.style.wordSpacing=4;return d;
}
RollUpSettings rolling(std::size_t lines,std::size_t current=1,int direction=1,int transition=1){
 RollUpSettings r;r.enabled=true;r.visibleLines=lines;r.currentLine=current;r.direction=direction;r.transition=transition;r.boundaryEnabled=false;return r;
}
const LayoutBox box{0,0,1000,1000};
Frame frameAt(const Document& d,double time,const RollUpSettings& r,std::size_t groups=1){return layoutFrame(d,time,box,measure,56,.6,{},groups,r);}
// Baseline of each drawn row, keyed by its word index (one word per row).
std::map<std::size_t,double> baselines(const Frame& f){std::map<std::size_t,double> result;for(const auto& w:f.words)result[w.wordIndex]=w.baseline;return result;}
const DrawWord& word(const Frame& f,std::size_t index){for(const auto& w:f.words)if(w.wordIndex==index)return w;std::cerr<<"missing word "<<index<<" among";for(const auto& w:f.words)std::cerr<<" "<<w.wordIndex;std::cerr<<"\n";throw std::logic_error("missing word");}
void setMargins(PositionStyle& p,double top,double bottom){p.fields|=PositionMarginTop|PositionMarginBottom;p.value.marginTop=top;p.value.marginBottom=bottom;}
void sameFrame(const Frame& a,const Frame& b,double tolerance){
 assert(a.words.size()==b.words.size()&&a.overflow==b.overflow&&a.rolling==b.rolling);
 assert(near(a.viewport.y,b.viewport.y,tolerance)&&near(a.viewport.height,b.viewport.height,tolerance)&&a.directionalPaintOutset==b.directionalPaintOutset);
 for(std::size_t index=0;index<a.words.size();++index){const auto& x=a.words[index];const auto& y=b.words[index];
  if(!(x.text==y.text&&x.wordIndex==y.wordIndex&&x.state==y.state&&near(x.x,y.x,tolerance)&&near(x.baseline,y.baseline,tolerance)&&near(x.width,y.width,tolerance)))
   std::cerr<<"word "<<index<<": "<<x.text<<" "<<x.x<<","<<x.baseline<<" w"<<x.width<<" vs "<<y.text<<" "<<y.x<<","<<y.baseline<<" w"<<y.width<<"\n";
  assert(x.text==y.text&&x.wordIndex==y.wordIndex&&x.state==y.state&&near(x.x,y.x,tolerance)&&near(x.baseline,y.baseline,tolerance)&&near(x.width,y.width,tolerance));
  assert(near(x.style.opacity,y.style.opacity,tolerance)&&near(x.style.fontSize*x.style.sizeScale,y.style.fontSize*y.style.sizeScale,tolerance));
 }
}

// Same words at the same places: a crossfade frame that is not mid-transition.
bool sameLayout(const Frame& a,const Frame& b){
 if(a.words.size()!=b.words.size())return false;
 for(std::size_t index=0;index<a.words.size();++index)if(a.words[index].wordIndex!=b.words[index].wordIndex||!near(a.words[index].baseline,b.words[index].baseline,1e-6)||!near(a.words[index].x,b.words[index].x,1e-6)||a.words[index].style.opacity!=b.words[index].style.opacity)return false;
 return true;
}

void codec(){
 auto plain=lineDocument(3);
 const auto legacy=encode(plain);assert(legacy[4]==kSchemaVersion);
 const auto decoded=decode(legacy);assert(!hasPositionStyles(decoded.style)&&encode(decoded)==legacy);
 // Every field on Line 1, a sparse Line 4; Lines 2, 3 and 5–8 stay unset.
 auto full=plain;auto& one=full.style.positions[0];one.fields=kPositionFieldMask;auto& v=one.value;
 v.fontFamily="Helvetica";v.fontWeight=700;v.fontWeightOffset=-1;v.italic=1;v.underline=0;v.fontSize=42;v.color={.1,.2,.3,1};v.opacity=.6;
 v.bubble=true;v.bubbleFillSpaces=true;v.bubbleColor={.4,.5,.6,.7};v.paddingTop=1;v.paddingRight=2;v.paddingBottom=3;v.paddingLeft=4;
 v.radiusTL=5;v.radiusTR=6;v.radiusBR=7;v.radiusBL=8;v.marginTop=-9;v.marginRight=10;v.marginBottom=11;v.marginLeft=12;
 v.outlineWidth=3;v.outlineColor={.7,.8,.9,.25};v.shadowBlur=4;v.shadowX=-2;v.shadowY=5;v.shadowColor={.9,.1,.2,.35};
 auto& four=full.style.positions[3];four.fields=PositionWeight|PositionMarginBottom;four.value.fontWeightOffset=100;four.value.marginBottom=24;
 const auto bytes=encode(full);assert(bytes[4]==kPositionStylesVersion&&bytes.size()>legacy.size());
 const auto back=decode(bytes);assert(encode(back)==bytes);
 for(std::size_t index=0;index<kMaxLinePositions;++index)assert(back.style.positions[index].fields==full.style.positions[index].fields);
 const auto& b=back.style.positions[0].value;
 assert(b.fontFamily=="Helvetica"&&b.fontWeight==700&&b.fontWeightOffset==-1&&b.italic==1&&b.underline==0&&b.fontSize==42&&b.opacity==.6);
 assert(b.color.r==.1&&b.color.g==.2&&b.color.b==.3&&b.bubble&&b.bubbleFillSpaces&&b.bubbleColor.b==.6&&b.bubbleColor.a==.7);
 assert(b.paddingLeft==4&&b.radiusBL==8&&b.marginTop==-9&&b.marginLeft==12&&b.outlineWidth==3&&b.outlineColor.a==.25&&b.shadowX==-2&&b.shadowColor.a==.35);
 assert(back.style.positions[3].value.fontWeightOffset==100&&back.style.positions[3].value.marginBottom==24);
 // The state styles and transcript bytes are untouched by the appended block.
 assert(std::equal(legacy.begin()+8,legacy.end(),bytes.begin()+8));
 // Clearing every position writes the legacy version again.
 auto cleared=back;for(auto& p:cleared.style.positions)p=PositionStyle{};assert(encode(cleared)==legacy);
 // Both features share one footer: wrap stays before positions in every mode.
 for(auto wrap:{LineWrap::Fill,LineWrap::Balance,LineWrap::Pretty}){
  auto base=plain;base.style.lineWrap=wrap;const auto baseBytes=encode(base);
  assert(baseBytes[4]==11&&baseBytes[baseBytes.size()-4]==static_cast<std::uint32_t>(wrap));
  const auto baseBack=decode(baseBytes);assert(baseBack.style.lineWrap==wrap&&!hasPositionStyles(baseBack.style)&&encode(baseBack)==baseBytes);
  auto positioned=full;positioned.style.lineWrap=wrap;const auto positionedBytes=encode(positioned);
  assert(positionedBytes[4]==12&&std::equal(baseBytes.begin()+8,baseBytes.end(),positionedBytes.begin()+8));
  auto restored=decode(positionedBytes);assert(restored.style.lineWrap==wrap&&encode(restored)==positionedBytes);
  restored.style.positions[3].value.marginBottom=37;
  assert(decode(encode(restored)).style.lineWrap==wrap);
  restored.style.lineWrap=wrap==LineWrap::Pretty?LineWrap::Fill:LineWrap::Pretty;
  const auto changedWrap=decode(encode(restored));assert(changedWrap.style.positions[0].fields==kPositionFieldMask&&changedWrap.style.positions[3].value.marginBottom==37);
  restored.style.lineWrap=wrap;for(auto& p:restored.style.positions)p=PositionStyle{};
  assert(encode(restored)==baseBytes);
  auto invalidWrap=positionedBytes;invalidWrap[baseBytes.size()-4]=3;rejects([&]{decode(invalidWrap);});
 }
 // Malformed position blocks are rejected.
 auto patched=[&](std::size_t offset,std::uint32_t value){auto copy=bytes;for(int i=0;i<4;++i)copy[offset+i]=static_cast<std::uint8_t>(value>>(8*i));return copy;};
 const auto block=legacy.size();
 rejects([&]{decode(patched(block,9));});                 // more than eight positions
 rejects([&]{decode(patched(block+4,0));});               // position 0
 rejects([&]{decode(patched(block+4,9));});               // position 9
 rejects([&]{decode(patched(block+8,0));});               // no fields
 rejects([&]{decode(patched(block+8,kPositionFieldMask+1));}); // unknown field bit
 auto lineFour=bytes;
 auto sparse=plain;sparse.style.positions[1]=four;sparse.style.positions[0]=four;const auto twice=encode(sparse);
 auto swapped=twice;for(int i=0;i<4;++i){swapped[block+4+i]=twice[block+4+i+4+4+8+4];}
 rejects([&]{decode(swapped);});                          // positions out of order
 auto truncated=bytes;truncated.pop_back();rejects([&]{decode(truncated);});
 auto trailing=bytes;trailing.push_back(0);rejects([&]{decode(trailing);});
 auto badMode=plain;badMode.style.positions[0].fields=PositionItalic;badMode.style.positions[0].value.italic=0;auto modeBytes=encode(badMode);
 modeBytes[block+12]=2;rejects([&]{decode(modeBytes);});
 auto invalid=plain;invalid.style.positions[2].fields=PositionPaddingTop;rejects([&]{validate(invalid);}); // inherit sentinel is not a value
 invalid=plain;invalid.style.positions[2].fields=PositionUnderline;rejects([&]{validate(invalid);});      // underline must be explicit
 invalid=plain;invalid.style.positions[2].fields=PositionFontSize;invalid.style.positions[2].value.fontSize=0;rejects([&]{validate(invalid);});
 // A v11 document decodes with no positions; v12 needs the positions block.
 auto withoutBlock=bytes;withoutBlock.resize(block);withoutBlock[4]=static_cast<std::uint8_t>(kPositionStylesVersion);rejects([&]{decode(withoutBlock);});
 auto future=legacy;future[4]=static_cast<std::uint8_t>(kMaxWireVersion+1);rejects([&]{decode(future);});
}

void precedence(){
 WordStyle state;state.fontSize=20;state.sizeScale=1.5;state.color={.2,.3,.4,.5};state.opacity=.9;state.bubbleColor={.1,.1,.1,.8};state.marginTop=3;state.italic=-1;
 PositionStyle none;assert(blendWordStyles(applyPositionStyle(state,none),state,0).fontSize==20);
 PositionStyle p;p.fields=PositionFontSize|PositionColor|PositionBubbleOpacity|PositionItalic;p.value.fontSize=12;p.value.color={1,0,0,1};p.value.bubbleColor.a=.25;p.value.italic=1;
 const auto merged=applyPositionStyle(state,p);
 assert(merged.fontSize==12&&merged.sizeScale==1&&merged.italic==1);
 assert(merged.color.r==1&&merged.color.g==0&&merged.color.a==.5);              // RGB from the position, alpha from the state
 assert(merged.bubbleColor.r==.1&&merged.bubbleColor.a==.25);                   // opacity alone
 assert(merged.opacity==.9&&merged.marginTop==3&&merged.bubble==state.bubble);   // unset fields inherit
 // Blends: exact ends, midpoints for numbers and colors, backgrounds fade.
 WordStyle a=state,c=state;c.fontSize=40;c.sizeScale=1;c.color={1,1,1,.5};c.marginTop=13;c.bubble=true;c.bubbleColor={1,0,0,1};c.paddingTop=10;
 const auto start=blendWordStyles(a,c,0),end=blendWordStyles(a,c,1),mid=blendWordStyles(a,c,.5);
 Document check;check.style.current=start;Document expect;expect.style.current=a;assert(encode(check)==encode(expect));
 check.style.current=end;expect.style.current=c;assert(encode(check)==encode(expect));
 assert(near(mid.fontSize*mid.sizeScale,35)&&near(mid.color.r,.6)&&near(mid.marginTop,8)&&near(mid.topPadding(),(a.topPadding()+10)/2));
 assert(mid.bubble&&near(mid.bubbleColor.r,1)&&near(mid.bubbleColor.a,.5));
 const auto early=blendWordStyles(a,c,.1);assert(early.bubble&&near(early.bubbleColor.a,.1));

 // Position wins over state in layout; other states keep their own values.
 auto d=lineDocument(1);d.style.upcoming.color={0,0,1,1};d.style.current.color={0,1,0,1};d.style.spoken.opacity=.4;
 auto& line=d.style.positions[0];line.fields=PositionColor;line.value.color={1,0,0,1};
 for(double time:{-.5,.4,.9}){
  const auto f=layoutFrame(d,time<0?0:time,box,measure,56,.6,{},1,{});if(time<0)continue;
  if(time>.8){assert(f.words.empty());continue;}
  assert(f.words.size()==1&&f.words[0].style.color.r==1&&f.words[0].style.color.g==0);
 }
 d.containers[0].words.push_back({"next",1,1.5,false});d.containers[0].words.push_back({"after",1.5,2,false});
 const auto page=layoutFrame(d,1.2,box,measure,56,.6,{},1,{});
 assert(page.words.size()==2&&page.words[0].style.color.r==1&&page.words[1].style.color.r==1&&page.words[1].style.color.g==0&&page.words[0].state==WordState::Current&&page.words[1].state==WordState::Upcoming);
}

void slotGeometry(){
 // Swen's example: Lines 1 and 4 get more margin; Lines 2 and 3 keep the
 // normal gap. Stub rows are 8 px ascent + 2 px descent at line height 1.
 const double M=6;auto d=lineDocument(6);
 const auto normal=frameAt(d,4.5,rolling(4));
 setMargins(d.style.positions[0],M,M);setMargins(d.style.positions[3],M,M);
 const auto spaced=frameAt(d,4.5,rolling(4));
 auto plainLines=baselines(normal),lines=baselines(spaced);
 assert(plainLines.size()==4&&lines.size()==4&&lines.count(1)&&lines.count(4));
 for(std::size_t row=1;row<4;++row)assert(near(plainLines[row+1]-plainLines[row],10));
 assert(near(lines[2]-lines[1],10+M)&&near(lines[3]-lines[2],10)&&near(lines[4]-lines[3],10+M));
 assert(near(normal.viewport.height,40)&&near(spaced.viewport.height,40+4*M));
 // Line 4 (anchor, bottom slot) sits below Lines 1–3: its top margin moves its own glyphs down.
 assert(near(lines[4]-spaced.viewport.y,(10+2*M)+10+10+8+M));
 // The window grows symmetrically inside the box; the box still contains it.
 assert(near(spaced.viewport.y,(1000-(40+4*M))/2)&&!spaced.overflow);
 // Down: newest line on top, the same slots in screen order.
 const auto down=frameAt(d,4.5,rolling(4,1,2));auto downLines=baselines(down);
 assert(near(downLines[3]-downLines[4],10+M)&&near(downLines[2]-downLines[3],10)&&near(downLines[1]-downLines[2],10+M));
 // Current line position: Line 2 holds the current line, upcoming lines below it.
 const auto led=frameAt(d,3.5,rolling(4,2));auto ledLines=baselines(led);
 assert(ledLines.count(2)&&ledLines.count(5)&&!ledLines.count(1));
 assert(near(ledLines[3]-ledLines[2],10+M)&&near(ledLines[4]-ledLines[3],10)&&near(ledLines[5]-ledLines[4],10+M));
 // A box too short for every slot shows fewer lines, like plain lines do.
 const auto capped=layoutFrame(d,4.5,{0,0,1000,60},measure,56,.6,{},1,rolling(4));
 assert(baselines(capped).size()==3&&near(capped.viewport.height,(10+2*M)+10+10)&&!capped.overflow);
}

void scrollInterpolation(){
 // Line 1 is red at 20 px; Line 2 green. Row 2 scrolls from Line 2 to Line 1
 // between 4.8 s and 4.98 s; its style and every row position change smoothly.
 auto d=lineDocument(6);
 auto& top=d.style.positions[0];top.fields=PositionColor|PositionFontSize|PositionMarginBottom;top.value.color={1,0,0,1};top.value.fontSize=20;top.value.marginBottom=4;
 auto& second=d.style.positions[1];second.fields=PositionColor;second.value.color={0,1,0,1};
 const auto r=rolling(4);
 const auto before=frameAt(d,4.79,r),after=frameAt(d,5.5,r);
 assert(word(before,2).style.color.g==1&&word(before,2).style.fontSize==10);
 assert(word(after,2).style.color.r==1&&word(after,2).style.fontSize==20);
 // Positions are settled exactly at both ends of the scroll; only word states differ.
 auto sameRows=[](const Frame& a,const Frame& b){auto x=baselines(a),y=baselines(b);assert(x.size()==y.size());for(const auto& [index,baseline]:x)assert(near(baseline,y.at(index)));};
 sameRows(frameAt(d,4.8,r),before);
 auto previous=baselines(before);double previousRed=0,previousSize=10;bool blended=false;
 for(double time=4.8;time<=5.0;time+=.002){
  const auto f=frameAt(d,time,r);const auto& moving=word(f,2);
  assert(moving.style.color.r>=previousRed-1e-12&&near(moving.style.color.r+moving.style.color.g,1,1e-9));
  assert(moving.style.fontSize*moving.style.sizeScale>=previousSize-1e-12);
  if(moving.style.color.r>.2&&moving.style.color.r<.8)blended=true;
  previousRed=moving.style.color.r;previousSize=moving.style.fontSize*moving.style.sizeScale;
  for(const auto& [index,baseline]:baselines(f))if(previous.count(index))assert(std::abs(baseline-previous[index])<1.5);
  previous=baselines(f);
 }
 assert(blended);
 sameRows(frameAt(d,4.99,r),after);assert(word(frameAt(d,4.99,r),2).style.color.r==1);
 // Entry glide-in with Current line position 2: the first line glides from the
 // bottom slot to Line 2's slot, blending through Line 3's style on the way.
 auto glide=d;auto& third=glide.style.positions[2];third.fields=PositionColor;third.value.color={0,0,1,1};
 const auto lead=rolling(4,2);double last=-1e9;
 for(double time=0;time<=.2;time+=.01){const auto f=frameAt(glide,time,lead);const double y=word(f,0).baseline;assert(last==-1e9||(y<=last+1e-9&&last-y<4));last=y;}
 assert(word(frameAt(glide,.3,lead),0).style.color.g==1);
}

void pauseLines(){
 // A, one pause line, B. With B current, the pause line sits in Line 2.
 Document d=lineDocument(0);d.containers[0].words={{"A",0,.8,true},{"B",2.3,3.1,true},{"C",3.2,4,true}};
 auto r=rolling(3);r.blankLineSeconds=1;
 const double plain=baselines(frameAt(d,2.9,r))[1]-baselines(frameAt(d,2.9,r))[0];assert(near(plain,20));
 setMargins(d.style.positions[1],5,7);
 auto spaced=baselines(frameAt(d,2.9,r));assert(near(spaced[1]-spaced[0],20+12));
 // Once the pause scrolls up into Line 1, text line B takes Line 2's margins.
 auto later=baselines(frameAt(d,3.5,r));assert(later.size()==2&&near(later[2]-later[1],10+7));
}

void weightInterpolation(){
 WordStyle regular;regular.fontFamily="Fixture";regular.fontWeight=400;regular.fontWeightOffset=0;
 auto bold=regular;bold.fontWeightOffset=100;
 // Like Arial, this family has Regular and Bold, with no 500/600 face.
 const ResolveWeight supported=[](const WordStyle& s){return s.fontWeightOffset==100?700.0:s.fontWeightOffset==0?400.0:s.fontWeight;};
 for(double t:{.25,.5,.75}){
  const auto blended=blendWordStyles(regular,bold,t,supported);
  assert(blended.fontWeightOffset==-1&&near(blended.fontWeight,400+300*t));
 }
 assert(blendWordStyles(regular,bold,0,supported).fontWeightOffset==0);
 assert(blendWordStyles(regular,bold,1,supported).fontWeightOffset==100);
 auto absolute=bold;absolute.fontWeightOffset=-1;absolute.fontWeight=700;
 assert(near(blendWordStyles(regular,absolute,.5,supported).fontWeight,550));
 auto other=bold;other.fontFamily="Other";
 assert(blendWordStyles(regular,other,.25,supported).fontFamily==regular.fontFamily);
 assert(blendWordStyles(regular,other,.75,supported).fontFamily==other.fontFamily);
 assert(blendWordStyles(regular,other,.75,supported).fontWeightOffset==100);

 // The real layout path must pass the resolver through continuous scrolling
 // and shared-line fade/slide/pop transitions, in both vertical directions.
 auto d=lineDocument(6);d.style.baseFontWeight=600;
 for(auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){s->fontFamily=regular.fontFamily;s->fontWeightOffset=0;}
 for(int direction:{1,2})for(int transition:{1,2,3,4}){
  for(auto& p:d.style.positions)p=PositionStyle{};
  auto& target=d.style.positions[direction==1?0:3];target.fields=PositionWeight;target.value=bold;
  const auto r=rolling(4,1,direction,transition);
  const auto frame=layoutFrame(d,4.89,box,measure,56,.6,{},1,r,supported);
  const auto& moving=word(frame,2);
  assert(moving.style.fontWeightOffset==-1&&near(moving.style.fontWeight,550,1e-6));
  const auto fallback=frameAt(d,4.89,r);
  assert(word(fallback,2).style.fontWeightOffset==-1&&near(word(fallback,2).style.fontWeight,650,1e-6));
 }
}

void pagedMode(){
 auto d=lineDocument(6);
 auto& two=d.style.positions[1];two.fields=PositionColor;two.value.color={1,0,0,1};
 auto& three=d.style.positions[2];three.fields=PositionMarginTop;three.value.marginTop=6;
 const auto page=layoutFrame(d,.5,box,measure,56,.6,{},3,{});
 auto lines=baselines(page);assert(lines.size()==3);
 assert(word(page,0).style.color.g==1&&word(page,1).style.color.g==0&&word(page,2).style.color.g==1);
 assert(near(lines[1]-lines[0],10)&&near(lines[2]-lines[1],10+6));
 // The next page starts again at Line 1.
 const auto next=layoutFrame(d,3.5,box,measure,56,.6,{},3,{});
 assert(word(next,4).style.color.g==0&&word(next,3).style.color.g==1);
 // One line per page: every line is Line 1, so Line 2's style never shows.
 auto plain=lineDocument(6);sameFrame(layoutFrame(d,.5,box,measure,56,.6,{},1,{}),layoutFrame(plain,.5,box,measure,56,.6,{},1,{}),0);
}

void horizontal(){
 // Pages slide sideways whole: a row keeps its slot style during the slide.
 auto d=lineDocument(6);auto& two=d.style.positions[1];two.fields=PositionColor|PositionMarginTop;two.value.color={1,0,0,1};two.value.marginTop=5;
 for(int direction:{3,4}){
  const auto r=rolling(2,1,direction);
  const auto settled=frameAt(d,.5,r);assert(word(settled,1).style.color.g==0&&word(settled,0).style.color.g==1);
  assert(near(word(settled,1).baseline-word(settled,0).baseline,10+5));
  const auto sliding=frameAt(d,1.89,r);
  assert(word(sliding,1).style.color.g==0&&word(sliding,3).style.color.g==0&&word(sliding,2).style.color.g==1);
  assert(near(word(sliding,3).baseline-word(sliding,2).baseline,10+5));
 }
}

void transitions(){
 // Fades, slides and pops paint two settled windows, each with its own slot
 // styles: the incoming line takes Line 4's red at once while it fades in.
 // A line in both windows is drawn once and glides from Line 4 to Line 3,
 // blending red to white and its spacing, with no jump at either end.
 auto d=lineDocument(6);auto& bottom=d.style.positions[3];bottom.fields=PositionColor|PositionMarginTop;bottom.value.color={1,0,0,1};bottom.value.marginTop=6;
 for(int transition:{2,3,4}){
  const auto r=rolling(4,1,1,transition);
  const auto settled=frameAt(d,4.5,r),after=frameAt(d,5.5,r);assert(word(settled,4).style.color.g==0&&word(settled,3).style.color.g==1);
  const auto mid=frameAt(d,4.89,r);
  assert(word(mid,5).style.color.g==0&&word(mid,5).style.opacity<1&&word(mid,1).style.color.g==1);
  assert(std::count_if(mid.words.begin(),mid.words.end(),[](const DrawWord& w){return w.wordIndex==4;})==1);
  const auto& shared=word(mid,4);assert(shared.style.color.g>0&&shared.style.color.g<1);
  assert(shared.baseline<word(settled,4).baseline&&shared.baseline>word(after,4).baseline);
  double previous=word(settled,4).baseline;
  for(double time=4.8;time<5;time+=.004){const double y=word(frameAt(d,time,r),4).baseline;assert(y<=previous+1e-9&&previous-y<2);previous=y;}
  assert(near(previous,word(after,4).baseline,1e-6));
 }
}

void visibleLinesChange(){
 // Line 4's settings are kept but unused while only three lines show.
 auto d=lineDocument(6);setMargins(d.style.positions[3],9,9);const auto plain=lineDocument(6);
 for(double time:{.5,2.5,3.9,4.85}){
  sameFrame(frameAt(d,time,rolling(3)),frameAt(plain,time,rolling(3)),0);
  assert(frameAt(d,time,rolling(4)).viewport.height>frameAt(plain,time,rolling(4)).viewport.height);
 }
 assert(decode(encode(d)).style.positions[3].value.marginTop==9);
}

void legacyParity(){
 // Overrides equal to the state values take the positioned layout path; it
 // must reproduce the legacy layout for every direction, transition and lead.
 // (Fade, slide and pop differ only mid-transition, where a positioned shared
 // line glides instead of jumping; compare those at settled times.)
 auto plain=lineDocument(7);plain.style.current.fontSize=14;plain.style.spoken.opacity=.6;plain.style.current.marginBottom=3;
 plain.containers[0].words[3].start=3.5;// a pause line
 plain.containers[0].words[3].end=4.2;
 auto same=plain;for(auto& p:same.style.positions){p.fields=PositionMarginLeft;p.value.marginLeft=0;}
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(std::size_t lead:{std::size_t(1),std::size_t(2),std::size_t(3)})
  for(double time=0;time<7;time+=.0625){
   auto r=rolling(3,lead,direction,transition);r.blankLineSeconds=.5;
   const auto legacy=frameAt(plain,time,r);
   if(transition!=1){auto settled=r;settled.transition=1;if(!sameLayout(legacy,frameAt(plain,time,settled)))continue;}
   sameFrame(frameAt(same,time,r),legacy,1e-6);
  }
}

void paintOutset(){
 auto d=lineDocument(4);auto r=rolling(2);r.boundaryEnabled=true;
 const auto plain=frameAt(d,.5,r);
 auto& one=d.style.positions[0];one.fields=PositionMarginTop;one.value.marginTop=-12;
 assert(frameAt(d,.5,r).directionalPaintOutset[0]>plain.directionalPaintOutset[0]);
}

int main(){
 codec();precedence();slotGeometry();scrollInterpolation();pauseLines();weightInterpolation();pagedMode();horizontal();transitions();visibleLinesChange();legacyParity();paintOutset();
 std::cout<<"line positions: codec, precedence, slot geometry, interpolation, pause lines, pages, sideways, transitions, visible lines and legacy parity passed\n";
}
