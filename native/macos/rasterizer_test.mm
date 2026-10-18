#include "caption_rasterizer.hpp"
#include <algorithm>
#include <iostream>
#include <stdexcept>
using namespace better_captions;
void check(bool b,const char* s){if(!b)throw std::runtime_error(s);}
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
 for(auto* s:{&d.style.current,&d.style.upcoming,&d.style.spoken})s->opacity=0;
 check(count(macos::rasterize(d,.5,box,640,240))==0,"Zero opacity leaked pixels");
 std::cout<<"CoreText rasterizer acceptance passed\n";
}
