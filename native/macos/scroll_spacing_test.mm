#include "caption_rasterizer.hpp"
#include <cmath>
#include <fstream>
#include <iostream>
#include <stdexcept>
using namespace better_captions;
static void check(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
int main(int argc,char** argv){
 const auto measure=[](const std::string& text,const WordStyle& style){return macos::measureText(text,style);};
 std::ofstream baseline;if(argc==3&&std::string(argv[1])=="--static-output")baseline.open(argv[2],std::ios::binary);
 for(int alignment:{1,2,3})for(double wordSpacing:{0.,12.,30.})for(double lineHeight:{.6,1.3,2.}){
  Document document;document.containers.push_back({"spacing",false,{{"Older",0,1,false},{"words.",1,2,true},{"Current",2,3,false},{"row.",3,4,true},{"Next",4,5,false},{"line.",5,6,true}}});
  document.style.wordSpacing=wordSpacing;document.style.lineHeight=lineHeight;
  auto& spoken=document.style.spoken;spoken.fontFamily="Arial";spoken.fontSize=32;spoken.marginLeft=2;spoken.marginRight=4;spoken.marginTop=1;spoken.marginBottom=3;
  auto& current=document.style.current;current.fontFamily="Arial";current.fontSize=44;current.bubble=true;current.paddingLeft=17;current.paddingRight=5;current.paddingTop=8;current.paddingBottom=4;current.marginLeft=7;current.marginRight=3;current.marginTop=5;current.marginBottom=2;
  auto& upcoming=document.style.upcoming;upcoming.fontFamily="Arial";upcoming.fontSize=28;upcoming.bubble=true;upcoming.paddingLeft=23;upcoming.paddingRight=11;upcoming.marginLeft=-2;upcoming.marginRight=6;upcoming.opacity=0;
  const auto bytes=encode(document);LayoutBox box{30,30,640,1000,alignment};
  const auto normal=layoutFrame(document,2.4,box,measure,56,.6,{},3);
  auto normalPixels=macos::rasterize(document,2.4,box,720,1400,56,.6,3);
  if(baseline.is_open()){baseline.write(reinterpret_cast<const char*>(normalPixels.pixels.data()),normalPixels.pixels.size());continue;}
  RollUpSettings scrolling;scrolling.enabled=true;scrolling.visibleLines=3;scrolling.currentLine=3;scrolling.scrollDuration=0;scrolling.boundaryEnabled=false;
  const auto rolling=layoutFrame(document,2.4,box,measure,56,.6,{},3,scrolling);
  check(rolling.words.size()==4&&rolling.words.back().state==WordState::Upcoming&&rolling.words.back().style.opacity==0,"Scrolling did not retain the complete current row with authored hidden Next styling");
  double translate=0;bool first=true;
  for(const auto& actual:rolling.words){
   const DrawWord* expected=nullptr;for(const auto& candidate:normal.words)if(candidate.wordIndex==actual.wordIndex)expected=&candidate;
   check(expected,"Scrolling invented a word");
   if(first){translate=actual.baseline-expected->baseline;first=false;}
   check(std::abs(actual.x-expected->x)<1e-8,"Scrolling changed horizontal word spacing or alignment");
   check(std::abs(actual.baseline-expected->baseline-translate)<1e-8,"Scrolling changed authored inter-row spacing");
   check(actual.width==expected->width&&actual.height==expected->height,"Scrolling changed word geometry");
  }
  box.y+=translate;
  const auto translated=macos::rasterize(document,2.4,box,720,1400,56,.6,3);
  const auto moving=macos::rasterize(document,2.4,{30,30,640,1000,alignment},720,1400,56,.6,3,scrolling);
  // Compare complete overflowing paint for retained rows. Hidden future rows
  // have zero opacity, so a placement rectangle must not mask any pixels.
  bool equal=true;std::size_t ink=0;
  for(std::size_t y=0;y<moving.height;++y)for(std::size_t x=0;x<moving.width;++x){
   const auto at=y*moving.stride+x*4;ink+=moving.pixels[at+3]>0;
   for(int channel=0;channel<4;++channel)if(translated.pixels[at+channel]!=moving.pixels[at+channel])equal=false;
  }
  if(!equal)std::cerr<<"Pixel parity case alignment="<<alignment<<" words="<<wordSpacing<<" lines="<<lineHeight<<" translation="<<translate<<"\n";
  check(ink>100&&equal,"Scrolling changed real CoreText pixels after the intended block translation");
  check(encode(document)==bytes,"Scrolling changed authored style data");
 }
 std::cout<<(baseline.is_open()?"Static CoreText baseline emitted\n":"Scrolling spacing: shared word/row geometry and visible CoreText pixel parity passed\n");
}
