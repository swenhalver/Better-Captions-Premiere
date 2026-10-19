#include "caption_core.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>
#include <limits>
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
 require(s.fontWeightOffset==-1||s.fontWeightOffset==0||s.fontWeightOffset==100,"invalid relative weight mode");
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
 require(d.schemaVersion>=1&&d.schemaVersion<=kSchemaVersion,"unsupported schema version");require(finite(d.timeOriginSeconds)&&std::abs(d.timeOriginSeconds)<=864000,"invalid document time origin");require(d.containers.size()<=10000,"too many containers");
 require(d.style.baseFontWeight==0||(finite(d.style.baseFontWeight)&&d.style.baseFontWeight>=1&&d.style.baseFontWeight<=1000),"invalid base font weight");
 std::size_t total=0,bytes=0;std::vector<std::string> ids;
 for(const auto& c:d.containers) {
  require(!c.id.empty()&&c.id.size()<=256,"invalid container id");text(c.id);ids.push_back(c.id);bytes+=c.id.size();
  total+=c.words.size();require(total<=kMaxWords,"too many words");double previous=-1;
  for(const auto& w:c.words) {require(!w.text.empty()&&w.text.size()<=4096,"invalid word text");text(w.text);bytes+=w.text.size();
   require(finite(w.start)&&finite(w.end)&&w.start>=0&&w.end>=w.start&&w.start>=previous,"invalid word timing");previous=w.start;}
 }
 std::sort(ids.begin(),ids.end());require(std::adjacent_find(ids.begin(),ids.end())==ids.end(),"duplicate container id");
 require(bytes<=kMaxDocumentBytes/2,"text limit exceeded");style(d.style.upcoming);style(d.style.current);style(d.style.spoken);
 require(d.style.letterCase>=0&&d.style.letterCase<=2&&!(d.style.letterCase&&d.style.titleCase),"invalid display letter case");
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
 validate(d);auto wireVersion=d.schemaVersion;
 bool typography=d.style.baseFontWeight!=0;
 for(const auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken})typography=typography||s->fontWeight!=0||s->italic!=-1||s->fontWeightOffset!=-1;
 if(d.style.letterCase)wireVersion=4;else if(typography&&wireVersion<3)wireVersion=3;else if(wireVersion==1&&d.timeOriginSeconds!=0)wireVersion=2;
 Writer w;w.u(0x50414342);w.u(wireVersion);w.u(static_cast<std::uint32_t>(d.containers.size()));
 for(const auto& c:d.containers){w.s(c.id);w.u(c.manualSplit);w.u(static_cast<std::uint32_t>(c.words.size()));for(const auto& a:c.words){w.s(a.text);w.d(a.start);w.d(a.end);w.u(a.endOfSentence);}}
 writeStyle(w,d.style.upcoming);writeStyle(w,d.style.current);writeStyle(w,d.style.spoken);w.d(d.style.wordSpacing);w.d(d.style.lineHeight);w.u(d.style.titleCase);
 if(wireVersion>=2)w.d(d.timeOriginSeconds);
 if(wireVersion>=3){w.d(d.style.baseFontWeight);for(const auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){w.d(s->fontWeight);w.u(static_cast<std::uint32_t>(s->italic+1));w.u(s->fontWeightOffset==-1?0:s->fontWeightOffset==0?1:2);}}
 if(wireVersion>=4)w.u(d.style.letterCase);
 require(w.b.size()<=kMaxDocumentBytes,"document size exceeded");return w.b;
}
Document decode(const std::vector<std::uint8_t>& b) {
 require(b.size()<=kMaxDocumentBytes,"document size exceeded");Reader r{b};require(r.u()==0x50414342,"invalid document magic");Document d;const auto wireVersion=r.u();require(wireVersion>=1&&wireVersion<=kSchemaVersion,"unsupported schema version");d.schemaVersion=wireVersion;
 auto n=r.u();require(n<=10000,"too many containers");std::size_t total=0;
 for(std::uint32_t i=0;i<n;++i){CaptionContainer c;c.id=r.s(256);c.manualSplit=r.flag();auto k=r.u();total+=k;require(total<=kMaxWords,"too many words");
 for(std::uint32_t j=0;j<k;++j){Word w;w.text=r.s(4096);w.start=r.d();w.end=r.d();w.endOfSentence=r.flag();c.words.push_back(std::move(w));}d.containers.push_back(std::move(c));}
 d.style.upcoming=readStyle(r);d.style.current=readStyle(r);d.style.spoken=readStyle(r);d.style.wordSpacing=r.d();d.style.lineHeight=r.d();d.style.titleCase=r.flag();if(wireVersion>=2)d.timeOriginSeconds=r.d();
 if(wireVersion>=3){d.style.baseFontWeight=r.d();for(auto* s:{&d.style.upcoming,&d.style.current,&d.style.spoken}){s->fontWeight=r.d();const auto italic=r.u(),offset=r.u();require(italic<=2&&offset<=2,"invalid native typography mode");s->italic=static_cast<int>(italic)-1;s->fontWeightOffset=offset==0?-1:offset==1?0:100;}}
 if(wireVersion>=4)d.style.letterCase=static_cast<int>(r.u());
 require(r.p==b.size(),"trailing document bytes");validate(d);return d;
}
std::string displayText(const std::string& text,bool title,int letterCase) {
 if(letterCase){std::string out=text;for(char& c:out){if(letterCase==1&&c>='a'&&c<='z')c-=32;else if(letterCase==2&&c>='A'&&c<='Z')c+=32;}return out;}
 if(!title)return text;std::string out=text;bool initial=true;
 for(char& c:out){auto u=static_cast<unsigned char>(c);if(u>=128){initial=false;continue;}if((c>='a'&&c<='z')||(c>='A'&&c<='Z')){if(initial&&c>='a'&&c<='z')c-=32;else if(!initial&&c>='A'&&c<='Z')c+=32;initial=false;}else if(c=='-'||c==' '||c=='\t')initial=true;}
 return out;
}
std::size_t sampledGroupsPerPage(double value) {
 require(finite(value),"invalid groups per page");
 return static_cast<std::size_t>(std::floor(std::max(1.0,std::min(double(kMaxGroupsPerPage),value))+.5));
}
bool sampledSmartLineFit(double value) { require(finite(value),"invalid smart line fit");return value>=.5; }
RollUpSettings sampledRollUpSettings(double enabled,double lines,double duration,double boundary,double position,double thickness,double fade,double curve,double direction,double speed,double wait,double transition) {
 for(double value:{enabled,lines,duration,boundary,position,thickness,fade,curve,direction,speed,wait,transition})require(finite(value),"invalid roll-up sample");
 auto clamp=[](double value,double low,double high){return std::max(low,std::min(high,value));};
 RollUpSettings settings;settings.enabled=enabled>=.5;settings.visibleLines=static_cast<std::size_t>(std::floor(clamp(lines,1,8)+.5));settings.scrollDuration=clamp(duration,0,2);
 settings.boundaryEnabled=boundary>=.5;settings.boundaryPosition=clamp(position,0,1);settings.transitionThickness=clamp(thickness,0,1);settings.fadeAmount=clamp(fade,0,1);
 settings.transitionCurve=static_cast<int>(std::floor(clamp(curve,1,4)+.5));settings.direction=static_cast<int>(std::floor(clamp(direction,1,4)+.5));settings.speed=clamp(speed,.1,10);settings.waitForLine=wait>=.5;settings.transition=static_cast<int>(std::floor(clamp(transition,1,4)+.5));return settings;
}
namespace {
double rollCurve(double value,int curve) {
 const auto x=std::max(0.0,std::min(1.0,value));
 if(curve==2)return x*x*(3-2*x);if(curve==3)return x*x;if(curve==4)return 1-(1-x)*(1-x);return x;
}
void validateRollUp(const RollUpSettings& s) {
 require(s.visibleLines>=1&&s.visibleLines<=8&&finite(s.scrollDuration)&&s.scrollDuration>=0&&s.scrollDuration<=2,"invalid roll-up settings");
 require(finite(s.boundaryPosition)&&s.boundaryPosition>=0&&s.boundaryPosition<=1&&finite(s.transitionThickness)&&s.transitionThickness>=0&&s.transitionThickness<=1&&finite(s.fadeAmount)&&s.fadeAmount>=0&&s.fadeAmount<=1,"invalid roll-up boundary");
 require(s.transitionCurve>=1&&s.transitionCurve<=4&&s.direction>=1&&s.direction<=4&&finite(s.speed)&&s.speed>=.1&&s.speed<=10&&s.transition>=1&&s.transition<=4,"invalid roll-up direction or speed");
}
Metrics worstMetrics(const std::string& text,const Style& style,const MeasureText& measure) {
 Metrics reserved;
 for(const auto* state:{&style.upcoming,&style.current,&style.spoken}){
  auto metrics=measure(text,*state);require(finite(metrics.width)&&finite(metrics.ascent)&&finite(metrics.descent)&&metrics.width>=0&&metrics.ascent>=0&&metrics.descent>=0&&metrics.width<=1e9&&metrics.ascent<=1e9&&metrics.descent<=1e9,"invalid text metrics");
  const double pad=state->bubble?state->padding:0;
  reserved.width=std::max(reserved.width,metrics.width+2*pad);reserved.ascent=std::max(reserved.ascent,metrics.ascent+pad);reserved.descent=std::max(reserved.descent,metrics.descent+pad);
 }return reserved;
}
struct RollingSlot {std::size_t index=0;std::string text;Metrics reserved;double left=0;};
struct RollingRow {std::vector<RollingSlot> words;double width=0,start=0,end=0;};
Frame rollingFrame(const Document& d,double time,const LayoutBox& box,const MeasureText& measure,const TransformText& transform,const std::vector<Phrase>& phrases,const RollUpSettings& settings) {
 Frame result;
 for(const auto& container:d.containers){
  if(container.words.empty())continue;
  double containerEnd=0;for(const auto& word:container.words)containerEnd=std::max(containerEnd,word.end);
  if(time<container.words.front().start||time>=containerEnd)continue;
  std::vector<RollingRow> rows;RollingRow row;double maxAscent=0,maxDescent=0;
  std::unordered_map<std::string,Metrics> reservedCache;
  auto flush=[&](){if(!row.words.empty()){rows.push_back(std::move(row));row=RollingRow{};}};
  for(const auto& phrase:phrases){if(phrase.containerId!=container.id)continue;
   for(std::size_t index=phrase.firstWord;index<phrase.firstWord+phrase.wordCount;++index){
    const auto& word=container.words[index];const auto text=transform?transform(word.text,d.style):displayText(word.text,d.style.titleCase,d.style.letterCase);
    auto found=reservedCache.find(text);if(found==reservedCache.end())found=reservedCache.emplace(text,worstMetrics(text,d.style,measure)).first;
    const auto metrics=found->second;maxAscent=std::max(maxAscent,metrics.ascent);maxDescent=std::max(maxDescent,metrics.descent);
    double gap=!row.words.empty()&&!punctuation(text)?d.style.wordSpacing:0;
    if(!row.words.empty()&&!punctuation(text)&&row.width+gap+metrics.width>box.width){flush();gap=0;}
    if(row.words.empty()){row.start=word.start;row.end=word.end;}else row.end=std::max(row.end,word.end);
    row.words.push_back({index,text,metrics,row.width+gap});row.width+=gap+metrics.width;
    if(row.width>box.width)result.overflow=true;
   }flush(); // Keep character/Smart phrase boundaries as explicit rolling rows.
  }
  if(rows.empty())continue;
  const double rowHeight=std::max(1.0,(maxAscent+maxDescent)*d.style.lineHeight);
  const auto fitting=static_cast<std::size_t>(std::max(1.0,std::floor(box.height/rowHeight)));
  const auto lines=std::min(settings.visibleLines,fitting);
  const double viewportHeight=std::min(box.height,lines*rowHeight),viewportTop=box.y+(box.height-viewportHeight)/2;
  result.rolling=true;result.viewport={box.x,viewportTop,box.width,viewportHeight};result.rollUp=settings;
  if(rowHeight>box.height)result.overflow=true;
  const bool horizontal=settings.direction>=3;
  const auto blockRows=horizontal?lines:1;
  const auto blocks=(rows.size()+blockRows-1)/blockRows;
  const double distance=horizontal?box.width:rowHeight;
  const double initialOffset=horizontal?0:-double(lines-1)*rowHeight;double steps=0;
  for(std::size_t block=1;block<blocks;++block){
   const auto first=(block-1)*blockRows,last=std::min(rows.size(),first+blockRows);double end=rows[first].end;
   for(std::size_t index=first+1;index<last;++index)end=std::max(end,rows[index].end);
   const double start=rows[first].start,trigger=settings.waitForLine?end:start;
   const double duration=(settings.waitForLine?settings.scrollDuration:std::max(settings.scrollDuration,end-start))/settings.speed;
   const double progress=duration>0?rollCurve((time-trigger)/duration,2):(time>=trigger?1:0);
   steps+=progress;
  }
  // Crossfade neighbouring settled windows for creative transitions. Reusing
  // the cumulative smooth progress also handles overlapping short-line events
  // deterministically, without animation state or an unbounded layer stack.
  auto paint=[&](double offset,double alpha,double scale,double shiftX,double shiftY){
   if(alpha<=0)return;
   const double centerX=box.x+box.width/2,centerY=viewportTop+viewportHeight/2;
   for(std::size_t index=0;index<rows.size();++index){
    const auto& line=rows[index];if(line.start>time)continue;
    double left=box.x,top=viewportTop;
    if(horizontal){const auto block=index/lines;const double shift=block*box.width-offset;left+=settings.direction==3?shift:-shift;top+=(index%lines)*rowHeight;}
    else{const double shift=index*rowHeight-offset;top+=settings.direction==1?shift:viewportHeight-rowHeight-shift;}
    if(left+box.width<=box.x||left>=box.x+box.width||top+rowHeight<=viewportTop||top>=viewportTop+viewportHeight)continue;
    for(const auto& slot:line.words){
     const auto& word=container.words[slot.index];if(word.start>time)continue;
     const auto state=time<word.end?WordState::Current:WordState::Spoken;
     auto style=state==WordState::Current?d.style.current:d.style.spoken;const auto metrics=measure(slot.text,style);
     const double pad=style.bubble?style.padding:0,width=metrics.width+2*pad;
     const double x=left+(box.width-line.width)/2+slot.left+(slot.reserved.width-width)/2;
     style.opacity*=alpha;
     style.fontSize*=scale;style.padding*=scale;style.radius*=scale;style.outlineWidth*=scale;style.shadowBlur*=scale;style.shadowX*=scale;style.shadowY*=scale;
     result.words.push_back({slot.text,container.id,slot.index,state,style,centerX+(x-centerX)*scale+shiftX,centerY+(top+maxAscent-centerY)*scale+shiftY,width*scale,(metrics.ascent+metrics.descent+2*pad)*scale});
    }
   }
  };
  if(settings.transition==1)paint(initialOffset+distance*steps,1,1,0,0);
  else{
   if(std::abs(steps-std::round(steps))<1e-9)steps=std::round(steps);
   const double previous=std::floor(steps),progress=steps-previous;
   const double beforeOffset=initialOffset+distance*previous,afterOffset=beforeOffset+distance;
   if(settings.transition==2){paint(beforeOffset,1-progress,1,0,0);paint(afterOffset,progress,1,0,0);}
   else if(settings.transition==3){
    const double extent=horizontal?box.width:viewportHeight;
    const double sign=settings.direction==1||settings.direction==3?-1:1;
    paint(beforeOffset,1-progress,1,horizontal?sign*progress*extent:0,horizontal?0:sign*progress*extent);
    paint(afterOffset,progress,1,horizontal?-sign*(1-progress)*extent:0,horizontal?0:-sign*(1-progress)*extent);
   }else{paint(beforeOffset,1-progress,1-.15*progress,0,0);paint(afterOffset,progress,.8+.2*progress,0,0);}
  }
 }return result;
}
}
double rollUpAlpha(double x,double y,const Frame& frame) {
 if(!frame.rolling)return 1;
 const auto& box=frame.viewport;const auto& settings=frame.rollUp;
 if(x<box.x||x>=box.x+box.width||y<box.y||y>=box.y+box.height)return 0;
 if(!settings.boundaryEnabled)return 1;
 double position=y-box.y,length=box.height;
 if(settings.direction==2)position=box.y+box.height-y;
 if(settings.direction==3){position=x-box.x;length=box.width;}else if(settings.direction==4){position=box.x+box.width-x;length=box.width;}
 const double start=settings.boundaryPosition*length,feather=settings.transitionThickness*length;
 if(position<start)return 0;
 const double strength=rollCurve(feather>0?1-(position-start)/feather:(position<=start?1:0),settings.transitionCurve);
 return 1-settings.fadeAmount*strength;
}
std::vector<Phrase> regroupToWidth(const Document& d,double width,const MeasureText& measure,double pause,const TransformText& transform) {
 validate(d);require(finite(width)&&width>0&&width<=1e7,"invalid smart line width");require(bool(measure),"missing text measurer");require(finite(pause)&&pause>=0&&pause<=60,"invalid pause");
 const double usable=width*.95;std::vector<Phrase> result;std::unordered_map<std::string,Metrics> cache;
 for(const auto& c:d.containers){
  std::size_t first=0,count=0;double used=0;
  auto flush=[&](){if(count){double end=c.words[first].end;for(std::size_t i=first+1;i<first+count;++i)end=std::max(end,c.words[i].end);result.push_back({c.id,first,count,c.words[first].start,end});count=0;used=0;}};
  for(std::size_t i=0;i<c.words.size();++i){
   const auto& word=c.words[i];const auto text=transform?transform(word.text,d.style):displayText(word.text,d.style.titleCase,d.style.letterCase);
   auto found=cache.find(text);if(found==cache.end())found=cache.emplace(text,worstMetrics(text,d.style,measure)).first;const double advance=found->second.width;
   const bool attached=punctuation(word.text);double gap=count&&!attached?d.style.wordSpacing:0;
   if(count&&!attached&&(used+gap+advance>usable||word.start-c.words[i-1].end>pause)){flush();gap=0;}
   if(!count)first=i;used+=gap+advance;++count;
   if(word.endOfSentence||(!word.text.empty()&&std::string(".!?").find(word.text.back())!=std::string::npos))flush();
  }flush();
 }return result;
}
Frame layoutFrame(const Document& d,double time,const LayoutBox& box,const MeasureText& measureInput,std::size_t maxChars,double pause,const TransformText& transform,std::size_t groupsPerPage,bool smartLineFit,const RollUpSettings& rollUp) {
 require(finite(time),"invalid time");require(finite(box.x)&&finite(box.y)&&finite(box.width)&&finite(box.height)&&box.width>0&&box.height>0,"invalid layout box");require(bool(measureInput),"missing text measurer");
 require(std::abs(box.x)<=1e7&&std::abs(box.y)<=1e7&&box.width<=1e7&&box.height<=1e7,"layout geometry exceeds bounds");
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
 Frame result;auto phrases=smartLineFit?regroupToWidth(d,box.width,measure,pause,transform):regroup(d,maxChars,pause);
 if(rollUp.enabled)return rollingFrame(d,time,box,measure,transform,phrases,rollUp);
 for(std::size_t first=0;first<phrases.size();){
  std::size_t last=first+1;double pageEnd=phrases[first].end;
  while(last<phrases.size()&&last-first<groupsPerPage&&phrases[last].containerId==phrases[first].containerId){pageEnd=std::max(pageEnd,phrases[last].end);++last;}
  const auto begin=first;first=last;
  if(time<phrases[begin].start||time>=pageEnd)continue;
  const auto it=std::find_if(d.containers.begin(),d.containers.end(),[&](const CaptionContainer& c){return c.id==phrases[begin].containerId;});
  std::vector<DrawWord> line;double lineWidth=0,lineAscent=0,lineDescent=0,y=box.y;
  auto flush=[&](){if(line.empty())return;double x=box.x+(box.width-lineWidth)/2;bool firstRun=true;for(auto& run:line){if(!firstRun&&!punctuation(run.text))x+=d.style.wordSpacing;run.x=x;run.baseline=y+lineAscent;x+=run.width;result.words.push_back(std::move(run));firstRun=false;}double h=lineAscent+lineDescent;if(y+h>box.y+box.height)result.overflow=true;y+=h*d.style.lineHeight;line.clear();lineWidth=lineAscent=lineDescent=0;};
  for(std::size_t phraseIndex=begin;phraseIndex<last;++phraseIndex){const auto& p=phrases[phraseIndex];
   for(std::size_t i=p.firstWord;i<p.firstWord+p.wordCount;++i){const auto& w=it->words[i];WordState state=time<w.start?WordState::Upcoming:time<w.end?WordState::Current:WordState::Spoken;
   WordStyle s=state==WordState::Current?d.style.current:state==WordState::Spoken?d.style.spoken:d.style.upcoming;
   auto text=transform?transform(w.text,d.style):displayText(w.text,d.style.titleCase,d.style.letterCase);auto m=measure(text,s);require(finite(m.width)&&finite(m.ascent)&&finite(m.descent)&&m.width>=0&&m.ascent>=0&&m.descent>=0&&m.width<=1e9&&m.ascent<=1e9&&m.descent<=1e9,"invalid text metrics");
   double pad=s.bubble?s.padding:0;double width=m.width+2*pad,ascent=m.ascent+pad,descent=m.descent+pad;
   double gap=!line.empty()&&!punctuation(text)?d.style.wordSpacing:0;
   if(!line.empty()&&!punctuation(text)&&lineWidth+gap+width>box.width){flush();gap=0;}
   lineWidth+=gap+width;lineAscent=std::max(lineAscent,ascent);lineDescent=std::max(lineDescent,descent);if(lineWidth>box.width)result.overflow=true;
   line.push_back({text,p.containerId,i,state,s,0,0,width,ascent+descent});
   }flush(); // Explicit group break, independently of width-based wrapping.
  }
 }return result;
}
} // namespace better_captions
