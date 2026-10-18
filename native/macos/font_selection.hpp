#pragma once
#include "caption_rasterizer.hpp"
#include <CoreText/CoreText.h>
#include <CoreGraphics/CoreGraphics.h>
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

namespace better_captions::macos::font_detail {
template<class T> struct Hold {
 T value=nullptr;explicit Hold(T v):value(v){}~Hold(){if(value)CFRelease(value);}
 Hold(const Hold&)=delete;Hold& operator=(const Hold&)=delete;
 operator T()const{return value;}
};
inline std::string text(CFStringRef value){
 if(!value)return {};const auto bytes=CFStringGetMaximumSizeForEncoding(CFStringGetLength(value),kCFStringEncodingUTF8)+1;
 if(bytes<=0||bytes>4096)throw std::runtime_error("Invalid CoreText font name");
 std::string result(static_cast<std::size_t>(bytes),'\0');if(!CFStringGetCString(value,result.data(),bytes,kCFStringEncodingUTF8))throw std::runtime_error("Invalid CoreText font name");result.resize(std::char_traits<char>::length(result.c_str()));return result;
}
inline double number(CFTypeRef value,double fallback=0){double result=fallback;if(value&&CFGetTypeID(value)==CFNumberGetTypeID())CFNumberGetValue(static_cast<CFNumberRef>(value),kCFNumberDoubleType,&result);return std::isfinite(result)?result:fallback;}
inline double weight(CTFontRef font){
 Hold<CFDataRef> table(CTFontCopyTable(font,kCTFontTableOS2,kCTFontTableOptionNoOptions));
 if(table.value&&CFDataGetLength(table)>=6){const auto* bytes=CFDataGetBytePtr(table);const auto actual=unsigned(bytes[4])*256+bytes[5];if(actual>=1&&actual<=1000)return actual;}
 Hold<CFDictionaryRef> traits(CTFontCopyTraits(font));const auto trait=number(CFDictionaryGetValue(traits,kCTFontWeightTrait));
 const double anchors[][2]={{100,-.8},{200,-.6},{300,-.4},{400,0},{500,.23},{600,.3},{700,.4},{800,.56},{900,.62},{1000,1}};
 double best=400,distance=std::numeric_limits<double>::infinity();for(const auto& point:anchors){const auto d=std::abs(point[1]-trait);if(d<distance){best=point[0];distance=d;}}return best;
}
struct Face {
 CTFontRef font=nullptr;double css=400,minimum=0,maximum=0;std::int64_t axis=0;bool italic=false;
 explicit Face(CTFontRef value):font(value),css(weight(value)),italic((CTFontGetSymbolicTraits(value)&kCTFontItalicTrait)!=0){
  Hold<CFArrayRef> axes(CTFontCopyVariationAxes(font));if(!axes.value)return;
  for(CFIndex i=0;i<CFArrayGetCount(axes);++i){auto descriptor=static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(axes,i));
   auto identifier=static_cast<CFNumberRef>(CFDictionaryGetValue(descriptor,kCTFontVariationAxisIdentifierKey));std::int64_t tag=0;
   if(!identifier||!CFNumberGetValue(identifier,kCFNumberSInt64Type,&tag)||tag!=0x77676874)continue;
   const auto lo=number(CFDictionaryGetValue(descriptor,kCTFontVariationAxisMinimumValueKey)),hi=number(CFDictionaryGetValue(descriptor,kCTFontVariationAxisMaximumValueKey));
   if(lo>hi||lo>1000||hi<1)continue;minimum=std::max(1.0,lo);maximum=std::min(1000.0,hi);axis=tag;
   Hold<CFDictionaryRef> current(CTFontCopyVariation(font));if(current.value)css=number(CFDictionaryGetValue(current,identifier),css);
  }
 }
 Face(const Face&)=delete;Face& operator=(const Face&)=delete;
 Face(Face&& other)noexcept:font(other.font),css(other.css),minimum(other.minimum),maximum(other.maximum),axis(other.axis),italic(other.italic){other.font=nullptr;}
 ~Face(){if(font)CFRelease(font);}
};
struct Choice {CTFontRef font;FontSelection info;};
inline Choice choose(const WordStyle& style,double baseWeight){
 Hold<CFStringRef> name(CFStringCreateWithBytes(nullptr,reinterpret_cast<const UInt8*>(style.fontFamily.data()),style.fontFamily.size(),kCFStringEncodingUTF8,false));
 if(!name.value)throw std::invalid_argument("Invalid font name");
 const auto size=style.fontSize*style.sizeScale;
 Hold<CTFontRef> original(CTFontCreateWithName(name,size,nullptr));if(!original.value)throw std::runtime_error("CoreText could not resolve the font");
 const bool originalItalic=(CTFontGetSymbolicTraits(original)&kCTFontItalicTrait)!=0;
 if(style.fontWeight==0&&style.fontWeightOffset==-1&&style.italic==-1){
  Hold<CFStringRef> family(CTFontCopyFamilyName(original)),postscript(CTFontCopyPostScriptName(original));
  return {static_cast<CTFontRef>(CFRetain(original)),{text(family),text(postscript),weight(original),originalItalic,false,{weight(original)}}};
 }
 Hold<CFStringRef> family(CTFontCopyFamilyName(original));
 const void* keys[]={kCTFontFamilyNameAttribute};const void* values[]={family.value};
 Hold<CFDictionaryRef> attributes(CFDictionaryCreate(nullptr,keys,values,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks));
 Hold<CTFontDescriptorRef> descriptor(CTFontDescriptorCreateWithAttributes(attributes));
 Hold<CFSetRef> mandatory(CFSetCreate(nullptr,keys,1,&kCFTypeSetCallBacks));
 Hold<CFArrayRef> matches(CTFontDescriptorCreateMatchingFontDescriptors(descriptor,mandatory));
 std::vector<Face> faces;
 if(matches.value){const auto count=CFArrayGetCount(matches);if(count>4096)throw std::runtime_error("Font family has too many faces");
  for(CFIndex i=0;i<count;++i){auto item=static_cast<CTFontDescriptorRef>(CFArrayGetValueAtIndex(matches,i));auto face=CTFontCreateWithFontDescriptor(item,size,nullptr);if(face)faces.emplace_back(face);}}
 if(faces.empty())faces.emplace_back(static_cast<CTFontRef>(CFRetain(original)));
 std::vector<double> available;
 for(const auto& face:faces){available.push_back(face.css);if(face.axis){available.push_back(face.minimum);available.push_back(face.maximum);for(int w=100;w<=1000;w+=100)if(w>=face.minimum&&w<=face.maximum)available.push_back(w);}}
 std::sort(available.begin(),available.end());available.erase(std::unique(available.begin(),available.end(),[](double a,double b){return std::abs(a-b)<.001;}),available.end());
 double requested=style.fontWeight>0?style.fontWeight:weight(original);
 if(style.fontWeightOffset>=0){requested=baseWeight>0?baseWeight:400;if(style.fontWeightOffset==100){const auto next=std::find_if(available.begin(),available.end(),[&](double w){return w>requested+.001;});if(next!=available.end())requested=*next;}}
 const bool italic=style.italic==-1?originalItalic:style.italic==1;
 const Face* selected=nullptr;double selectedWeight=400,best=std::numeric_limits<double>::infinity();
 for(const auto& face:faces){const auto actual=face.axis?std::clamp(requested,face.minimum,face.maximum):face.css;
  const auto score=std::abs(actual-requested)*10+(face.italic==italic?0:1);
  if(score<best||(score==best&&actual<selectedWeight)){best=score;selected=&face;selectedWeight=actual;}}
 CTFontRef result=static_cast<CTFontRef>(CFRetain(selected->font));
 if(selected->axis){
  Hold<CFNumberRef> axis(CFNumberCreate(nullptr,kCFNumberSInt64Type,&selected->axis)),value(CFNumberCreate(nullptr,kCFNumberDoubleType,&selectedWeight));
  const void* variationKeys[]={axis.value};const void* variationValues[]={value.value};
  Hold<CFDictionaryRef> variation(CFDictionaryCreate(nullptr,variationKeys,variationValues,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks));
  const void* variationAttributeKeys[]={kCTFontVariationAttribute};const void* variationAttributeValues[]={variation.value};
  Hold<CFDictionaryRef> variationAttributes(CFDictionaryCreate(nullptr,variationAttributeKeys,variationAttributeValues,1,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks));
  Hold<CTFontDescriptorRef> variedDescriptor(CTFontDescriptorCreateWithAttributes(variationAttributes));
  auto varied=CTFontCreateCopyWithAttributes(result,size,nullptr,variedDescriptor);if(!varied){CFRelease(result);throw std::runtime_error("Could not select the variable font weight");}CFRelease(result);result=varied;
  Face verified(static_cast<CTFontRef>(CFRetain(result)));
  if(std::abs(verified.css-selectedWeight)>.01){CFRelease(result);throw std::runtime_error("CoreText did not apply the requested variable font weight");}
  selectedWeight=verified.css;
 }
 const bool nativeItalic=(CTFontGetSymbolicTraits(result)&kCTFontItalicTrait)!=0;
 const bool synthetic=italic&&!nativeItalic;
 if(synthetic){const auto shear=CGAffineTransformMake(1,0,std::tan(12.0*3.14159265358979323846/180.0),1,0,0);const auto matrix=CGAffineTransformConcat(CTFontGetMatrix(result),shear);
  auto slanted=CTFontCreateCopyWithAttributes(result,size,&matrix,nullptr);if(!slanted){CFRelease(result);throw std::runtime_error("Could not synthesize italic");}CFRelease(result);result=slanted;}
 Hold<CFStringRef> postscript(CTFontCopyPostScriptName(result));
 return {result,{text(family),text(postscript),selectedWeight,nativeItalic,synthetic,available}};
}
}
