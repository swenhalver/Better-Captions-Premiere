#include "caption_core.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>

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
 for(double v:{s.padding,s.radius,s.outlineWidth,s.shadowBlur}) require(finite(v)&&v>=0&&v<=4096,"invalid style extent");
 require(finite(s.shadowX)&&finite(s.shadowY)&&std::abs(s.shadowX)<=4096&&std::abs(s.shadowY)<=4096,"invalid shadow offset");
 color(s.color);color(s.bubbleColor);color(s.outlineColor);color(s.shadowColor);
}
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
 require(d.schemaVersion==kSchemaVersion,"unsupported schema version");require(finite(d.timeOriginSeconds)&&std::abs(d.timeOriginSeconds)<=864000,"invalid document time origin");require(d.containers.size()<=10000,"too many containers");
 std::size_t total=0,bytes=0;std::vector<std::string> ids;
 for(const auto& c:d.containers) {
  require(!c.id.empty()&&c.id.size()<=256,"invalid container id");text(c.id);ids.push_back(c.id);bytes+=c.id.size();
  total+=c.words.size();require(total<=kMaxWords,"too many words");double previous=-1;
  for(const auto& w:c.words) {require(!w.text.empty()&&w.text.size()<=4096,"invalid word text");text(w.text);bytes+=w.text.size();
   require(finite(w.start)&&finite(w.end)&&w.start>=0&&w.end>=w.start&&w.start>=previous,"invalid word timing");previous=w.start;}
 }
 std::sort(ids.begin(),ids.end());require(std::adjacent_find(ids.begin(),ids.end())==ids.end(),"duplicate container id");
 require(bytes<=kMaxDocumentBytes/2,"text limit exceeded");style(d.style.upcoming);style(d.style.current);style(d.style.spoken);
 require(finite(d.style.wordSpacing)&&d.style.wordSpacing>=0&&d.style.wordSpacing<=4096,"invalid word spacing");
 require(finite(d.style.lineHeight)&&d.style.lineHeight>=1&&d.style.lineHeight<=10,"invalid line height");
}
std::vector<Phrase> regroup(const Document& d,std::size_t maxChars,double pause) {
 validate(d);require(maxChars>=1&&maxChars<=500,"invalid character count");require(finite(pause)&&pause>=0&&pause<=60,"invalid pause");
 std::vector<Phrase> out;
 for(const auto& c:d.containers) {
  std::size_t first=0,count=0,len=0;
  auto flush=[&](){if(count){double end=c.words[first].end;for(std::size_t j=first+1;j<first+count;++j)end=std::max(end,c.words[j].end);out.push_back({c.id,first,count,c.words[first].start,end});count=0;len=0;}};
  for(std::size_t i=0;i<c.words.size();++i) {const auto& w=c.words[i];auto n=chars(w.text);auto space=count&&!punctuation(w.text)?1u:0u;
   if(count&&((!punctuation(w.text)&&len+n+space>maxChars)||(!punctuation(w.text)&&w.start-c.words[i-1].end>pause)))flush();
   if(!count)first=i;len+=n+(count&&!punctuation(w.text)?1:0);++count;
   if(w.endOfSentence||(!w.text.empty()&&std::string(".!?").find(w.text.back())!=std::string::npos))flush();
  }flush();
 }return out;
}
std::vector<std::uint8_t> encode(const Document& d) {
 validate(d);Writer w;w.u(0x50414342);w.u(d.schemaVersion);w.u(static_cast<std::uint32_t>(d.containers.size()));
 for(const auto& c:d.containers){w.s(c.id);w.u(c.manualSplit);w.u(static_cast<std::uint32_t>(c.words.size()));for(const auto& a:c.words){w.s(a.text);w.d(a.start);w.d(a.end);w.u(a.endOfSentence);}}
 writeStyle(w,d.style.upcoming);writeStyle(w,d.style.current);writeStyle(w,d.style.spoken);w.d(d.style.wordSpacing);w.d(d.style.lineHeight);w.u(d.style.titleCase);w.d(d.timeOriginSeconds);
 require(w.b.size()<=kMaxDocumentBytes,"document size exceeded");return w.b;
}
Document decode(const std::vector<std::uint8_t>& b) {
 require(b.size()<=kMaxDocumentBytes,"document size exceeded");Reader r{b};require(r.u()==0x50414342,"invalid document magic");Document d;const auto wireVersion=r.u();require(wireVersion==1||wireVersion==kSchemaVersion,"unsupported schema version");
 auto n=r.u();require(n<=10000,"too many containers");std::size_t total=0;
 for(std::uint32_t i=0;i<n;++i){CaptionContainer c;c.id=r.s(256);c.manualSplit=r.flag();auto k=r.u();total+=k;require(total<=kMaxWords,"too many words");
 for(std::uint32_t j=0;j<k;++j){Word w;w.text=r.s(4096);w.start=r.d();w.end=r.d();w.endOfSentence=r.flag();c.words.push_back(std::move(w));}d.containers.push_back(std::move(c));}
 d.style.upcoming=readStyle(r);d.style.current=readStyle(r);d.style.spoken=readStyle(r);d.style.wordSpacing=r.d();d.style.lineHeight=r.d();d.style.titleCase=r.flag();if(wireVersion>=2)d.timeOriginSeconds=r.d();require(r.p==b.size(),"trailing document bytes");validate(d);return d;
}
std::string displayText(const std::string& text,bool title) {
 if(!title)return text;std::string out=text;bool initial=true;
 for(char& c:out){auto u=static_cast<unsigned char>(c);if(u>=128){initial=false;continue;}if((c>='a'&&c<='z')||(c>='A'&&c<='Z')){if(initial&&c>='a'&&c<='z')c-=32;else if(!initial&&c>='A'&&c<='Z')c+=32;initial=false;}else if(c=='-'||c==' '||c=='\t')initial=true;}
 return out;
}
Frame layoutFrame(const Document& d,double time,const LayoutBox& box,const MeasureText& measure,std::size_t maxChars,double pause) {
 require(finite(time),"invalid time");require(finite(box.x)&&finite(box.y)&&finite(box.width)&&finite(box.height)&&box.width>0&&box.height>0,"invalid layout box");require(bool(measure),"missing text measurer");
 require(std::abs(box.x)<=1e7&&std::abs(box.y)<=1e7&&box.width<=1e7&&box.height<=1e7,"layout geometry exceeds bounds");
 Frame result;auto phrases=regroup(d,maxChars,pause);
 for(const auto& p:phrases){if(time<p.start||time>=p.end)continue;
  const auto it=std::find_if(d.containers.begin(),d.containers.end(),[&](const CaptionContainer& c){return c.id==p.containerId;});
  std::vector<DrawWord> line;double lineWidth=0,lineAscent=0,lineDescent=0,y=box.y;
  auto flush=[&](){if(line.empty())return;double x=box.x+(box.width-lineWidth)/2;bool firstRun=true;for(auto& run:line){if(!firstRun&&!punctuation(run.text))x+=d.style.wordSpacing;run.x=x;run.baseline=y+lineAscent;x+=run.width;result.words.push_back(std::move(run));firstRun=false;}double h=lineAscent+lineDescent;if(y+h>box.y+box.height)result.overflow=true;y+=h*d.style.lineHeight;line.clear();lineWidth=lineAscent=lineDescent=0;};
  for(std::size_t i=p.firstWord;i<p.firstWord+p.wordCount;++i){const auto& w=it->words[i];WordState state=time<w.start?WordState::Upcoming:time<w.end?WordState::Current:WordState::Spoken;
   WordStyle s=state==WordState::Current?d.style.current:state==WordState::Spoken?d.style.spoken:d.style.upcoming;
   auto text=displayText(w.text,d.style.titleCase);auto m=measure(text,s);require(finite(m.width)&&finite(m.ascent)&&finite(m.descent)&&m.width>=0&&m.ascent>=0&&m.descent>=0&&m.width<=1e9&&m.ascent<=1e9&&m.descent<=1e9,"invalid text metrics");
   double pad=s.bubble?s.padding:0;double width=m.width+2*pad,ascent=m.ascent+pad,descent=m.descent+pad;
   double gap=!line.empty()&&!punctuation(text)?d.style.wordSpacing:0;
   if(!line.empty()&&!punctuation(text)&&lineWidth+gap+width>box.width){flush();gap=0;}
   lineWidth+=gap+width;lineAscent=std::max(lineAscent,ascent);lineDescent=std::max(lineDescent,descent);if(lineWidth>box.width)result.overflow=true;
   line.push_back({text,p.containerId,i,state,s,0,0,width,ascent+descent});
  }flush();
 }return result;
}
} // namespace better_captions
