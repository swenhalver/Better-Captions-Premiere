#include "caption_rasterizer.hpp"
#include <CoreGraphics/CoreGraphics.h>
#include <CoreText/CoreText.h>
#include <cmath>
#include <stdexcept>

namespace better_captions::macos {
namespace {
template<class T> struct Ref {
 T value=nullptr;
 explicit Ref(T v):value(v){if(!v)throw std::runtime_error("CoreText/CoreGraphics allocation failed");}
 ~Ref(){CFRelease(value);} Ref(const Ref&)=delete; Ref& operator=(const Ref&)=delete;
 operator T()const{return value;}
};
struct Shaped {
 Ref<CFStringRef> text,fontName;
 Ref<CTFontRef> font;
 Ref<CGColorSpaceRef> space;
 Ref<CGColorRef> fill,stroke;
 Ref<CFNumberRef> strokeWidth;
 Ref<CFDictionaryRef> attributes;
 Ref<CFAttributedStringRef> attributed;
 Ref<CTLineRef> line;
 static CFStringRef utf8(const std::string& s) {
  auto result=CFStringCreateWithBytes(nullptr,reinterpret_cast<const UInt8*>(s.data()),s.size(),kCFStringEncodingUTF8,false);
  if(!result)throw std::invalid_argument("Invalid UTF-8 caption text or font");return result;
 }
 static CGColorRef color(CGColorSpaceRef space,const Color& c,double opacity){CGFloat values[]={c.r,c.g,c.b,c.a*opacity};return CGColorCreate(space,values);}
 static CFNumberRef number(double width,double size){double percent=width>0?-100*width/size:0;return CFNumberCreate(nullptr,kCFNumberDoubleType,&percent);}
 static CFDictionaryRef attrs(CTFontRef f,CGColorRef fill,CGColorRef stroke,CFNumberRef w){
  const void* keys[]={kCTFontAttributeName,kCTForegroundColorAttributeName,kCTStrokeColorAttributeName,kCTStrokeWidthAttributeName};
  const void* values[]={f,fill,stroke,w};return CFDictionaryCreate(nullptr,keys,values,4,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 }
 Shaped(const std::string& s,const WordStyle& style):text(utf8(s)),fontName(utf8(style.fontFamily)),
 font(CTFontCreateWithName(fontName,style.fontSize*style.sizeScale,nullptr)),space(CGColorSpaceCreateWithName(kCGColorSpaceSRGB)),
 fill(color(space,style.color,style.opacity)),stroke(color(space,style.outlineColor,style.opacity)),
 strokeWidth(number(style.outlineWidth,style.fontSize*style.sizeScale)),attributes(attrs(font,fill,stroke,strokeWidth)),
 attributed(CFAttributedStringCreate(nullptr,text,attributes)),line(CTLineCreateWithAttributedString(attributed)){}
 Metrics metrics()const{CGFloat a=0,d=0;double w=CTLineGetTypographicBounds(line,&a,&d,nullptr);return {w,a,d};}
};
}
Metrics measureText(const std::string& text,const WordStyle& style){
 Document check;check.style.upcoming=check.style.current=check.style.spoken=style;validate(check);
 return Shaped(text,style).metrics();
}
Bitmap rasterize(const Document& document,double time,const LayoutBox& box,std::size_t width,std::size_t height,std::size_t maxChars,double pause){
 validate(document);
 if(!width||!height||width>8192||height>8192||width*height>33554432)throw std::invalid_argument("Native frame exceeds bitmap bounds");
 auto frame=layoutFrame(document,time,box,measureText,maxChars,pause);
 Bitmap bitmap{width,height,width*4,std::vector<std::uint8_t>(width*height*4,0),frame.overflow};
 Ref<CGColorSpaceRef> space(CGColorSpaceCreateWithName(kCGColorSpaceSRGB));
 Ref<CGContextRef> context(CGBitmapContextCreate(bitmap.pixels.data(),width,height,8,bitmap.stride,space,kCGImageAlphaPremultipliedLast|kCGBitmapByteOrder32Big));
 // Core Graphics coordinates are bottom-left; layout geometry is top-left.
 CGContextClipToRect(context,CGRectMake(box.x,height-box.y-box.height,box.width,box.height));
 for(const auto& run:frame.words){
  const auto& s=run.style;Shaped shaped(run.text,s);auto m=shaped.metrics();double pad=s.bubble?s.padding:0;
  CGContextSaveGState(context);
  if(s.bubble){
   Ref<CGColorRef> bubble(Shaped::color(space,s.bubbleColor,s.opacity));CGContextSetFillColorWithColor(context,bubble);
   auto rect=CGRectMake(run.x,height-run.baseline-m.descent-pad,run.width,m.ascent+m.descent+2*pad);
   double radius=std::fmin(s.radius,std::fmin(rect.size.width,rect.size.height)/2);
   Ref<CGPathRef> path(CGPathCreateWithRoundedRect(rect,radius,radius,nullptr));CGContextAddPath(context,path);CGContextFillPath(context);
  }
  if(s.shadowColor.a>0&&(s.shadowBlur>0||s.shadowX!=0||s.shadowY!=0)){
   Ref<CGColorRef> shadow(Shaped::color(space,s.shadowColor,s.opacity));
   CGContextSetShadowWithColor(context,CGSizeMake(s.shadowX,-s.shadowY),s.shadowBlur,shadow);
  }
  CGContextSetTextMatrix(context,CGAffineTransformIdentity);CGContextSetTextPosition(context,run.x+pad,height-run.baseline);
  CTLineDraw(shaped.line,context);CGContextRestoreGState(context);
 }
 return bitmap;
}
}
