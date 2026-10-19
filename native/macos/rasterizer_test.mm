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
 Document d;d.containers.push_back({"scratch",false,{{"Caption",0,1,false},{"reflow",1,2,false},{"works",2,3,false}}});
 for(auto* s:{&d.style.current,&d.style.upcoming,&d.style.spoken})s->fontSize=32;
 d.style.current.color={1,0,0,1};d.style.current.bubble=true;d.style.current.bubbleColor={0,0,1,1};
 LayoutBox box{20,10,500,160};auto b=macos::rasterize(d,.5,box,640,240);check(count(b)>500,"No text/bubble rasterized");
 for(std::size_t y=0;y<b.height;++y)for(std::size_t x=0;x<b.width;++x)if(x<20||x>=520||y<10||y>=170)check(b.pixels[y*b.stride+x*4+3]==0,"Raster escaped layout clip or rows inverted");
 check(b.pixels==macos::rasterize(d,.5,box,640,240).pixels,"Render is nondeterministic");
 check(count(macos::rasterize(d,3,box,640,240))==0,"Caption leaked past half-open interval");
 auto narrow=macos::rasterize(d,.5,{20,10,150,160},640,240);check(narrow.pixels!=b.pixels,"Width did not reflow glyphs");
 auto shortBox=macos::rasterize(d,.5,{20,10,150,10},640,240);check(shortBox.overflow,"Independent height overflow missing");
 Document pages;pages.containers.push_back({"pages",false,{{"First.",0,1,true},{"Second.",1,2,true},{"Third.",2,3,true},{"Last.",3,4,true}}});
 for(auto* s:{&pages.style.current,&pages.style.upcoming,&pages.style.spoken})s->fontSize=32;
 const auto unchangedPages=encode(pages);
 const auto oneGroup=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,1);
 const auto threeGroups=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,3);
 check(count(threeGroups)>count(oneGroup)&&visible(threeGroups).bottom>visible(oneGroup).bottom+32,"Rasterizer did not render three caption groups on separate lines");
 check(macos::rasterize(pages,1.5,{20,10,500,33},640,240,56,.6,3).overflow,"Multiple caption groups did not report independent height overflow");
 check(macos::rasterize(pages,3.5,{20,10,500,200},640,240,56,.6,3).pixels==macos::rasterize(pages,3.5,{20,10,500,200},640,240,56,.6,1).pixels,"Last partial page did not reset to the top of the caption box");
 check(encode(pages)==unchangedPages,"Page grouping changed persisted transcript or styles");
 Document smart;smart.style.wordSpacing=4;smart.containers.push_back({"smart-fit",false,{{"iii",0,.3,false},{"iii",.4,.7,false},{"iii",.8,1.1,false},{"iii",1.2,1.5,false}}});
 for(auto* s:{&smart.style.current,&smart.style.upcoming,&smart.style.spoken})s->fontSize=32;
 const auto realMetrics=[](const std::string& text,const WordStyle& style){return macos::measureText(text,style);};
 const auto skinnyGroups=regroupToWidth(smart,150,realMetrics);auto wide=smart;for(auto& word:wide.containers[0].words)word.text="WWW";
 check(regroupToWidth(wide,150,realMetrics).size()>skinnyGroups.size(),"Real CoreText smart fitting did not distinguish narrow and wide letters");
 const auto smartPixels=macos::rasterize(smart,.5,{20,10,150,200},640,240,1,.6,1,true);
 check(count(smartPixels)>count(macos::rasterize(smart,.5,{20,10,150,200},640,240,1,.6,1,false)),"Rasterizer smart-fit switch did not override fixed character grouping");
 RollUpSettings roll;roll.enabled=true;roll.boundaryEnabled=false;
 const auto rollingPixels=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,1,false,roll);
 check(count(rollingPixels)>0,"Native roll-up produced no pixels");
 roll.boundaryEnabled=true;const auto maskedPixels=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,1,false,roll);
 bool faded=false;for(std::size_t index=0;index<rollingPixels.pixels.size();++index){check(maskedPixels.pixels[index]<=rollingPixels.pixels[index],"Roll-up fade blurred or added pixels instead of masking existing sharp pixels");if(maskedPixels.pixels[index]<rollingPixels.pixels[index])faded=true;}
 check(faded,"Soft roll-up boundary did not attenuate pixels");
 for(std::size_t index=0;index<maskedPixels.pixels.size();index+=4)for(std::size_t channel=0;channel<3;++channel)check(maskedPixels.pixels[index+channel]<=maskedPixels.pixels[index+3],"Roll-up fade lost premultiplied alpha");
 roll.boundaryEnabled=false;const auto atHalf=macos::rasterize(pages,1.5,{20,10,500,200},640,240,56,.6,1,false,roll);
 check(atHalf.pixels==rollingPixels.pixels,"Backward scrubbing changed native rolling pixels");
 for(int direction:{1,2,3,4}){roll.direction=direction;const auto moved=macos::rasterize(pages,2.09,{20,10,500,200},640,240,56,.6,1,false,roll);check(count(moved)>0,"A roll-up direction produced an empty transition");}
 roll.direction=1;const auto scrollPixels=macos::rasterize(pages,1.09,{20,10,500,200},640,240,56,.6,1,false,roll);
 for(int transition:{2,3,4}){
  roll.transition=transition;const auto creative=macos::rasterize(pages,1.09,{20,10,500,200},640,240,56,.6,1,false,roll);
  check(count(creative)>0&&creative.pixels!=scrollPixels.pixels,"A creative line transition did not change rendered caption pixels");
  check(creative.pixels==macos::rasterize(pages,1.09,{20,10,500,200},640,240,56,.6,1,false,roll).pixels,"Creative transition depended on previous frame state");
 }
 auto readablePages=pages;readablePages.style.current.color={0,1,0,1};roll.transition=2;
 const auto readableFade=macos::rasterize(readablePages,1.09,{20,10,500,200},640,240,56,.6,1,false,roll);std::size_t opaqueCurrentPixels=0;
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
 // Family weight selection uses actual installed faces, not requested labels.
 WordStyle upright;upright.fontFamily="Arial";upright.fontSize=52;upright.fontWeight=400;upright.italic=0;
 const auto regular=macos::fontSelection(upright);check(regular.family=="Arial"&&regular.weight==400,"Arial regular face not selected");
 auto bold=upright;bold.fontWeight=700;const auto heavier=macos::fontSelection(bold);
 check(heavier.weight==700&&heavier.postscriptName!=regular.postscriptName,"Actual bold face not selected");
 auto relative=upright;relative.fontWeightOffset=100;const auto next=macos::fontSelection(relative,400);
 check(next.weight==700,"B did not choose Arial's next available heavier face");
 relative.fontWeightOffset=0;check(macos::fontSelection(relative,400).weight==400,"Relative B off did not follow shared base");
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
  check(bounds.left>=20&&bounds.right<520&&bounds.top>=20&&bounds.bottom<140,"Synthetic italic escaped layout clipping");
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
