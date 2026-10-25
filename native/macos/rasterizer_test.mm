#include "caption_rasterizer.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <limits>
#include <cmath>
#include <CoreText/CoreText.h>
using namespace better_captions;
void check(bool b,const char* s){if(!b)throw std::runtime_error(s);}
struct Bounds {std::size_t left,top,right,bottom;};
Bounds visible(const macos::Bitmap& b){Bounds r{b.width,b.height,0,0};for(std::size_t y=0;y<b.height;++y)for(std::size_t x=0;x<b.width;++x)if(b.pixels[y*b.stride+x*4+3]){r.left=std::min(r.left,x);r.right=std::max(r.right,x);r.top=std::min(r.top,y);r.bottom=std::max(r.bottom,y);}return r;}
std::size_t count(const macos::Bitmap& b){std::size_t n=0;for(std::size_t i=3;i<b.pixels.size();i+=4)if(b.pixels[i])++n;return n;}
int main(){
 Document d;d.containers.push_back({"scratch",false,{{"Caption",0,1,false},{"stays",1,2,false},{"together",2,3,false}}});
 for(auto* s:{&d.style.current,&d.style.upcoming,&d.style.spoken})s->fontSize=32;
 d.style.current.color={1,0,0,1};d.style.current.bubble=true;d.style.current.bubbleColor={0,0,1,1};
 LayoutBox box{20,10,500,160,1};auto b=macos::rasterize(d,.5,box,640,240);check(count(b)>500,"No text/bubble rasterized");
 check(b.pixels==macos::rasterize(d,.5,box,640,240).pixels,"Render is nondeterministic");
 check(count(macos::rasterize(d,3,box,640,240))==0,"Caption leaked past half-open interval");
 // Width changes position/overflow metadata; only regrouping creates rows.
 const auto measureGlyphs=[](const std::string& text,const WordStyle& style){return macos::measureText(text,style);};
 const auto wideFrame=layoutFrame(d,.5,box,measureGlyphs);
 const LayoutBox narrowBox{20,10,150,160,1};const auto narrowFrame=layoutFrame(d,.5,narrowBox,measureGlyphs);
 auto narrow=macos::rasterize(d,.5,narrowBox,640,240);check(narrowFrame.overflow,"Narrow phrase did not report overflow");
 check(narrowFrame.words.size()==wideFrame.words.size(),"Width change hid or regrouped authored words");
 for(std::size_t index=0;index<narrowFrame.words.size();++index){const auto& run=narrowFrame.words[index];const auto& wide=wideFrame.words[index];
  check(run.baseline==narrowFrame.words.front().baseline,"Narrow caption created a second physical row");
  check(run.x==wide.x&&run.baseline==wide.baseline&&run.width==wide.width&&run.height==wide.height&&run.style.fontSize==wide.style.fontSize,"Narrow caption resized or moved authored glyphs");}
 check(narrow.pixels==b.pixels&&visible(narrow).right>=170,"Narrow placement box cropped or resized the overflowing line");
 for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=1;settings.scrollDuration=0;settings.boundaryEnabled=false;settings.direction=direction;
  const auto wide=layoutFrame(d,.5,box,measureGlyphs,56,.6,{},1,settings);
  const auto clipped=layoutFrame(d,.5,narrowBox,measureGlyphs,56,.6,{},1,settings);
  check(clipped.overflow&&clipped.words.size()==wide.words.size(),"Scrolling width regrouped or discarded overflowing words");
  for(std::size_t index=0;index<clipped.words.size();++index)check(clipped.words[index].baseline==clipped.words.front().baseline&&clipped.words[index].width==wide.words[index].width&&clipped.words[index].style.fontSize==32,"Scrolling width wrapped or shrank the authored line");
  const auto widePixels=macos::rasterize(d,.5,box,640,240,56,.6,1,settings);
  const auto clippedPixels=macos::rasterize(d,.5,narrowBox,640,240,56,.6,1,settings);
  check(clippedPixels.pixels==widePixels.pixels&&visible(clippedPixels).right>=170,"Scrolling placement box cropped or resized the overflowing line");
 }
 // A placement rectangle is not a paint mask. Large type and asymmetric word
 // backgrounds extend beyond every edge; authored shadow settings survive
 // the same full-bitmap comparison without changing existing shadow behavior.
 Document outside;outside.containers.push_back({"outside-placement",false,{{"Overflow",0,1,true}}});
 for(auto* style:{&outside.style.current,&outside.style.spoken,&outside.style.upcoming}){style->fontFamily="Arial";style->fontSize=64;style->color={1,0,0,1};style->bubble=true;style->bubbleColor={0,0,1,1};style->radius=0;style->paddingTop=17;style->paddingBottom=29;style->paddingLeft=23;style->paddingRight=7;style->marginTop=-40;style->marginLeft=-40;style->shadowColor={0,1,0,1};style->shadowX=-90;style->shadowY=-90;style->shadowBlur=4;}
 const LayoutBox placement{200,150,60,10,1};
 const auto outsideStatic=macos::rasterize(outside,.5,placement,640,400);
 check(outsideStatic.overflow&&outsideStatic.pixels==macos::rasterize(outside,.5,{200,150,400,230,1},640,400).pixels,"Placement width/height cropped large text, background or shadow");
 const auto outsidePaint=[&](const macos::Bitmap& pixels,const LayoutBox& area){std::array<std::size_t,3> colors{};std::array<bool,4> edges{};
  for(std::size_t y=0;y<pixels.height;++y)for(std::size_t x=0;x<pixels.width;++x){const auto pixel=y*pixels.stride+x*4;if(!pixels.pixels[pixel+3])continue;
   const bool left=x<area.x,top=y<area.y,right=x>=area.x+area.width,bottom=y>=area.y+area.height;
   if(left||top||right||bottom)for(int channel=0;channel<3;++channel)colors[channel]+=pixels.pixels[pixel+channel]>0;
   edges[0]=edges[0]||top;edges[1]=edges[1]||bottom;edges[2]=edges[2]||left;edges[3]=edges[3]||right;}
  check(colors[0]>100&&colors[2]>100,"Placement rectangle cropped overflowing glyph or background pixels");return edges;};
 const auto outsideEdges=outsidePaint(outsideStatic,placement);for(bool edge:outsideEdges)check(edge,"Large styled caption did not paint beyond every placement-box edge");
 for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=1;settings.scrollDuration=0;settings.boundaryEnabled=false;settings.direction=direction;
  const auto frame=layoutFrame(outside,.5,placement,measureGlyphs,56,.6,{},1,settings);
  const auto pixels=macos::rasterize(outside,.5,placement,640,400,56,.6,1,settings);outsidePaint(pixels,frame.viewport);
  auto independent=settings;independent.boundaryMode=1;for(auto& edge:independent.edges){edge.fadeEnabled=false;edge.inset=.01;}
  const auto maskedFrame=layoutFrame(outside,.5,placement,measureGlyphs,56,.6,{},1,independent);
  const auto masked=macos::rasterize(outside,.5,placement,640,400,56,.6,1,independent);
  check(count(masked)<count(pixels),"Explicit four-edge mask did not crop overflowing paint");
  for(std::size_t y=0;y<pixels.height;++y)for(std::size_t x=0;x<pixels.width;++x){const auto pixel=y*pixels.stride+x*4;const double alpha=rollUpAlpha(x+.5,y+.5,maskedFrame);for(int channel=0;channel<4;++channel)check(masked.pixels[pixel+channel]==std::lround(pixels.pixels[pixel+channel]*alpha),"Explicit four-edge mask did not multiply overflowing paint");}
  auto directional=settings;directional.boundaryEnabled=true;directional.transitionThickness=0;
  const auto directionalFrame=layoutFrame(outside,.5,placement,measureGlyphs,56,.6,{},1,directional);
  const auto directionalPixels=macos::rasterize(outside,.5,placement,640,400,56,.6,1,directional);std::size_t preservedOutside=0;
  for(std::size_t y=0;y<pixels.height;++y)for(std::size_t x=0;x<pixels.width;++x){const auto pixel=y*pixels.stride+x*4;const double alpha=rollUpAlpha(x+.5,y+.5,directionalFrame);for(int channel=0;channel<4;++channel)check(directionalPixels.pixels[pixel+channel]==std::lround(pixels.pixels[pixel+channel]*alpha),"Directional edge mask altered unrelated paint");if((x<placement.x||x>=placement.x+placement.width||y<placement.y||y>=placement.y+placement.height)&&directionalPixels.pixels[pixel+3])++preservedOutside;}
  check(preservedOutside>100,"Directional boundary cropped all placement-box edges instead of its designated edge");
 }
 // Live top-crop reproduction: a -5px authored margin places the rounded
 // background outside its row metric. A default directional edge must allow
 // that full settled line, without shifting glyphs or changing row advance.
 Document roundedEdge;roundedEdge.containers.push_back({"rounded-edge",false,{{"All",.31,.45666666666666667,false},{"right,",.45666666666666667,.75,false},{"this",.75,.95,false},{"thing's",.95,1.23,false},{"Another.",1.23,2.2,true}}});roundedEdge.style.lineHeight=1;roundedEdge.style.wordSpacing=0;roundedEdge.style.titleCase=true;roundedEdge.style.baseFontWeight=500;
 for(auto* style:{&roundedEdge.style.current,&roundedEdge.style.spoken,&roundedEdge.style.upcoming}){style->fontFamily="Helvetica Neue";style->fontSize=50;style->fontWeight=500;style->color={1,1,1,1};style->paddingTop=style->paddingRight=style->paddingBottom=style->paddingLeft=15;style->marginTop=style->marginRight=style->marginBottom=style->marginLeft=-5;style->radius=20;style->radiusTL=style->radiusTR=style->radiusBR=style->radiusBL=20;style->shadowColor.a=0;}
 roundedEdge.style.current.bubble=true;roundedEdge.style.current.bubbleColor={.2196078431372549,.3411764705882353,.10196078431372549,1};roundedEdge.style.current.outlineWidth=5;roundedEdge.style.upcoming.opacity=.9;
 const LayoutBox roundedBox{32,320,656,1152,1};const auto roundedBytes=encode(roundedEdge);
 auto noRoundedBackground=roundedEdge;noRoundedBackground.style.current.bubble=false;
 const auto twoRoundedRows=layoutFrame(roundedEdge,.375,roundedBox,measureGlyphs,28,.6,{},2),twoUnpaintedRows=layoutFrame(noRoundedBackground,.375,roundedBox,measureGlyphs,28,.6,{},2);
 check(twoRoundedRows.words.size()==5&&twoUnpaintedRows.words.size()==5,"Rounded-edge line-advance fixture did not retain two phrase groups");
 for(std::size_t index=0;index<twoRoundedRows.words.size();++index)check(twoRoundedRows.words[index].x==twoUnpaintedRows.words[index].x&&twoRoundedRows.words[index].baseline==twoUnpaintedRows.words[index].baseline,"Negative-margin background toggle changed word positions or line advance");
 for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=1;settings.scrollDuration=.18;settings.speed=.7;settings.boundaryEnabled=true;settings.boundaryPosition=0;settings.transitionThickness=0;settings.direction=direction;
  auto unmasked=settings;unmasked.boundaryEnabled=false;
  const auto maskedFrame=layoutFrame(roundedEdge,.375,roundedBox,measureGlyphs,28,.6,{},2,settings),unmaskedFrame=layoutFrame(roundedEdge,.375,roundedBox,measureGlyphs,28,.6,{},2,unmasked);
  check(maskedFrame.words.size()==4&&unmaskedFrame.words.size()==4,"Rounded-edge fixture lost its complete authored phrase");
  for(std::size_t index=0;index<maskedFrame.words.size();++index)check(maskedFrame.words[index].x==unmaskedFrame.words[index].x&&maskedFrame.words[index].baseline==unmaskedFrame.words[index].baseline,"Directional paint allowance shifted the caption");
  const auto masked=macos::rasterize(roundedEdge,.375,roundedBox,720,1280,28,.6,2,settings),full=macos::rasterize(roundedEdge,.375,roundedBox,720,1280,28,.6,2,unmasked);
  check(count(full)>100&&masked.pixels==full.pixels,"Default directional boundary cropped a settled rounded background with negative margins");
  auto explicitCrop=settings;explicitCrop.boundaryMode=1;for(auto& edge:explicitCrop.edges)edge.fadeEnabled=false;
  check(macos::rasterize(roundedEdge,.375,roundedBox,720,1280,28,.6,2,explicitCrop).pixels==full.pixels,"Zero-inset four-edge crop cut a settled rounded background with negative margins");
  for(auto& edge:explicitCrop.edges)edge.inset=.001;
  const auto cropped=macos::rasterize(roundedEdge,.375,roundedBox,720,1280,28,.6,2,explicitCrop);
  check(count(cropped)<count(full),"Positive four-edge crop no longer masks authored negative-margin overflow");
 }
 check(encode(roundedEdge)==roundedBytes,"Directional paint allowance changed saved margins or word styling");
 auto shortBox=macos::rasterize(d,.5,{20,10,150,10},640,240);check(shortBox.overflow,"Independent height overflow missing");
 // A real pixel inside the interword gap changes from transparent to the
 // requested premultiplied bubble alpha, without changing text positions.
 Document spaced;spaced.containers.push_back({"space-fill",false,{{"MM",0,1,false},{"NN",1,2,false}}});spaced.style.wordSpacing=32;
 for(auto* style:{&spaced.style.current,&spaced.style.spoken,&spaced.style.upcoming}){style->fontSize=32;style->bubble=true;style->padding=0;style->radius=0;style->color.a=0;style->bubbleColor={.8,.2,.1,.5};style->opacity=.5;style->shadowColor.a=0;}
 LayoutBox spacedBox{10,10,500,160,1};const auto nativeMeasure=[](const std::string& text,const WordStyle& style){return macos::measureText(text,style);};
 const auto spacedFrame=layoutFrame(spaced,.5,spacedBox,nativeMeasure);const auto& first=spacedFrame.words.front();
 const auto gapX=static_cast<std::size_t>(std::floor(first.x+first.width+16)),gapY=static_cast<std::size_t>(std::floor(first.baseline-8));
 const auto emptyGap=macos::rasterize(spaced,.5,spacedBox,640,240);check(emptyGap.pixels[gapY*emptyGap.stride+gapX*4+3]==0,"Unfilled space contains pixels");
 spaced.style.current.bubbleFillSpaces=true;const auto filledGap=macos::rasterize(spaced,.5,spacedBox,640,240);const auto gapAlpha=filledGap.pixels[gapY*filledGap.stride+gapX*4+3];
 check(gapAlpha>=63&&gapAlpha<=65,"Filled space lost independent bubble/text opacity");
 const auto finalRun=layoutFrame(spaced,.5,spacedBox,nativeMeasure).words.back();const auto trailing=static_cast<std::size_t>(std::ceil(finalRun.x+finalRun.width+4));
 check(filledGap.pixels[gapY*filledGap.stride+trailing*4+3]==0,"Space fill extended beyond final line word");
 spaced.style.current.bubble=false;const auto disabledBubble=macos::rasterize(spaced,.5,spacedBox,640,240);check(disabledBubble.pixels[gapY*disabledBubble.stride+gapX*4+3]==0,"Disabled bubble still colored its spaces");
 // Joining bubbles removes the top/bottom rounded notches at interior
 // spaces while retaining the two outer rounded endpoints and state alpha.
 Document connected=spaced;connected.style.current.bubble=true;
 for(auto* style:{&connected.style.current,&connected.style.spoken,&connected.style.upcoming}){style->bubbleFillSpaces=true;style->padding=8;style->radius=12;}
 connected.style.spoken.bubbleColor={1,0,0,.5};connected.style.current.bubbleColor={0,0,1,.8};
 const auto connectedFrame=layoutFrame(connected,1.5,spacedBox,nativeMeasure);const auto& a=connectedFrame.words[0];const auto& z=connectedFrame.words[1];
 const auto connectedBitmap=macos::rasterize(connected,1.5,spacedBox,640,240);
 const auto top=static_cast<std::size_t>(std::ceil(a.baseline-nativeMeasure(a.text,a.style).ascent-a.style.padding)+1);
 auto alphaAt=[&](std::size_t x,std::size_t y){return connectedBitmap.pixels[y*connectedBitmap.stride+x*4+3];};
 const auto beforeJoin=static_cast<std::size_t>(std::floor(z.x)-2),afterJoin=static_cast<std::size_t>(std::ceil(z.x)+2);
 check(alphaAt(beforeJoin,top)>=63&&alphaAt(beforeJoin,top)<=65,"Filled space retains a rounded notch on its right join");
 check(alphaAt(afterJoin,top)>=101&&alphaAt(afterJoin,top)<=103,"Following bubble retains a rounded notch or loses its alpha on its left join");
 check(alphaAt(static_cast<std::size_t>(a.x)+1,top)<32,"First outer bubble end lost its rounded corner");
 check(alphaAt(static_cast<std::size_t>(z.x+z.width)-2,top)<50,"Last outer bubble end lost its rounded corner");
 check(connectedBitmap.pixels[top*connectedBitmap.stride+beforeJoin*4]>0&&connectedBitmap.pixels[top*connectedBitmap.stride+beforeJoin*4+2]==0,"Previous state fill color changed at join");
 check(connectedBitmap.pixels[top*connectedBitmap.stride+afterJoin*4]==0&&connectedBitmap.pixels[top*connectedBitmap.stride+afterJoin*4+2]>0,"Current state fill color changed at join");
 const auto clippedConnected=layoutFrame(connected,1.5,{10,10,75,200,1},nativeMeasure);
 check(clippedConnected.overflow&&clippedConnected.words.size()==2,"Narrow connected phrase did not retain both overflowing words");
 check(clippedConnected.words.front().baseline==clippedConnected.words.back().baseline,"Narrow width split a connected bubble onto separate rows");
 check(clippedConnected.words.front().bubbleJoinRight&&clippedConnected.words.back().bubbleJoinLeft,"Narrow width split the authored bubble join");

 // Actual native pixels move with the compact line-height multiplier; .6
 // can intentionally overlap lines while larger values add vertical gap.
 std::vector<macos::Bitmap> linePixels;
 for(double spacing:{.6,1.2,2.0}){auto lineDoc=connected;lineDoc.style.lineHeight=spacing;lineDoc.containers.front().words.front().endOfSentence=true;
  const LayoutBox lineBox{10,10,500,300,1};const auto frame=layoutFrame(lineDoc,1.5,lineBox,nativeMeasure,56,.6,{},2);check(frame.words.size()==2,"Line spacing fixture did not retain both explicit phrase groups");
  const auto& firstRun=frame.words.front();const auto glyphMetrics=nativeMeasure(firstRun.text,firstRun.style);const double lineExtent=glyphMetrics.ascent+glyphMetrics.descent+firstRun.style.marginTop+firstRun.style.marginBottom+firstRun.style.verticalPadding();
  check(std::abs(frame.words.back().baseline-firstRun.baseline-lineExtent*spacing)<1e-9,"Native line spacing did not move physical line baselines");
  for(const auto& run:frame.words)check(!run.bubbleJoinLeft&&!run.bubbleJoinRight,"Line spacing joined separate phrase groups");
  linePixels.push_back(macos::rasterize(lineDoc,1.5,lineBox,640,360,56,.6,2));
 }
 check(linePixels[0].pixels!=linePixels[1].pixels&&linePixels[1].pixels!=linePixels[2].pixels,"Line-height changes did not affect actual native pixels");
 check(visible(linePixels[0]).bottom<visible(linePixels[1]).bottom&&visible(linePixels[1]).bottom<visible(linePixels[2]).bottom,"Native line-height pixels did not gain increasing vertical gap");
 // Each whole average-line interval in a pause occupies an ordinary transparent
 // row. Two seconds between one-second lines therefore reserves two rows.
 Document silence;silence.containers.push_back({"silence-pixels",false,{{"Before.",0,1,true},{"After.",3,4,true}}});
 for(auto* style:{&silence.style.current,&silence.style.spoken,&silence.style.upcoming}){style->fontFamily="Arial";style->fontSize=32;style->bubble=false;style->shadowColor.a=0;style->outlineWidth=0;}
 const auto silenceBytes=encode(silence);const LayoutBox silenceBox{20,20,580,300,1};
 const auto silenceRows=layoutFrame(silence,3.5,silenceBox,nativeMeasure,56,.6,{},4);
 auto continuous=silence;continuous.containers.front().words.back().start=1;continuous.containers.front().words.back().end=2;
 const auto continuousRows=layoutFrame(continuous,1.5,silenceBox,nativeMeasure,56,.6,{},2);
 check(silenceRows.words.size()==2&&continuousRows.words.size()==2,"Silence row fixture lost surrounding phrase groups");
 check(std::abs(silenceRows.words.back().baseline-silenceRows.words.front().baseline-3*(continuousRows.words.back().baseline-continuousRows.words.front().baseline))<1e-8,"Speech gap did not reserve two complete blank lines");
 const auto silencePage=macos::rasterize(silence,3.5,silenceBox,640,360,56,.6,4);
 const auto emptyTop=static_cast<std::size_t>(std::ceil(silenceRows.words.front().baseline+nativeMeasure("Before.",silence.style.spoken).descent)+2);
 const auto emptyBottom=static_cast<std::size_t>(std::floor(silenceRows.words.back().baseline-nativeMeasure("After.",silence.style.current).ascent)-2);
 check(emptyBottom>emptyTop+32,"Timed blank row has no physical empty pixel band");
 for(std::size_t y=emptyTop;y<emptyBottom;++y)for(std::size_t x=0;x<silencePage.width;++x)check(silencePage.pixels[y*silencePage.stride+x*4+3]==0,"Derived blank row painted pixels between speech lines");
 check(count(macos::rasterize(silence,.5,silenceBox,640,360))>100&&count(macos::rasterize(silence,3.5,silenceBox,640,360))>100,"Silence fixture lost surrounding speech");
 for(double time:{1.5,2.,2.5})check(count(macos::rasterize(silence,time,silenceBox,640,360))==0,"Static silence interval contains caption pixels");
 auto ordinarySilence=silence;ordinarySilence.containers.front().words={{"Before.",0,1,true},{" ",1,3,true},{"After.",3,4,true}};
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=1;settings.scrollDuration=.1;settings.boundaryEnabled=false;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;
  for(double time:{1.5,2.,2.5})check(macos::rasterize(silence,time,silenceBox,640,360,56,.6,1,settings).pixels==macos::rasterize(ordinarySilence,time,silenceBox,640,360,56,.6,1,settings).pixels,"Pause lines differ from ordinary empty-line transition pixels");
  check(count(macos::rasterize(silence,3.5,silenceBox,640,360,56,.6,1,settings))>100,"Scrolling speech failed to resume after a blank row");
 }
 check(encode(silence)==silenceBytes,"Timed silence rows changed saved source words");
 // Leading virtual blanks use the same entry pixels as the entry-edge Current
 // line (the bottom line for Up, Line 1 for Down), then
 // converge to the previous settled slot without changing the speech clock.
 Document opening;opening.containers.push_back({"opening-pixels",false,{{"First.",10,11,true},{"Next.",11,12,true},{"Third.",12,13,true},{"Last.",13,14,true}}});
 for(auto* style:{&opening.style.current,&opening.style.spoken,&opening.style.upcoming}){style->fontFamily="Arial";style->fontSize=20;style->padding=0;style->bubble=false;style->shadowColor.a=0;}
 opening.style.current.color={1,0,0,1};const auto openingBytes=encode(opening);const LayoutBox openingBox{10,10,220,240,1};
 for(const auto slots:std::vector<std::pair<std::size_t,std::size_t>>{{3,2},{5,3}})
 for(int direction:{1,2})for(int transition:{1,2,3,4})for(bool wait:{false,true}){
  RollUpSettings settings;settings.enabled=true;settings.visibleLines=slots.first;settings.currentLine=slots.second;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;settings.scrollDuration=.4;settings.boundaryEnabled=false;
  auto renderOpening=[&](double time,const RollUpSettings& s){return macos::rasterize(opening,time,openingBox,240,260,56,.6,1,s);};
  auto edge=settings;edge.currentLine=direction==1?slots.first:1;
  const auto entry=renderOpening(10,settings);
  check(count(entry)>20&&entry.pixels==renderOpening(10,edge).pixels,"Leading blanks did not start at the normal entry edge");
  const auto moving=renderOpening(10.1,settings);
  check(count(moving)>20&&moving.pixels!=entry.pixels,"Leading blanks did not animate visible speech");
  auto settled=settings;settled.scrollDuration=0;
  // In continuous mode the real first-row event also starts at 10. Compare
  // only after it completes; in wait mode the opening alone is done at 10.4.
  const double time=wait?10.5:11.5;
  check(renderOpening(time,settings).pixels==renderOpening(time,settled).pixels,"Opening changed settled current-line pixels");
  check(entry.pixels==renderOpening(10,settings).pixels,"Backward seek changed the opening pixels");
 }
 check(encode(opening)==openingBytes,"Leading blanks changed word timing or saved caption data");
 // Authored padding determines row height even with backgrounds disabled.
 // Toggling paint alone retains glyphs, blank-row advances and capacity.
 Document background; background.containers.push_back({"background-lines",false,{{"One.",0,1,true},{"Two.",1,2,true},{"After.",4,5,true},{"Four.",5,6,true},{"Six.",6,7,true}}});background.style.lineHeight=1.3;
 for(auto* style:{&background.style.current,&background.style.spoken,&background.style.upcoming}){style->fontFamily="Arial";style->fontSize=32;style->color={1,0,0,1};style->shadowColor.a=0;style->outlineWidth=0;style->paddingLeft=13;style->paddingRight=29;style->marginLeft=7;style->marginRight=11;style->paddingTop=55;style->paddingBottom=27;style->bubbleColor={0,0,1,1};style->radius=0;}
 auto paintedBackground=background;for(auto* style:{&paintedBackground.style.current,&paintedBackground.style.spoken,&paintedBackground.style.upcoming})style->bubble=true;
 const LayoutBox backgroundBox{20,20,580,1000,1};
 const auto compareBackground=[&](const LayoutBox& area,const RollUpSettings& settings){
  const auto textFrame=layoutFrame(background,4.5,area,nativeMeasure,56,.6,{},7,settings);
  const auto paintedFrame=layoutFrame(paintedBackground,4.5,area,nativeMeasure,56,.6,{},7,settings);
  check(textFrame.words.size()==paintedFrame.words.size()&&!textFrame.words.empty(),"Word background changed visible speech/history capacity");
  check(textFrame.viewport.y==paintedFrame.viewport.y&&textFrame.viewport.height==paintedFrame.viewport.height,"Word background changed scrolling viewport height");
  for(std::size_t index=0;index<textFrame.words.size();++index){const auto& text=textFrame.words[index];const auto& painted=paintedFrame.words[index];
   check(text.wordIndex==painted.wordIndex&&text.baseline==painted.baseline&&text.x==painted.x,"Word background moved glyphs or changed blank-row spacing");
   check(painted.height==text.height+82,"Asymmetric word background did not retain its independent paint height");}
  const auto textPixels=macos::rasterize(background,4.5,area,640,1100,56,.6,7,settings);
  const auto paintedPixels=macos::rasterize(paintedBackground,4.5,area,640,1100,56,.6,7,settings);
  std::size_t glyphInk=0,backgroundInk=0;
  for(std::size_t pixel=0;pixel<textPixels.pixels.size();pixel+=4){check(textPixels.pixels[pixel]==paintedPixels.pixels[pixel],"Word background changed actual red CoreText glyph positions or pixels");glyphInk+=textPixels.pixels[pixel]>0;backgroundInk+=paintedPixels.pixels[pixel+2]>0;}
  check(glyphInk>100&&backgroundInk>100&&count(paintedPixels)>count(textPixels),"Word background did not expand real paint independently of text");
 };
 compareBackground(backgroundBox,{});
 for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=3;settings.scrollDuration=0;settings.boundaryEnabled=false;settings.direction=direction;compareBackground(backgroundBox,settings);}
 auto unpaddedBackground=background;for(auto* style:{&unpaddedBackground.style.current,&unpaddedBackground.style.spoken,&unpaddedBackground.style.upcoming}){style->paddingTop=0;style->paddingBottom=0;}
 const auto paddedRows=layoutFrame(background,4.5,backgroundBox,nativeMeasure,56,.6,{},7);
 const auto unpaddedRows=layoutFrame(unpaddedBackground,4.5,backgroundBox,nativeMeasure,56,.6,{},7);
 check(paddedRows.words.size()==unpaddedRows.words.size()&&paddedRows.words.size()==5,"Padding edit unexpectedly regrouped source words");
 check(std::abs(paddedRows.words.front().baseline-unpaddedRows.words.front().baseline-55)<1e-8,"Disabled background padding did not reserve its top extent");
 const double paddedGap=paddedRows.words[2].baseline-paddedRows.words[0].baseline,unpaddedGap=unpaddedRows.words[2].baseline-unpaddedRows.words[0].baseline;
 check(std::abs(paddedGap-unpaddedGap-4*82*background.style.lineHeight)<1e-8,"Padding edit did not adjust speech and intervening blank-row advances with background off");
 const auto paddedGlyphs=macos::rasterize(background,4.5,backgroundBox,640,1100,56,.6,7),unpaddedGlyphs=macos::rasterize(unpaddedBackground,4.5,backgroundBox,640,1100,56,.6,7);
 check(paddedGlyphs.pixels!=unpaddedGlyphs.pixels&&visible(paddedGlyphs).bottom>visible(unpaddedGlyphs).bottom+300,"Padding edits did not adjust actual text-line spacing with background off");
 auto completeBubble=paintedBackground;completeBubble.containers.front().words={{"Full.",0,1,true}};completeBubble.style.current.color.a=0;
 const LayoutBox completeBox{20,20,580,400,1};const auto completePixels=macos::rasterize(completeBubble,.5,completeBox,640,460);const auto completeBounds=visible(completePixels);const auto completeMetrics=nativeMeasure("Full.",completeBubble.style.current);
 check(!completePixels.overflow&&completeBounds.top==20&&std::abs(double(completeBounds.bottom-completeBounds.top+1)-(completeMetrics.ascent+completeMetrics.descent+82))<2,"Padded word background was cropped above or below despite sufficient layout height");
 for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=8;settings.scrollDuration=0;settings.boundaryEnabled=false;settings.direction=direction;
  const LayoutBox compactBox{20,20,580,150,1};const auto text=layoutFrame(background,4.5,compactBox,nativeMeasure,56,.6,{},7,settings);const auto painted=layoutFrame(paintedBackground,4.5,compactBox,nativeMeasure,56,.6,{},7,settings);
  check(text.words.size()==painted.words.size()&&text.viewport.height==painted.viewport.height,"Large word-background padding reduced compact-box line capacity");
  for(std::size_t index=0;index<text.words.size();++index)check(text.words[index].wordIndex==painted.words[index].wordIndex&&text.words[index].baseline==painted.words[index].baseline,"Large word-background padding changed compact scrolling baselines");
 }
 // Rendering Next is independent of scrolling. A distinct green Next style
 // must reach actual CoreText pixels, while explicit zero opacity stays empty.
 Document nextWords;nextWords.containers.push_back({"next-pixels",false,{{"Now",0,1,false},{"Next.",1,2,true},{"Later",2,3,false},{"row.",3,4,true},{"Future",4,5,false},{"page.",5,6,true}}});
 for(auto* style:{&nextWords.style.current,&nextWords.style.spoken,&nextWords.style.upcoming}){style->fontFamily="Arial";style->fontSize=28;style->bubble=false;style->shadowColor.a=0;style->outlineWidth=0;}
 nextWords.style.current.color={1,0,0,1};nextWords.style.spoken.color={0,0,1,1};
 nextWords.style.upcoming.color={0,1,0,1};nextWords.style.upcoming.opacity=.65;nextWords.style.upcoming.fontSize=36;nextWords.style.upcoming.marginLeft=5;nextWords.style.upcoming.marginRight=7;
 auto greenPixels=[](const macos::Bitmap& pixels){std::size_t green=0;for(std::size_t i=0;i<pixels.pixels.size();i+=4)if(pixels.pixels[i+1]>10&&pixels.pixels[i]==0&&pixels.pixels[i+2]==0)++green;return green;};
 const auto nextBytes=encode(nextWords);
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true}){
  RollUpSettings settings;settings.enabled=true;settings.boundaryEnabled=false;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;
  const auto visibleNext=macos::rasterize(nextWords,.5,{20,20,580,300},640,360,56,.6,1,settings);
  check(greenPixels(visibleNext)>50,"Scrolling omitted the authored green Next text from real pixels");
  auto hidden=nextWords;hidden.style.upcoming.opacity=0;
  const auto hiddenNext=macos::rasterize(hidden,.5,{20,20,580,300},640,360,56,.6,1,settings);
  check(greenPixels(hiddenNext)==0&&visibleNext.pixels!=hiddenNext.pixels,"Scrolling ignored explicit Next zero opacity");
  check(encode(nextWords)==nextBytes,"Scrolling modified saved Next typography");
 }
 // Visible-line changes affect real CoreText pixels when enough physical
 // height is available, while a short box retains the authored glyph size.
 Document rollingCount;rollingCount.containers.push_back({"visible-lines",false,{}});
 for(int index=0;index<24;++index)rollingCount.containers[0].words.push_back({"Caption.",double(index),double(index+1),true});
 for(auto* style:{&rollingCount.style.current,&rollingCount.style.upcoming,&rollingCount.style.spoken})style->fontSize=60;
 const auto rollingCountBytes=encode(rollingCount);const LayoutBox countBox{20,20,580,900};
 RollUpSettings rollingSettings;rollingSettings.enabled=true;rollingSettings.boundaryEnabled=false;
 std::vector<macos::Bitmap> countPixels;
 for(std::size_t requested:{1,3,8}){
  rollingSettings.visibleLines=requested;const auto frame=layoutFrame(rollingCount,20.5,countBox,nativeMeasure,56,.6,{},1,rollingSettings);
  check(frame.words.size()==requested,"Visible-line count silently capped by caption height");
  auto pixels=macos::rasterize(rollingCount,20.5,countBox,640,940,56,.6,1,rollingSettings);
  std::size_t bands=0;bool previous=false;
  for(std::size_t y=0;y<pixels.height;++y){bool ink=false;for(std::size_t x=0;x<pixels.width;++x){const auto alpha=pixels.pixels[y*pixels.stride+x*4+3];if(alpha>8)ink=true;}if(ink&&!previous)++bands;previous=ink;}
  check(bands==requested,"CoreText pixels did not honor requested visible-line count");
  check(encode(rollingCount)==rollingCountBytes,"Rolling layout changed saved typography or document words");countPixels.push_back(std::move(pixels));
 }
 check(countPixels[0].pixels!=countPixels[1].pixels&&countPixels[1].pixels!=countPixels[2].pixels,"Visible-line changes produced identical tall-box pixels");
 const LayoutBox shortCountBox{20,20,580,100};std::vector<std::uint8_t> shortReference;
 for(std::size_t requested:{1,3,8}){rollingSettings.visibleLines=requested;
  const auto frame=layoutFrame(rollingCount,20.5,shortCountBox,nativeMeasure,56,.6,{},1,rollingSettings);
  check(frame.words.size()==1&&frame.words.front().style.fontSize==60,"Short scrolling box changed authored 60px font instead of limiting history");
  const auto pixels=macos::rasterize(rollingCount,20.5,shortCountBox,640,180,56,.6,1,rollingSettings);
  if(shortReference.empty())shortReference=pixels.pixels;else check(pixels.pixels==shortReference,"Visible-line limit silently resized actual glyph pixels in short box");
  check(encode(rollingCount)==rollingCountBytes,"Short scrolling box changed saved typography");
 }

 // Four independent physical edges mask the same sharp CoreText bitmap.
 // Moving/fading one edge must not resize captions, reflow rows or alter source.
 rollingSettings.visibleLines=3;rollingSettings.boundaryMode=0;rollingSettings.boundaryEnabled=false;
 const auto unmaskedEdges=macos::rasterize(rollingCount,20.5,countBox,640,940,56,.6,1,rollingSettings);
 const auto unmaskedFrame=layoutFrame(rollingCount,20.5,countBox,nativeMeasure,56,.6,{},1,rollingSettings);
 for(std::size_t side=0;side<4;++side){
  auto settings=rollingSettings;settings.boundaryMode=1;for(auto& edge:settings.edges)edge.fadeEnabled=false;
  auto& edge=settings.edges[side];edge.inset=side<2?.15:.45;edge.fadeEnabled=true;edge.thickness=.35;edge.amount=.8;edge.curve=2;
  const auto frame=layoutFrame(rollingCount,20.5,countBox,nativeMeasure,56,.6,{},1,settings);
  check(frame.viewport.x==unmaskedFrame.viewport.x&&frame.viewport.y==unmaskedFrame.viewport.y&&frame.viewport.width==unmaskedFrame.viewport.width&&frame.viewport.height==unmaskedFrame.viewport.height,"Boundary inset resized scrolling viewport");
  check(frame.words.size()==unmaskedFrame.words.size(),"Boundary inset changed requested line count");
  for(std::size_t word=0;word<frame.words.size();++word)check(frame.words[word].x==unmaskedFrame.words[word].x&&frame.words[word].baseline==unmaskedFrame.words[word].baseline&&frame.words[word].style.fontSize==unmaskedFrame.words[word].style.fontSize,"Boundary inset moved or resized caption text");
  const auto pixels=macos::rasterize(rollingCount,20.5,countBox,640,940,56,.6,1,settings);std::size_t feathered=0;
  for(std::size_t y=0;y<pixels.height;++y)for(std::size_t x=0;x<pixels.width;++x){const auto offset=y*pixels.stride+x*4;const double alpha=rollUpAlpha(x+.5,y+.5,frame);for(int channel=0;channel<4;++channel)check(pixels.pixels[offset+channel]==std::lround(unmaskedEdges.pixels[offset+channel]*alpha),"Independent edge did not multiply all premultiplied RGBA channels");if(unmaskedEdges.pixels[offset+3]>20&&pixels.pixels[offset+3]>0&&pixels.pixels[offset+3]<unmaskedEdges.pixels[offset+3])++feathered;}
  check(count(pixels)>0&&count(pixels)<count(unmaskedEdges)&&feathered>0,"Independent edge did not exercise both clipping and feathered real pixels");
  edge.fadeEnabled=false;const auto hardPixels=macos::rasterize(rollingCount,20.5,countBox,640,940,56,.6,1,settings);check(hardPixels.pixels!=pixels.pixels,"Per-edge fade toggle did not change rendered pixels");
  check(encode(rollingCount)==rollingCountBytes,"Independent fade changed saved caption data");
 }
 auto changedLegacyEdges=rollingSettings;for(auto& edge:changedLegacyEdges.edges){edge.inset=.9;edge.amount=.5;edge.curve=4;}
 check(macos::rasterize(rollingCount,20.5,countBox,640,940,56,.6,1,changedLegacyEdges).pixels==unmaskedEdges.pixels,"Legacy boundary mode did not retain exact prior pixels");
 auto conflictingEdges=rollingSettings;conflictingEdges.boundaryMode=1;conflictingEdges.edges[0].inset=.6;conflictingEdges.edges[1].inset=.5;
 check(count(macos::rasterize(rollingCount,20.5,countBox,640,940,56,.6,1,conflictingEdges))==0,"Conflicting independent insets leaked pixels");

 // Real CoreGraphics bounds use inline padding horizontally and block
 // padding vertically, with legacy uniform padding as an independent fallback.
 Document axisPixels;axisPixels.containers.push_back({"axis-pixels",false,{{"MM",0,2,false}}});axisPixels.style.current.fontSize=32;axisPixels.style.current.bubble=true;axisPixels.style.current.color.a=0;axisPixels.style.current.shadowColor.a=0;axisPixels.style.current.bubbleColor={1,0,0,1};axisPixels.style.current.radius=0;
 const LayoutBox axisBox{10,10,400,250,1};const auto legacyPixelBounds=visible(macos::rasterize(axisPixels,.5,axisBox,640,360));
 axisPixels.style.current.bubblePaddingInline=20;axisPixels.style.current.bubblePaddingBlock=3;
 const auto axesBitmap=macos::rasterize(axisPixels,.5,axisBox,640,360);const auto axesBounds=visible(axesBitmap);
 check(axesBounds.right-axesBounds.left>=legacyPixelBounds.right-legacyPixelBounds.left+23,"Native inline padding did not widen the actual bubble pixels");
 check(axesBounds.bottom-axesBounds.top<=legacyPixelBounds.bottom-legacyPixelBounds.top-9,"Native block padding did not tighten actual bubble pixels independently");
 const auto axesFrame=layoutFrame(axisPixels,.5,axisBox,nativeMeasure);axisPixels.style.current.bubblePaddingBlock=30;
 const auto tallerBitmap=macos::rasterize(axisPixels,.5,axisBox,640,360);const auto tallerBounds=visible(tallerBitmap);const auto tallerFrame=layoutFrame(axisPixels,.5,axisBox,nativeMeasure);
 check(tallerBounds.right-tallerBounds.left==axesBounds.right-axesBounds.left&&tallerBounds.bottom-tallerBounds.top>axesBounds.bottom-axesBounds.top+50,"Block padding changed width or did not grow complete vertical pixels");
 check(tallerFrame.words[0].width==axesFrame.words[0].width&&tallerFrame.words[0].height==axesFrame.words[0].height+54&&tallerFrame.words[0].baseline==axesFrame.words[0].baseline+27,"Native block padding did not adjust row geometry independently of inline dimension");
 // CoreText renders a real underline without altering glyph layout. Explicit
 // off matches an old unset style exactly; it is not a formatting-only flag.
 Document underlineDoc;underlineDoc.containers.push_back({"underline",false,{{"HHHH",0,2,false}}});underlineDoc.style.current.fontSize=48;underlineDoc.style.current.color={1,0,0,1};
 const LayoutBox underlineBox{20,20,500,200,1};const auto withoutUnderline=macos::rasterize(underlineDoc,.5,underlineBox,640,300);const auto underlineBefore=layoutFrame(underlineDoc,.5,underlineBox,nativeMeasure);
 underlineDoc.style.current.underline=1;const auto withUnderline=macos::rasterize(underlineDoc,.5,underlineBox,640,300);const auto underlineAfter=layoutFrame(underlineDoc,.5,underlineBox,nativeMeasure);
 check(underlineBefore.words[0].x==underlineAfter.words[0].x&&underlineBefore.words[0].width==underlineAfter.words[0].width&&underlineBefore.words[0].baseline==underlineAfter.words[0].baseline,"Underline changed native glyph layout");
 std::size_t addedUnderline=0;for(std::size_t pixel=0;pixel<withUnderline.pixels.size();pixel+=4)if(withUnderline.pixels[pixel+3]>0&&withoutUnderline.pixels[pixel+3]==0)addedUnderline++;
 check(addedUnderline>50&&count(withUnderline)>count(withoutUnderline),"CoreText did not render actual underline pixels");
 underlineDoc.style.current.underline=0;check(macos::rasterize(underlineDoc,.5,underlineBox,640,300).pixels==withoutUnderline.pixels,"Explicit underline off did not preserve legacy pixels");
 Document pages;pages.containers.push_back({"pages",false,{{"First.",0,1,true},{"Second.",1,2,true},{"Third.",2,3,true},{"Last.",3,4,true}}});
 for(auto* s:{&pages.style.current,&pages.style.upcoming,&pages.style.spoken})s->fontSize=32;
 const auto unchangedPages=encode(pages);
 const auto oneGroup=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,1);
 const auto threeGroups=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,3);
 check(count(threeGroups)>count(oneGroup)&&visible(threeGroups).bottom>visible(oneGroup).bottom+32,"Rasterizer did not render three caption groups on separate lines");
 check(macos::rasterize(pages,1.5,{20,10,500,33},640,240,56,.6,3).overflow,"Multiple caption groups did not report independent height overflow");
 check(macos::rasterize(pages,3.5,{20,10,500,200},640,240,56,.6,3).pixels==macos::rasterize(pages,3.5,{20,10,500,200},640,240,56,.6,1).pixels,"Last partial page did not reset to the top of the caption box");
 check(encode(pages)==unchangedPages,"Page grouping changed persisted transcript or styles");
 RollUpSettings roll;roll.enabled=true;roll.boundaryEnabled=false;
 const auto rollingPixels=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,1,roll);
 check(count(rollingPixels)>0,"Native roll-up produced no pixels");
 roll.boundaryEnabled=true;const auto maskedPixels=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,1,roll);
 bool faded=false;for(std::size_t index=0;index<rollingPixels.pixels.size();++index){check(maskedPixels.pixels[index]<=rollingPixels.pixels[index],"Roll-up fade blurred or added pixels instead of masking existing sharp pixels");if(maskedPixels.pixels[index]<rollingPixels.pixels[index])faded=true;}
 check(faded,"Soft roll-up boundary did not attenuate pixels");
 for(std::size_t index=0;index<maskedPixels.pixels.size();index+=4)for(std::size_t channel=0;channel<3;++channel)check(maskedPixels.pixels[index+channel]<=maskedPixels.pixels[index+3],"Roll-up fade lost premultiplied alpha");
 roll.boundaryEnabled=false;const auto atHalf=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,1,roll);
 check(atHalf.pixels==rollingPixels.pixels,"Backward scrubbing changed native rolling pixels");
 for(int direction:{1,2,3,4}){roll.direction=direction;const auto moved=macos::rasterize(pages,2.09,{20,10,500,200},640,240,56,.6,1,roll);check(count(moved)>0,"A roll-up direction produced an empty transition");}
 roll.direction=1;const auto scrollPixels=macos::rasterize(pages,1.09,{20,10,500,200},640,240,56,.6,1,roll);
 for(int transition:{2,3,4}){
  roll.transition=transition;const auto creative=macos::rasterize(pages,1.09,{20,10,500,200},640,240,56,.6,1,roll);
  check(count(creative)>0&&creative.pixels!=scrollPixels.pixels,"A creative line transition did not change rendered caption pixels");
  check(creative.pixels==macos::rasterize(pages,1.09,{20,10,500,200},640,240,56,.6,1,roll).pixels,"Creative transition depended on previous frame state");
 }
 auto readablePages=pages;readablePages.style.current.color={0,1,0,1};roll.transition=2;
 const auto readableFade=macos::rasterize(readablePages,1.09,{20,10,500,200},640,240,56,.6,1,roll);std::size_t opaqueCurrentPixels=0;
 for(std::size_t index=0;index<readableFade.pixels.size();index+=4)if(readableFade.pixels[index+1]>200&&readableFade.pixels[index]<30&&readableFade.pixels[index+3]>200)++opaqueCurrentPixels;
 check(opaqueCurrentPixels>20,"Fade hid the currently spoken word behind translucent duplicated history");
 auto m=macos::measureText("Caption",d.style.current);check(m.width>0&&m.ascent>0,"Missing actual font metrics");
 bool failed=false;try{macos::rasterize(d,.5,box,100000,1);}catch(const std::invalid_argument&){failed=true;}check(failed,"Unbounded bitmap accepted");
 failed=false;try{macos::measureText(std::string("\xff"),d.style.current);}catch(const std::invalid_argument&){failed=true;}check(failed,"Malformed UTF-8 accepted");
 // Asymmetric top and bottom boxes have no shared permitted row interval.
 // This detects a vertical flip that a centered/overlapping clip test can miss.
 Document single;single.containers.push_back({"orientation",false,{{"ROW",0,1,false}}});
 for(auto* s:{&single.style.current,&single.style.upcoming,&single.style.spoken})s->fontSize=32;
 auto topImage=macos::rasterize(single,.5,{11,7,250,55},320,240);auto topBounds=visible(topImage);
 check(topImage.pixels==macos::rasterize(single,.5,{11,7,250,55,2},320,240).pixels,"Explicit native center alignment changed the existing default pixels");
 const auto alignLeft=macos::rasterize(single,.5,{11,7,250,55,1},320,240),alignRight=macos::rasterize(single,.5,{11,7,250,55,3},320,240);
 check(visible(alignLeft).left<topBounds.left&&visible(alignRight).left>topBounds.left,"Native left/right alignment did not shift actual glyph pixels within the same box");
 check(count(topImage)>0&&topBounds.top>=7&&topBounds.bottom<62,"Top-row order/clip orientation incorrect");
 auto bottomImage=macos::rasterize(single,.5,{11,177,250,55},320,240);auto bottomBounds=visible(bottomImage);
 check(count(bottomImage)>0&&bottomBounds.top>=177&&bottomBounds.bottom<232,"Bottom-row order/clip orientation incorrect");
 check(topBounds.bottom<bottomBounds.top,"Asymmetric orientation test regions overlap");
 // Native adapter's new-effect defaults: Position center(50%,90%), Height150.
 // Existing authored point/height values retain their original interpretation.
 for(std::size_t frameHeight:{720u,1080u,2160u}){
  single.style.current.fontSize=64;
  LayoutBox lower{1920*.5-1536*.5,frameHeight*.9-75,1536,150};
  auto lowerImage=macos::rasterize(single,.5,lower,1920,frameHeight);auto bounds=visible(lowerImage);
  check(count(lowerImage)>0,"Default lower caption is empty");
  check(bounds.top>=frameHeight*.79&&bounds.bottom<=frameHeight*.94,"Default caption is not towards bottom of video");
 }
 // Only the sequence bitmap limits offscreen paint; placement-box edges do not.
 single.style.current.fontSize=32;
 auto partial=macos::rasterize(single,.5,{-60,-8,180,55},320,240);auto partialBounds=visible(partial);
 check(count(partial)>0&&partialBounds.left<partialBounds.right,"Partially offscreen placement lost visible text");
 auto offscreen=macos::rasterize(single,.5,{-500,-500,100,50},320,240);check(count(offscreen)==0,"Fully offscreen box leaked pixels");
 // The rasterizer consumes pixels, not host downsample metadata. Uniformly scaled
 // geometry and every pixel-sized style preserve normalized text placement.
 Document scaled=single;single.style.current.bubble=true;single.style.current.padding=8;single.style.current.radius=6;
 scaled=single;for(auto* st:{&scaled.style.current,&scaled.style.upcoming,&scaled.style.spoken}){st->fontSize*=.5;st->padding*=.5;st->radius*=.5;st->outlineWidth*=.5;st->shadowBlur*=.5;st->shadowX*=.5;st->shadowY*=.5;}scaled.style.wordSpacing*=.5;
 auto fullRes=macos::rasterize(single,.5,{20,100,500,100},640,240);auto halfRes=macos::rasterize(scaled,.5,{10,50,250,50},320,120);
 auto fullBounds=visible(fullRes),halfBounds=visible(halfRes);check(count(fullRes)>0&&count(halfRes)>0,"Downsample fixture empty");
 check(std::abs(double(fullBounds.left)-2*halfBounds.left)<=3&&std::abs(double(fullBounds.top)-2*halfBounds.top)<=3&&std::abs(double(fullBounds.bottom)-2*halfBounds.bottom)<=3,"Scaled pixel geometry shifted normalized placement");
 failed=false;try{auto invalid=d.style.current;invalid.fontSize=std::numeric_limits<double>::infinity();macos::measureText("Caption",invalid);}catch(const std::invalid_argument&){failed=true;}check(failed,"Direct font metrics accepted infinite size");
 failed=false;try{macos::measureText("bad\ntext",d.style.current);}catch(const std::invalid_argument&){failed=true;}check(failed,"Direct font metrics accepted control text");
 // Family weight selection uses actual installed faces, not requested labels.
 WordStyle upright;upright.fontFamily="Arial";upright.fontSize=52;upright.fontWeight=400;upright.italic=0;
 const auto regular=macos::fontSelection(upright);check(regular.family=="Arial"&&regular.weight==400,"Arial regular face not selected");
 auto bold=upright;bold.fontWeight=700;const auto heavier=macos::fontSelection(bold);
 check(heavier.weight==700&&heavier.postscriptName!=regular.postscriptName,"Actual bold face not selected");
 auto relative=upright;relative.fontWeightOffset=100;const auto next=macos::fontSelection(relative,400);
 check(next.weight==700,"B did not choose Arial's next available heavier face");
 relative.fontWeightOffset=0;check(macos::fontSelection(relative,400).weight==400,"Relative B off did not follow shared base");
 // During a slot transition, relative +100 resolves to Arial Bold (700)
 // before blending, exactly like an explicitly authored 700 endpoint.
 Document weightedScroll;weightedScroll.style.baseFontWeight=400;
 weightedScroll.containers.push_back({"weight-scroll",false,{}});
 for(int index=0;index<6;++index)weightedScroll.containers[0].words.push_back({"Caption",double(index),index+.8,true});
 for(auto* s:{&weightedScroll.style.upcoming,&weightedScroll.style.current,&weightedScroll.style.spoken}){*s=upright;s->fontSize=24;s->fontWeightOffset=0;s->padding=0;}
 auto& topWeight=weightedScroll.style.positions[0];topWeight.fields=PositionWeight;topWeight.value=upright;topWeight.value.fontWeightOffset=100;
 auto absoluteScroll=weightedScroll;absoluteScroll.style.positions[0].value=bold;
 auto plainScroll=weightedScroll;plainScroll.style.positions[0]=PositionStyle{};
 RollUpSettings weightScroll;weightScroll.enabled=true;weightScroll.visibleLines=4;weightScroll.boundaryEnabled=false;
 const LayoutBox weightBox{20,20,500,220};
 const auto relativePixels=macos::rasterize(weightedScroll,4.935,weightBox,640,280,56,.6,1,weightScroll);
 const auto absolutePixels=macos::rasterize(absoluteScroll,4.935,weightBox,640,280,56,.6,1,weightScroll);
 check(relativePixels.pixels==absolutePixels.pixels,"Relative weight blend did not use the same supported-weight resolution as rasterization");
 check(relativePixels.pixels!=macos::rasterize(plainScroll,4.935,weightBox,640,280,56,.6,1,weightScroll).pixels,"Weight blend fixture did not reach the heavier face");
 auto naturalItalic=upright;naturalItalic.italic=1;const auto italicFace=macos::fontSelection(naturalItalic);
 check(italicFace.nativeItalic&&!italicFace.syntheticItalic,"Available real italic face was not preferred");
 auto legacyFace=upright;legacyFace.fontFamily="Arial-BoldItalicMT";legacyFace.fontWeight=0;legacyFace.italic=-1;
 const auto legacySelection=macos::fontSelection(legacyFace);
 check(legacySelection.postscriptName=="Arial-BoldItalicMT"&&legacySelection.nativeItalic,"Legacy named face changed without a typography edit");
 Document fontDocument; fontDocument.containers.push_back({"font",false,{{"Caption",0,1,false}}});
 fontDocument.style.current=upright;const auto regularPixels=macos::rasterize(fontDocument,.5,{20,20,500,120},640,180);
 fontDocument.style.current=bold;check(regularPixels.pixels!=macos::rasterize(fontDocument,.5,{20,20,500,120},640,180).pixels,"Weight selection did not change rendered glyphs");
 // Outline is a lower layer: an unchanged clean fill must cover its inner
 // half, preserving the solid interior/weight of the unoutlined glyphs.
 Document outlined;outlined.containers.push_back({"outline",false,{{"Thin aim",0,1,false}}});
 for(auto* style:{&outlined.style.current,&outlined.style.upcoming,&outlined.style.spoken}){*style=upright;style->color={1,1,1,1};style->outlineColor={0,0,0,1};}
 const auto clean=macos::rasterize(outlined,.5,{20,20,500,120},640,180);
 outlined.style.current.outlineWidth=8;
 const auto edged=macos::rasterize(outlined,.5,{20,20,500,120},640,180);
 std::size_t interior=0,outlinePixels=0;
 for(std::size_t i=0;i<clean.pixels.size();i+=4){
  if(clean.pixels[i+3]==255&&clean.pixels[i]>=252){++interior;check(edged.pixels[i]>=250&&edged.pixels[i+1]>=250&&edged.pixels[i+2]>=250,"Outline painted over the clean glyph fill and reduced font weight");}
  if(edged.pixels[i+3]>200&&edged.pixels[i]<10)++outlinePixels;
 }
 check(interior>100&&outlinePixels>100,"Outline layering acceptance did not exercise both layers");
 const auto cleanMetrics=macos::measureText("Thin aim",upright),outlineMetrics=macos::measureText("Thin aim",outlined.style.current);
 check(cleanMetrics.width==outlineMetrics.width&&cleanMetrics.ascent==outlineMetrics.ascent&&cleanMetrics.descent==outlineMetrics.descent,"Outline changed glyph layout metrics");
 // A shared shadow follows the combined outline/fill, and hidden outlines
 // keep the exact no-outline pixels. Neither pass may leak at zero opacity.
 outlined.style.current.shadowBlur=4;outlined.style.current.shadowX=3;outlined.style.current.shadowColor={0,0,0,.5};
 const auto shadowed=macos::rasterize(outlined,.5,{20,20,500,120},640,180);
 for(std::size_t i=0;i<clean.pixels.size();i+=4)if(clean.pixels[i+3]==255&&clean.pixels[i]>=252)check(shadowed.pixels[i]>=250,"Shadowed outline covered clean fill");
 outlined.style.current.opacity=0;check(count(macos::rasterize(outlined,.5,{20,20,500,120},640,180))==0,"Layered outline leaked at zero opacity");
 outlined.style.current.opacity=1;outlined.style.current.shadowBlur=outlined.style.current.shadowX=0;outlined.style.current.outlineColor.a=0;
 check(macos::rasterize(outlined,.5,{20,20,500,120},640,180).pixels==clean.pixels,"Invisible outline changed clean text");
 // macOS uses Unicode conversion before measurement/drawing, without changing
 // source text or phrase boundaries (including length-expanding upper case).
 Document cased;const std::string sourceCase="Straße café";cased.containers.push_back({"case",false,{{sourceCase,0,1,false}}});
 for(int mode:{1,2}){cased.style.letterCase=mode;auto expected=cased;expected.style.letterCase=0;expected.containers[0].words[0].text=mode==1?"STRASSE CAFÉ":"straße café";check(macos::rasterize(cased,.5,{20,20,500,120},640,180).pixels==macos::rasterize(expected,.5,{20,20,500,120},640,180).pixels,"Native Unicode display case differs from clean transformed text");check(cased.containers[0].words[0].text==sourceCase,"Display case modified the source transcript");}
 // Exercise a real installed regular-only family. Synthetic italic must draw
 // slanted glyphs and account for their horizontal ink when measuring/reflowing.
 bool syntheticTested=false;
 for(const char* family:{"Impact","Arial Black","Papyrus","Marker Felt","DIN Alternate","Apple Chancery"}){
  auto plain=upright;plain.fontFamily=family;const auto plainSelection=macos::fontSelection(plain);
  if(plainSelection.family!=family)continue;
  auto slanted=plain;slanted.italic=1;const auto slantSelection=macos::fontSelection(slanted);
  if(!slantSelection.syntheticItalic)continue;
  check(!slantSelection.nativeItalic,"Synthetic italic falsely reported a native italic face");
  fontDocument.containers[0].words[0].text="ffff AWA";fontDocument.style.current=plain;
  const auto plainPixels=macos::rasterize(fontDocument,.5,{20,20,500,120},640,180);
  fontDocument.style.current=slanted;const auto slantPixels=macos::rasterize(fontDocument,.5,{20,20,500,120},640,180);
  check(plainPixels.pixels!=slantPixels.pixels&&count(slantPixels)>0,"Synthetic italic did not change real glyph pixels");
  const auto measured=macos::measureText("ffff AWA",slanted);const auto bounds=visible(slantPixels);
  check(double(bounds.right-bounds.left)<=std::ceil(measured.width)+2,"Synthetic italic ink escaped measured width");
  check(bounds.left>=20&&bounds.top>=20,"Synthetic italic placement origin shifted");
  syntheticTested=true;std::cout<<"Synthetic italic acceptance: "<<family<<"\n";break;
 }
 check(syntheticTested,"No installed regular-only family exercised the synthetic italic path");
 // If this Mac has a variable wght family, verify a fractional coordinate on
 // its real range. The selector verifies the returned CTFont variation too.
 bool variableTested=false;auto families=CTFontManagerCopyAvailableFontFamilyNames();
 for(CFIndex i=0;families&&i<CFArrayGetCount(families)&&!variableTested;++i){
  auto name=static_cast<CFStringRef>(CFArrayGetValueAtIndex(families,i));auto candidate=CTFontCreateWithName(name,52,nullptr);
  auto axes=CTFontCopyVariationAxes(candidate);double low=0,high=0;
  for(CFIndex j=0;axes&&j<CFArrayGetCount(axes);++j){auto axis=static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(axes,j));int tag=0;
   if(!CFNumberGetValue(static_cast<CFNumberRef>(CFDictionaryGetValue(axis,kCTFontVariationAxisIdentifierKey)),kCFNumberIntType,&tag)||tag!=0x77676874)continue;
   CFNumberGetValue(static_cast<CFNumberRef>(CFDictionaryGetValue(axis,kCTFontVariationAxisMinimumValueKey)),kCFNumberDoubleType,&low);
   CFNumberGetValue(static_cast<CFNumberRef>(CFDictionaryGetValue(axis,kCTFontVariationAxisMaximumValueKey)),kCFNumberDoubleType,&high);
  }
  if(axes)CFRelease(axes);CFRelease(candidate);if(low<1||high>1000||low>=high)continue;
  char utf8[1024];if(!CFStringGetCString(name,utf8,sizeof utf8,kCFStringEncodingUTF8))continue;
  auto variable=upright;variable.fontFamily=utf8;variable.fontWeight=low+(high-low)*.371;
  const auto selection=macos::fontSelection(variable);check(std::abs(selection.weight-variable.fontWeight)<.01,"Fractional variable font weight was not applied");
  fontDocument.style.current=variable;check(count(macos::rasterize(fontDocument,.5,{20,20,500,120},640,180))>0,"Variable font rendered no glyphs");
  variableTested=true;std::cout<<"Variable weight acceptance: "<<utf8<<" "<<selection.weight<<"\n";
 }
 if(families)CFRelease(families);if(!variableTested)std::cout<<"Variable wght acceptance skipped: no installed weight axis\n";
 for(auto* s:{&d.style.current,&d.style.upcoming,&d.style.spoken})s->opacity=0;
 check(count(macos::rasterize(d,.5,box,640,240))==0,"Zero opacity leaked pixels");
 std::cout<<"CoreText rasterizer acceptance passed\n";
}
