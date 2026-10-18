#include "caption_rasterizer.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <limits>
using namespace better_captions;
void check(bool b,const char* s){if(!b)throw std::runtime_error(s);}
struct Bounds {std::size_t left,top,right,bottom;};
Bounds visible(const macos::Bitmap& b){Bounds r{b.width,b.height,0,0};for(std::size_t y=0;y<b.height;++y)for(std::size_t x=0;x<b.width;++x)if(b.pixels[y*b.stride+x*4+3]){r.left=std::min(r.left,x);r.right=std::max(r.right,x);r.top=std::min(r.top,y);r.bottom=std::max(r.bottom,y);}return r;}
std::size_t count(const macos::Bitmap& b){std::size_t n=0;for(std::size_t i=3;i<b.pixels.size();i+=4)if(b.pixels[i])++n;return n;}
int main(){
 Document d;d.containers.push_back({"scratch",false,{{"Caption",0,1,false},{"reflow",1,2,false},{"works",2,3,false}}});
 for(auto* s:{&d.style.current,&d.style.upcoming,&d.style.spoken})s->fontSize=32;
 d.style.current.color={1,0,0,1};d.style.current.bubble=true;d.style.current.bubbleColor={0,0,1,1};
 LayoutBox box{20,10,500,160};auto b=macos::rasterize(d,.5,box,640,240);check(count(b)>500,"No text/bubble rasterized");
 for(std::size_t y=0;y<b.height;++y)for(std::size_t x=0;x<b.width;++x)if(x<20||x>=520||y<10||y>=170)check(b.pixels[y*b.stride+x*4+3]==0,"Raster escaped layout clip or rows inverted");
 check(b.pixels==macos::rasterize(d,.5,box,640,240).pixels,"Render is nondeterministic");
 check(count(macos::rasterize(d,3,box,640,240))==0,"Caption leaked past half-open interval");
 auto narrow=macos::rasterize(d,.5,{20,10,150,160},640,240);check(narrow.pixels!=b.pixels,"Width did not reflow glyphs");
 auto shortBox=macos::rasterize(d,.5,{20,10,150,10},640,240);check(shortBox.overflow,"Independent height overflow missing");
 auto m=macos::measureText("Caption",d.style.current);check(m.width>0&&m.ascent>0,"Missing actual font metrics");
 bool failed=false;try{macos::rasterize(d,.5,box,100000,1);}catch(const std::invalid_argument&){failed=true;}check(failed,"Unbounded bitmap accepted");
 failed=false;try{macos::measureText(std::string("\xff"),d.style.current);}catch(const std::invalid_argument&){failed=true;}check(failed,"Malformed UTF-8 accepted");
 // Asymmetric top and bottom boxes have no shared permitted row interval.
 // This detects a vertical flip that a centered/overlapping clip test can miss.
 Document single;single.containers.push_back({"orientation",false,{{"ROW",0,1,false}}});
 for(auto* s:{&single.style.current,&single.style.upcoming,&single.style.spoken})s->fontSize=32;
 auto topImage=macos::rasterize(single,.5,{11,7,250,55},320,240);auto topBounds=visible(topImage);
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
 // Negative/cropped text areas remain clipped to the actual bitmap, without wrapping rows.
 single.style.current.fontSize=32;
 auto partial=macos::rasterize(single,.5,{-60,-8,180,55},320,240);auto partialBounds=visible(partial);
 check(count(partial)>0&&partialBounds.right<120&&partialBounds.bottom<47,"Partially offscreen crop escaped geometry");
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
 for(auto* s:{&d.style.current,&d.style.upcoming,&d.style.spoken})s->opacity=0;
 check(count(macos::rasterize(d,.5,box,640,240))==0,"Zero opacity leaked pixels");
 std::cout<<"CoreText rasterizer acceptance passed\n";
}
