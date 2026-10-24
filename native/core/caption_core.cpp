#include "caption_core.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <unordered_map>

namespace better_captions {
static_assert(sizeof(double)==8&&std::numeric_limits<double>::is_iec559,"BCAP requires IEEE-754 binary64");
namespace {
void require(bool ok,const char* reason) { if(!ok) throw std::invalid_argument(reason); }
bool finite(double v) { return std::isfinite(v); }
void text(const std::string& s) {
 // Reject malformed UTF-8 and control characters before host font APIs consume it.
 for(std::size_t i=0;i<s.size();) {
  unsigned char lead=static_cast<unsigned char>(s[i++]);std::uint32_t cp=lead;unsigned n=0;
  if(lead>=0xc2&&lead<=0xdf){cp=lead&0x1f;n=1;}
  else if(lead>=0xe0&&lead<=0xef){cp=lead&0x0f;n=2;}
  else if(lead>=0xf0&&lead<=0xf4){cp=lead&0x07;n=3;}
  else require(lead<0x80,"invalid UTF-8");
  require(n<=s.size()-i,"truncated UTF-8");
  for(unsigned j=0;j<n;++j){unsigned char c=static_cast<unsigned char>(s[i++]);require((c&0xc0)==0x80,"invalid UTF-8 continuation");cp=(cp<<6)|(c&0x3f);}
  require((n!=1||cp>=0x80)&&(n!=2||cp>=0x800)&&(n!=3||cp>=0x10000)&&cp<=0x10ffff&&!(cp>=0xd800&&cp<=0xdfff),"invalid UTF-8 scalar");
  require(cp>=0x20&&!(cp>=0x7f&&cp<=0x9f)&&cp!=0x2028&&cp!=0x2029,"control characters are unsupported");
 }
}

void color(const Color& c) { for(double v:{c.r,c.g,c.b,c.a}) require(finite(v)&&v>=0&&v<=1,"invalid color"); }
void style(const WordStyle& s) {
 require(!s.fontFamily.empty()&&s.fontFamily.size()<=256,"invalid font family");text(s.fontFamily);
 require(finite(s.fontSize)&&s.fontSize>0&&s.fontSize<=4096,"invalid font size");
 require(finite(s.sizeScale)&&s.sizeScale>0&&s.sizeScale<=16,"invalid size scale");
 require(finite(s.opacity)&&s.opacity>=0&&s.opacity<=1,"invalid opacity");
 require(s.fontWeight==0||(finite(s.fontWeight)&&s.fontWeight>=1&&s.fontWeight<=1000),"invalid font weight");
 require(s.italic>=-1&&s.italic<=1,"invalid italic mode");
 require(s.underline>=-1&&s.underline<=1,"invalid underline mode");
 require(s.fontWeightOffset==-1||s.fontWeightOffset==0||s.fontWeightOffset==100,"invalid relative weight mode");
 for(double v:{s.padding,s.radius,s.outlineWidth,s.shadowBlur}) require(finite(v)&&v>=0&&v<=4096,"invalid style extent");
 require(finite(s.shadowX)&&finite(s.shadowY)&&std::abs(s.shadowX)<=4096&&std::abs(s.shadowY)<=4096,"invalid shadow offset");
 for(double axis:{s.bubblePaddingInline,s.bubblePaddingBlock})require(axis==-1||(finite(axis)&&axis>=0&&axis<=4096),"invalid bubble axis padding");
 require(s.paddingTop==-1||(finite(s.paddingTop)&&s.paddingTop>=0&&s.paddingTop<=4096),"invalid geometry");require(s.paddingRight==-1||(finite(s.paddingRight)&&s.paddingRight>=0&&s.paddingRight<=4096),"invalid geometry");require(s.paddingBottom==-1||(finite(s.paddingBottom)&&s.paddingBottom>=0&&s.paddingBottom<=4096),"invalid geometry");require(s.paddingLeft==-1||(finite(s.paddingLeft)&&s.paddingLeft>=0&&s.paddingLeft<=4096),"invalid geometry");require(s.radiusTL==-1||(finite(s.radiusTL)&&s.radiusTL>=0&&s.radiusTL<=4096),"invalid geometry");require(s.radiusTR==-1||(finite(s.radiusTR)&&s.radiusTR>=0&&s.radiusTR<=4096),"invalid geometry");require(s.radiusBR==-1||(finite(s.radiusBR)&&s.radiusBR>=0&&s.radiusBR<=4096),"invalid geometry");require(s.radiusBL==-1||(finite(s.radiusBL)&&s.radiusBL>=0&&s.radiusBL<=4096),"invalid geometry");require(finite(s.marginTop)&&std::abs(s.marginTop)<=4096,"invalid margin");require(finite(s.marginRight)&&std::abs(s.marginRight)<=4096,"invalid margin");require(finite(s.marginBottom)&&std::abs(s.marginBottom)<=4096,"invalid margin");require(finite(s.marginLeft)&&std::abs(s.marginLeft)<=4096,"invalid margin");
 color(s.color);color(s.bubbleColor);color(s.outlineColor);color(s.shadowColor);
}
bool visibleBubble(const WordStyle& s) { return s.bubble&&s.opacity>0&&s.bubbleColor.a>0; }
bool punctuation(const std::string& s) { return !s.empty()&&std::string(".,!?;:%)]}").find(s.front())!=std::string::npos; }
std::size_t chars(const std::string& s) { std::size_t n=0;for(unsigned char c:s) if((c&0xc0)!=0x80)++n;return n; }
struct Writer {
 std::vector<std::uint8_t> b;
 void u(std::uint32_t v) { for(int i=0;i<4;++i)b.push_back(static_cast<std::uint8_t>(v>>(i*8))); }
 void d(double v) { std::uint64_t q;std::memcpy(&q,&v,8);for(int i=0;i<8;++i)b.push_back(static_cast<std::uint8_t>(q>>(i*8))); }
 void s(const std::string& v) { u(static_cast<std::uint32_t>(v.size()));b.insert(b.end(),v.begin(),v.end()); }
};
struct Reader {
 const std::vector<std::uint8_t>& b;std::size_t p=0;
 void need(std::size_t n) {require(n<=b.size()-p,"truncated document");}
 std::uint32_t u() {need(4);std::uint32_t v=0;for(int i=0;i<4;++i)v|=std::uint32_t(b[p++])<<(i*8);return v;}
 bool flag() {auto v=u();require(v<=1,"invalid boolean");return v!=0;}
 double d() {need(8);std::uint64_t q=0;for(int i=0;i<8;++i)q|=std::uint64_t(b[p++])<<(i*8);double v;std::memcpy(&v,&q,8);return v;}
 std::string s(std::size_t limit) {auto n=u();require(n<=limit,"string limit exceeded");need(n);std::string v(b.begin()+p,b.begin()+p+n);p+=n;return v;}
};
void writeColor(Writer& w,const Color& c) {w.d(c.r);w.d(c.g);w.d(c.b);w.d(c.a);}
Color readColor(Reader& r) {Color c;c.r=r.d();c.g=r.d();c.b=r.d();c.a=r.d();return c;}
void writeStyle(Writer& w,const WordStyle& s) {
 w.s(s.fontFamily);w.d(s.fontSize);w.d(s.sizeScale);w.d(s.opacity);writeColor(w,s.color);w.u(s.bubble);
 writeColor(w,s.bubbleColor);w.d(s.padding);w.d(s.radius);w.d(s.outlineWidth);writeColor(w,s.outlineColor);
 w.d(s.shadowBlur);w.d(s.shadowX);w.d(s.shadowY);writeColor(w,s.shadowColor);
}
WordStyle readStyle(Reader& r) {
 WordStyle s;s.fontFamily=r.s(256);s.fontSize=r.d();s.sizeScale=r.d();s.opacity=r.d();s.color=readColor(r);s.bubble=r.flag();
 s.bubbleColor=readColor(r);s.padding=r.d();s.radius=r.d();s.outlineWidth=r.d();s.outlineColor=readColor(r);
 s.shadowBlur=r.d();s.shadowX=r.d();s.shadowY=r.d();s.shadowColor=readColor(r);return s;
}
}
void validate(const Document& d) {
 require(d.schemaVersion>=1&&d.schemaVersion<=kSchemaVersion,"unsupported schema version");require(finite(d.timeOriginSeconds)&&std::abs(d.timeOriginSeconds)<=864000,"invalid document time origin");require(d.containers.size()<=10000,"too many containers");
 require(d.style.baseFontWeight==0||(finite(d.style.baseFontWeight)&&d.style.baseFontWeight>=1&&d.style.baseFontWeight<=1000),"invalid base font weight");
 std::size_t total=0,bytes=0;std::vector<std::string> ids;
 for(const auto& c:d.containers) {
  require(!c.id.empty()&&c.id.size()<=256,"invalid container id");text(c.id);ids.push_back(c.id);bytes+=c.id.size();
  total+=c.words.size();require(total<=kMaxWords,"too many words");double previous=-1;
  for(const auto& w:c.words) {require(!w.text.empty()&&w.text.size()<=4096,"invalid word text");text(w.text);bytes+=w.text.size();
   require(static_cast<std::uint32_t>(w.lineBreakBefore)<=3,"invalid line break mode");
   require(w.pauseLinesRemoved<=8,"invalid removed pause line count");
   require(finite(w.start)&&finite(w.end)&&w.start>=0&&w.end>=w.start&&w.start>=previous,"invalid word timing");previous=w.start;}
 }
 std::sort(ids.begin(),ids.end());require(std::adjacent_find(ids.begin(),ids.end())==ids.end(),"duplicate container id");
 require(bytes<=kMaxDocumentBytes/2,"text limit exceeded");style(d.style.upcoming);style(d.style.current);style(d.style.spoken);
 require(d.style.letterCase>=0&&d.style.letterCase<=2&&!(d.style.letterCase&&d.style.titleCase),"invalid display letter case");
 require(finite(d.style.wordSpacing)&&d.style.wordSpacing>=0&&d.style.wordSpacing<=4096,"invalid word spacing");
 require(finite(d.style.lineHeight)&&d.style.lineHeight>=.6&&d.style.lineHeight<=10,"invalid line height");
}
std::vector<Phrase> regroup(const Document& d,std::size_t maxChars,double pause) {
 validate(d);require(maxChars>=1&&maxChars<=500,"invalid character count");require(finite(pause)&&pause>=0&&pause<=60,"invalid pause");
 std::vector<WordRef> stream;
 for(std::size_t c=0;c<d.containers.size();++c)for(std::size_t w=0;w<d.containers[c].words.size();++w)stream.push_back({c,w});
 auto word=[&](const WordRef& ref)->const Word&{return d.containers[ref.containerIndex].words[ref.wordIndex];};
 std::vector<Phrase> out;Phrase phrase;std::size_t len=0;const Word* previous=nullptr;
 auto flush=[&](){if(phrase.wordCount){out.push_back(std::move(phrase));phrase=Phrase{};len=0;}};
 for(const auto& ref:stream){const auto& w=word(ref);const auto n=chars(w.text);const bool punct=punctuation(w.text);
  const bool previousEnds=previous&&(previous->endOfSentence||(!previous->text.empty()&&std::string(".!?").find(previous->text.back())!=std::string::npos));
  const bool automatic=previous&&(previousEnds||(!punct&&(len+n+(phrase.wordCount?1:0)>maxChars||w.start-previous->end>pause)));
  if(phrase.wordCount&&(w.lineBreakBefore==LineBreakBefore::Break||w.lineBreakBefore==LineBreakBefore::MergeEdge||(w.lineBreakBefore!=LineBreakBefore::Join&&automatic)))flush();
  if(!phrase.wordCount){phrase.containerId=d.containers[ref.containerIndex].id;phrase.firstWord=ref.wordIndex;phrase.start=w.start;phrase.end=w.end;}
  else phrase.end=std::max(phrase.end,w.end);
  len+=n+(phrase.wordCount&&!punct?1:0);++phrase.wordCount;phrase.wordRefs.push_back(ref);previous=&w;
 }
 flush();return out;
}
std::vector<std::uint8_t> encode(const Document& d) {
 validate(d);const auto wireVersion=kSchemaVersion;
 Writer w;w.u(0x50414342);w.u(wireVersion);w.u(static_cast<std::uint32_t>(d.containers.size()));
 for(const auto& c:d.containers){w.s(c.id);w.u(c.manualSplit);w.u(static_cast<std::uint32_t>(c.words.size()));for(const auto& a:c.words){w.s(a.text);w.d(a.start);w.d(a.end);w.u(a.endOfSentence);w.u(static_cast<std::uint32_t>(a.lineBreakBefore));w.u(a.pauseLinesRemoved);}}
 writeStyle(w,d.style.upcoming);writeStyle(w,d.style.current);writeStyle(w,d.style.spoken);w.d(d.style.wordSpacing);w.d(d.style.lineHeight);w.u(d.style.titleCase);
 if(wireVersion>=2)w.d(d.timeOriginSeconds);
 if(wireVersion>=3){w.d(d.style.baseFontWeight);for(const auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){w.d(s->fontWeight);w.u(static_cast<std::uint32_t>(s->italic+1));w.u(s->fontWeightOffset==-1?0:s->fontWeightOffset==0?1:2);}}
 if(wireVersion>=4)w.u(d.style.letterCase);
 if(wireVersion>=5)for(const auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken})w.u(s->bubbleFillSpaces);
 if(wireVersion>=6)for(const auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){w.d(s->bubblePaddingInline);w.d(s->bubblePaddingBlock);}
 if(wireVersion>=6)for(const auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken})w.u(static_cast<std::uint32_t>(s->underline+1));
 if(wireVersion>=7)for(const auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){w.d(s->paddingTop);w.d(s->paddingRight);w.d(s->paddingBottom);w.d(s->paddingLeft);w.d(s->radiusTL);w.d(s->radiusTR);w.d(s->radiusBR);w.d(s->radiusBL);w.d(s->marginTop);w.d(s->marginRight);w.d(s->marginBottom);w.d(s->marginLeft);}
 require(w.b.size()<=kMaxDocumentBytes,"document size exceeded");return w.b;
}
Document decode(const std::vector<std::uint8_t>& b) {
 require(b.size()<=kMaxDocumentBytes,"document size exceeded");Reader r{b};require(r.u()==0x50414342,"invalid document magic");Document d;const auto wireVersion=r.u();require(wireVersion>=1&&wireVersion<=kSchemaVersion,"unsupported schema version");
 auto n=r.u();require(n<=10000,"too many containers");std::size_t total=0;
 for(std::uint32_t i=0;i<n;++i){CaptionContainer c;c.id=r.s(256);c.manualSplit=r.flag();auto k=r.u();total+=k;require(total<=kMaxWords,"too many words");
 for(std::uint32_t j=0;j<k;++j){Word w;w.text=r.s(4096);w.start=r.d();w.end=r.d();w.endOfSentence=r.flag();if(wireVersion>=8){const auto mode=r.u();require(mode<=(wireVersion>=10?3u:2u),"invalid line break mode");w.lineBreakBefore=static_cast<LineBreakBefore>(mode);}else if(i>0&&j==0)w.lineBreakBefore=LineBreakBefore::Break;if(wireVersion>=9)w.pauseLinesRemoved=r.u();c.words.push_back(std::move(w));}d.containers.push_back(std::move(c));}
 d.style.upcoming=readStyle(r);d.style.current=readStyle(r);d.style.spoken=readStyle(r);d.style.wordSpacing=r.d();d.style.lineHeight=r.d();d.style.titleCase=r.flag();if(wireVersion>=2)d.timeOriginSeconds=r.d();
 if(wireVersion>=3){d.style.baseFontWeight=r.d();for(auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){s->fontWeight=r.d();const auto italic=r.u(),offset=r.u();require(italic<=2&&offset<=2,"invalid native typography mode");s->italic=static_cast<int>(italic)-1;s->fontWeightOffset=offset==0?-1:offset==1?0:100;}}
 if(wireVersion>=4)d.style.letterCase=static_cast<int>(r.u());
 if(wireVersion>=5)for(auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken})s->bubbleFillSpaces=r.flag();
 if(wireVersion>=6)for(auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){s->bubblePaddingInline=r.d();s->bubblePaddingBlock=r.d();}
 if(wireVersion>=6)for(auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){auto mode=r.u();require(mode<=2,"invalid underline mode");s->underline=static_cast<int>(mode)-1;}
 if(wireVersion>=7)for(auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){s->paddingTop=r.d();s->paddingRight=r.d();s->paddingBottom=r.d();s->paddingLeft=r.d();s->radiusTL=r.d();s->radiusTR=r.d();s->radiusBR=r.d();s->radiusBL=r.d();s->marginTop=r.d();s->marginRight=r.d();s->marginBottom=r.d();s->marginLeft=r.d();}
 require(r.p==b.size(),"trailing document bytes");validate(d);return d;
}
std::string displayText(const std::string& text,bool title,int letterCase) {
 if(letterCase){std::string out=text;for(char& c:out){if(letterCase==1&&c>='a'&&c<='z')c-=32;else if(letterCase==2&&c>='A'&&c<='Z')c+=32;}return out;}
 if(!title)return text;std::string out=text;bool initial=true;
 // A word that already has a capital (NASA, iPhone, JunkYourVehicle.Net) keeps its casing.
 auto boundary=[](char c){return c=='-'||c=='.'||c==' '||c=='\t';};
 for(std::size_t i=0;i<out.size();++i){
  if(i==0||boundary(out[i-1])){initial=true;for(std::size_t j=i;j<out.size()&&!boundary(out[j]);++j)if(out[j]>='A'&&out[j]<='Z'){initial=false;break;}}
  char& c=out[i];auto u=static_cast<unsigned char>(c);if(u>=128){initial=false;continue;}
  if((c>='a'&&c<='z')||(c>='A'&&c<='Z')){if(initial&&c>='a'&&c<='z')c-=32;initial=false;}}
 return out;
}
std::size_t sampledGroupsPerPage(double value) {
 require(finite(value),"invalid groups per page");
 return static_cast<std::size_t>(std::floor(std::max(1.0,std::min(double(kMaxGroupsPerPage),value))+.5));
}
int sampledTextAlignment(double value) { require(finite(value),"invalid text alignment");return static_cast<int>(std::floor(std::max(1.0,std::min(3.0,value))+.5)); }
RollUpEdge sampledRollUpEdge(double inset,double fadeEnabled,double thickness,double amount,double curve) {
 for(double value:{inset,fadeEnabled,thickness,amount,curve})require(finite(value),"invalid roll-up edge sample");
 auto unit=[](double value){return std::max(0.0,std::min(1.0,value));};
 RollUpEdge edge;edge.inset=unit(inset);edge.fadeEnabled=fadeEnabled>=.5;edge.thickness=unit(thickness);edge.amount=unit(amount);
 edge.curve=static_cast<int>(std::floor(std::max(1.0,std::min(4.0,curve))+.5));return edge;
}
RollUpSettings sampledRollUpSettings(double enabled,double lines,double duration,double boundary,double position,double thickness,double fade,double curve,double direction,double speed,double wait,double transition,double currentLine,double blankLineSeconds) {
 for(double value:{enabled,lines,duration,boundary,position,thickness,fade,curve,direction,speed,wait,transition,currentLine,blankLineSeconds})require(finite(value),"invalid roll-up sample");
 auto clamp=[](double value,double low,double high){return std::max(low,std::min(high,value));};
 RollUpSettings settings;settings.enabled=enabled>=.5;settings.visibleLines=static_cast<std::size_t>(std::floor(clamp(lines,1,8)+.5));settings.scrollDuration=clamp(duration,0,2);settings.currentLine=static_cast<std::size_t>(std::floor(clamp(currentLine,1,8)+.5));
 settings.blankLineSeconds=clamp(blankLineSeconds,0,30);
 settings.boundaryEnabled=boundary>=.5;settings.boundaryPosition=clamp(position,0,1);settings.transitionThickness=clamp(thickness,0,1);settings.fadeAmount=clamp(fade,0,1);
 settings.transitionCurve=static_cast<int>(std::floor(clamp(curve,1,4)+.5));settings.direction=static_cast<int>(std::floor(clamp(direction,1,4)+.5));settings.speed=clamp(speed,.1,10);settings.waitForLine=wait>=.5;settings.transition=static_cast<int>(std::floor(clamp(transition,1,4)+.5));return settings;
}
namespace {
double lineInset(const LayoutBox& box,double width) {
 if(box.alignment==1)return 0;if(box.alignment==3)return box.width-width;return (box.width-width)/2;
}
double rollCurve(double value,int curve) {
 const auto x=std::max(0.0,std::min(1.0,value));
 if(curve==2)return x*x*(3-2*x);if(curve==3)return x*x;if(curve==4)return 1-(1-x)*(1-x);return x;
}
void validateRollUp(const RollUpSettings& s) {
 require(finite(s.blankLineSeconds)&&s.blankLineSeconds>=0&&s.blankLineSeconds<=30,"invalid blank line length");
 require(s.currentLine>=1&&s.currentLine<=8,"invalid current line position");
 require(s.visibleLines>=1&&s.visibleLines<=8&&finite(s.scrollDuration)&&s.scrollDuration>=0&&s.scrollDuration<=2,"invalid roll-up settings");
 require(finite(s.boundaryPosition)&&s.boundaryPosition>=0&&s.boundaryPosition<=1&&finite(s.transitionThickness)&&s.transitionThickness>=0&&s.transitionThickness<=1&&finite(s.fadeAmount)&&s.fadeAmount>=0&&s.fadeAmount<=1,"invalid roll-up boundary");
 require(s.transitionCurve>=1&&s.transitionCurve<=4&&s.direction>=1&&s.direction<=4&&finite(s.speed)&&s.speed>=.1&&s.speed<=10&&s.transition>=1&&s.transition<=4,"invalid roll-up direction or speed");
 require(s.boundaryMode==0||s.boundaryMode==1,"invalid roll-up boundary mode");
 if(s.boundaryMode==1)for(const auto& edge:s.edges){
  require(finite(edge.inset)&&edge.inset>=0&&edge.inset<=1&&finite(edge.thickness)&&edge.thickness>=0&&edge.thickness<=1&&finite(edge.amount)&&edge.amount>=0&&edge.amount<=1&&edge.curve>=1&&edge.curve<=4,"invalid independent roll-up edge");
 }
}
Metrics worstMetrics(const std::string& text,const Style& style,const MeasureText& measure) {
 Metrics reserved;
 for(const auto* state:{&style.upcoming,&style.current,&style.spoken}){
  auto metrics=measure(text,*state);require(finite(metrics.width)&&finite(metrics.ascent)&&finite(metrics.descent)&&metrics.width>=0&&metrics.ascent>=0&&metrics.descent>=0&&metrics.width<=1e9&&metrics.ascent<=1e9&&metrics.descent<=1e9,"invalid text metrics");
  reserved.width=std::max(reserved.width,std::max(0.0,metrics.width+state->horizontalPadding()+state->marginLeft+state->marginRight));reserved.ascent=std::max(reserved.ascent,std::max(0.0,metrics.ascent+state->topPadding()+state->marginTop));reserved.descent=std::max(reserved.descent,std::max(0.0,metrics.descent+state->bottomPadding()+state->marginBottom));
 }return reserved;
}
std::array<double,4> directionalPaintOutset(const Style& style) {
 std::array<double,4> result{};
 for(const auto* s:{&style.upcoming,&style.current,&style.spoken}){
  if(s->opacity<=0)continue;
  const bool glyph=s->color.a>0,outlined=s->outlineWidth>0&&s->outlineColor.a>0;
  const double outline=outlined?s->outlineWidth:0;
  // Conservative finite CoreGraphics shadow support. Shadows are applied to
  // glyphs/outline, not the background; reserve all states, never moving runs.
  const double shadow=(glyph||outlined)&&s->shadowColor.a>0?s->shadowBlur*3:0;
  const double shadowX=(glyph||outlined)&&s->shadowColor.a>0?s->shadowX:0;
  const double shadowY=(glyph||outlined)&&s->shadowColor.a>0?s->shadowY:0;
  const std::array<double,4> padding{{s->topPadding(),s->bottomPadding(),s->leftPadding(),s->rightPadding()}};
  const std::array<double,4> margin{{s->marginTop,s->marginBottom,s->marginLeft,s->marginRight}};
  const std::array<double,4> extent{{outline+std::max(0.0,shadow-shadowY),outline+std::max(0.0,shadow+shadowY),outline+std::max(0.0,shadow-shadowX),outline+std::max(0.0,shadow+shadowX)}};
  for(std::size_t edge=0;edge<result.size();++edge){
   // Background toggles are paint-only: authored padding/margin overhang
   // keeps the same boundary allowance whether that paint is enabled or not.
   double outside=std::max(0.0,-margin[edge]);
   if(glyph||outlined)outside=std::max(outside,std::max(0.0,extent[edge]-padding[edge]-margin[edge]));
   // One output-pixel allowance retains antialias coverage at the paint edge.
   if(outside>0)result[edge]=std::max(result[edge],outside+1);
  }
 }return result;
}
// Silence is a derived timed row, not a carrier word or a regrouping boundary.
// Keep public regrouping results unchanged. Every complete pause interval
// contributes an ordinary line in both presentation modes.
// The first blank begins at speech end; later slots enter at the same cadence.
// Blank rows follow the pace of speech: a pause becomes blank rows only when it
// lasts at least one average spoken line, and each blank row stands for one
// average line of silence, unless Blank line length specifies a cadence.
// Whole rows only, capped at Visible lines in both modes before deletions.
// The remainder extends the last remaining blank's duration.
double averageLineSeconds(const std::vector<Phrase>& phrases,double fallback) {
 double total=0;std::size_t count=0;
 for(const auto& phrase:phrases)if(phrase.wordCount>0&&phrase.end>phrase.start){total+=phrase.end-phrase.start;++count;}
 return count?total/double(count):fallback;
}
std::vector<Phrase> withSilenceRows(const Document& d,const std::vector<Phrase>& phrases,double pause,const RollUpSettings& settings) {
 std::vector<Phrase> result;result.reserve(phrases.size());
 // A zero pause still needs a finite cadence for derived rows.
 const double cadence=settings.blankLineSeconds>0?settings.blankLineSeconds:averageLineSeconds(phrases,pause>0?pause:0.6);
 for(const auto& phrase:phrases){
  if(!result.empty()){
   const auto& previous=result.back();const double speechEnd=previous.end,gap=phrase.start-speechEnd;
   if(gap>=cadence){
    const auto complete=static_cast<std::size_t>(std::min(double(settings.visibleLines),std::floor(gap/cadence)));
    const auto& ref=phrase.wordRefs.front();
    const auto removed=d.containers[ref.containerIndex].words[ref.wordIndex].pauseLinesRemoved;
    const auto count=complete>removed?complete-removed:0;
    for(std::size_t index=0;index<count;++index){
     const double start=speechEnd+index*cadence,end=index+1<count?speechEnd+(index+1)*cadence:phrase.start;
     result.push_back({phrase.containerId,phrase.firstWord,0,start,end,{}});
    }
   }
  }
  result.push_back(phrase);
 }
 return result;
}
struct ComposedRow {
 std::vector<DrawWord> words;
 double width=0,ascent=0,descent=0,paintAscent=0,paintDescent=0,start=0,end=0;
 double advance(double lineHeight)const{return (ascent+descent)*lineHeight;}
};
// Both presentation modes use the same sampled typography. Scrolling may move
// a row, but never reserves a different word advance or changes its baseline.
std::vector<ComposedRow> composeRows(const Document& d,
 const std::vector<Phrase>& phrases,std::size_t begin,std::size_t end,double time,
 const LayoutBox& box,const MeasureText& measure,const TransformText& transform,double originX=0) {
 std::vector<ComposedRow> rows;ComposedRow row;
 auto flush=[&](){
  if(row.words.empty())return;
  double x=originX+lineInset(box,row.width);
  for(std::size_t index=0;index<row.words.size();++index){
   auto& run=row.words[index];if(index&&!punctuation(run.text))x+=d.style.wordSpacing;
   run.x=x+run.style.marginLeft;run.baseline=row.ascent;
   if(run.style.bubble&&run.style.bubbleFillSpaces&&index+1<row.words.size()&&!punctuation(row.words[index+1].text)){
    run.bubbleExtraWidth=d.style.wordSpacing;
    if(visibleBubble(run.style)&&visibleBubble(row.words[index+1].style)){run.bubbleJoinRight=true;row.words[index+1].bubbleJoinLeft=true;}
   }
   x+=run.width;
  }
  rows.push_back(std::move(row));row=ComposedRow{};
 };
 for(std::size_t phraseIndex=begin;phraseIndex<end;++phraseIndex){const auto& phrase=phrases[phraseIndex];
  if(!phrase.wordCount){
   const auto& style=time<phrase.start?d.style.upcoming:time<phrase.end?d.style.current:d.style.spoken;
   const auto metrics=measure(" ",style);
   require(finite(metrics.ascent)&&finite(metrics.descent)&&metrics.ascent>=0&&metrics.descent>=0&&metrics.ascent<=1e9&&metrics.descent<=1e9,"invalid text metrics");
   row.start=phrase.start;row.end=phrase.end;
   row.ascent=std::max(0.0,metrics.ascent+style.topPadding()+style.marginTop);row.descent=std::max(0.0,metrics.descent+style.bottomPadding()+style.marginBottom);
   rows.push_back(std::move(row));row=ComposedRow{};continue;
  }
  for(const auto& ref:phrase.wordRefs){const auto& container=d.containers[ref.containerIndex];const auto index=ref.wordIndex;
   const auto& word=container.words[index];const auto state=time<word.start?WordState::Upcoming:time<word.end?WordState::Current:WordState::Spoken;
   const auto style=state==WordState::Current?d.style.current:state==WordState::Spoken?d.style.spoken:d.style.upcoming;
   const auto text=transform?transform(word.text,d.style):displayText(word.text,d.style.titleCase,d.style.letterCase);const auto metrics=measure(text,style);
   require(finite(metrics.width)&&finite(metrics.ascent)&&finite(metrics.descent)&&metrics.width>=0&&metrics.ascent>=0&&metrics.descent>=0&&metrics.width<=1e9&&metrics.ascent<=1e9&&metrics.descent<=1e9,"invalid text metrics");
   const double width=std::max(0.0,metrics.width+style.horizontalPadding()+style.marginLeft+style.marginRight);
   // Authored padding reserves inline and row room even without paint.
   // Toggling the background cannot move text; editing padding can.
   const double ascent=std::max(0.0,metrics.ascent+style.topPadding()+style.marginTop),descent=std::max(0.0,metrics.descent+style.bottomPadding()+style.marginBottom);
   const double paintAscent=metrics.ascent+(style.bubble?style.topPadding():0),paintDescent=metrics.descent+(style.bubble?style.bottomPadding():0);
   double gap=!row.words.empty()&&!punctuation(text)?d.style.wordSpacing:0;
   // Phrase boundaries are authored by regrouping. Width changes may clip a
   // row, but must never add another line or shrink its typography.
   if(row.words.empty()){row.start=word.start;row.end=word.end;}else row.end=std::max(row.end,word.end);
   row.width+=gap+width;row.ascent=std::max(row.ascent,ascent);row.descent=std::max(row.descent,descent);row.paintAscent=std::max(row.paintAscent,paintAscent);row.paintDescent=std::max(row.paintDescent,paintDescent);
   const double paintHeight=std::max(0.0,paintAscent+style.marginTop)+std::max(0.0,paintDescent+style.marginBottom);
   row.words.push_back({text,container.id,index,state,style,0,0,width,paintHeight});
  }flush();
 }
 return rows;
}
Frame rollingFrame(const Document& d,double time,const LayoutBox& box,const MeasureText& measure,const TransformText& transform,const std::vector<Phrase>& phrases,const RollUpSettings& settings) {
 Frame result;
 if(phrases.empty())return result;
 double streamStart=phrases.front().start,streamEnd=0;for(const auto& phrase:phrases){streamStart=std::min(streamStart,phrase.start);streamEnd=std::max(streamEnd,phrase.end);}
 if(time<streamStart||time>=streamEnd)return result;
 // Splitting a caption authors a new line, never a new scrolling window.
 // Compose history, pauses and upcoming lines together with their source IDs.
 {
  auto rows=composeRows(d,phrases,0,phrases.size(),time,box,measure,transform);
  double maxAscent=0,maxDescent=0;std::unordered_map<std::string,Metrics> reservedCache;
  for(const auto& row:rows){
   if(row.words.empty()){const auto metrics=worstMetrics(" ",d.style,measure);maxAscent=std::max(maxAscent,metrics.ascent);maxDescent=std::max(maxDescent,metrics.descent);}
   for(const auto& word:row.words){
    auto found=reservedCache.find(word.text);if(found==reservedCache.end())found=reservedCache.emplace(word.text,worstMetrics(word.text,d.style,measure)).first;
    maxAscent=std::max(maxAscent,found->second.ascent);maxDescent=std::max(maxDescent,found->second.descent);
   }
  }
  if(rows.empty())return result;
  // Visible lines limits the window, never the authored font size.
  // Preserve typography and constrain the window to physical box capacity.
  const double rowHeight=std::max(1.0,(maxAscent+maxDescent)*d.style.lineHeight);
  const auto capacity=static_cast<std::size_t>(std::max(1.0,std::floor(box.height/rowHeight)));
  const auto lines=std::min(settings.visibleLines,capacity);
  for(const auto& line:rows)if(line.width>box.width)result.overflow=true;
  const double viewportHeight=std::min(box.height,lines*rowHeight),viewportTop=box.y+(box.height-viewportHeight)/2;
  result.rolling=true;result.viewport={box.x,viewportTop,box.width,viewportHeight};result.rollUp=settings;
  result.directionalPaintOutset=directionalPaintOutset(d.style);
  if(rowHeight>box.height)result.overflow=true;

  std::vector<double> rowTops(rows.size()+1,0);
  for(std::size_t index=0;index<rows.size();++index)rowTops[index+1]=rowTops[index]+rows[index].advance(d.style.lineHeight);
  const bool horizontal=settings.direction>=3;
  const auto blockRows=horizontal?lines:1;
  const auto blocks=(rows.size()+blockRows-1)/blockRows;
  const double distance=horizontal?box.width:rowHeight;
  // Horizontal scrolling pages ignore the current line position.
  const auto lead=std::min(std::max<std::size_t>(settings.currentLine,1),lines);
  const double initialOffset=horizontal?0:-double(lines-lead)*rowHeight;double steps=0;
  // Virtual leading blanks let the first line enter at the new-line edge.
  // Glide through all lead-1 blank slots during the first scrollDuration
  // (scaled by speed), rather than holding back any real line events. This
  // keeps speech/highlight times and ordinary line triggers untouched, and is
  // exactly the settled current-line layout once the opening glide ends.
  // Negative steps reuse every transition's normal neighbouring windows;
  // virtual blanks have the reserved slot height, not active word metrics.
  if(!horizontal&&lead>1&&settings.scrollDuration>0){
   const double duration=settings.scrollDuration/settings.speed;
   steps=-double(lead-1)*(1-rollCurve((time-rows.front().start)/duration,2));
  }
  auto authoredOffset=[&](double progress){
   if(progress<0)return progress*rowHeight;
   const auto whole=static_cast<std::size_t>(std::max(0.0,std::floor(progress)));
   const auto index=std::min(whole,rows.size()-1);const double fraction=progress-double(index);
   if(settings.direction==2){
    const double start=rowTops[index+1]-rows.front().advance(d.style.lineHeight);
    const auto next=std::min(index+1,rows.size()-1);
    return start+fraction*rows[next].advance(d.style.lineHeight);
   }
   return rowTops[index]+fraction*rows[index].advance(d.style.lineHeight);
  };
  for(std::size_t block=1;block<blocks;++block){
   const auto first=(block-1)*blockRows,last=std::min(rows.size(),first+blockRows);double end=rows[first].end;
   for(std::size_t index=first+1;index<last;++index)end=std::max(end,rows[index].end);
   const double start=rows[first].start;
   // Empty pause rows are ordinary timed rows: use the same line/page event
   // and duration for speech, blanks and upcoming text in every wait mode.
   const double trigger=settings.waitForLine?end:start;
   const double duration=(settings.waitForLine?settings.scrollDuration:std::max(settings.scrollDuration,end-start))/settings.speed;
   const double progress=duration>0?rollCurve((time-trigger)/duration,2):(time>=trigger?1:0);
   steps+=progress;
  }
  // Crossfade neighbouring settled windows for creative transitions. Reusing
  // the cumulative smooth progress also handles overlapping short-line events
  // deterministically, without animation state or an unbounded layer stack.
  using WordId=std::pair<std::string,std::size_t>;
  auto wordId=[](const DrawWord& word){return WordId{word.containerId,word.wordIndex};};
  auto paint=[&](double progress,double alpha,double scale,double shiftX,double shiftY,std::map<WordId,DrawWord>* settled=nullptr){
   if(alpha<=0)return;
   const double offset=initialOffset+(horizontal?distance*progress:authoredOffset(progress));
   const double legacyOffset=initialOffset+distance*progress;
   const double centerX=box.x+box.width/2,centerY=viewportTop+viewportHeight/2;
   for(std::size_t index=0;index<rows.size();++index){
    const auto& line=rows[index];
    double left=box.x,top=viewportTop,eligibilityTop=viewportTop;
    if(horizontal){const auto block=index/lines;const double shift=block*box.width-offset;left+=settings.direction==3?shift:-shift;top+=rowTops[index]-rowTops[block*lines];eligibilityTop+=(index%lines)*rowHeight;}
    else{
     const double origin=settings.direction==2?rowTops[index+1]-rows.front().advance(d.style.lineHeight):rowTops[index];
     const double shift=origin-offset,legacyShift=index*rowHeight-legacyOffset;
     top+=settings.direction==1?shift:viewportHeight-rowHeight-shift;
     eligibilityTop+=settings.direction==1?legacyShift:viewportHeight-rowHeight-legacyShift;
    }
    const double edgeTolerance=std::numeric_limits<double>::epsilon()*64*std::max({1.0,std::abs(viewportTop),std::abs(left),box.width,viewportHeight});
    // Keep the slot window and capacity, including upcoming rows reserved by
    // currentLine. Active style metrics position rows without adding slots.
    if(left+box.width<=box.x+edgeTolerance||left>=box.x+box.width-edgeTolerance||eligibilityTop+rowHeight<=viewportTop+edgeTolerance||eligibilityTop>=viewportTop+viewportHeight-edgeTolerance)continue;
    for(const auto& composed:line.words){
     auto run=composed;run.x+=left;run.baseline+=top;
     const double x=run.x,baseline=run.baseline;
     if(settled)settled->emplace(wordId(run),run);
     run.style.opacity*=alpha;
     run.style.fontSize*=scale;run.style.padding*=scale;if(run.style.bubblePaddingInline>=0)run.style.bubblePaddingInline*=scale;if(run.style.bubblePaddingBlock>=0)run.style.bubblePaddingBlock*=scale;run.style.scaleGeometry(scale,scale);run.style.radius*=scale;run.style.outlineWidth*=scale;run.style.shadowBlur*=scale;run.style.shadowX*=scale;run.style.shadowY*=scale;
     run.x=centerX+(x-centerX)*scale+shiftX;run.baseline=centerY+(baseline-centerY)*scale+shiftY;run.width*=scale;run.height*=scale;run.bubbleExtraWidth*=scale;
     result.words.push_back(std::move(run));
    }
   }
  };
  if(settings.transition==1)paint(steps,1,1,0,0);
  else{
   if(std::abs(steps-std::round(steps))<1e-9)steps=std::round(steps);
   const double previous=std::floor(steps),progress=steps-previous;
   const double beforeOffset=previous,afterOffset=previous+1;
   const auto firstLayer=result.words.size();std::map<WordId,DrawWord> settledIncoming;
   std::size_t secondLayer=firstLayer;
   if(settings.transition==2){paint(beforeOffset,1-progress,1,0,0);secondLayer=result.words.size();paint(afterOffset,progress,1,0,0,&settledIncoming);}
   else if(settings.transition==3){
    const double extent=horizontal?box.width:viewportHeight;
    const double sign=settings.direction==1||settings.direction==3?-1:1;
    paint(beforeOffset,1-progress,1,horizontal?sign*progress*extent:0,horizontal?0:sign*progress*extent);
    secondLayer=result.words.size();paint(afterOffset,progress,1,horizontal?-sign*(1-progress)*extent:0,horizontal?0:-sign*(1-progress)*extent,&settledIncoming);
   }else{paint(beforeOffset,1-progress,1-.15*progress,0,0);secondLayer=result.words.size();paint(afterOffset,progress,.8+.2*progress,0,0,&settledIncoming);}
   // History shared by both settled windows is one unchanged word, not two
   // crossfading copies. Keep it once at the incoming settled position. The
   // currently spoken word retains its authored opacity even while entering;
   // creative motion/scale is retained for genuinely incoming-only words.
   std::set<WordId> outgoingIds;
   for(auto index=firstLayer;index<secondLayer;++index)outgoingIds.insert(wordId(result.words[index]));
   std::vector<DrawWord> merged;merged.reserve(result.words.size()-firstLayer);
   for(auto index=firstLayer;index<secondLayer;++index){auto& run=result.words[index];if(settledIncoming.find(wordId(run))!=settledIncoming.end())continue;if(run.state==WordState::Current)run.style.opacity=d.style.current.opacity;merged.push_back(std::move(run));}
   for(auto index=secondLayer;index<result.words.size();++index){auto& run=result.words[index];if(outgoingIds.find(wordId(run))!=outgoingIds.end())run=settledIncoming.at(wordId(run));else if(run.state==WordState::Current)run.style.opacity=d.style.current.opacity;merged.push_back(std::move(run));}
   result.words.resize(firstLayer);for(auto& run:merged)result.words.push_back(std::move(run));
  }
 }return result;
}
}
double rollUpAlpha(double x,double y,const Frame& frame) {
 if(!frame.rolling)return 1;
 const auto& box=frame.viewport;const auto& settings=frame.rollUp;
 // Position/history bounds never impose an implicit four-sided paint crop.
 // All-sides mode opts into its explicit crop rectangle; directional mode
 // masks only its selected edge, leaving perpendicular overflow intact.
 if(settings.boundaryMode==1){
  const auto& top=settings.edges[0];const auto& bottom=settings.edges[1];const auto& left=settings.edges[2];const auto& right=settings.edges[3];
  const double x0=box.x+left.inset*box.width,x1=box.x+(1-right.inset)*box.width;
  const double y0=box.y+top.inset*box.height,y1=box.y+(1-bottom.inset)*box.height;
  if(x0>=x1||y0>=y1||x<x0||x>=x1||y<y0||y>=y1)return 0;
  const std::array<double,4> distances{{y-y0,y1-y,x-x0,x1-x}};
  double alpha=1;
  for(std::size_t index=0;index<settings.edges.size();++index){const auto& edge=settings.edges[index];
   if(!edge.fadeEnabled||edge.amount<=0||edge.thickness<=0)continue;
   const double length=index<2?box.height:box.width,feather=edge.thickness*length;
   const double strength=rollCurve(1-distances[index]/feather,edge.curve);
   alpha=std::min(alpha,1-edge.amount*strength);
  }
  return alpha;
 }
 if(!settings.boundaryEnabled)return 1;
 double position=y-box.y,length=box.height;
 if(settings.direction==2)position=box.y+box.height-y;
 if(settings.direction==3){position=x-box.x;length=box.width;}else if(settings.direction==4){position=box.x+box.width-x;length=box.width;}
 // Default edge follows the settled row's complete paint, including negative
 // margins and text effects. Keep the original feather length; deliberate
 // positive boundary positions and all independent crop edges remain exact.
 if(settings.boundaryPosition==0)position+=frame.directionalPaintOutset[settings.direction-1];
 const double start=settings.boundaryPosition*length,feather=settings.transitionThickness*length;
 if(position<start)return 0;
 const double strength=rollCurve(feather>0?1-(position-start)/feather:(position<=start?1:0),settings.transitionCurve);
 return 1-settings.fadeAmount*strength;
}
Frame layoutFrame(const Document& d,double time,const LayoutBox& box,const MeasureText& measureInput,std::size_t maxChars,double pause,const TransformText& transform,std::size_t groupsPerPage,const RollUpSettings& rollUp) {
 require(finite(time),"invalid time");require(finite(box.x)&&finite(box.y)&&finite(box.width)&&finite(box.height)&&box.width>0&&box.height>0,"invalid layout box");require(bool(measureInput),"missing text measurer");
 require(std::abs(box.x)<=1e7&&std::abs(box.y)<=1e7&&box.width<=1e7&&box.height<=1e7,"layout geometry exceeds bounds");
 require(box.alignment>=1&&box.alignment<=3,"invalid text alignment");
 require(groupsPerPage>=1&&groupsPerPage<=kMaxGroupsPerPage,"invalid groups per page");
 require(maxChars>=1&&maxChars<=500,"invalid character count");
 validateRollUp(rollUp);
 std::array<std::unordered_map<std::string,Metrics>,3> metricsCache;
 const std::array<const WordStyle*,3> styles{{&d.style.upcoming,&d.style.current,&d.style.spoken}};
 const MeasureText measure=[&](const std::string& text,const WordStyle& style){
  for(std::size_t index=0;index<styles.size();++index){const auto& candidate=*styles[index];
   if(style.fontFamily!=candidate.fontFamily||style.fontSize!=candidate.fontSize||style.sizeScale!=candidate.sizeScale||style.fontWeight!=candidate.fontWeight||style.italic!=candidate.italic||style.fontWeightOffset!=candidate.fontWeightOffset)continue;
   auto found=metricsCache[index].find(text);if(found==metricsCache[index].end())found=metricsCache[index].emplace(text,measureInput(text,style)).first;return found->second;
  }return measureInput(text,style);
 };
 Frame result;auto phrases=regroup(d,maxChars,pause);
 phrases=withSilenceRows(d,phrases,pause,rollUp);
 if(rollUp.enabled)return rollingFrame(d,time,box,measure,transform,phrases,rollUp);
 for(std::size_t first=0;first<phrases.size();){
  std::size_t last=first+1;double pageEnd=phrases[first].end;
  while(last<phrases.size()&&last-first<groupsPerPage){pageEnd=std::max(pageEnd,phrases[last].end);++last;}
  const auto begin=first;first=last;
  if(time<phrases[begin].start||time>=pageEnd)continue;
  const auto rows=composeRows(d,phrases,begin,last,time,box,measure,transform,box.x);double y=box.y;
  for(const auto& row:rows){
   const double height=row.ascent+row.descent;
   if(row.width>box.width||y+height>box.y+box.height||y+row.ascent-row.paintAscent<box.y||y+row.ascent+row.paintDescent>box.y+box.height)result.overflow=true;
   for(auto run:row.words){run.baseline+=y;result.words.push_back(std::move(run));}
   y+=row.advance(d.style.lineHeight);
  }
 }return result;
}
} // namespace better_captions
