#include "caption_rasterizer.hpp"
#include "font_selection.hpp"
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
// One render can measure/draw dozens of words with the same three state fonts.
// Reuse selections for that frame only; installed-font changes take effect on
// the next render without a global cache or a font-registration observer.
struct FrameFonts {
 struct Entry {std::string family;double size,weight,base;int italic,offset;CTFontRef font;bool synthetic;};
 std::vector<Entry> entries;
 ~FrameFonts(){for(const auto& entry:entries)CFRelease(entry.font);}
 CTFontRef select(const WordStyle& style,double base,bool& synthetic){
  const auto size=style.fontSize*style.sizeScale;
  for(const auto& entry:entries)if(entry.family==style.fontFamily&&entry.size==size&&entry.weight==style.fontWeight&&entry.base==base&&entry.italic==style.italic&&entry.offset==style.fontWeightOffset){synthetic=entry.synthetic;return static_cast<CTFontRef>(CFRetain(entry.font));}
  auto choice=font_detail::choose(style,base);synthetic=choice.info.syntheticItalic;
  if(entries.size()<16)entries.push_back({style.fontFamily,size,style.fontWeight,base,style.italic,style.fontWeightOffset,static_cast<CTFontRef>(CFRetain(choice.font)),synthetic});
  return choice.font;
 }
};
// Preserve the exact legacy path when no join is needed. Joined edges have
// zero corner radius; separate state colors/alpha still paint their own span.
CGPathRef bubblePath(CGRect rect,double radius,bool joinLeft,bool joinRight){
 if(!joinLeft&&!joinRight)return CGPathCreateWithRoundedRect(rect,radius,radius,nullptr);
 auto path=CGPathCreateMutable();if(!path)throw std::runtime_error("Bubble path allocation failed");
 const auto left=CGRectGetMinX(rect),right=CGRectGetMaxX(rect),bottom=CGRectGetMinY(rect),top=CGRectGetMaxY(rect);
 const double l=joinLeft?0:radius,r=joinRight?0:radius;
 CGPathMoveToPoint(path,nullptr,left+l,bottom);CGPathAddLineToPoint(path,nullptr,right-r,bottom);
 if(r)CGPathAddArcToPoint(path,nullptr,right,bottom,right,bottom+r,r);else CGPathAddLineToPoint(path,nullptr,right,bottom);
 CGPathAddLineToPoint(path,nullptr,right,top-r);
 if(r)CGPathAddArcToPoint(path,nullptr,right,top,right-r,top,r);else CGPathAddLineToPoint(path,nullptr,right,top);
 CGPathAddLineToPoint(path,nullptr,left+l,top);
 if(l)CGPathAddArcToPoint(path,nullptr,left,top,left,top-l,l);else CGPathAddLineToPoint(path,nullptr,left,top);
 CGPathAddLineToPoint(path,nullptr,left,bottom+l);
 if(l)CGPathAddArcToPoint(path,nullptr,left,bottom,left+l,bottom,l);else CGPathAddLineToPoint(path,nullptr,left,bottom);
 CGPathCloseSubpath(path);return path;
}
struct Shaped {
 Ref<CFStringRef> text;
 bool syntheticItalic=false;
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
 static CFNumberRef number(double width,double size){double percent=width>0?100*width/size:0;return CFNumberCreate(nullptr,kCFNumberDoubleType,&percent);}
 static CTFontRef selectFont(const WordStyle& style,double baseWeight,bool& synthetic,FrameFonts* fonts){if(fonts)return fonts->select(style,baseWeight,synthetic);auto choice=font_detail::choose(style,baseWeight);synthetic=choice.info.syntheticItalic;return choice.font;}
 static CFDictionaryRef attrs(CTFontRef f,CGColorRef fill,CGColorRef stroke,CFNumberRef w){
  const void* keys[]={kCTFontAttributeName,kCTForegroundColorAttributeName,kCTStrokeColorAttributeName,kCTStrokeWidthAttributeName};
  const void* values[]={f,fill,stroke,w};return CFDictionaryCreate(nullptr,keys,values,4,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 }
 Shaped(const std::string& s,const WordStyle& style,double baseWeight,FrameFonts* fonts=nullptr,bool outlineOnly=false):text(utf8(s)),
 font(selectFont(style,baseWeight,syntheticItalic,fonts)),space(CGColorSpaceCreateWithName(kCGColorSpaceSRGB)),
 fill(color(space,style.color,style.opacity)),stroke(color(space,style.outlineColor,style.opacity)),
 strokeWidth(number(outlineOnly?style.outlineWidth:0,style.fontSize*style.sizeScale)),attributes(attrs(font,fill,stroke,strokeWidth)),
 attributed(CFAttributedStringCreate(nullptr,text,attributes)),line(CTLineCreateWithAttributedString(attributed)){}
 CGRect inkBounds()const{return CTLineGetBoundsWithOptions(line,kCTLineBoundsUseGlyphPathBounds);}
 double offsetX()const{return syntheticItalic?std::max(0.0,-double(inkBounds().origin.x)):0;}
 Metrics metrics()const{CGFloat a=0,d=0;double w=CTLineGetTypographicBounds(line,&a,&d,nullptr);
  // Synthetic slant adds ink beyond the advance. Include that overhang in
  // reflow and bubbles, and draw with the matching offset at the left edge.
  if(syntheticItalic){const auto ink=inkBounds();const auto left=std::min(0.0,double(ink.origin.x));w=std::max(w,double(CGRectGetMaxX(ink)))-left;a=std::max(double(a),double(CGRectGetMaxY(ink)));d=std::max(double(d),-double(ink.origin.y));}
  return {w,a,d};}
};
}
std::string transformText(const std::string& text,const Style& style){
 if(!style.letterCase)return displayText(text,style.titleCase);
 Ref<CFStringRef> source(Shaped::utf8(text));
 Ref<CFMutableStringRef> result(CFStringCreateMutableCopy(nullptr,0,source));
 if(style.letterCase==1)CFStringUppercase(result,nullptr);else CFStringLowercase(result,nullptr);
 const auto bytes=CFStringGetMaximumSizeForEncoding(CFStringGetLength(result),kCFStringEncodingUTF8)+1;
 std::vector<char> utf8(static_cast<std::size_t>(bytes));
 if(!CFStringGetCString(result,utf8.data(),bytes,kCFStringEncodingUTF8))throw std::runtime_error("Caption case conversion failed");
 return std::string(utf8.data());
}
FontSelection fontSelection(const WordStyle& style,double baseWeight){
 Document check;check.style.current=style;check.style.baseFontWeight=baseWeight;validate(check);
 auto choice=font_detail::choose(style,baseWeight);CFRelease(choice.font);return choice.info;
}
Metrics measureText(const std::string& text,const WordStyle& style,double baseWeight){
 Document check;check.style.current=style;check.style.baseFontWeight=baseWeight;check.containers.push_back({"measure",false,{{text,0,1,false}}});validate(check);
 return Shaped(text,style,baseWeight).metrics();
}
Bitmap rasterize(const Document& document,double time,const LayoutBox& box,std::size_t width,std::size_t height,std::size_t maxChars,double pause,std::size_t groupsPerPage,bool smartLineFit,const RollUpSettings& rollUp){
 validate(document);
 if(!width||!height||width>8192||height>8192||width*height>33554432)throw std::invalid_argument("Native frame exceeds bitmap bounds");
 FrameFonts fonts;
 auto frame=layoutFrame(document,time,box,[&](const std::string& text,const WordStyle& style){return Shaped(text,style,document.style.baseFontWeight,&fonts).metrics();},maxChars,pause,transformText,groupsPerPage,smartLineFit,rollUp);
 Bitmap bitmap{width,height,width*4,std::vector<std::uint8_t>(width*height*4,0),frame.overflow};
 Ref<CGColorSpaceRef> space(CGColorSpaceCreateWithName(kCGColorSpaceSRGB));
 Ref<CGContextRef> context(CGBitmapContextCreate(bitmap.pixels.data(),width,height,8,bitmap.stride,space,kCGImageAlphaPremultipliedLast|kCGBitmapByteOrder32Big));
 // Core Graphics coordinates are bottom-left; layout geometry is top-left.
 CGContextClipToRect(context,CGRectMake(box.x,height-box.y-box.height,box.width,box.height));
 if(frame.rolling)CGContextClipToRect(context,CGRectMake(frame.viewport.x,height-frame.viewport.y-frame.viewport.height,frame.viewport.width,frame.viewport.height));
 for(const auto& run:frame.words){
  const auto& s=run.style;Shaped shaped(run.text,s,document.style.baseFontWeight,&fonts);auto m=shaped.metrics();double pad=s.bubble?s.padding:0;
  CGContextSaveGState(context);
  if(s.bubble){
   Ref<CGColorRef> bubble(Shaped::color(space,s.bubbleColor,s.opacity));CGContextSetFillColorWithColor(context,bubble);
   auto rect=CGRectMake(run.x,height-run.baseline-m.descent-pad,run.width+run.bubbleExtraWidth,m.ascent+m.descent+2*pad);
   double radius=std::fmin(s.radius,std::fmin(rect.size.width,rect.size.height)/2);
   Ref<CGPathRef> path(bubblePath(rect,radius,run.bubbleJoinLeft,run.bubbleJoinRight));CGContextAddPath(context,path);CGContextFillPath(context);
  }
  const bool shadow=s.shadowColor.a>0&&(s.shadowBlur>0||s.shadowX!=0||s.shadowY!=0);
  if(shadow){
   Ref<CGColorRef> shadow(Shaped::color(space,s.shadowColor,s.opacity));
   CGContextSetShadowWithColor(context,CGSizeMake(s.shadowX,-s.shadowY),s.shadowBlur,shadow);
  }
  CGContextSetTextMatrix(context,CGAffineTransformIdentity);CGContextSetTextPosition(context,run.x+pad+shaped.offsetX(),height-run.baseline);
  // CoreText's combined fill/stroke mode paints into the glyph interior.
  // Keep the stroke below an unchanged fill, with identical font and origin.
  // Group shadowed passes so the completed text casts one shadow.
  const bool outlined=s.outlineWidth>0&&s.outlineColor.a>0;
  if(outlined&&shadow)CGContextBeginTransparencyLayer(context,nullptr);
  if(outlined){
   Shaped outline(run.text,s,document.style.baseFontWeight,&fonts,true);
   CTLineDraw(outline.line,context);
   CGContextSetTextPosition(context,run.x+pad+shaped.offsetX(),height-run.baseline);
  }
  CTLineDraw(shaped.line,context);
  if(outlined&&shadow)CGContextEndTransparencyLayer(context);
  CGContextRestoreGState(context);
 }
 if(frame.rolling){
  CGContextFlush(context);
  for(std::size_t row=0;row<height;++row)for(std::size_t col=0;col<width;++col){
   auto* pixel=&bitmap.pixels[row*bitmap.stride+col*4];if(!pixel[3])continue;
   const auto alpha=rollUpAlpha(col+.5,row+.5,frame);
   for(int channel=0;channel<4;++channel)pixel[channel]=static_cast<std::uint8_t>(std::lround(pixel[channel]*alpha));
  }
 }
 return bitmap;
}
}
