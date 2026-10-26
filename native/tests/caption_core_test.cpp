#ifdef NDEBUG
#undef NDEBUG // Test checks remain active in Release builds.
#endif
#include "../core/caption_core.hpp"
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstring>
#include <iostream>
#include <fstream>
#include <iterator>
#include <limits>
#include <set>
#include <stdexcept>
using namespace better_captions;
template<class F> void rejects(F f){bool rejected=false;try{f();}catch(const std::invalid_argument&){rejected=true;}assert(rejected);}
Document sample(){Document d;d.containers.push_back({"original",false,{{"HELLO",0,0.4,false},{"world",0.4,0.8,false},{"again.",0.8,1.2,true},{"later",2,3,false}}});d.style.current.color={1,0,0,1};d.style.spoken.opacity=0.5;return d;}
Metrics measure(const std::string& text,const WordStyle& s){double px=s.fontSize*s.sizeScale;return {text.size()*px*0.5,px*0.8,px*0.2};}
// Materialize historical fixture layouts from their documented fixed suffixes,
// omitting newer per-word metadata as appropriate. Production always writes the current schema.
std::vector<std::uint8_t> legacyWire(const Document& document,std::uint32_t version){
 assert(version>=1&&version<=8);const auto current=encode(document);std::vector<std::uint8_t> legacy(current.begin(),current.begin()+12);legacy[4]=static_cast<std::uint8_t>(version);
 std::size_t pos=12;
 auto u=[&](std::size_t offset){std::uint32_t value=0;for(unsigned i=0;i<4;++i)value|=std::uint32_t(current.at(offset+i))<<(8*i);return value;};
 for(std::size_t c=0;c<document.containers.size();++c){const auto begin=pos;pos+=4+u(pos)+4;const auto count=u(pos);pos+=4;legacy.insert(legacy.end(),current.begin()+begin,current.begin()+pos);
  for(std::uint32_t word=0;word<count;++word){const auto start=pos;pos+=4+u(pos)+8+8+4;if(version>=8)pos+=4;legacy.insert(legacy.end(),current.begin()+start,current.begin()+pos);pos+=version>=8?4:8;}
 }
 legacy.insert(legacy.end(),current.begin()+pos,current.end());
 const std::size_t removed=4+(version<7?288:0)+(version<6?60:0)+(version<5?12:0)+(version<4?4:0)+(version<3?56:0)+(version<2?8:0);
 legacy.resize(legacy.size()-removed);return legacy;
}
void sameRenderedFrame(const Frame& a,const Frame& b){
 assert(a.words.size()==b.words.size()&&a.overflow==b.overflow&&a.rolling==b.rolling);
 assert(a.viewport.x==b.viewport.x&&a.viewport.y==b.viewport.y&&a.viewport.width==b.viewport.width&&a.viewport.height==b.viewport.height&&a.directionalPaintOutset==b.directionalPaintOutset);
 for(std::size_t index=0;index<a.words.size();++index){const auto& x=a.words[index];const auto& y=b.words[index];
  assert(x.text==y.text&&x.containerId==y.containerId&&x.wordIndex==y.wordIndex&&x.state==y.state&&x.x==y.x&&x.baseline==y.baseline&&x.width==y.width&&x.height==y.height&&x.bubbleExtraWidth==y.bubbleExtraWidth&&x.bubbleJoinLeft==y.bubbleJoinLeft&&x.bubbleJoinRight==y.bubbleJoinRight);
  Document xs,ys;xs.style.current=x.style;ys.style.current=y.style;assert(encode(xs)==encode(ys));
 }
}
// Reference pause rows are authored blank lines, which draw nothing. This
// checks timing, geometry and transitions (including the glide through blank
// rows) without relying on the implementation's derived-row or silence logic.
Frame ordinaryPauseFrame(const Document& source,double time,const LayoutBox& box,const RollUpSettings& settings,std::size_t groups=1){
 auto reference=source;reference.containers.front().words.clear();std::vector<std::size_t> indices;
 const auto phrases=regroup(source,56,.6);double total=0;std::size_t count=0;
 for(const auto& phrase:phrases)if(phrase.end>phrase.start){total+=phrase.end-phrase.start;++count;}
 const double cadence=settings.blankLineSeconds>0?settings.blankLineSeconds:count?total/double(count):.6;
 for(std::size_t p=0;p<phrases.size();++p){const auto& phrase=phrases[p];
  if(p){const double previousEnd=phrases[p-1].end;const auto complete=static_cast<std::size_t>(std::min(double(settings.visibleLines),std::floor(std::max(0.0,phrase.start-previousEnd)/cadence)));
   const auto& first=phrase.wordRefs.front();const auto removed=source.containers[first.containerIndex].words[first.wordIndex].pauseLinesRemoved;
   const auto blanks=complete>removed?complete-removed:0;
   for(std::size_t blank=0;blank<blanks;++blank){reference.containers.front().words.push_back({"",previousEnd+double(blank)*cadence,blank+1<blanks?previousEnd+double(blank+1)*cadence:phrase.start,true});indices.push_back(std::numeric_limits<std::size_t>::max());}
  }
  for(auto index=phrase.firstWord;index<phrase.firstWord+phrase.wordCount;++index){reference.containers.front().words.push_back(source.containers.front().words[index]);indices.push_back(index);}
  reference.containers.front().words.back().endOfSentence=true;
 }
 auto ordinary=settings;ordinary.blankLineSeconds=30;
 auto frame=layoutFrame(reference,time,box,measure,56,60,{},groups,ordinary);
 for(auto& word:frame.words)word.wordIndex=indices.at(word.wordIndex);
 return frame;
}
// Line wrap fixtures share their expected lines with tests/line-wrap.test.mjs.
std::string wrapped(const Document& d,std::size_t maxChars){
 std::string out;for(const auto& phrase:regroup(d,maxChars)){if(!out.empty())out+=" / ";for(std::size_t i=0;i<phrase.wordRefs.size();++i){if(i)out+=" ";out+=d.containers[phrase.wordRefs[i].containerIndex].words[phrase.wordRefs[i].wordIndex].text;}}
 return out;
}
Document spoken(const std::string& text,LineWrap mode,double step=.3){
 Document d;d.style.lineWrap=mode;CaptionContainer c{"wrap",false,{}};double t=0;std::size_t at=0;
 while(at<=text.size()){auto next=text.find(' ',at);if(next==std::string::npos)next=text.size();c.words.push_back({text.substr(at,next-at),t,t+step*.9,false});t+=step;at=next+1;}
 d.containers.push_back(c);return d;
}
// An empty word is an authored blank line: a timed row that stands alone in
// every wrap mode, draws nothing (no text, bubble or shadow), and is not speech.
void blankLineChecks(){
 auto blankDoc=[](const std::string& middle){
  Document d;d.containers.push_back({"blank",false,{{"Before",0,1,false},{middle,1,2,false},{",after",2,3,false}}});
  d.containers[0].words[1].lineBreakBefore=LineBreakBefore::Join;d.containers[0].words[2].lineBreakBefore=LineBreakBefore::Join;
  for(auto* style:{&d.style.current,&d.style.upcoming,&d.style.spoken}){style->fontSize=10;style->bubble=true;style->bubbleColor={0,0,1,1};style->shadowBlur=4;}
  return d;
 };
 const auto blank=blankDoc("");validate(blank);
 // The same rows with a visible middle line, held apart by manual breaks.
 auto visibleDoc=blankDoc("x");for(std::size_t i:{1,2})visibleDoc.containers[0].words[i].lineBreakBefore=LineBreakBefore::Break;
 assert(decode(encode(blank)).containers[0].words[1].text.empty()&&encode(decode(encode(blank)))==encode(blank));
 auto instant=blank;instant.containers[0].words[1].end=1;rejects([&]{validate(instant);});
 for(auto mode:{LineWrap::Fill,LineWrap::Balance,LineWrap::Pretty}){auto d=blank;d.style.lineWrap=mode;
  // Joins and leading punctuation never glue a word to a blank line.
  const auto phrases=regroup(d,56);assert(phrases.size()==3&&phrases[1].wordCount==1&&phrases[1].start==1&&phrases[1].end==2);}
 for(double time:{0.5,1.5,2.5}){
  const auto page=layoutFrame(blank,time,{0,0,400,400},measure,56,.6,{},3),visible=layoutFrame(visibleDoc,time,{0,0,400,400},measure,56,.6,{},3);
  assert(page.words.size()==2&&visible.words.size()==3);
  for(const auto& run:page.words)assert(!run.text.empty());
  // The blank row reserves the same slot a visible line would.
  assert(page.words[1].baseline==visible.words[2].baseline&&page.words[0].baseline==visible.words[0].baseline);
 }
 for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=3;settings.direction=direction;settings.boundaryEnabled=false;
  for(double time:{0.5,1.5,2.5}){const auto frame=layoutFrame(blank,time,{0,0,400,400},measure,56,.6,{},1,settings);for(const auto& run:frame.words)assert(!run.text.empty()&&run.containerId=="blank"&&run.wordIndex!=1);}
 }
 // Blank lines do not set the derived pause cadence: lines of 1 s make a 2.5 s
 // gap two pause rows. Counting the 8 s blank line as speech would give none.
 Document paced;paced.containers.push_back({"paced",false,{{"A.",0,1,true},{"",1.5,9.5,false},{"B.",12,13,true}}});
 for(auto* style:{&paced.style.current,&paced.style.upcoming,&paced.style.spoken}){style->fontSize=10;style->bubble=false;}
 const auto row=layoutFrame(visibleDoc,2.5,{0,0,400,400},measure,56,.6,{},3);const double advance=row.words[1].baseline-row.words[0].baseline;
 const auto pacedPage=layoutFrame(paced,12.5,{0,0,400,400},measure,56,.6,{},8);
 assert(pacedPage.words.size()==2&&std::abs(pacedPage.words[1].baseline-pacedPage.words[0].baseline-4*advance)<1e-9);
}
void lineWrapChecks(){
 const std::string fox="The quick brown fox jumps over the lazy dog.";
 assert(wrapped(spoken(fox,LineWrap::Fill),20)=="The quick brown fox / jumps over the lazy / dog.");
 assert(wrapped(spoken(fox,LineWrap::Balance),20)=="The quick brown / fox jumps over / the lazy dog.");
 assert(wrapped(spoken(fox,LineWrap::Pretty),20)=="The quick brown fox / jumps over / the lazy dog.");
 // A full last line keeps Pretty identical to Fill; Balance evens two lines.
 const std::string it="The quick brown fox jumps over it.";
 assert(wrapped(spoken(it,LineWrap::Pretty),20)=="The quick brown fox / jumps over it."&&wrapped(spoken(it,LineWrap::Balance),20)=="The quick brown / fox jumps over it.");
 // Pretty prefers a two-word last line over the most even pair.
 const std::string count="one two three four five six seven eight nine ten eleven";
 assert(wrapped(spoken(count,LineWrap::Fill),12)=="one two / three four / five six / seven eight / nine ten / eleven");
 assert(wrapped(spoken(count,LineWrap::Pretty),12)=="one two / three four / five six / seven eight / nine / ten eleven");
 // Unicode scalars count once; an overlong word stands alone in every mode.
 for(auto mode:{LineWrap::Fill,LineWrap::Balance,LineWrap::Pretty}){
  assert(wrapped(spoken("日本語 café naïve über",mode),10)=="日本語 café / naïve über");
  assert(wrapped(spoken("go extraordinarily far",mode),6)=="go / extraordinarily / far");
 }
 // Hard breaks bound every mode: sentence ends, pauses, manual and merge edges.
 for(auto mode:{LineWrap::Fill,LineWrap::Balance,LineWrap::Pretty}){
  auto d=spoken("aa bb. cc dd ee ff",mode);assert(wrapped(d,56)=="aa bb. / cc dd ee ff");
  d.containers[0].words[4].start=3;d.containers[0].words[4].end=3.2;d.containers[0].words[5].start=3.3;d.containers[0].words[5].end=3.5;assert(wrapped(d,56)=="aa bb. / cc dd / ee ff");
  d=spoken("aa bb cc dd",mode);d.containers[0].words[2].lineBreakBefore=LineBreakBefore::Break;assert(wrapped(d,56)=="aa bb / cc dd");
  d.containers[0].words[2].lineBreakBefore=LineBreakBefore::MergeEdge;assert(wrapped(d,56)=="aa bb / cc dd");
  // A merged run is one unit: never split, even past the limit.
  d=spoken("aa bb cc dd ee",mode);d.containers[0].words[1].lineBreakBefore=LineBreakBefore::MergeEdge;for(int i:{2,3})d.containers[0].words[i].lineBreakBefore=LineBreakBefore::Join;d.containers[0].words[4].lineBreakBefore=LineBreakBefore::MergeEdge;
  assert(wrapped(d,5)=="aa / bb cc dd / ee");
  // Characters per line is a maximum: glued punctuation counts toward it.
  d=spoken("aaaa bbbb ...",mode);assert(wrapped(d,9)=="aaaa / bbbb ...");
 }
 // No line lasts longer than kMaxLineSeconds; one long word still stands alone.
 for(auto mode:{LineWrap::Fill,LineWrap::Balance,LineWrap::Pretty}){
  auto slow=spoken("a b c d e f g h",mode,1.5);assert(wrapped(slow,56)=="a b c / d e f / g h");
  for(const auto& phrase:regroup(slow,56))assert(phrase.end-phrase.start<=kMaxLineSeconds);
  auto longWord=spoken("hold this",mode);longWord.containers[0].words[0].end=7;longWord.containers[0].words[1].start=7;longWord.containers[0].words[1].end=7.3;assert(wrapped(longWord,56)=="hold / this");
 }
 // Balance keeps Fill's line count.
 auto many=spoken("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore",LineWrap::Fill);
 const auto fillCount=regroup(many,24).size();many.style.lineWrap=LineWrap::Balance;assert(regroup(many,24).size()==fillCount);
 // v11 stores the wrap as one u32 after the v7 footer; v10 bytes decode as Fill.
 auto wire=spoken(fox,LineWrap::Pretty);const auto bytes=encode(wire);assert(bytes[4]==11&&bytes.back()==0&&bytes[bytes.size()-4]==2);
 assert(decode(bytes).style.lineWrap==LineWrap::Pretty&&encode(decode(bytes))==bytes);
 auto v10=bytes;v10.resize(v10.size()-4);v10[4]=10;assert(decode(v10).style.lineWrap==LineWrap::Fill);
 auto bad=bytes;bad[bad.size()-4]=3;rejects([&]{decode(bad);});
 auto invalid=wire;invalid.style.lineWrap=static_cast<LineWrap>(3);rejects([&]{validate(invalid);});
}
int main(int argc,char** argv){
 if(argc==4&&std::string(argv[1])=="--lines"){
  // Prints each line's first word index in the flat word stream.
  std::ifstream input(argv[2],std::ios::binary);assert(input.good());
  std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(input)),std::istreambuf_iterator<char>());
  const auto d=decode(bytes);std::size_t offset=0;std::vector<std::size_t> starts(d.containers.size());
  for(std::size_t c=0;c<d.containers.size();++c){starts[c]=offset;offset+=d.containers[c].words.size();}
  for(const auto& phrase:regroup(d,static_cast<std::size_t>(std::stoul(argv[3]))))std::cout<<starts[phrase.wordRefs[0].containerIndex]+phrase.wordRefs[0].wordIndex<<"\n";
  return 0;
 }
 if(argc==4&&std::string(argv[1])=="--roundtrip"){
  std::ifstream input(argv[2],std::ios::binary);assert(input.good());
  std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(input)),std::istreambuf_iterator<char>());
  auto out=encode(decode(bytes));std::ofstream output(argv[3],std::ios::binary);output.write(reinterpret_cast<const char*>(out.data()),static_cast<std::streamsize>(out.size()));assert(output.good());return 0;
 }

 auto d=sample();
 for(const auto& badText:std::vector<std::string>{std::string("\xff"),std::string("\xc0\xaf"),std::string("\xed\xa0\x80"),std::string("\xf4\x90\x80\x80"),std::string("\xe2\x82"),std::string("bad\ntext"),std::string("a\0b",3),std::string("\xc2\x85")}) {
  auto malformed=d;malformed.containers[0].words[0].text=badText;rejects([&]{validate(malformed);});
  malformed=d;malformed.style.current.fontFamily=badText;rejects([&]{validate(malformed);});
 }
 auto unicode=d;unicode.containers[0].words[0].text="café 😀";assert(encode(decode(encode(unicode)))==encode(unicode));
 Document punct;punct.containers.push_back({"punct",false,{{"Hello",0,1,false},{",",1,1,false},{"there",1,2,false}}});
 auto grouped=regroup(punct,5);assert(grouped.size()==2&&grouped[0].wordCount==2);
 auto punctuationFrame=layoutFrame(punct,0.5,{0,0,1000,100},measure);assert(punctuationFrame.words.size()==3);assert(punctuationFrame.words[1].x==punctuationFrame.words[0].x+punctuationFrame.words[0].width);
 rejects([&]{layoutFrame(d,0.4,{1e308,0,1e308,300},measure);});
auto p=regroup(d,56);assert(p.size()==2&&p[0].wordCount==3&&p[1].firstWord==3);
 p=regroup(d,8);assert(p.size()==4);assert(d.containers[0].id=="original"&&d.containers[0].words[0].text=="HELLO");
 d.containers.push_back({"razor-right",true,{{"separate",3,4,false,LineBreakBefore::Break}}});assert(regroup(d,500).size()==3);assert(d.containers[1].manualSplit);
 auto encoded=encode(d);auto copy=decode(encoded);assert(encode(copy)==encoded&&copy.containers[1].manualSplit&&copy.style.spoken.opacity==0.5);
 // BCAP v8 stores auto=0/break=1/join=2 immediately after each word's EOS.
 {
  Document modes;modes.containers={{"id",false,{{"X",0,1,false,LineBreakBefore::Auto},{"Y",1,2,true,LineBreakBefore::Break},{"Z",2,3,false,LineBreakBefore::Join}}}};
  const auto bytes=encode(modes);assert(bytes[4]==kSchemaVersion);
  for(const auto item:std::vector<std::pair<std::size_t,unsigned>>{{51,0},{84,1},{117,2}}){
   assert(bytes[item.first]==item.second&&bytes[item.first+1]==0&&bytes[item.first+2]==0&&bytes[item.first+3]==0);
   for(unsigned invalid:{4u,255u}){auto malformed=bytes;malformed[item.first]=static_cast<std::uint8_t>(invalid);rejects([&]{decode(malformed);});}
  }
  const auto decoded=decode(bytes);assert(decoded.schemaVersion==kSchemaVersion&&encode(decoded)==bytes&&decoded.containers[0].words[2].lineBreakBefore==LineBreakBefore::Join);
  modes.schemaVersion=1;assert(encode(modes)==bytes); // Writes always use the current schema.
  modes.containers[0].words[0].lineBreakBefore=static_cast<LineBreakBefore>(4);rejects([&]{validate(modes);});
  // V10 merge edges render as hard breaks, round trip, and are invalid on older wires.
  Document edges;edges.containers={{"id",false,{{"X",0,1,false},{"Y",1,2,false,LineBreakBefore::MergeEdge},{"Z",2,3,false,LineBreakBefore::Join}}}};
  const auto edgeBytes=encode(edges);assert(edgeBytes[84]==3&&encode(decode(edgeBytes))==edgeBytes&&decode(edgeBytes).containers[0].words[1].lineBreakBefore==LineBreakBefore::MergeEdge);
  const auto edgeRows=regroup(edges,500);assert(edgeRows.size()==2&&edgeRows[1].firstWord==1&&edgeRows[1].wordCount==2);
  auto edgeV9=edgeBytes;edgeV9[4]=9;rejects([&]{decode(edgeV9);});
 }
 // V9 stores bounded deletion metadata after each v8 boundary field. It is
 // word metadata, including when currently inside a joined line, and survives
 // saved editing/Undo snapshots byte for byte.
 {
  for(std::uint32_t removed=0;removed<=8;++removed){
   auto source=sample();source.containers[0].words.back().pauseLinesRemoved=removed;
   const auto saved=encode(source),restored=encode(decode(saved));assert(saved==restored);
   assert(decode(saved).containers[0].words.back().pauseLinesRemoved==removed);
  }
  Document wire;wire.containers={{"id",false,{{"X",0,1,false,LineBreakBefore::Join,8}}}};
  const auto bytes=encode(wire);assert(bytes[4]==kSchemaVersion&&bytes[51]==2&&bytes[55]==8);
  for(std::uint32_t invalid:{9u,255u,0xffffffffu}){
   wire.containers[0].words[0].pauseLinesRemoved=invalid;rejects([&]{validate(wire);});
   auto malformed=bytes;for(unsigned byte=0;byte<4;++byte)malformed[55+byte]=static_cast<std::uint8_t>(invalid>>(8*byte));rejects([&]{decode(malformed);});
  }
  auto source=sample();source.containers[0].words.back().pauseLinesRemoved=8;
  source.containers.push_back({"next",true,{{"next",4,5,false,LineBreakBefore::Join,5}}});
  for(std::uint32_t version=1;version<=8;++version){
   const auto restored=decode(legacyWire(source,version));
   for(const auto& container:restored.containers)for(const auto& word:container.words)assert(word.pauseLinesRemoved==0);
   assert(restored.containers[1].words.front().lineBreakBefore==(version<=7?LineBreakBefore::Break:LineBreakBefore::Join));
  }
 }
 // Every historical schema loads into v9. Preserve all words, styles, IDs,
 // times and storage metadata, with one explicit break per old boundary.
 for(std::uint32_t version=1;version<=7;++version){
  auto source=sample();source.containers.push_back({"empty",true,{}});source.containers.push_back({"legacy-next",false,{{"naïve",3,3.5,false},{"tail",3.5,4,true}}});source.containers.push_back({"legacy-last",true,{{"last",4,5,false}}});
  source.style.current.fontFamily="Arial Bold";source.style.upcoming.color={.1,.2,.3,.4};source.style.spoken.bubble=true;source.style.spoken.padding=3;source.style.spoken.shadowX=-2;
  if(version>=2)source.timeOriginSeconds=123.456;
  if(version>=3){source.style.baseFontWeight=500;source.style.current.fontWeight=700;source.style.current.italic=1;source.style.spoken.fontWeightOffset=0;}
  if(version>=4)source.style.letterCase=2;
  if(version>=5)source.style.upcoming.bubbleFillSpaces=true;
  if(version>=6){source.style.current.bubblePaddingInline=4;source.style.current.bubblePaddingBlock=7;source.style.current.underline=1;}
  if(version>=7){source.style.upcoming.paddingTop=3;source.style.upcoming.radiusBR=5;source.style.spoken.marginLeft=-2;}
  const auto before=encode(source);const auto historical=legacyWire(source,version);auto expected=source;
  for(std::size_t c=1;c<expected.containers.size();++c)if(!expected.containers[c].words.empty())expected.containers[c].words.front().lineBreakBefore=LineBreakBefore::Break;
  const auto migrated=decode(historical);assert(migrated.schemaVersion==kSchemaVersion&&encode(migrated)==encode(expected)&&encode(source)==before);
  assert(migrated.containers[0].words.front().lineBreakBefore==LineBreakBefore::Auto&&migrated.containers[2].words.front().lineBreakBefore==LineBreakBefore::Break&&migrated.containers[2].words[1].lineBreakBefore==LineBreakBefore::Auto);
  assert(encode(decode(encode(migrated)))==encode(migrated));
 }
 // V8 storage boundaries, IDs and manualSplit flags have no grouping effect.
 // A line may retain words from several containers; explicit join overrides
 // the character limit, the pause threshold and the previous word's EOS.
 {
  Document stream;stream.style.lineHeight=1;for(auto* style:{&stream.style.current,&stream.style.upcoming,&stream.style.spoken}){style->fontSize=10;style->padding=0;}
  stream.containers={{"left",true,{{"Alpha",0,1,false}}},{"right",true,{{"beta",1,2,false}}}};
  auto groups=regroup(stream,56);assert(groups.size()==1&&groups[0].wordCount==2&&groups[0].containerId=="left"&&groups[0].firstWord==0&&groups[0].wordRefs.size()==2);
  assert(groups[0].wordRefs[0].containerIndex==0&&groups[0].wordRefs[0].wordIndex==0&&groups[0].wordRefs[1].containerIndex==1&&groups[0].wordRefs[1].wordIndex==0);
  assert(decode(encode(stream)).containers[1].words.front().lineBreakBefore==LineBreakBefore::Auto);
  const auto noBoundaryBytes=encode(stream);
  auto flat=stream;flat.containers.front().words.push_back(flat.containers.back().words.front());flat.containers.pop_back();
  for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true})for(bool rolling:{false,true}){
   RollUpSettings settings;settings.enabled=rolling;settings.visibleLines=3;settings.currentLine=2;settings.blankLineSeconds=3;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;
   for(double time:{0.,.09,.5,1.,1.09,1.5}){
    const auto expected=layoutFrame(flat,time,{0,0,400,100},measure,56,.6,{},3,settings);auto actual=layoutFrame(stream,time,{0,0,400,100},measure,56,.6,{},3,settings);
    for(auto& word:actual.words)if(word.containerId=="right"){word.containerId="left";word.wordIndex+=1;}
    sameRenderedFrame(expected,actual);
   }
  }
  stream.containers[1].words.front().lineBreakBefore=LineBreakBefore::Break;assert(regroup(stream,56).size()==2);
  stream.containers[0].words.front().text="Alpha.";stream.containers[0].words.front().endOfSentence=true;
  auto& next=stream.containers[1].words.front();next.text="betabetabeta";next.start=5;next.end=6;next.lineBreakBefore=LineBreakBefore::Join;
  groups=regroup(stream,5,.1);assert(groups.size()==1&&groups[0].wordCount==2&&groups[0].end==6);
  stream.containers[1].words.push_back({"Gamma",6,7,false});stream.containers[1].words.push_back({".",7,7,false});
  groups=regroup(stream,5,.1);assert(groups.size()==2&&groups[1].wordCount==2);
  auto deferred=sample();deferred.containers.front().words={{"Hello.",0,1,true},{"again",1,2,false,LineBreakBefore::Join},{"today",2,3,false}};
  assert(regroup(deferred,56).size()==1);
  deferred.containers.front().words[1].endOfSentence=true;assert(regroup(deferred,56).size()==2);
  deferred.containers.front().words[0].lineBreakBefore=LineBreakBefore::Break;assert(regroup(deferred,56).size()==2);
  deferred.containers.front().words[1].lineBreakBefore=LineBreakBefore::Break;assert(regroup(deferred,56).size()==3);
  Document storage;storage.containers={{"late",false,{{"Late.",10,11,true}}},{"early",false,{{"early",1,2,false,LineBreakBefore::Join},{"tail",2,3,true}}},{"overlap",true,{{"overlap",2.5,4,false}}}};
  const auto storageGroups=regroup(storage,56);assert(storageGroups.size()==2&&storageGroups[0].wordCount==3);
  assert(storageGroups[0].wordRefs[0].containerIndex==0&&storageGroups[0].wordRefs[1].containerIndex==1&&storageGroups[0].wordRefs[1].wordIndex==0&&storageGroups[0].wordRefs[2].containerIndex==1&&storageGroups[0].wordRefs[2].wordIndex==1&&storageGroups[1].wordRefs[0].containerIndex==2);
  assert(encode(decode(noBoundaryBytes))==noBoundaryBytes);
 }
 // Schema 2 adds a persistent source/sequence origin without rewriting word times.
 auto versionTwo=d;versionTwo.schemaVersion=2;const auto versionTwoBytes=legacyWire(versionTwo,2);
 auto originDoc=versionTwo;originDoc.timeOriginSeconds=3600;auto originBytes=encode(originDoc);auto originCopy=decode(originBytes);
 assert(originCopy.schemaVersion==kSchemaVersion&&originCopy.timeOriginSeconds==3600&&originCopy.containers[0].words[0].start==d.containers[0].words[0].start);
 originDoc.timeOriginSeconds=-864000;assert(decode(encode(originDoc)).timeOriginSeconds==-864000);originDoc.timeOriginSeconds=864000;assert(decode(encode(originDoc)).timeOriginSeconds==864000);
 auto legacy=versionTwoBytes;legacy.resize(legacy.size()-8);legacy[4]=1;auto legacyCopy=decode(legacy);assert(legacyCopy.schemaVersion==kSchemaVersion&&legacyCopy.timeOriginSeconds==0&&legacyCopy.containers[0].words[0].text=="HELLO");
 assert(encode(legacyCopy)==encode(d)&&encode(decode(versionTwoBytes))==encode(d)); // Historical inputs upgrade without changing content.
 legacyCopy.timeOriginSeconds=3600;assert(decode(encode(legacyCopy)).schemaVersion==kSchemaVersion);
 for(double invalidOrigin:{std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN(),864000.001,-864000.001}){
  originDoc.timeOriginSeconds=invalidOrigin;rejects([&]{encode(originDoc);});
  auto malformed=versionTwoBytes;std::uint64_t bits=0;std::memcpy(&bits,&invalidOrigin,8);for(int j=0;j<8;++j)malformed[malformed.size()-8+j]=static_cast<std::uint8_t>(bits>>(8*j));rejects([&]{decode(malformed);});
 }
 // Schema 3 appends bounded optional typography. Explicit false/relative base
 // differ from legacy unset face selection, and next-heavier remains a mode.
 auto typography=versionTwo;typography.style.baseFontWeight=400;
 typography.style.upcoming.fontWeight=400;typography.style.upcoming.italic=0;
 typography.style.current.fontWeight=700;typography.style.current.fontWeightOffset=100;typography.style.current.italic=1;
 typography.style.spoken.fontWeight=400;typography.style.spoken.fontWeightOffset=0;
 auto typographyBytes=encode(typography);auto typographyCopy=decode(typographyBytes);
 assert(typographyCopy.schemaVersion==kSchemaVersion&&typographyCopy.style.baseFontWeight==400);
 assert(typographyCopy.style.current.fontWeight==700&&typographyCopy.style.current.fontWeightOffset==100&&typographyCopy.style.current.italic==1);
 assert(typographyCopy.style.upcoming.italic==0&&typographyCopy.style.spoken.fontWeightOffset==0&&encode(typographyCopy)==typographyBytes);
 assert(typographyBytes.size()==encode(versionTwo).size());
 for(double invalidWeight:{0.999,1000.001,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}){auto invalid=typography;invalid.style.current.fontWeight=invalidWeight;rejects([&]{encode(invalid);});invalid=typography;invalid.style.baseFontWeight=invalidWeight;rejects([&]{encode(invalid);});}
 auto invalidTypography=typography;invalidTypography.style.current.italic=2;rejects([&]{encode(invalidTypography);});invalidTypography=typography;invalidTypography.style.current.fontWeightOffset=50;rejects([&]{encode(invalidTypography);});
 for(std::size_t offset:{typographyBytes.size()-368-40,typographyBytes.size()-368-36}){auto malformed=typographyBytes;malformed[offset]=3;rejects([&]{decode(malformed);});}
 auto bad=encoded;bad[4]=99;rejects([&]{decode(bad);});bad=encoded;bad.pop_back();rejects([&]{decode(bad);});bad=encoded;bad.push_back(0);rejects([&]{decode(bad);});rejects([&]{decode({});});
 bad=encoded;bad[8]=255;bad[9]=255;rejects([&]{decode(bad);});
 auto invalid=d;invalid.containers[1].id="original";rejects([&]{validate(invalid);});invalid=d;invalid.containers[0].words[0].start=std::numeric_limits<double>::quiet_NaN();rejects([&]{validate(invalid);});invalid=d;invalid.style.current.opacity=2;rejects([&]{validate(invalid);});rejects([&]{regroup(d,0);});
 d.style.titleCase=true;auto frame=layoutFrame(d,0.4,{0,0,1200,300},measure);assert(frame.words.size()==3);assert(frame.words[0].state==WordState::Spoken&&frame.words[1].state==WordState::Current&&frame.words[2].state==WordState::Upcoming);assert(frame.words[0].text=="HELLO"&&frame.words[1].text=="World"&&d.containers[0].words[0].text=="HELLO");
 assert(displayText("JunkYourVehicle.Net",true)=="JunkYourVehicle.Net"&&displayText("junkyourvehicle.net",true)=="Junkyourvehicle.Net"&&displayText("nasa-led iPhone",true)=="Nasa-Led iPhone"&&displayText("NASA rocks",true)=="NASA Rocks");
 assert(frame.words[0].style.opacity==0.5&&frame.words[1].style.color.r==1&&frame.words[1].style.color.g==0);
 auto narrow=layoutFrame(d,0.4,{0,0,200,1000},measure);assert(narrow.words.size()==3&&narrow.overflow&&narrow.words[1].baseline==narrow.words[0].baseline);assert(narrow.words[1].style.fontSize==frame.words[1].style.fontSize&&narrow.words[1].width==frame.words[1].width);
 auto shortBox=layoutFrame(d,0.4,{0,0,1200,10},measure);assert(shortBox.overflow&&shortBox.words[0].x==frame.words[0].x&&shortBox.words[0].width==frame.words[0].width);
 const auto explicitCenter=layoutFrame(d,.4,{0,0,1200,300,2},measure),leftAligned=layoutFrame(d,.4,{0,0,1200,300,1},measure),rightAligned=layoutFrame(d,.4,{0,0,1200,300,3},measure);
 for(std::size_t i=0;i<frame.words.size();++i)assert(explicitCenter.words[i].x==frame.words[i].x&&explicitCenter.words[i].baseline==frame.words[i].baseline);
 assert(leftAligned.words[0].x==0&&rightAligned.words.back().x+rightAligned.words.back().width==1200);
 for(int alignment:{1,3}){const auto wrapped=layoutFrame(d,.4,{10,0,200,1000,alignment},measure);assert(wrapped.words.size()==3&&wrapped.overflow);if(alignment==1)assert(wrapped.words.front().x==10);else assert(wrapped.words.back().x+wrapped.words.back().width==210);for(const auto& word:wrapped.words)assert(word.baseline==wrapped.words.front().baseline);}
 assert(sampledTextAlignment(1)==1&&sampledTextAlignment(1.49)==1&&sampledTextAlignment(1.5)==2&&sampledTextAlignment(2.5)==3&&sampledTextAlignment(100)==3&&sampledTextAlignment(-100)==1);
 rejects([&]{sampledTextAlignment(std::numeric_limits<double>::infinity());});rejects([&]{layoutFrame(d,.4,{0,0,1200,300,0},measure);});
 assert(layoutFrame(d,1.2,{0,0,1200,300},measure).words.empty());assert(layoutFrame(d,2,{0,0,1200,300},measure).words.size()==1);
 assert(displayText("don't STOP naïve café",true)=="Don't STOP Naïve Café");
 assert(displayText("Mixed-case",false,1)=="MIXED-CASE"&&displayText("Mixed-case",false,2)=="mixed-case");
 for(int mode:{1,2}){auto cased=sample();cased.style.letterCase=mode;const auto bytes=encode(cased),roundtrip=encode(decode(bytes));assert(bytes==roundtrip&&decode(bytes).schemaVersion==kSchemaVersion);auto cf=layoutFrame(cased,.4,{0,0,1200,300},measure);assert(cf.words[0].text==(mode==1?"HELLO":"hello"));assert(cased.containers[0].words[0].text=="HELLO");}
 auto badCase=sample();badCase.style.letterCase=3;rejects([&]{validate(badCase);});badCase.style.letterCase=1;badCase.style.titleCase=true;rejects([&]{validate(badCase);});
 rejects([&]{layoutFrame(d,0.4,{0,0,1200,300},[](const std::string&,const WordStyle&){return Metrics{-1,0,0};});});
 // Every truncation boundary is rejected; malformed data cannot partially load.
 for(std::size_t i=0;i<encoded.size();++i){std::vector<std::uint8_t> part(encoded.begin(),encoded.begin()+i);rejects([&]{decode(part);});}
 // Native rendering follows the host's sample time directly, including fractional
 // sequence rates. No source rate or 30fps quantization participates in layout.
 Document timeline;timeline.containers.push_back({"timeline",false,{{"first",0,.04,false},{"second",.04,.08,false},{"third",.08,.3,false}}});
 auto activeAt=[&](double hostTime){auto f=layoutFrame(timeline,hostTime,{0,0,1200,300},measure);assert(f.words.size()==3);std::size_t active=99;for(const auto& word:f.words)if(word.state==WordState::Current)active=word.wordIndex;return active;};
 assert(activeAt(1001.0/24000.0)==1); // 23.976 sequence, frame 1
 assert(activeAt(1001.0/30000.0)==0); // 29.97 sequence, frame 1
 assert(activeAt(2*1001.0/30000.0)==1); // 29.97 sequence, frame 2
 assert(activeAt(2*1001.0/24000.0)==2); // 23.976 sequence, frame 2
 assert(activeAt(.039)==0&&activeAt(.041)==1); // samples within one 30fps bucket
 assert(activeAt(std::nextafter(.04,0.0))==0&&activeAt(.04)==1);
 assert(activeAt(std::nextafter(.08,0.0))==1&&activeAt(.08)==2);
 // Bubble adds padding around real metrics without changing the source font size.
 auto bubbles=sample();bubbles.style.current.bubble=true;bubbles.style.current.padding=10;
 auto bubbleFrame=layoutFrame(bubbles,0.1,{0,0,1200,300},measure);
 auto glyph=measure("HELLO",bubbles.style.current);
 assert(bubbleFrame.words[0].width==glyph.width+20&&bubbleFrame.words[0].height==glyph.ascent+glyph.descent+20);
 // Filling spaces is a paint-only extension: source layout, wrapping and final
 // trailing bounds stay identical; current/spoken/upcoming flags are independent.
 for(const auto state:{0,1,2}){
  auto fill=bubbles;fill.style.wordSpacing=37;auto* selected=state==0?&fill.style.current:state==1?&fill.style.spoken:&fill.style.upcoming;
  selected->bubble=true;selected->bubbleFillSpaces=true;
  const double time=state==1?.5:.1;const auto frame=layoutFrame(fill,time,{0,0,1200,300},measure);
  auto without=fill;selected=state==0?&without.style.current:state==1?&without.style.spoken:&without.style.upcoming;selected->bubbleFillSpaces=false;
  const auto baseline=layoutFrame(without,time,{0,0,1200,300},measure);assert(frame.words.size()==baseline.words.size());
  for(std::size_t i=0;i<frame.words.size();++i){const auto& run=frame.words[i];assert(run.x==baseline.words[i].x&&run.width==baseline.words[i].width&&run.baseline==baseline.words[i].baseline);const bool enabled=run.style.bubble&&run.style.bubbleFillSpaces&&i+1<frame.words.size();assert(run.bubbleExtraWidth==(enabled?37:0));}
  const auto bytes=encode(fill);assert(decode(bytes).schemaVersion==kSchemaVersion&&encode(decode(bytes))==bytes);
  const auto narrowFill=layoutFrame(fill,time,{0,0,160,600},measure);assert(narrowFill.overflow);for(std::size_t i=0;i<frame.words.size();++i)assert(narrowFill.words[i].bubbleExtraWidth==frame.words[i].bubbleExtraWidth);
 }
 // A continuous grouped line keeps its joins even when it overflows.
 // Only explicit regroup boundaries begin another line.
 Document joined;joined.containers.push_back({"joins",false,{{"AA",0,1,false},{"BB",1,2,false},{"CC",2,3,false}}});
 for(auto* style:{&joined.style.current,&joined.style.upcoming,&joined.style.spoken}){style->fontSize=20;style->bubble=true;style->bubbleFillSpaces=true;style->padding=2;style->radius=10;}
 const auto joinBytes=encode(joined);const auto joinFrame=layoutFrame(joined,1.5,{0,0,300,300},measure);
 assert(joinFrame.words.size()==3&&!joinFrame.words[0].bubbleJoinLeft&&joinFrame.words[0].bubbleJoinRight&&joinFrame.words[1].bubbleJoinLeft&&joinFrame.words[1].bubbleJoinRight&&joinFrame.words[2].bubbleJoinLeft&&!joinFrame.words[2].bubbleJoinRight);
 const auto wrapJoins=layoutFrame(joined,1.5,{0,0,65,300},measure);
 assert(wrapJoins.overflow&&!wrapJoins.words[0].bubbleJoinLeft&&wrapJoins.words[0].bubbleJoinRight&&wrapJoins.words[1].bubbleJoinLeft&&wrapJoins.words[1].bubbleJoinRight&&wrapJoins.words[2].bubbleJoinLeft&&!wrapJoins.words[2].bubbleJoinRight);
 joined.style.current.bubbleColor.a=0;const auto transparentJoin=layoutFrame(joined,1.5,{0,0,300,300},measure);for(const auto& run:transparentJoin.words)assert(!run.bubbleJoinLeft&&!run.bubbleJoinRight);
 joined.style.current.bubbleColor.a=1;assert(encode(joined)==joinBytes); // joins are derived, not a new format
 // The ribbon's .6 lower bound is valid native spacing. Multipliers change
 // physical line baselines without changing horizontal layout or corner joins.
 for(double spacing:{.6,1.2,2.0,10.0}){
  joined.style.lineHeight=spacing;auto regrouped=joined;regrouped.containers[0].words[1].endOfSentence=true;const auto spaced=layoutFrame(regrouped,1.5,{0,0,65,1000},measure,56,.6,{},2);
  assert(std::abs(spaced.words[2].baseline-spaced.words[0].baseline-24*spacing)<1e-10);
  assert(spaced.words[0].x==spaced.words[1].x-spaced.words[0].width-joined.style.wordSpacing);
  assert(spaced.words[0].bubbleJoinRight&&!spaced.words[1].bubbleJoinRight&&!spaced.words[2].bubbleJoinLeft&&!spaced.words[2].bubbleJoinRight);
  const auto bytes=encode(joined);assert(decode(bytes).style.lineHeight==spacing&&encode(decode(bytes))==bytes);
 }
 for(double spacing:{.599999,0.0,-1.0,10.00001,std::numeric_limits<double>::quiet_NaN(),std::numeric_limits<double>::infinity()}){auto invalidSpacing=joined;invalidSpacing.style.lineHeight=spacing;rejects([&]{validate(invalidSpacing);});}

 // Independent padding changes only its own geometry; legacy uniform padding
 // remains the fallback and old documents keep their byte-exact version.
 Document axes;axes.containers.push_back({"axes",false,{{"AA",0,1,false},{"BB",1,2,false}}});
 for(auto* style:{&axes.style.current,&axes.style.upcoming,&axes.style.spoken}){style->fontSize=20;style->bubble=true;style->padding=8;style->radius=0;}
 const auto legacyAxes=encode(axes);assert(decode(legacyAxes).schemaVersion==kSchemaVersion);assert(encode(decode(legacyAxes))==legacyAxes);
 axes.style.current.bubblePaddingInline=20;axes.style.current.bubblePaddingBlock=3;
 const auto axisFrame=layoutFrame(axes,.5,{0,0,200,300},measure);assert(axisFrame.words[0].width==60&&axisFrame.words[0].height==26&&axisFrame.words[1].width==36&&axisFrame.words[1].height==36);
 const auto axisBytes=encode(axes);assert(decode(axisBytes).schemaVersion==kSchemaVersion&&encode(decode(axisBytes))==axisBytes);assert(decode(axisBytes).style.current.bubblePaddingInline==20&&decode(axisBytes).style.current.bubblePaddingBlock==3&&decode(axisBytes).style.upcoming.bubblePaddingInline==-1);
 auto moreBlock=axes;moreBlock.style.current.bubblePaddingBlock=30;const auto blockFrame=layoutFrame(moreBlock,.5,{0,0,200,300},measure);assert(blockFrame.words[0].width==axisFrame.words[0].width&&blockFrame.words[0].height==80);
 for(double invalidAxis:{-2.0,-.5,4096.1,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}){auto invalidAxes=axes;invalidAxes.style.current.bubblePaddingInline=invalidAxis;rejects([&]{validate(invalidAxes);});invalidAxes=axes;invalidAxes.style.current.bubblePaddingBlock=invalidAxis;rejects([&]{validate(invalidAxes);});}
 auto underlined=axes;underlined.style.current.underline=1;underlined.style.spoken.underline=0;
 const auto underlineBytes=encode(underlined);assert(decode(underlineBytes).schemaVersion==kSchemaVersion&&encode(decode(underlineBytes))==underlineBytes);assert(decode(underlineBytes).style.current.underline==1&&decode(underlineBytes).style.spoken.underline==0&&decode(underlineBytes).style.upcoming.underline==-1);
 const auto underFrame=layoutFrame(underlined,.5,{0,0,200,300},measure);assert(underFrame.words[0].width==axisFrame.words[0].width&&underFrame.words[0].height==axisFrame.words[0].height&&underFrame.words[0].baseline==axisFrame.words[0].baseline);
 auto invalidUnderline=underlineBytes;invalidUnderline[invalidUnderline.size()-4-288-12]=3;rejects([&]{decode(invalidUnderline);});underlined.style.current.underline=2;rejects([&]{validate(underlined);});
 auto v5Bad=encode(bubbles);auto v5Fill=bubbles;v5Fill.style.current.bubbleFillSpaces=true;v5Bad=encode(v5Fill);v5Bad[v5Bad.size()-4-288-12-48-12]=2;rejects([&]{decode(v5Bad);});
 auto again=layoutFrame(bubbles,0.1,{0,0,1200,300},measure);
 assert(again.words.size()==bubbleFrame.words.size());for(std::size_t i=0;i<again.words.size();++i)assert(again.words[i].x==bubbleFrame.words[i].x&&again.words[i].baseline==bubbleFrame.words[i].baseline&&again.words[i].text==bubbleFrame.words[i].text);
 auto overlap=sample();overlap.containers[0].words={ {"long",0,2,false},{"short",0.5,1,false} };assert(layoutFrame(overlap,1.5,{0,0,1200,300},measure).words.size()==2);
 // Multi-group pages retain character-limit phrases, place each on a new line,
 // and evaluate current/spoken/upcoming styling across the complete page.
 Document pages;pages.style.spoken.opacity=.4;pages.style.current.color={0,1,0,1};
 pages.containers.push_back({"page-source",false,{}});
 const char* pageWords[]={"one","two","three","four","five","six","seven","eight"};
 for(std::size_t i=0;i<8;++i)pages.containers[0].words.push_back({pageWords[i],i*.5,i*.5+.4,false});
 const auto pageBytes=encode(pages);assert(regroup(pages,11).size()==4);
 const auto singlePage=layoutFrame(pages,1.2,{0,0,1200,1000},measure,11);
 const auto explicitSingle=layoutFrame(pages,1.2,{0,0,1200,1000},measure,11,.6,{},1);
 assert(singlePage.words.size()==2&&explicitSingle.words.size()==singlePage.words.size());
 for(std::size_t i=0;i<singlePage.words.size();++i)assert(singlePage.words[i].text==explicitSingle.words[i].text&&singlePage.words[i].x==explicitSingle.words[i].x&&singlePage.words[i].baseline==explicitSingle.words[i].baseline);
 const auto threeGroups=layoutFrame(pages,1.2,{0,0,1200,1000},measure,11,.6,{},3);
 assert(threeGroups.words.size()==6&&threeGroups.words[0].state==WordState::Spoken&&threeGroups.words[2].state==WordState::Current&&threeGroups.words[3].state==WordState::Upcoming);
 assert(threeGroups.words[0].style.opacity==.4&&threeGroups.words[2].style.color.g==1);
 assert(threeGroups.words[0].baseline==threeGroups.words[1].baseline&&threeGroups.words[2].baseline>threeGroups.words[1].baseline&&threeGroups.words[4].baseline>threeGroups.words[3].baseline);
 for(int alignment:{1,3}){const auto alignedPage=layoutFrame(pages,1.2,{0,0,1200,1000,alignment},measure,11,.6,{},3);assert(alignedPage.words.size()==6);for(std::size_t line=0;line<3;++line){const auto& first=alignedPage.words[line*2];const auto& last=alignedPage.words[line*2+1];if(alignment==1)assert(first.x==0);else assert(last.x+last.width==1200);}}
 assert(layoutFrame(pages,2.95,{0,0,1200,1000},measure,11,.6,{},3).words.empty()); // Inter-page gap.
 const auto lastPage=layoutFrame(pages,3.1,{0,0,1200,1000},measure,11,.6,{},3);
 assert(lastPage.words.size()==2&&lastPage.words[0].wordIndex==6&&lastPage.words[0].baseline==threeGroups.words[0].baseline);
 const auto pageReflow=layoutFrame(pages,1.2,{0,0,180,1000},measure,11,.6,{},3);
 assert(pageReflow.words.size()==6&&pageReflow.overflow&&pageReflow.words[1].baseline==pageReflow.words[0].baseline&&pageReflow.words[2].baseline>pageReflow.words[1].baseline);
 assert(layoutFrame(pages,1.2,{0,0,1200,100},measure,11,.6,{},3).overflow);
 // A page remains visible during an internal pause, without inventing a current
 // word. Complete pause lengths each consume one ordinary page line.
 auto paused=pages;for(std::size_t i=2;i<paused.containers[0].words.size();++i){paused.containers[0].words[i].start+=2;paused.containers[0].words[i].end+=2;}
 const auto pausedPage=layoutFrame(paused,2,{0,0,1200,1000},measure,11,.6,{},4);
 assert(pausedPage.words.size()==4);for(const auto& run:pausedPage.words)assert(run.state!=WordState::Current);assert(std::abs(pausedPage.words[2].baseline-pausedPage.words[0].baseline-3*(pausedPage.words[0].height+paused.style.spoken.verticalPadding())*paused.style.lineHeight)<1e-9);
 auto splitPages=pages;splitPages.containers.push_back({"manual-next",true,{{"separate",5,6,false}}});
 const auto splitFrame=layoutFrame(splitPages,3.1,{0,0,1200,1000},measure,11,.6,{},100);
 assert(splitFrame.words.size()==9&&splitFrame.words.back().containerId=="manual-next"&&splitFrame.words.back().state==WordState::Upcoming);
 assert(layoutFrame(splitPages,5.2,{0,0,1200,1000},measure,11,.6,{},100).words.size()==9);
 assert(encode(pages)==pageBytes); // Layout never modifies the carrier/word clock.
 rejects([&]{layoutFrame(pages,1.2,{0,0,1200,1000},measure,11,.6,{},0);});
 rejects([&]{layoutFrame(pages,1.2,{0,0,1200,1000},measure,11,.6,{},101);});
 assert(sampledGroupsPerPage(1)==1&&sampledGroupsPerPage(1.49)==1&&sampledGroupsPerPage(1.5)==2&&sampledGroupsPerPage(2.7)==3);
 assert(sampledGroupsPerPage(-1e308)==1&&sampledGroupsPerPage(0)==1&&sampledGroupsPerPage(100.4)==100&&sampledGroupsPerPage(1e308)==100);
 for(double badGroups:{std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()})rejects([&]{sampledGroupsPerPage(badGroups);});
 assert(layoutFrame(pages,1.2,{0,0,1200,1000},measure,11,.6,{},sampledGroupsPerPage(2.7)).words.size()==6);
 // A timed blank row preserves silence without inserting fake words into the
 // carrier. It consumes a real line slot, and ordinary pauses stay unchanged.
 Document silence;silence.containers.push_back({"silence",false,{{"Before.",0,1,true},{"After.",3,4,true}}});
 for(auto* style:{&silence.style.current,&silence.style.upcoming,&silence.style.spoken}){style->fontSize=10;style->bubble=false;}
 const auto silenceBytes=encode(silence);assert(regroup(silence,56).size()==2);
 const auto silentPage=layoutFrame(silence,2,{0,0,400,400},measure,56,.6,{},4);
 assert(silentPage.words.size()==2&&silentPage.words[0].state==WordState::Spoken&&silentPage.words[1].state==WordState::Upcoming);
 assert(std::abs(silentPage.words[1].baseline-silentPage.words[0].baseline-78*silence.style.lineHeight)<1e-9);
 assert(layoutFrame(silence,2,{0,0,400,400},measure).words.empty());
 // Blank rows follow the average spoken line (here 1 s): a 2 s pause is two
 // average lines of silence. A pause shorter than one average line adds none.
 Document longLines=silence;longLines.containers[0].words={{"Before.",0,3,true},{"After.",5,8,true}};
 const auto noGapRows=layoutFrame(longLines,5.5,{0,0,400,400},measure,56,.6,{},3);
 assert(noGapRows.words.size()==2&&noGapRows.words[1].baseline-noGapRows.words[0].baseline==26*silence.style.lineHeight);
 Document longPause=silence;longPause.containers[0].words={{"Before.",0,1,true},{"After.",11,12,true}};
 const auto cappedRows=layoutFrame(longPause,11.5,{0,0,400,400},measure,56,.6,{},3);
 assert(cappedRows.words.size()<=2); // Ordinary blank lines participate in pagination.
 auto splitSilence=silence;splitSilence.containers[0].words.resize(1);splitSilence.containers.push_back({"separate-silence",true,{{"After.",3,4,true}}});
 const auto splitSilentPage=layoutFrame(splitSilence,2,{0,0,400,400},measure,56,.6,{},4);
 assert(splitSilentPage.words.size()==2&&splitSilentPage.words.back().containerId=="separate-silence"&&splitSilentPage.words.back().baseline==silentPage.words.back().baseline);
 for(int direction:{1,2,3,4})for(bool wait:{false,true})for(int transition:{1,2,3,4}){
  RollUpSettings settings;settings.enabled=true;settings.visibleLines=1;settings.direction=direction;settings.waitForLine=wait;settings.transition=transition;settings.boundaryEnabled=false;
  for(double time:{1.5,2.0,2.5,3.2,2.0})sameRenderedFrame(layoutFrame(silence,time,{0,0,400,100},measure,56,.6,{},1,settings),ordinaryPauseFrame(silence,time,{0,0,400,100},settings));
 }
 // Empty rows reserve slots without hiding upcoming speech beyond them.
 auto longSilence=silence;longSilence.containers[0].words.push_back({"Later.",4,5,true});
 for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=8;settings.currentLine=direction==1?1:8;settings.direction=direction;const auto frame=layoutFrame(longSilence,2,{0,0,400,400},measure,56,.6,{},1,settings);sameRenderedFrame(frame,ordinaryPauseFrame(longSilence,2,{0,0,400,400},settings));assert(std::any_of(frame.words.begin(),frame.words.end(),[](const DrawWord& word){return word.wordIndex==1&&word.state==WordState::Upcoming;}));}
 assert(encode(silence)==silenceBytes);
 // Silence advances one empty row per complete pause interval, up to the
 // requested Visible lines. It clears existing history without carrier edits.
 Document fillingSilence;fillingSilence.containers.push_back({"filling-silence",false,{{"One.",0,.2,true},{"Two.",.2,.4,true},{"Three.",.4,1,true},{"After.",5,6.4,true}}});
 // Lines last .2+.2+.6+1.4 = 2.4 s, so one average line (the blank-row cadence) is 0.6 s.
 for(auto* style:{&fillingSilence.style.current,&fillingSilence.style.upcoming,&fillingSilence.style.spoken}){style->fontSize=10;style->padding=0;style->bubble=false;}
 const auto fillingBytes=encode(fillingSilence);
 RollUpSettings fillingSettings;fillingSettings.enabled=true;fillingSettings.visibleLines=3;fillingSettings.scrollDuration=0;fillingSettings.boundaryEnabled=false;
 auto silenceFrame=[&](const Document& document,double time,const RollUpSettings& settings,double pause=.6){return layoutFrame(document,time,{0,0,400,1000},measure,56,pause,{},1,settings);};
 // Fade keeps one event per row, so its settled windows count derived rows
 // and their cadence. Plain scroll glides through them (checked below).
 fillingSettings.transition=2;
 // Current line sits at the entry edge, so every history row stays in view.
 for(int direction:{1,2}){
  fillingSettings.direction=direction;fillingSettings.currentLine=direction==1?3:1;
  const auto oneEmpty=silenceFrame(fillingSilence,1.01,fillingSettings),twoEmpty=silenceFrame(fillingSilence,1.61,fillingSettings),threeEmpty=silenceFrame(fillingSilence,2.21,fillingSettings);
  assert(oneEmpty.words.size()==2&&oneEmpty.words[0].wordIndex==1&&oneEmpty.words[1].wordIndex==2);
  assert(twoEmpty.words.size()==1&&twoEmpty.words[0].wordIndex==2);assert(threeEmpty.words.empty());
  assert(silenceFrame(fillingSilence,4.9,fillingSettings).words.empty());
  const auto resumed=silenceFrame(fillingSilence,5.01,fillingSettings);assert(resumed.words.size()==1&&resumed.words[0].wordIndex==3&&resumed.words[0].state==WordState::Current);
  // Rendering backwards must recover the same independently derived rows.
  const auto backwardsSilence=silenceFrame(fillingSilence,1.61,fillingSettings);assert(backwardsSilence.words.size()==twoEmpty.words.size()&&backwardsSilence.words[0].wordIndex==twoEmpty.words[0].wordIndex&&backwardsSilence.words[0].baseline==twoEmpty.words[0].baseline);
  for(const auto& gapAndHistory:std::vector<std::pair<double,std::size_t>>{{.7,2},{1.19,2},{1.21,1},{1.81,0},{20,0}}){
   auto shorter=fillingSilence;shorter.containers[0].words.back().start=1+gapAndHistory.first;shorter.containers[0].words.back().end=2.4+gapAndHistory.first;
   const auto held=silenceFrame(shorter,shorter.containers[0].words.back().start-.01,fillingSettings);assert(held.words.size()==gapAndHistory.second);for(const auto& word:held.words)assert(word.wordIndex<3);
  }
 }
 // Explicit blank lengths count only complete intervals. A shorter gap adds
 // no line event; text continues using its ordinary row transition.
 for(int direction:{1,2}){
  auto settings=fillingSettings;settings.direction=direction;settings.currentLine=direction==1?3:1;settings.blankLineSeconds=2;
  for(const auto& gapAndHistory:std::vector<std::pair<double,std::size_t>>{{.99,3},{1.99,3},{2,2},{4.5,1},{20,0}}){
   auto document=fillingSilence;document.containers[0].words.back().start=1+gapAndHistory.first;document.containers[0].words.back().end=2.4+gapAndHistory.first;
   const double time=document.containers[0].words.back().start-.001;const auto held=silenceFrame(document,time,settings);sameRenderedFrame(held,ordinaryPauseFrame(document,time,{0,0,400,1000},settings));
   if(gapAndHistory.first>=2){assert(held.words.size()==gapAndHistory.second);for(const auto& word:held.words)assert(word.wordIndex<3);}
  }
  auto document=fillingSilence;document.containers[0].words.back().start=5.5;document.containers[0].words.back().end=6.9;
  assert(silenceFrame(document,1.01,settings).words.size()==2);
  assert(silenceFrame(document,3.01,settings).words.size()==1);
  assert(silenceFrame(document,5.49,settings).words.size()==1);
 }
 for(double value:{-1.,0.,.1,2.,30.,31.})assert(sampledRollUpSettings(1,3,.18,1,0,.35,1,2,1,1,1,1,1,value).blankLineSeconds==std::clamp(value,0.,30.));
 rejects([&]{sampledRollUpSettings(1,3,.18,1,0,.35,1,2,1,1,1,1,1,std::numeric_limits<double>::quiet_NaN());});
 for(double value:{-1.,31.,std::numeric_limits<double>::infinity()}){auto settings=fillingSettings;settings.blankLineSeconds=value;rejects([&]{silenceFrame(fillingSilence,2,settings);});}
 assert(fillingSettings.blankLineSeconds==0);
 // Long gaps contain at most Visible lines ordinary blank rows. Horizontal
 // pages and continuous motion may reveal upcoming text during a pause.
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true})for(std::size_t visible:{1,2,3,8}){
  auto settings=fillingSettings;settings.visibleLines=visible;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;settings.scrollDuration=.18;
  auto longGap=fillingSilence;longGap.containers[0].words.back().start=10;longGap.containers[0].words.back().end=11;
  for(double time:{9.5,10.3,2.0,1.3,8.0,1.1})sameRenderedFrame(silenceFrame(longGap,time,settings),ordinaryPauseFrame(longGap,time,{0,0,400,1000},settings));
 }
 // Zero thresholds use a bounded default cadence; positive custom thresholds
 // determine both the number and timing of derived silence slots.
 fillingSettings.direction=1;fillingSettings.currentLine=3;
 assert(silenceFrame(fillingSilence,2.21,fillingSettings,0).words.empty());
 assert(silenceFrame(fillingSilence,2.01,fillingSettings,1).words.size()==1);
 assert(silenceFrame(fillingSilence,3.01,fillingSettings,1).words.empty());
 assert(encode(fillingSilence)==fillingBytes&&regroup(fillingSilence,56).size()==4);
 // Plain vertical scroll that waits for lines moves at one rate set by
 // Transition duration and Speed. A run eases in like an ordinary scroll,
 // cruises at that scroll's peak speed (1.5 rows per duration) and eases out
 // like it; blank rows never hold it. The text line in the current slot holds
 // until it ends, and the next text line stops there and holds. Blank count,
 // blank lengths and speech starts never change the rate, and word times and
 // highlighting are left alone.
 {
  auto baselineOf=[](const Frame& frame,std::size_t wordIndex,WordState* state=nullptr){
   for(const auto& word:frame.words)if(word.wordIndex==wordIndex){if(state)*state=word.state;return word.baseline;}
   return std::numeric_limits<double>::quiet_NaN();
  };
  RollUpSettings glide;glide.enabled=true;glide.boundaryEnabled=false;
  auto glideFrame=[&](const Document& document,double time,const RollUpSettings& settings){return layoutFrame(document,time,{0,0,400,1000},measure,56,.6,{},1,settings);};
  const double advance=10*fillingSilence.style.lineHeight;
  auto smooth=[](double x){x=std::clamp(x,0.,1.);return x*x*(3-2*x);};
  // Moves in one direction, with no hold and no jump, between two times.
  auto glides=[&](const Document& document,const RollUpSettings& settings,std::size_t wordIndex,double from,double to,double maxStep,double every=.01){
   const double sign=settings.direction==1?-1:1;double previous=baselineOf(glideFrame(document,from,settings),wordIndex);assert(std::isfinite(previous));
   for(double time=from+every;time<=to+1e-9;time+=every){
    const double baseline=baselineOf(glideFrame(document,time,settings),wordIndex);assert(std::isfinite(baseline));
    const double step=(baseline-previous)*sign;assert(step>0&&step<maxStep);previous=baseline;
   }
  };
  // Rows scrolled since "Before." (word 0) settled, read off its baseline.
  auto scrolled=[&](const Document& document,const RollUpSettings& settings,double time){
   const double sign=settings.direction==1?-1:1;
   const double at=baselineOf(glideFrame(document,time,settings),0),home=baselineOf(glideFrame(document,.5,settings),0);
   assert(std::isfinite(at)&&std::isfinite(home));return sign*(at-home)/advance;
  };
  // "Before." 0-1 s, then blank rows, then "After." for one second.
  auto authored=[&](const std::vector<double>& blanks,double afterStart){
   Document document;document.style=fillingSilence.style;std::vector<Word> words{{"Before.",0,1,true}};double at=1;
   for(double length:blanks){words.push_back({"",at,at+length,true});at+=length;}
   words.push_back({"After.",std::max(at,afterStart),std::max(at,afterStart)+1,true});
   document.containers.push_back({"rate",false,words});return document;
  };
  struct Case{Document document;std::size_t blanks;double blankLineSeconds;};
  const std::vector<Case> cases{
   {authored({},1),0,30},{authored({},1.4),0,30},
   {authored({.05},0),1,30},{authored({2},0),1,30},{authored({},3.2),1,2},
   {authored({.3,1.7},0),2,30},{authored({},2.1),2,.5},
   {authored({.05,.5,3},0),3,30},{authored({},2.6),3,.5},{authored({},8),3,2}};
  for(int direction:{1,2})for(double speed:{.5,1.,2.}){
   const double sign=direction==1?-1:1;
   auto settings=glide;settings.direction=direction;settings.speed=speed;settings.visibleLines=8;settings.currentLine=direction==1?8:1;
   const double pace=settings.scrollDuration/speed,cruise=1.5/pace;
   for(const auto& item:cases){
    auto caseSettings=settings;caseSettings.blankLineSeconds=item.blankLineSeconds;
    const auto& document=item.document;const auto bytes=encode(document);
    const auto rows=item.blanks+1,after=document.containers[0].words.size()-1;
    // Every run starts at the end of "Before." and adds 2/3 of a scroll per
    // blank row, whatever the blanks' lengths or the gap to "After.".
    const double arrival=1+pace*(1+2*double(item.blanks)/3);
    // An occupied current line holds until it ends.
    for(double time:{.5,.8,1.})assert(scrolled(document,caseSettings,time)==0);
    // Never faster than an ordinary scroll's peak, never stopping on a blank.
    double previous=0;
    for(double time=1+pace/40;time<arrival-1e-9;time+=pace/40){const double now=scrolled(document,caseSettings,time);assert(now>previous&&now-previous<=cruise*pace/40+1e-9);previous=now;}
    assert(std::abs(scrolled(document,caseSettings,arrival)-double(rows))<1e-9);
    // "After." stops in the current slot and holds until it ends; its words
    // highlight on their own times, whether it arrived early or late.
    const double slot=baselineOf(glideFrame(document,.5,caseSettings),0);
    const auto& words=document.containers[0].words;const double afterStart=words.back().start,afterEnd=words.back().end;
    for(double time:{arrival,arrival+.05,std::max(arrival,afterEnd-.01)})assert(std::abs(baselineOf(glideFrame(document,time,caseSettings),after)-slot)<1e-9);
    WordState state;
    if(afterStart<arrival-pace/10){const double time=(afterStart+arrival)/2;const double moving=baselineOf(glideFrame(document,time,caseSettings),after,&state);assert(state==WordState::Current&&std::abs(moving-slot)>1e-6);}
    baselineOf(glideFrame(document,std::max(afterStart,arrival)-1e-3,caseSettings),after,&state);assert(state==(afterStart<arrival-1e-3?WordState::Current:WordState::Upcoming));
    // Ordinary parity: with no blanks the move is exactly the ordinary scroll.
    if(!item.blanks)for(double elapsed=0;elapsed<=pace*1.2;elapsed+=pace/20)assert(std::abs(scrolled(document,caseSettings,1+elapsed)-smooth(elapsed/pace))<1e-9);
    // Cruise at exactly the ordinary peak between the half-row ease-in and ease-out.
    if(item.blanks)for(double x=0;x<=pace*2*double(item.blanks)/3+1e-12;x+=pace/16)assert(std::abs(scrolled(document,caseSettings,1+pace/2+x)-(.5+cruise*x))<1e-9);
    // Like for like: compared with every case of fewer or equal blanks, the
    // first and last rows of travel follow the same curve in time, both from
    // the start and back from the arrival, out to the shorter run's cruise.
    for(const auto& other:cases){
     if(other.blanks>item.blanks)continue;
     auto otherSettings=settings;otherSettings.blankLineSeconds=other.blankLineSeconds;
     const double otherArrival=1+pace*(1+2*double(other.blanks)/3),reach=pace/2+pace*2*double(other.blanks)/3;
     for(double tau=0;tau<=reach+1e-12;tau+=pace/24){
      assert(std::abs(scrolled(document,caseSettings,1+tau)-scrolled(other.document,otherSettings,1+tau))<1e-9);
      assert(std::abs((double(rows)-scrolled(document,caseSettings,arrival-tau))-(double(other.blanks+1)-scrolled(other.document,otherSettings,otherArrival-tau)))<1e-9);
     }
    }
    // Seeking in any order renders the same frame, and leaves the document alone.
    const double middle=(1+arrival)/2;const auto mid=glideFrame(document,middle,caseSettings);
    glideFrame(document,arrival+.3,caseSettings);glideFrame(document,.2,caseSettings);
    sameRenderedFrame(mid,glideFrame(document,middle,caseSettings));assert(encode(document)==bytes);
   }
   // A cue shorter than the move queues behind it: nothing speeds up, the
   // line arrives after its speech start and its words keep their times.
   const auto& late=cases[2].document;const double lateArrival=1+pace*5/3;
   assert(lateArrival>1.05);WordState state;
   const double lateMoving=baselineOf(glideFrame(late,1.05+(lateArrival-1.05)/2,settings),2,&state);
   assert(state==WordState::Current&&std::abs(lateMoving-baselineOf(glideFrame(late,.5,settings),0))>1e-6);
   // Capped gaps: Visible lines 3 allows three blank rows, so a ten-second
   // pause glides as far as three blanks do, then "After." waits for speech.
   {
    auto capped=settings;capped.visibleLines=3;capped.currentLine=direction==1?3:1;capped.blankLineSeconds=1;
    const auto& document=cases.back().document;const double arrival=1+pace*3,slot=baselineOf(glideFrame(document,.5,capped),0);
    for(double time:{arrival,arrival+1,7.99})assert(std::abs(baselineOf(glideFrame(document,time,capped),1)-slot)<1e-9);
    const double moving=baselineOf(glideFrame(document,arrival-pace/4,capped),1);assert(!std::isfinite(moving)||std::abs(moving-slot)>1e-6);
   }
   // A brief line that ends while the next scroll would still be arriving
   // queues: the moves never overlap or add speed. "Brief." stops, then goes.
   {
    Document queued;queued.style=fillingSilence.style;
    queued.containers.push_back({"queued",false,{{"Before.",0,.9,true},{"Brief.",.9,.9+pace*.9,true},{"After.",.9+pace*.9,3,true}}});
    for(double elapsed=0;elapsed<=pace*2.2;elapsed+=pace/40)assert(std::abs(scrolled(queued,settings,.9+elapsed)-smooth(elapsed/pace)-smooth((elapsed-pace)/pace))<1e-9);
    baselineOf(glideFrame(queued,.9+pace*.95,settings),1,&state);assert(state==WordState::Spoken);
    baselineOf(glideFrame(queued,.9+pace*1.5,settings),2,&state);assert(state==WordState::Current);
   }
   // Brief lines that ended before the run reaches them are passed like
   // blank rows at the same cruise, drawn on the way and never skipped.
   {
    Document briefs;briefs.style=fillingSilence.style;
    briefs.containers.push_back({"briefs",false,{{"Before.",0,.9,true},{"One.",.9,.93,true},{"Two.",.93,.97,true},{"Three.",.97,1,true},{"",1,1.05,true},{"After.",1.05,4,true}}});
    const double arrival=.9+pace*(1+2*4./3);std::set<std::size_t> drawn;double previous=0;
    for(double time=.9+pace/40;time<arrival+pace/40;time+=pace/40){
     const auto frame=glideFrame(briefs,time,settings);for(const auto& word:frame.words)drawn.insert(word.wordIndex);
     const double now=scrolled(briefs,settings,time);assert(now>=previous&&now-previous<=cruise*pace/40+1e-9);previous=now;
    }
    for(std::size_t index:{1,2,3,5})assert(drawn.count(index));
    for(double x=0;x<=pace*8/3;x+=pace/16)assert(std::abs(scrolled(briefs,settings,.9+pace/2+x)-(.5+cruise*x))<1e-9);
    assert(std::abs(baselineOf(glideFrame(briefs,arrival,settings),5)-baselineOf(glideFrame(briefs,.5,settings),0))<1e-9);
   }
   // Current line away from the entry edge: the first line glides in through
   // two virtual blank slots on the same two-row curve as a line after one
   // blank (whose run also starts from rest and covers two rows).
   {
    auto opening=settings;opening.visibleLines=4;opening.currentLine=direction==1?2:3;
    const auto& document=cases[0].document;const auto& oneBlank=cases[2].document;
    const double settled=baselineOf(glideFrame(document,pace*5/3,opening),0);
    for(double time:{pace*5/3,(pace*5/3+1)/2,.99})assert(std::abs(baselineOf(glideFrame(document,time,opening),0)-settled)<1e-9);
    for(double elapsed=0;elapsed<=pace*5/3;elapsed+=pace/24)
     assert(std::abs(sign*(baselineOf(glideFrame(document,elapsed,opening),0)-settled)/advance+2-scrolled(oneBlank,settings,1+elapsed))<1e-9);
   }
  }
  // Transition duration 0 steps at the exact trigger, through every blank.
  for(int direction:{1,2}){
   auto instant=glide;instant.direction=direction;instant.scrollDuration=0;instant.visibleLines=3;instant.currentLine=direction==1?3:1;
   for(const auto* document:{&cases[1].document,&cases[5].document}){
    const auto after=document->containers[0].words.size()-1;const double slot=baselineOf(glideFrame(*document,.5,instant),0);
    assert(baselineOf(glideFrame(*document,.999,instant),0)==slot);
    assert(std::abs(baselineOf(glideFrame(*document,1,instant),after)-slot)<1e-9);
   }
  }
  for(int direction:{1,2}){
   auto capped=glide;capped.direction=direction;capped.visibleLines=3;capped.currentLine=direction==1?3:1;
   // Fade, Slide and Pop keep one event per blank: still settled mid-blank.
   for(int transition:{2,3,4}){auto creative=capped;creative.transition=transition;creative.scrollDuration=0;
    sameRenderedFrame(glideFrame(fillingSilence,1.3,creative),glideFrame(fillingSilence,1.5,creative));}
   // Without Wait for line, motion is unchanged: each row scrolls for the
   // whole length of the row before it, so "After." is still on its way.
   auto continuous=capped;continuous.waitForLine=false;
   const double settled=baselineOf(glideFrame(fillingSilence,5.01,capped),3);
   const double moving=baselineOf(glideFrame(fillingSilence,4.5,continuous),3);assert(!std::isfinite(moving)||moving!=settled);
   // Leading and trailing authored blanks, back to back, glide without stops.
   Document edges;edges.style=fillingSilence.style;
   edges.containers.push_back({"edges",false,{{"",0,.5,true},{"",.5,1,true},{"Middle.",1,2,true},{"",2,3,true},{"",3,4,true}}});
   const double pace=glide.scrollDuration;
   WordState state;const double home=baselineOf(glideFrame(edges,1.5,capped),2,&state);assert(std::isfinite(home)&&state==WordState::Current);
   for(double time:{pace*5/3,1.,2.})assert(baselineOf(glideFrame(edges,time,capped),2)==home);
   glides(edges,capped,2,2.01,2+pace*5/3-.01,.2*advance);
   const double gone=baselineOf(glideFrame(edges,2+pace*5/3,capped),2);
   for(double time:{3.,3.99})assert(baselineOf(glideFrame(edges,time,capped),2)==gone);
   // Line position styles follow the physical slots as rows glide past.
   auto styled=fillingSilence;auto& top=styled.style.positions[0];top.fields=PositionMarginBottom;top.value=styled.style.current;top.value.marginBottom=4;
   auto tall=glide;tall.direction=direction;tall.visibleLines=8;tall.currentLine=direction==1?8:1;
   glides(styled,tall,2,1.01,1+pace*5-.01,.3*advance);
  }
 }
 // Cap BEFORE subtracting deletions in both paged and scrolling modes.
 // Auto is the average of every positive spoken-line duration in the stream:
 // 1 + 3 + 2 = 6 / 3 = 2 s, not the duration of the preceding line/caption.
 {
  Document source;source.style=fillingSilence.style;
  source.containers={{"deletions",false,{{"Before.",0,1,true},{"After.",20,23,true},{"Tail.",23,25,true}}}};
  for(std::size_t visible:{1,2,3,8})for(std::uint32_t removed=0;removed<=8;++removed)for(double blank:{0.,2.}){
   auto edited=source;edited.containers[0].words[1].pauseLinesRemoved=removed;
   RollUpSettings settings;settings.visibleLines=visible;settings.blankLineSeconds=blank;settings.scrollDuration=.18;settings.boundaryEnabled=false;
   const auto count=visible>removed?visible-removed:0;
   const auto page=layoutFrame(edited,.5,{0,0,400,1000},measure,56,.6,{},100,settings);
   assert(page.words.size()==3&&page.words[0].wordIndex==0&&page.words[1].wordIndex==1&&page.words[2].wordIndex==2);
   assert(std::abs(page.words[1].baseline-page.words[0].baseline-double(count+1)*10*edited.style.lineHeight)<1e-9);
   // Ordinary line slots begin at 1 + i*2; the final surviving slot holds
   // through 20. No max(1) creates a phantom row after deleting every blank.
   for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true})for(bool rolling:{false,true}){
    settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;settings.enabled=rolling;settings.currentLine=std::min<std::size_t>(visible,3);
    for(std::size_t groups:{1,3,100})for(double time:{.5,1.,1.09,3.09,7.3,18.,19.99,20.09,23.09,1.09}){
     sameRenderedFrame(layoutFrame(edited,time,{0,0,400,1000},measure,56,.6,{},groups,settings),ordinaryPauseFrame(edited,time,{0,0,400,1000},settings,groups));
    }
   }
   assert(edited.containers[0].words[1].pauseLinesRemoved==removed);
  }
  auto edited=source;const auto original=encode(edited);
  std::vector<std::vector<std::uint8_t>> undo{original};
  for(std::uint32_t removed=1;removed<=8;++removed){edited.containers[0].words[1].pauseLinesRemoved=removed;undo.push_back(encode(edited));}
  for(std::size_t index=undo.size();index-->0;){edited=decode(undo[index]);assert(edited.containers[0].words[1].pauseLinesRemoved==index&&encode(edited)==undo[index]);}
  assert(encode(edited)==original);
  // Metadata follows the source word through cross-container regrouping and
  // text/line edits. A join suppresses that boundary's override until split.
  source.containers[0].words[1].pauseLinesRemoved=2;
  auto split=source;split.containers[0].words.resize(1);split.containers.push_back({"next-caption",true,{source.containers[0].words[1],source.containers[0].words[2]}});
  const auto splitBytes=encode(split);const auto groups=regroup(split,56);
  assert(groups.size()==3&&groups[1].wordRefs.front().containerIndex==1&&groups[1].wordRefs.front().wordIndex==0);
  auto settings=fillingSettings;settings.enabled=false;settings.visibleLines=3;
  const auto flat=layoutFrame(source,.5,{0,0,400,1000},measure,56,.6,{},100,settings);
  auto separate=layoutFrame(split,.5,{0,0,400,1000},measure,56,.6,{},100,settings);
  for(auto& word:separate.words)if(word.containerId=="next-caption"){word.containerId="deletions";++word.wordIndex;}
  sameRenderedFrame(flat,separate);assert(encode(split)==splitBytes);
  auto joined=split;joined.containers[1].words.front().lineBreakBefore=LineBreakBefore::Join;
  auto noOverride=joined;noOverride.containers[1].words.front().pauseLinesRemoved=0;
  assert(regroup(joined,56).size()==2&&joined.containers[1].words.front().pauseLinesRemoved==2);
  for(bool rolling:{false,true})for(int direction:{1,2,3,4}){
   settings.enabled=rolling;settings.direction=direction;
   for(double time:{.5,1.3,19.9,20.1,23.1})sameRenderedFrame(layoutFrame(joined,time,{0,0,400,1000},measure,56,.6,{},100,settings),layoutFrame(noOverride,time,{0,0,400,1000},measure,56,.6,{},100,settings));
  }
  joined.containers[1].words.front().text="Edited.";joined.containers[1].words.front().lineBreakBefore=LineBreakBefore::Break;
  const auto restored=decode(encode(joined));assert(restored.containers[1].words.front().pauseLinesRemoved==2&&regroup(restored,3).size()==3);
  settings.enabled=false;const auto afterEdit=layoutFrame(restored,.5,{0,0,400,1000},measure,56,.6,{},100,settings);
  assert(std::abs(afterEdit.words[1].baseline-afterEdit.words[0].baseline-20*restored.style.lineHeight)<1e-9);
  // With no derived gap, all eight possible deletion values leave output
  // unchanged, including current/upcoming word clocks and source identities.
  auto continuous=source;continuous.containers[0].words[1].start=1;continuous.containers[0].words[1].end=4;continuous.containers[0].words[2].start=4;continuous.containers[0].words[2].end=6;
  continuous.containers[0].words[1].pauseLinesRemoved=0;
  for(std::uint32_t removed=0;removed<=8;++removed){auto altered=continuous;altered.containers[0].words[1].pauseLinesRemoved=removed;
   for(bool rolling:{false,true})for(int direction:{1,2,3,4}){settings.enabled=rolling;settings.direction=direction;
    for(double time:{.5,1.,1.09,2.,4.09})sameRenderedFrame(layoutFrame(continuous,time,{0,0,400,1000},measure,56,.6,{},3,settings),layoutFrame(altered,time,{0,0,400,1000},measure,56,.6,{},3,settings));
   }
  }
 }
 // Background visibility is paint-only. Authored padding reserves row room
 // in both states, changes lineheight when edited, and includes silent rows.
 Document backgroundRows;backgroundRows.schemaVersion=kSchemaVersion;backgroundRows.style.lineHeight=1.2;
 backgroundRows.containers.push_back({"background-rows",false,{}});
 for(int index=0;index<12;++index)backgroundRows.containers[0].words.push_back({"Line.",double(index),double(index)+.8,true});
 backgroundRows.style.current.fontSize=24;backgroundRows.style.upcoming.fontSize=18;backgroundRows.style.spoken.fontSize=12;
 for(auto* style:{&backgroundRows.style.current,&backgroundRows.style.upcoming,&backgroundRows.style.spoken}){style->marginTop=2;style->marginBottom=3;style->marginLeft=1;style->marginRight=2;}
 auto sameTextGeometry=[](const Frame& before,const Frame& after){
  assert(before.words.size()==after.words.size());
  assert(before.viewport.x==after.viewport.x&&before.viewport.y==after.viewport.y&&before.viewport.width==after.viewport.width&&before.viewport.height==after.viewport.height);
  for(std::size_t index=0;index<before.words.size();++index){const auto& a=before.words[index];const auto& b=after.words[index];assert(a.wordIndex==b.wordIndex&&a.x==b.x&&a.width==b.width&&a.baseline==b.baseline&&a.style.fontSize==b.style.fontSize&&a.style.sizeScale==b.style.sizeScale);}
 };
 for(unsigned states=1;states<8;++states)for(int paddingMode:{0,1,2}){
  auto painted=backgroundRows;const auto beforeBytes=encode(painted);
  auto setBackground=[&](WordStyle& style,unsigned flag){style.bubble=(states&flag)!=0;if(paddingMode==0)style.padding=200;else if(paddingMode==1)style.bubblePaddingBlock=400;else{style.paddingTop=350;style.paddingBottom=125;style.paddingLeft=23;style.paddingRight=47;}style.radius=50;};
  setBackground(painted.style.current,1);setBackground(painted.style.upcoming,2);setBackground(painted.style.spoken,4);
  const auto paintedBytes=encode(painted);assert(paintedBytes!=beforeBytes);
  auto unpainted=painted;for(auto* style:{&unpainted.style.current,&unpainted.style.upcoming,&unpainted.style.spoken})style->bubble=false;
  for(double time:{.5,3.09,8.5}){
   const LayoutBox box{20,30,1200,120,2};
   const auto plain=layoutFrame(unpainted,time,box,measure,56,.6,{},100);
   const auto bubbles=layoutFrame(painted,time,box,measure,56,.6,{},100);
   sameTextGeometry(plain,bubbles);
   for(int direction:{1,2,3,4})for(int transition:{1,2,3,4}){
    RollUpSettings settings;settings.enabled=true;settings.visibleLines=8;settings.direction=direction;settings.transition=transition;
    sameTextGeometry(layoutFrame(unpainted,time,box,measure,56,.6,{},100,settings),layoutFrame(painted,time,box,measure,56,.6,{},100,settings));
   }
  }
  auto paddedSilence=silence;for(auto* style:{&paddedSilence.style.current,&paddedSilence.style.upcoming,&paddedSilence.style.spoken})setBackground(*style,7);
  auto noBackgroundSilence=paddedSilence;for(auto* style:{&noBackgroundSilence.style.current,&noBackgroundSilence.style.upcoming,&noBackgroundSilence.style.spoken})style->bubble=false;
  const auto plainSilence=layoutFrame(noBackgroundSilence,2,{0,0,1200,400},measure,56,.6,{},3);
  const auto backgroundSilence=layoutFrame(paddedSilence,2,{0,0,1200,400},measure,56,.6,{},3);sameTextGeometry(plainSilence,backgroundSilence);
  for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=3;settings.direction=direction;sameTextGeometry(layoutFrame(noBackgroundSilence,2,{0,0,1200,100},measure,56,.6,{},1,settings),layoutFrame(paddedSilence,2,{0,0,1200,100},measure,56,.6,{},1,settings));}
  assert(encode(painted)==paintedBytes&&encode(backgroundRows)==beforeBytes);
 }
 // Padding edits affect row geometry even with backgrounds disabled; paint
 // fits the reserved top/bottom room once the background is enabled.
 auto paddingRows=backgroundRows;for(auto* style:{&paddingRows.style.current,&paddingRows.style.upcoming,&paddingRows.style.spoken}){style->fontSize=20;style->padding=0;style->marginTop=0;style->marginBottom=0;}
 auto expandedRows=paddingRows;for(auto* style:{&expandedRows.style.current,&expandedRows.style.upcoming,&expandedRows.style.spoken}){style->paddingTop=3;style->paddingBottom=9;}
 const LayoutBox paddingBox{0,0,1200,1000};
 const auto compactRows=layoutFrame(paddingRows,.5,paddingBox,measure,56,.6,{},100),roomyRows=layoutFrame(expandedRows,.5,paddingBox,measure,56,.6,{},100);
 assert(roomyRows.words[0].baseline==compactRows.words[0].baseline+3);
 assert(std::abs((roomyRows.words[1].baseline-roomyRows.words[0].baseline)-(compactRows.words[1].baseline-compactRows.words[0].baseline)-12*paddingRows.style.lineHeight)<1e-9);
 for(auto* style:{&expandedRows.style.current,&expandedRows.style.upcoming,&expandedRows.style.spoken})style->bubble=true;
 const auto paintedRoom=layoutFrame(expandedRows,.5,paddingBox,measure,56,.6,{},100);sameTextGeometry(roomyRows,paintedRoom);assert(!paintedRoom.overflow);
 assert(paintedRoom.words.front().baseline-measure("Line.",expandedRows.style.current).ascent-expandedRows.style.current.topPadding()==paddingBox.y);
 for(int direction:{1,2,3,4}){RollUpSettings settings;settings.enabled=true;settings.visibleLines=8;settings.direction=direction;const LayoutBox smallBox{0,0,1200,96};const auto compact=layoutFrame(paddingRows,8.5,smallBox,measure,56,.6,{},100,settings),expanded=layoutFrame(expandedRows,8.5,smallBox,measure,56,.6,{},100,settings);assert(compact.viewport.height!=expanded.viewport.height);}
 auto compactPause=silence,expandedPause=silence;for(auto* style:{&compactPause.style.current,&compactPause.style.upcoming,&compactPause.style.spoken})style->padding=0;
 for(auto* style:{&expandedPause.style.current,&expandedPause.style.upcoming,&expandedPause.style.spoken}){style->padding=0;style->paddingTop=3;style->paddingBottom=9;}
 const auto compactBlank=layoutFrame(compactPause,2,paddingBox,measure,56,.6,{},4),expandedBlank=layoutFrame(expandedPause,2,paddingBox,measure,56,.6,{},4);
 assert(compactBlank.words.size()==2&&expandedBlank.words.size()==2);
 assert(std::abs((expandedBlank.words[1].baseline-expandedBlank.words[0].baseline)-(compactBlank.words[1].baseline-compactBlank.words[0].baseline)-36*silence.style.lineHeight)<1e-9);
 // Native roll-up retains stable row packing and paints Next words in its visible window.
 // Scrolling is a pure source-time function, so scrubbing backward never depends
 // on previous rendered frames or an external animation clock.
 Document rolling;rolling.containers.push_back({"rolling",false,{{"First.",0,1,true},{"Second.",1,2,true},{"Third.",2,3,true},{"Fourth.",3,4,true}}});
 for(auto* style:{&rolling.style.current,&rolling.style.upcoming,&rolling.style.spoken})style->fontSize=10;
 RollUpSettings roll;roll.enabled=true;roll.boundaryEnabled=false;
 // Rolling geometry shares active-style word advances. Fill ends at the next
 // actual outer edge, including unequal states, then follows creative transforms.
 auto spaceRoll=bubbles;for(auto* style:{&spaceRoll.style.current,&spaceRoll.style.upcoming,&spaceRoll.style.spoken}){style->bubble=true;style->bubbleFillSpaces=true;style->fontSize=12;}
 spaceRoll.style.current.sizeScale=1.5;spaceRoll.style.wordSpacing=17;
 // Keep "later" off this page: a 2.8 s pause is over two average lines (1.1 s), so blank rows fill the window.
 spaceRoll.containers[0].words[3].start=4;spaceRoll.containers[0].words[3].end=5;
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4}){
  auto settings=roll;settings.direction=direction;settings.transition=transition;
  const auto frame=layoutFrame(spaceRoll,.6,{0,0,500,180},measure,56,.6,{},1,settings);
  assert(frame.words.size()==3&&frame.words[2].state==WordState::Upcoming);assert(frame.words[0].bubbleExtraWidth>0);assert(std::abs(frame.words[0].x+frame.words[0].width+frame.words[0].bubbleExtraWidth-frame.words[1].x)<1e-10);
  auto unchanged=spaceRoll;for(auto* style:{&unchanged.style.current,&unchanged.style.upcoming,&unchanged.style.spoken})style->bubbleFillSpaces=false;
  const auto baseline=layoutFrame(unchanged,.6,{0,0,500,180},measure,56,.6,{},1,settings);
  for(std::size_t i=0;i<frame.words.size();++i){assert(frame.words[i].x==baseline.words[i].x&&frame.words[i].width==baseline.words[i].width&&frame.words[i].baseline==baseline.words[i].baseline);}
 }
 // Next is an authored appearance, not a typewriter omission. It remains
 // visible in the current row and in rows that enter before their first word.
 Document preview;preview.schemaVersion=kSchemaVersion;
 preview.containers.push_back({"preview",false,{{"Now",0,1,false},{"Next.",1,2,true},{"Later",2,3,false},{"row.",3,4,true},{"Future",4,5,false},{"page.",5,6,true}}});
 for(auto* style:{&preview.style.current,&preview.style.spoken,&preview.style.upcoming}){style->fontSize=12;style->bubble=true;style->bubbleFillSpaces=true;style->padding=2;style->radius=6;}
 preview.style.current.color={1,0,0,1};preview.style.upcoming.color={0,1,0,1};preview.style.upcoming.opacity=.65;preview.style.upcoming.fontSize=18;preview.style.upcoming.marginLeft=5;preview.style.upcoming.marginRight=7;preview.style.wordSpacing=17;
 const auto previewBytes=encode(preview);
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4}){
  auto settings=roll;settings.direction=direction;settings.transition=transition;
  const auto frame=layoutFrame(preview,.5,{20,30,500,200},measure,56,.6,{},1,settings);
  const auto current=std::find_if(frame.words.begin(),frame.words.end(),[](const DrawWord& word){return word.wordIndex==0;});
  const auto next=std::find_if(frame.words.begin(),frame.words.end(),[](const DrawWord& word){return word.wordIndex==1;});
  assert(current!=frame.words.end()&&next!=frame.words.end()&&next->state==WordState::Upcoming);
  assert(next->style.color.g==1&&next->style.opacity==.65&&next->style.fontSize==18&&next->style.marginLeft==5&&next->style.marginRight==7);
  assert(current->bubbleJoinRight&&next->bubbleJoinLeft&&current->bubbleExtraWidth==17);
  auto hidden=preview;hidden.style.upcoming.opacity=0;
  const auto hiddenFrame=layoutFrame(hidden,.5,{20,30,500,200},measure,56,.6,{},1,settings);
  const auto hiddenCurrent=std::find_if(hiddenFrame.words.begin(),hiddenFrame.words.end(),[](const DrawWord& word){return word.wordIndex==0;});
  const auto hiddenNext=std::find_if(hiddenFrame.words.begin(),hiddenFrame.words.end(),[](const DrawWord& word){return word.wordIndex==1;});
  assert(hiddenNext!=hiddenFrame.words.end()&&hiddenNext->style.opacity==0&&!hiddenCurrent->bubbleJoinRight&&!hiddenNext->bubbleJoinLeft);
  assert(hiddenNext->x==next->x&&hiddenNext->width==next->width&&hiddenNext->baseline==next->baseline);
  settings.waitForLine=false;
  const auto entering=layoutFrame(preview,.5,{20,30,500,200},measure,56,.6,{},1,settings);
  bool futureRow=false;std::vector<std::size_t> ids;
  for(const auto& word:entering.words){assert(std::find(ids.begin(),ids.end(),word.wordIndex)==ids.end());ids.push_back(word.wordIndex);if(word.wordIndex>=(direction<3?2u:4u)){futureRow=true;assert(word.state==WordState::Upcoming&&word.style.opacity>0&&word.style.opacity<=.65&&word.style.color.g==1&&word.style.fontSize<=18&&word.style.fontSize>=14.4);}}
  assert(futureRow&&encode(preview)==previewBytes);
 }
 // On/off uses one active-style composer. A scrolling translation must not
 // change any glyph advance, margin, wrapping or authored inter-row spacing.
 Document spacingParity;spacingParity.schemaVersion=kSchemaVersion;
 spacingParity.containers.push_back({"spacing-parity",false,{{"First",0,.4,false},{"word.",.4,1,true},{"Second",1,1.4,false},{"wide",1.4,1.7,false},{"line.",1.7,2,true},{"Current",2,8,false},{",",8,9,false},{"tail.",9,11,true}}});
 for(auto* style:{&spacingParity.style.current,&spacingParity.style.upcoming,&spacingParity.style.spoken}){
  style->bubble=true;style->bubbleFillSpaces=true;style->paddingTop=3;style->paddingRight=7;style->paddingBottom=5;style->paddingLeft=2;
  style->marginTop=4;style->marginRight=3;style->marginBottom=6;style->marginLeft=-1;
 }
 spacingParity.style.current.fontSize=24;spacingParity.style.current.sizeScale=1.2;
 spacingParity.style.upcoming.fontSize=18;spacingParity.style.upcoming.paddingTop=9;spacingParity.style.upcoming.marginLeft=5;
 spacingParity.style.spoken.fontSize=12;spacingParity.style.spoken.marginBottom=1;
 auto parityRoll=roll;parityRoll.visibleLines=8;
 for(double spacing:{0.0,12.0,30.0})for(double lineHeight:{.6,1.3,2.0})for(int alignment:{1,2,3})for(double width:{80.0,140.0,360.0}){
  spacingParity.style.wordSpacing=spacing;spacingParity.style.lineHeight=lineHeight;
  const auto before=encode(spacingParity);const LayoutBox box{17.25,23.75,width,2000,alignment};
  const auto ordinary=layoutFrame(spacingParity,3.5,box,measure,56,.6,{},100);
  const auto scrolling=layoutFrame(spacingParity,3.5,box,measure,56,.6,{},100,parityRoll);
  assert(!ordinary.words.empty()&&!scrolling.words.empty());
  bool first=true;double translationX=0,translationY=0;std::size_t compared=0;
  for(const auto& moving:scrolling.words){
   const auto found=std::find_if(ordinary.words.begin(),ordinary.words.end(),[&](const DrawWord& word){return word.wordIndex==moving.wordIndex;});assert(found!=ordinary.words.end());
   if(first){translationX=moving.x-found->x;translationY=moving.baseline-found->baseline;first=false;}
   assert(std::abs(moving.x-found->x-translationX)<1e-9);
   assert(std::abs(moving.baseline-found->baseline-translationY)<1e-9);
   assert(moving.width==found->width&&moving.height==found->height&&moving.bubbleExtraWidth==found->bubbleExtraWidth);
   assert(moving.style.fontSize==found->style.fontSize&&moving.style.sizeScale==found->style.sizeScale&&moving.style.marginLeft==found->style.marginLeft&&moving.style.marginBottom==found->style.marginBottom);
   ++compared;
  }
  assert(compared>=2&&encode(spacingParity)==before);
 }
 // Down retains reverse history order, but each upper row contributes its
 // own line advance. Reversing a forward prefix overlaps unequal-height rows.
 auto reverseSpacing=rolling;reverseSpacing.containers[0].words.resize(3);reverseSpacing.containers[0].words.back().end=5;
 reverseSpacing.style.current.fontSize=24;reverseSpacing.style.spoken.fontSize=12;reverseSpacing.style.upcoming.fontSize=32;
 auto reverseSettings=roll;reverseSettings.visibleLines=3;reverseSettings.direction=2;
 const auto reverseFrame=layoutFrame(reverseSpacing,2.5,{0,0,500,1000},measure,56,.6,{},100,reverseSettings);assert(reverseFrame.words.size()==3);
 for(std::size_t index=1;index<reverseFrame.words.size();++index){
  const auto& below=reverseFrame.words[index-1];const auto& above=reverseFrame.words[index];
  const auto belowMetrics=measure(below.text,below.style),aboveMetrics=measure(above.text,above.style);
  const double belowTop=below.baseline-belowMetrics.ascent,aboveTop=above.baseline-aboveMetrics.ascent;
  assert(std::abs(belowTop-aboveTop-(aboveMetrics.ascent+aboveMetrics.descent+above.style.verticalPadding())*reverseSpacing.style.lineHeight)<1e-9);
 }
 // A large unused upcoming style may reserve capacity, never typography; it
 // must not let the smaller actual row heights add extra history to the frame.
 auto capacitySpacing=rolling;capacitySpacing.style.current.fontSize=10;capacitySpacing.style.spoken.fontSize=10;capacitySpacing.style.upcoming.fontSize=40;
 auto capacitySettings=roll;capacitySettings.visibleLines=8;
 const auto capacityFrame=layoutFrame(capacitySpacing,2.5,{0,0,500,104},measure,56,.6,{},100,capacitySettings);
 assert(capacityFrame.words.size()==1&&capacityFrame.words[0].wordIndex==2&&std::abs(capacityFrame.viewport.height-72.8)<1e-9);
 const auto rollingBytes=encode(rolling);
 auto rollFrame=[&](double time,const RollUpSettings& settings,std::size_t groups=1){return layoutFrame(rolling,time,{0,0,200,100},measure,56,.6,{},groups,settings);};
 // Current line counts from the top: Up's entry edge, which keeps full
 // history, is the bottom of two slots (Line 2). Down's stays Line 1.
 auto entryRoll=roll;entryRoll.currentLine=2;
 const auto initialRoll=rollFrame(.5,entryRoll),middleRoll=rollFrame(1.09,entryRoll),finishedRoll=rollFrame(1.18,entryRoll);
 assert(initialRoll.rolling&&initialRoll.words.size()==1&&initialRoll.words[0].wordIndex==0&&initialRoll.words[0].state==WordState::Current);
 assert(std::abs(initialRoll.viewport.height-67.6)<1e-9&&std::abs(initialRoll.viewport.y-16.2)<1e-9&&std::abs(initialRoll.words[0].baseline-66)<1e-9);
 assert(middleRoll.words.size()==2&&middleRoll.words[0].baseline<initialRoll.words[0].baseline&&middleRoll.words[0].baseline>finishedRoll.words[0].baseline);
 assert(finishedRoll.words.size()==2&&finishedRoll.words[0].state==WordState::Spoken&&finishedRoll.words[1].state==WordState::Current);
 const auto backwards=rollFrame(.5,entryRoll);assert(backwards.words[0].baseline==initialRoll.words[0].baseline&&backwards.words[0].x==initialRoll.words[0].x);
 const auto ignoredPages=rollFrame(1.18,entryRoll,100);assert(ignoredPages.words.size()==finishedRoll.words.size());
 for(std::size_t index=0;index<finishedRoll.words.size();++index)assert(ignoredPages.words[index].x==finishedRoll.words[index].x&&ignoredPages.words[index].baseline==finishedRoll.words[index].baseline);
 auto continuousRoll=entryRoll;continuousRoll.waitForLine=false;assert(rollFrame(.5,continuousRoll).words[0].baseline<initialRoll.words[0].baseline);
 auto fasterRoll=entryRoll;fasterRoll.speed=2;assert(std::abs(rollFrame(1.045,fasterRoll).words[0].baseline-middleRoll.words[0].baseline)<1e-10);
 auto instantRoll=entryRoll;instantRoll.scrollDuration=0;assert(rollFrame(1,instantRoll).words.size()==2);
 auto downRoll=roll;downRoll.direction=2;assert(std::abs(rollFrame(.5,downRoll).words[0].baseline-32.2)<1e-9);assert(std::abs(rollFrame(1.18,downRoll).words[0].baseline-66)<1e-9);
 auto leftRoll=roll;leftRoll.direction=3;const auto leftBefore=rollFrame(1.5,leftRoll),leftDuring=rollFrame(2.09,leftRoll);
 assert(leftBefore.words.size()==2&&leftDuring.words.size()==4&&leftDuring.words[0].x<leftBefore.words[0].x);
 auto rightRoll=leftRoll;rightRoll.direction=4;assert(rollFrame(2.09,rightRoll).words[0].x>leftBefore.words[0].x);
 for(int direction:{1,2,3,4})for(int alignment:{1,3}){auto alignedRoll=roll;alignedRoll.direction=direction;const auto aligned=layoutFrame(rolling,1.5,{0,0,200,100,alignment},measure,56,.6,{},1,alignedRoll);assert(aligned.words.size()==2);for(const auto& word:aligned.words){if(alignment==1)assert(word.x==0);else assert(word.x+word.width==200);}}
 const auto clippedRoll=layoutFrame(rolling,.5,{0,0,200,5},measure,56,.6,{},1,roll);assert(clippedRoll.overflow&&clippedRoll.viewport.height==5&&clippedRoll.words[0].style.fontSize==rolling.style.current.fontSize);
 // Visible lines limits history within the physical box. A small height
 // never silently shrinks authored text, bubbles, margins, outlines or shadows.
 auto lineCountDoc=rolling;lineCountDoc.schemaVersion=kSchemaVersion;lineCountDoc.containers[0].words.clear();
 for(int index=0;index<24;++index)lineCountDoc.containers[0].words.push_back({"Line.",double(index),double(index+1),true});
 for(auto* style:{&lineCountDoc.style.current,&lineCountDoc.style.upcoming,&lineCountDoc.style.spoken}){style->fontSize=60;style->paddingTop=3;style->paddingRight=4;style->paddingBottom=5;style->paddingLeft=6;style->marginLeft=2;style->radiusTL=4;style->outlineWidth=1;style->shadowBlur=3;}
 lineCountDoc.style.spoken.sizeScale=.8;const auto lineCountBytes=encode(lineCountDoc);
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(std::size_t requested:{1,3,8})for(double boxHeight:{100,900}){
  auto settings=roll;settings.visibleLines=requested;settings.currentLine=direction==1?requested:1;settings.direction=direction;settings.transition=transition;
  const LayoutBox fixedBox{10,20,600,boxHeight};
  const double settledTime=direction<3?20.5:requested==8?23.5:20.5;
  const auto frame=layoutFrame(lineCountDoc,settledTime,fixedBox,measure,56,.6,{},1,settings);
  assert(frame.words.size()==(boxHeight==100?1:requested));assert(!frame.overflow&&frame.viewport.x==fixedBox.x&&frame.viewport.width==fixedBox.width);
  assert(frame.viewport.y>=fixedBox.y-1e-9&&frame.viewport.y+frame.viewport.height<=fixedBox.y+fixedBox.height+1e-9);
  for(const auto& run:frame.words){const auto& authored=run.state==WordState::Current?lineCountDoc.style.current:lineCountDoc.style.spoken;assert(run.style.fontSize==authored.fontSize&&run.style.sizeScale==authored.sizeScale);assert(run.style.paddingTop==3&&run.style.paddingLeft==6&&run.style.marginLeft==2&&run.style.radiusTL==4);assert(run.style.outlineWidth==1&&run.style.shadowBlur==3);assert(run.baseline>=fixedBox.y&&run.baseline<=fixedBox.y+fixedBox.height);}
  assert(encode(lineCountDoc)==lineCountBytes);
 }
 assert(rollFrame(4,roll).words.empty());
 auto manualRoll=rolling;manualRoll.containers.push_back({"manual-roll",true,{{"New.",5,6,true}}});
 const auto manualFrame=layoutFrame(manualRoll,5.2,{0,0,200,100},measure,56,.6,{},1,roll);
 assert(manualFrame.words.size()==1&&manualFrame.words[0].containerId=="manual-roll");
 // Fade is an alpha mask over sharp text. Its exit edge follows direction and
 // curves, including the original hard-zero region above a moved boundary.
 auto mask=initialRoll;mask.directionalPaintOutset={};mask.viewport={0,37,200,26};mask.rollUp.boundaryEnabled=true;mask.rollUp.transitionCurve=1;mask.rollUp.transitionThickness=.5;mask.rollUp.fadeAmount=1;
 assert(rollUpAlpha(100,37,mask)==0&&rollUpAlpha(100,43.5,mask)==.5&&rollUpAlpha(100,50,mask)==1&&rollUpAlpha(100,36,mask)==0);
 mask.rollUp.direction=2;assert(rollUpAlpha(100,62.9,mask)<.01&&rollUpAlpha(100,56.5,mask)==.5);
 mask.rollUp.direction=3;assert(rollUpAlpha(0,50,mask)==0&&rollUpAlpha(50,50,mask)==.5&&rollUpAlpha(100,50,mask)==1);
 mask.rollUp.direction=4;assert(rollUpAlpha(199.9,50,mask)<.01&&rollUpAlpha(150,50,mask)==.5);
 mask.rollUp.direction=1;mask.rollUp.transitionCurve=3;assert(rollUpAlpha(100,43.5,mask)==.75);mask.rollUp.transitionCurve=4;assert(rollUpAlpha(100,43.5,mask)==.25);
 // A saved zero fade amount is ignored: the gradient always spans 0..100%.
 mask.rollUp.boundaryPosition=.5;mask.rollUp.transitionCurve=1;mask.rollUp.fadeAmount=0;assert(rollUpAlpha(100,43,mask)==0&&rollUpAlpha(100,50,mask)==0&&rollUpAlpha(100,56.5,mask)==.5);
 mask.rollUp.boundaryEnabled=false;assert(rollUpAlpha(100,43,mask)==1);
 // Placement bounds are not a crop. Disabled directional masks pass all
 // overflowing paint; enabled masks affect only their designated edge.
 for(int direction:{1,2,3,4}){mask.rollUp.direction=direction;assert(rollUpAlpha(-200,-200,mask)==1&&rollUpAlpha(400,300,mask)==1);}
 auto directional=mask;directional.rollUp.boundaryEnabled=true;directional.rollUp.boundaryPosition=0;directional.rollUp.fadeAmount=1;
 directional.rollUp.direction=1;assert(rollUpAlpha(-200,100,directional)==1&&rollUpAlpha(400,100,directional)==1);
 directional.rollUp.direction=2;assert(rollUpAlpha(-200,0,directional)==1&&rollUpAlpha(400,0,directional)==1);
 directional.rollUp.direction=3;assert(rollUpAlpha(400,-200,directional)==1&&rollUpAlpha(400,300,directional)==1);
 directional.rollUp.direction=4;assert(rollUpAlpha(-200,-200,directional)==1&&rollUpAlpha(-200,300,directional)==1);

 // Independent edges clip inward from the fixed viewport, with separate
 // fade width/curve. Direction cannot swap the authored physical edges.
 Frame independent;independent.rolling=true;independent.viewport={10,20,200,100};independent.rollUp.boundaryMode=1;
 for(auto& edge:independent.rollUp.edges)edge.fadeEnabled=false;
 const std::array<std::array<double,2>,4> halfPoints{{{{110,50}},{{110,90}},{{70,70}},{{150,70}}}};
 const std::array<std::array<double,2>,4> clippedPoints{{{{110,39}},{{110,101}},{{49,70}},{{171,70}}}};
 for(std::size_t side=0;side<4;++side){
  auto frame=independent;auto& edge=frame.rollUp.edges[side];edge.inset=.2;edge.fadeEnabled=true;edge.thickness=.2;edge.curve=1;
  const auto p=halfPoints[side],outside=clippedPoints[side];
  for(int direction:{1,2,3,4}){frame.rollUp.direction=direction;assert(std::abs(rollUpAlpha(p[0],p[1],frame)-.5)<1e-9);assert(rollUpAlpha(outside[0],outside[1],frame)==0);}
  edge.amount=.4;assert(std::abs(rollUpAlpha(p[0],p[1],frame)-.5)<1e-9);
  edge.amount=1;edge.curve=3;assert(std::abs(rollUpAlpha(p[0],p[1],frame)-.75)<1e-9);
  edge.curve=4;assert(std::abs(rollUpAlpha(p[0],p[1],frame)-.25)<1e-9);
  edge.fadeEnabled=false;assert(rollUpAlpha(p[0],p[1],frame)==1&&rollUpAlpha(outside[0],outside[1],frame)==0);
  edge.fadeEnabled=true;edge.thickness=0;assert(rollUpAlpha(p[0],p[1],frame)==1);
  // A saved zero amount is ignored: the same ease-out (curve 4) as amount 1.
  edge.thickness=.2;edge.amount=0;assert(std::abs(rollUpAlpha(p[0],p[1],frame)-.25)<1e-9&&rollUpAlpha(outside[0],outside[1],frame)==0);
  for(std::size_t other=0;other<4;++other)if(other!=side)assert(frame.rollUp.edges[other].inset==0&&!frame.rollUp.edges[other].fadeEnabled);
 }
 auto corner=independent;corner.rollUp.edges[0].fadeEnabled=corner.rollUp.edges[2].fadeEnabled=true;
 corner.rollUp.edges[0].curve=corner.rollUp.edges[2].curve=1;corner.rollUp.edges[0].thickness=corner.rollUp.edges[2].thickness=.2;
 assert(std::abs(rollUpAlpha(30,30,corner)-.5)<1e-9); // min(.5,.5), never .25
 auto crossed=independent;crossed.rollUp.edges[0].inset=.7;crossed.rollUp.edges[1].inset=.4;
 for(double y:{20,50,80,119})assert(rollUpAlpha(110,y,crossed)==0);
 crossed=independent;crossed.rollUp.edges[2].inset=.5;crossed.rollUp.edges[3].inset=.5;assert(rollUpAlpha(110,70,crossed)==0);
 // Legacy mode is exact even if new independent settings contain other values.
 auto legacyBoundary=mask;legacyBoundary.rollUp.boundaryEnabled=true;legacyBoundary.rollUp.boundaryMode=0;
 auto legacyOtherEdges=legacyBoundary;for(auto& edge:legacyOtherEdges.rollUp.edges){edge.inset=.9;edge.thickness=.7;edge.amount=.4;edge.fadeEnabled=false;edge.curve=4;}
 for(int direction:{1,2,3,4}){legacyBoundary.rollUp.direction=legacyOtherEdges.rollUp.direction=direction;for(int y=35;y<65;++y)for(int x=0;x<200;++x)assert(rollUpAlpha(x+.5,y+.5,legacyBoundary)==rollUpAlpha(x+.5,y+.5,legacyOtherEdges));}
 // Default directional masks retain settled paint beyond authored row space.
 // This is mask-only: no caption origins, history, capacity or styles change.
 auto overhangDoc=rolling;overhangDoc.schemaVersion=kSchemaVersion;
 for(auto* style:{&overhangDoc.style.upcoming,&overhangDoc.style.current,&overhangDoc.style.spoken}){
  style->fontSize=50;style->padding=15;style->marginTop=style->marginBottom=style->marginLeft=style->marginRight=-5;
  style->outlineWidth=5;style->shadowColor.a=0;style->bubble=true;
 }
 overhangDoc.style.lineHeight=1;const auto overhangBytes=encode(overhangDoc);
 auto overhangSettings=roll;overhangSettings.boundaryEnabled=true;overhangSettings.visibleLines=1;overhangSettings.transitionThickness=0;
 const LayoutBox overhangBox{32,320,656,1152};
 for(int direction:{1,2,3,4}){
  overhangSettings.direction=direction;
  const auto on=layoutFrame(overhangDoc,.5,overhangBox,measure,56,.6,{},1,overhangSettings);
  auto offSettings=overhangSettings;offSettings.boundaryEnabled=false;
  const auto off=layoutFrame(overhangDoc,.5,overhangBox,measure,56,.6,{},1,offSettings);
  assert(on.viewport.x==off.viewport.x&&on.viewport.y==off.viewport.y&&on.viewport.width==off.viewport.width&&on.viewport.height==off.viewport.height);
  assert(on.words.size()==off.words.size()&&on.directionalPaintOutset==off.directionalPaintOutset);
  for(std::size_t index=0;index<on.words.size();++index)assert(on.words[index].x==off.words[index].x&&on.words[index].baseline==off.words[index].baseline);
  for(double outset:on.directionalPaintOutset)assert(outset==6);
  const auto& v=on.viewport;double x=v.x+v.width/2,y=v.y+v.height/2;
  if(direction==1)y=v.y-5;if(direction==2)y=v.y+v.height+5;if(direction==3)x=v.x-5;if(direction==4)x=v.x+v.width+5;
  assert(rollUpAlpha(x,y,on)==1);
  auto explicitBoundary=on;explicitBoundary.rollUp.boundaryPosition=.1;assert(rollUpAlpha(x,y,explicitBoundary)==0);
  auto independentBoundary=on;independentBoundary.rollUp.boundaryMode=1;for(auto& edge:independentBoundary.rollUp.edges)edge.fadeEnabled=false;
  assert(rollUpAlpha(x,y,independentBoundary)==1);
  auto insetIndependent=independentBoundary;for(auto& edge:insetIndependent.rollUp.edges)edge.inset=.1;assert(rollUpAlpha(x,y,insetIndependent)==0);
  for(double inset:{.000001,.1,.5,.9})for(double thickness:{0.,.2,.7}){
   auto explicitMask=on;explicitMask.rollUp.boundaryPosition=inset;explicitMask.rollUp.transitionThickness=thickness;
   auto legacyMask=explicitMask;legacyMask.directionalPaintOutset={};
   for(double horizontal:{-10.,0.,.2,.5,1.,1.1})for(double vertical:{-10.,0.,.2,.5,1.,1.1})
    assert(rollUpAlpha(v.x+horizontal*v.width,v.y+vertical*v.height,explicitMask)==rollUpAlpha(v.x+horizontal*v.width,v.y+vertical*v.height,legacyMask));
  }
  auto unexpandedIndependent=insetIndependent;unexpandedIndependent.directionalPaintOutset={};
  for(double horizontal:{-.1,0.,.2,.5,1.,1.1})for(double vertical:{-.1,0.,.2,.5,1.,1.1})
   assert(rollUpAlpha(v.x+horizontal*v.width,v.y+vertical*v.height,insetIndependent)==rollUpAlpha(v.x+horizontal*v.width,v.y+vertical*v.height,unexpandedIndependent));
  auto backgroundOff=overhangDoc;for(auto* style:{&backgroundOff.style.upcoming,&backgroundOff.style.current,&backgroundOff.style.spoken})style->bubble=false;
  assert(layoutFrame(backgroundOff,.5,overhangBox,measure,56,.6,{},1,overhangSettings).directionalPaintOutset==on.directionalPaintOutset);
  // Feather remains the original viewport fraction, translated outward only.
  auto feather=on;feather.rollUp.transitionThickness=.2;feather.rollUp.transitionCurve=1;
  const double length=direction<3?v.height:v.width,half=.1*length-on.directionalPaintOutset[direction-1];
  x=v.x+v.width/2;y=v.y+v.height/2;
  if(direction==1)y=v.y+half;if(direction==2)y=v.y+v.height-half;if(direction==3)x=v.x+half;if(direction==4)x=v.x+v.width-half;
  assert(std::abs(rollUpAlpha(x,y,feather)-.5)<1e-9);
 }
 // Different current/spoken metrics and off-axis shadows do not make the
 // allowance follow moving rows or the currently highlighted state.
 auto effectsDoc=overhangDoc;effectsDoc.style.current.shadowColor.a=1;effectsDoc.style.current.shadowBlur=4;effectsDoc.style.current.shadowX=-8;effectsDoc.style.current.shadowY=-10;
 const auto effects=layoutFrame(effectsDoc,.5,overhangBox,measure,56,.6,{},1,overhangSettings);
 assert(effects.directionalPaintOutset[0]==18&&effects.directionalPaintOutset[2]==16);
 assert(layoutFrame(effectsDoc,1.5,overhangBox,measure,56,.6,{},1,overhangSettings).directionalPaintOutset==effects.directionalPaintOutset);
 assert(encode(overhangDoc)==overhangBytes);
 const auto sampledEdge=sampledRollUpEdge(.3,.5,.4,.6,3.5);assert(sampledEdge.inset==.3&&sampledEdge.fadeEnabled&&sampledEdge.thickness==.4&&sampledEdge.amount==.6&&sampledEdge.curve==4);
 assert(sampledRollUpEdge(-2,.49,2,-1,-5).inset==0&&!sampledRollUpEdge(-2,.49,2,-1,-5).fadeEnabled&&sampledRollUpEdge(-2,.49,2,-1,-5).thickness==1);
 rejects([&]{sampledRollUpEdge(0,1,.2,std::numeric_limits<double>::quiet_NaN(),2);});
 auto invalidEdge=roll;invalidEdge.boundaryMode=1;invalidEdge.edges[3].amount=2;rejects([&]{rollFrame(.5,invalidEdge);});

 assert(encode(rolling)==rollingBytes);
 const auto sampledRoll=sampledRollUpSettings(.5,2.7,.18,.5,0,.35,1,1.5,2.7,2,.5);
 assert(sampledRoll.enabled&&sampledRoll.visibleLines==3&&sampledRoll.transitionCurve==2&&sampledRoll.direction==3&&sampledRoll.speed==2&&sampledRoll.waitForLine);
 rejects([&]{sampledRollUpSettings(1,2,std::numeric_limits<double>::infinity(),1,0,.35,1,2);});
 auto invalidRoll=roll;invalidRoll.visibleLines=9;rejects([&]{rollFrame(.5,invalidRoll);});invalidRoll=roll;invalidRoll.speed=0;rejects([&]{rollFrame(.5,invalidRoll);});
 // Current line slots reserve room for upcoming rows at the entry edge.
 // Equal metrics make the slot coordinates and the Down mirror exact.
 Document positionedRows;positionedRows.style.lineHeight=1;
 positionedRows.containers.push_back({"positioned-rows",false,{}});
 for(int index=0;index<12;++index)positionedRows.containers[0].words.push_back({"Row.",double(index),double(index+1),true});
 for(auto* style:{&positionedRows.style.current,&positionedRows.style.upcoming,&positionedRows.style.spoken}){style->fontSize=10;style->padding=0;style->bubble=false;}
 const auto positionedBytes=encode(positionedRows);
 auto positionedFrame=[&](double time,const RollUpSettings& settings,double height=100){return layoutFrame(positionedRows,time,{0,0,400,height},measure,56,.6,{},1,settings);};
 auto samePositionedFrame=[&](const Frame& a,const Frame& b){
  sameTextGeometry(a,b);assert(a.overflow==b.overflow&&a.rolling==b.rolling);
  for(std::size_t index=0;index<a.words.size();++index){const auto& x=a.words[index];const auto& y=b.words[index];assert(x.text==y.text&&x.containerId==y.containerId&&x.state==y.state&&x.height==y.height&&x.style.opacity==y.style.opacity);}
 };
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(double time:{.1,1.01,1.61,2.21,4.9,5.01}){
  auto settings=fillingSettings;settings.direction=direction;settings.transition=transition;
  const auto original=silenceFrame(fillingSilence,time,settings);settings.blankLineSeconds=0;
  samePositionedFrame(original,silenceFrame(fillingSilence,time,settings));
 }
 // The permitted opening-glide policy consumes virtual blank-line events
 // during the first duration, without postponing any speech/real row event.
 // With 2 blanks, the smooth curve crosses one slot exactly halfway through.
 for(const auto slots:std::vector<std::pair<std::size_t,std::size_t>>{{3,2},{5,3}})
 for(int direction:{1,2})for(int transition:{1,2,3,4})for(double speed:{.5,1.,2.}){
  auto settings=roll;settings.visibleLines=slots.first;settings.currentLine=slots.second;settings.direction=direction;settings.transition=transition;settings.scrollDuration=.4;settings.speed=speed;
  const double duration=settings.scrollDuration/speed,sign=direction==1?-1:1;
  const auto entry=positionedFrame(0,settings);assert(entry.words.size()==1&&entry.words.front().wordIndex==0&&entry.words.front().state==WordState::Current);
  const double entryBaseline=entry.viewport.y+8+(direction==1?double(slots.first-1)*10:0);
  assert(entry.words.front().baseline==entryBaseline);
  // Plain scroll instead glides at its one rate: half a row of ease-in, then
  // 2/3 of a duration per slot. The 1 s first line joins the glide when it
  // ends before the glide would settle on it, so the glide passes it.
  const double blanks=double(slots.second-1),plain=duration*(1+2*(blanks-1)/3);
  const bool passed=transition==1&&1<=plain-duration/6;
  for(std::size_t event=0;event<slots.second;++event){
   const double time=transition!=1?duration*double(event)/blanks:event==0?0:event<slots.second-1||passed?duration/6+2*double(event)*duration/3:plain;
   const auto frame=positionedFrame(time,settings);
   const auto first=std::find_if(frame.words.begin(),frame.words.end(),[](const DrawWord& word){return word.wordIndex==0;});assert(first!=frame.words.end());
   assert(std::abs(first->baseline-(entryBaseline+sign*event*10))<1e-9);
   assert(first->state==(time<1?WordState::Current:WordState::Spoken));
   if(time<1)assert(first->style.opacity==positionedRows.style.current.opacity);
  }
  auto instant=settings;instant.scrollDuration=0;
  if(!passed){const double settled=(transition==1?plain:duration)+.01;samePositionedFrame(positionedFrame(settled,settings),positionedFrame(settled,instant));}
  // Once the blanks are gone, normal completed line events retain the old
  // settled windows, including their upcoming rows and current-word state.
  for(double time:{2.9,4.9,6.9})samePositionedFrame(positionedFrame(time,settings),positionedFrame(time,instant));
  // A stream beginning at a nonzero source time still highlights immediately,
  // independently of seek order.
  auto delayed=positionedRows;for(auto& word:delayed.containers.front().words){word.start+=20;word.end+=20;}
  auto delayedFrame=[&](double time){return layoutFrame(delayed,time,{0,0,400,100},measure,56,.6,{},1,settings);};
  samePositionedFrame(delayedFrame(20),entry);
  delayedFrame(25);samePositionedFrame(delayedFrame(20),entry);
  // Continuous scrolling uses its existing first-line trigger as well as the
  // virtual blanks; it must neither delay highlighting nor duplicate a word.
  settings.waitForLine=false;
  for(double time:{0.,duration/4,duration/2,duration}){
   const auto frame=positionedFrame(time,settings);std::vector<std::size_t> seen;bool current=false;
   for(const auto& word:frame.words){assert(std::find(seen.begin(),seen.end(),word.wordIndex)==seen.end());seen.push_back(word.wordIndex);assert(std::isfinite(word.baseline)&&word.style.opacity>=0&&word.style.opacity<=1);if(word.state==WordState::Current){current=true;assert(word.wordIndex==0&&word.style.opacity==positionedRows.style.current.opacity);}}
   assert(current);
  }
 }
 // A scroll opening is continuous, not merely correct at virtual slot events.
 for(int direction:{1,2}){
  auto settings=roll;settings.visibleLines=5;settings.currentLine=3;settings.direction=direction;settings.scrollDuration=.4;
  double previous=positionedFrame(0,settings).words.front().baseline;
  for(int sample=1;sample<=40;++sample){const auto frame=positionedFrame(sample*.01,settings);const double baseline=frame.words.front().baseline;assert(direction==1?baseline<previous:baseline>previous);assert(std::abs(baseline-previous)<1);previous=baseline;}
 }
 for(int direction:{1,2})for(int transition:{1,2,3,4}){
  auto settings=roll;settings.visibleLines=3;settings.currentLine=2;settings.direction=direction;settings.transition=transition;
  const auto centered=positionedFrame(4.5,settings);
  assert(centered.words.size()==3);
  for(std::size_t index=0;index<3;++index){const auto& word=centered.words[index];assert(word.wordIndex==index+3);assert(word.state==(index==0?WordState::Spoken:index==1?WordState::Current:WordState::Upcoming));assert(word.baseline==53+(direction==1?1:-1)*(double(index)-1)*10);}
  settings.currentLine=8;const auto clamped=positionedFrame(4.5,settings);settings.currentLine=3;samePositionedFrame(clamped,positionedFrame(4.5,settings));
  assert(direction==1?clamped.words.front().wordIndex==2&&clamped.words.back().wordIndex==4:clamped.words.front().wordIndex==4&&clamped.words.back().wordIndex==6);
  // Physical capacity clamps even when the requested Visible lines is larger.
  settings.visibleLines=8;settings.currentLine=8;const auto physical=positionedFrame(4.5,settings,25);settings.currentLine=2;samePositionedFrame(physical,positionedFrame(4.5,settings,25));assert(physical.words.size()==2);
  settings.visibleLines=5;settings.currentLine=3;const auto five=positionedFrame(4.5,settings);assert(five.words.size()==5&&five.words[2].wordIndex==4&&five.words[2].baseline==53);
 }
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true}){
  auto settings=roll;settings.visibleLines=3;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;
  for(double time:{.5,3.99,4.0,4.01,4.09,4.18,4.5,8.5}){
   const auto original=positionedFrame(time,settings);settings.currentLine=1;samePositionedFrame(original,positionedFrame(time,settings));
   if(direction>=3){settings.currentLine=8;samePositionedFrame(original,positionedFrame(time,settings));settings.currentLine=1;}
  }
 }
 // A slot changes only the vertical translation, including during a scroll.
 for(int direction:{1,2})for(bool wait:{false,true}){
  auto settings=roll;settings.visibleLines=3;settings.direction=direction;settings.waitForLine=wait;
  for(double time:{3.99,4.0,4.01,4.09,4.18,4.5}){
   settings.currentLine=1;const auto edge=positionedFrame(time,settings);settings.currentLine=2;const auto center=positionedFrame(time,settings);bool shared=false;
   for(const auto& a:edge.words)for(const auto& b:center.words)if(a.wordIndex==b.wordIndex){shared=true;assert(std::abs(b.baseline-a.baseline-10)<1e-9);assert(a.x==b.x&&a.state==b.state&&a.style.opacity==b.style.opacity);}
   assert(shared);
  }
 }
 // Look-ahead crosses ordinary blank rows in all transitions and wait modes.
 for(int direction:{1,2})for(int transition:{1,2,3,4})for(bool wait:{false,true}){
  auto settings=roll;settings.visibleLines=3;settings.currentLine=2;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;
  for(double time:{.5,1.0,1.09,2.0,2.99,3.3})sameRenderedFrame(layoutFrame(longSilence,time,{0,0,400,400},measure,56,.6,{},1,settings),ordinaryPauseFrame(longSilence,time,{0,0,400,400},settings));
 }
 // Three slots can contain current text, a blank, and upcoming text. When
 // the blank becomes current it still counts, with history and next intact.
 for(int direction:{1,2})for(int transition:{1,2,3,4}){
  auto gap=positionedRows;gap.containers.front().words={{"Before.",0,1,true},{"After.",4,5,true}};
  auto settings=roll;settings.visibleLines=3;settings.currentLine=direction==1?1:3;settings.blankLineSeconds=3;settings.direction=direction;settings.transition=transition;
  const auto current=layoutFrame(gap,.5,{0,0,400,100},measure,56,.6,{},1,settings);
  assert(current.words.size()==2&&current.words[0].state==WordState::Current&&current.words[1].state==WordState::Upcoming);
  assert(std::abs(current.words[1].baseline-current.words[0].baseline)==20);
  // Plain scroll glides through the blank, so see it as it passes the slot.
  const double passing=transition==1?1+settings.scrollDuration*5/6:1.3;
  settings.currentLine=2;const auto blankCurrent=layoutFrame(gap,passing,{0,0,400,100},measure,56,.6,{},1,settings);
  assert(blankCurrent.words.size()==2&&blankCurrent.words[0].state==WordState::Spoken&&blankCurrent.words[1].state==WordState::Upcoming);
  assert(std::abs(std::abs(blankCurrent.words[1].baseline-blankCurrent.words[0].baseline)-20)<1e-9);
 }
 // Blanks sample current/upcoming/spoken line geometry just like authored
 // rows, including unequal font sizes, padding, margins and paint styles.
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true})for(std::size_t current:{1,2,3}){
  auto document=positionedRows;document.containers.front().words={{"Before.",0,1,true},{"After.",4,5,true}};
  document.style.current.fontSize=16;document.style.current.paddingTop=2;document.style.current.marginBottom=3;
  document.style.spoken.sizeScale=.8;document.style.upcoming.fontSize=12;document.style.upcoming.bubble=true;document.style.upcoming.shadowY=2;
  auto settings=roll;settings.visibleLines=3;settings.currentLine=current;settings.blankLineSeconds=3;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;
  for(double time:{.1,.5,1.09,2.,3.9,4.2})sameRenderedFrame(layoutFrame(document,time,{0,0,1200,400},measure,56,.6,{},1,settings),ordinaryPauseFrame(document,time,{0,0,1200,400},settings));
  settings.enabled=false;sameRenderedFrame(layoutFrame(document,2,{0,0,1200,400},measure,56,.6,{},3,settings),ordinaryPauseFrame(document,2,{0,0,1200,400},settings,3));
 }
 // Manual caption boundaries are line breaks in one scrolling stream. Use
 // the actual first two captions/word times from the pause-line live fixture.
 {
 Document splitCaptions;splitCaptions.style=positionedRows.style;
 splitCaptions.containers={
  {"first-caption",true,{{"Alright,",.31,.75,false},{"This",.75,.95,false},{"Thing's",.95,1.23,false}}},
  {"second-caption",true,{{"finally",1.23,1.63,false},{"going.",1.63,2.11,true},{"It",3.1,3.4583333333333335,false},{"hasn't",3.4683333333333333,3.828333333333333,false},{"started",3.828333333333333,4.2683333333333335,false},{"in",4.2683333333333335,4.508333333333333,false},{"months",4.508333333333333,4.988333333333333,true}}}
 };
 splitCaptions.containers[1].words.front().lineBreakBefore=LineBreakBefore::Break;
 auto streamSettings=roll;streamSettings.visibleLines=3;streamSettings.currentLine=2;streamSettings.blankLineSeconds=3;
 auto splitFrame=[&](double time,const RollUpSettings& settings){return layoutFrame(splitCaptions,time,{0,0,1200,100},measure,30,.6,{},1,settings);};
 const auto splitBytes=encode(splitCaptions);
 const auto beforeSplit=splitFrame(1.17,streamSettings),afterSplit=splitFrame(1.42,streamSettings);
 assert(beforeSplit.words.size()==5&&afterSplit.words.size()==10);
 for(std::size_t index=0;index<beforeSplit.words.size();++index){const auto& word=beforeSplit.words[index];assert(word.containerId==(index<3?"first-caption":"second-caption"));assert(word.baseline==(index<3?53:63));assert(word.state==(index<2?WordState::Spoken:index==2?WordState::Current:WordState::Upcoming));}
 for(std::size_t index=0;index<afterSplit.words.size();++index){const auto& word=afterSplit.words[index];assert(word.containerId==(index<3?"first-caption":"second-caption"));assert(word.wordIndex==(index<3?index:index-3));assert(word.baseline==(index<3?43:index<5?53:63));assert(word.state==(index<3?WordState::Spoken:index==3?WordState::Current:WordState::Upcoming));}
 // Compare split output against the same authored rows in one container.
 // Normalizing only source identity exposes geometry, timing and creative
 // transition regressions, including equal local word indices in many captions.
 auto splitPhrases=[](const Document& source){
  auto split=source;split.containers.clear();
  for(const auto& phrase:regroup(source,56,.6)){
   const auto& words=source.containers.front().words;
   split.containers.push_back({"split-"+std::to_string(phrase.firstWord),true,{words.begin()+phrase.firstWord,words.begin()+phrase.firstWord+phrase.wordCount}});
   split.containers.back().words.front().lineBreakBefore=LineBreakBefore::Break;
  }
  return split;
 };
 auto sameStreamFrame=[&](const Document& source,const Document& split,double time,const RollUpSettings& settings,std::size_t groups=1){
  const LayoutBox box{0,0,1200,100};
  const auto expected=layoutFrame(source,time,box,measure,56,.6,{},groups,settings);
  auto actual=layoutFrame(split,time,box,measure,56,.6,{},groups,settings);
  std::vector<std::pair<std::string,std::size_t>> seen;
  for(auto& word:actual.words){
   const auto identity=std::make_pair(word.containerId,word.wordIndex);
   assert(std::find(seen.begin(),seen.end(),identity)==seen.end());seen.push_back(identity);
   word.wordIndex+=std::stoul(word.containerId.substr(6));word.containerId=source.containers.front().id;
  }
  samePositionedFrame(expected,actual);
  assert(expected.directionalPaintOutset==actual.directionalPaintOutset);
  for(std::size_t index=0;index<actual.words.size();++index){const auto& a=expected.words[index];const auto& b=actual.words[index];assert(a.bubbleExtraWidth==b.bubbleExtraWidth&&a.bubbleJoinLeft==b.bubbleJoinLeft&&a.bubbleJoinRight==b.bubbleJoinRight);}
 };
 const auto splitPositioned=splitPhrases(positionedRows);
 // Every split retains prior history/upcoming rows. The sole opening glide
 // stays at the beginning; all transitions/directions/wait policies and seeks
 // match the original stream exactly, including during boundary animations.
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true})for(std::size_t current:{1,2,3})for(double speed:{.5,2.}){
  auto settings=streamSettings;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;settings.currentLine=current;settings.speed=speed;
  for(double time:{0.,.045,.09,.18,.5,.99,1.,1.045,1.09,1.18,1.5,2.09,3.09,4.5,8.09,11.5,12.})sameStreamFrame(positionedRows,splitPositioned,time,settings);
 }
 // Auto uses average spoken-line duration across captions; explicit lengths
 // reserve the same complete pause rows. Empty rows clear history through
 // ordinary transitions and participate in upcoming-line visibility.
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true})for(std::size_t visible:{1,3,8})for(double blank:{0.,2.})for(double gap:{.7,2.,4.5,20.}){
  auto source=fillingSilence;source.containers[0].words.back().start=1+gap;source.containers[0].words.back().end=2.4+gap;
  auto split=splitPhrases(source);const auto sourceBytes=encode(source),beforeBytes=encode(split);
  auto settings=streamSettings;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;settings.visibleLines=visible;settings.blankLineSeconds=blank;
  for(double time:{0.,.19,.3,.5,.99,1.,1.09,1.3,1+gap-.001,1+gap,1+gap+.09,1+gap+.3,1.1})sameStreamFrame(source,split,time,settings);
  assert(encode(source)==sourceBytes&&encode(split)==beforeBytes);
 }
 // A split alone forces a new line even without terminal punctuation, and
 // creative layers must retain both containers' local word zero.
 auto joined=splitCaptions;joined.containers.front().words.back().endOfSentence=true;
 joined.containers.front().words.insert(joined.containers.front().words.end(),joined.containers.back().words.begin(),joined.containers.back().words.end());joined.containers.pop_back();
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4})for(bool wait:{false,true}){
  auto settings=streamSettings;settings.direction=direction;settings.transition=transition;settings.waitForLine=wait;
  for(double time:{.31,.4,1.17,1.23,1.3,1.42,2.15,3.1,3.2}){
   const auto expected=layoutFrame(joined,time,{0,0,1200,100},measure,30,.6,{},1,settings);auto actual=splitFrame(time,settings);
   for(auto& word:actual.words){if(word.containerId=="second-caption")word.wordIndex+=3;word.containerId="first-caption";}
   samePositionedFrame(expected,actual);
  }
 }
 // Stream ordering comes from storage order, including out-of-order times.
 auto reordered=splitPositioned;std::reverse(reordered.containers.begin(),reordered.containers.end());
 const auto reverseGroups=regroup(reordered,56,.6);assert(reverseGroups.size()==12);
 for(std::size_t index=0;index<reverseGroups.size();++index){assert(reverseGroups[index].containerId=="split-"+std::to_string(11-index));assert(reverseGroups[index].wordRefs.front().containerIndex==index);}
 // Groups per page consumes the same stream across caption boundaries.
 // Explicit/Auto pause rows occupy page slots exactly like authored lines.
 for(std::size_t groups:{1,2,3,5,100})for(double blank:{0.,3.}){
  auto settings=streamSettings;settings.enabled=false;settings.blankLineSeconds=blank;
  for(double time:{0.,.5,1.,1.09,2.5,4.5,8.09,11.5,12.})sameStreamFrame(positionedRows,splitPositioned,time,settings,groups);
  for(double gap:{.7,2.,4.5,20.}){
   auto source=fillingSilence;source.containers[0].words.back().start=1+gap;source.containers[0].words.back().end=2.4+gap;
   const auto split=splitPhrases(source);
   for(double time:{.1,1.,1.5,1+gap-.001,1+gap+.3}){
    sameStreamFrame(source,split,time,settings,groups);
    sameRenderedFrame(layoutFrame(source,time,{0,0,400,1000},measure,56,.6,{},groups,settings),ordinaryPauseFrame(source,time,{0,0,400,1000},settings,groups));
   }
  }
  for(double time:{.31,1.17,1.23,1.42,2.5,3.2}){
   const auto expected=layoutFrame(joined,time,{0,0,1200,100},measure,30,.6,{},groups,settings);auto actual=layoutFrame(splitCaptions,time,{0,0,1200,100},measure,30,.6,{},groups,settings);
   for(auto& word:actual.words){if(word.containerId=="second-caption")word.wordIndex+=3;word.containerId="first-caption";}
   samePositionedFrame(expected,actual);
  }
 }
 assert(splitFrame(.3,streamSettings).words.empty()&&splitFrame(5,streamSettings).words.empty());
 assert(encode(splitCaptions)==splitBytes&&encode(positionedRows)==positionedBytes);
 }
 for(double value:{-10.0,1.0,1.49,1.5,2.7,8.0,100.0}){const auto sample=sampledRollUpSettings(1,3,.18,1,0,.35,1,2,1,1,1,1,value);assert(sample.currentLine==static_cast<std::size_t>(std::floor(std::clamp(value,1.0,8.0)+.5)));}
 assert(sampledRoll.currentLine==1);
 rejects([&]{sampledRollUpSettings(1,3,.18,1,0,.35,1,2,1,1,1,1,std::numeric_limits<double>::quiet_NaN());});
 for(std::size_t invalidPosition:{0,9}){auto settings=roll;settings.currentLine=invalidPosition;rejects([&]{positionedFrame(4.5,settings);});}
 // Creative transitions crossfade the neighbouring settled windows. They keep
 // the default wait policy, source-time determinism and settled row geometry.
 for(int transition:{2,3,4}){
  auto creative=entryRoll;creative.transition=transition;
  const auto before=rollFrame(.5,creative),during=rollFrame(1.09,creative),after=rollFrame(1.18,creative);
  assert(before.words.size()==initialRoll.words.size()&&before.words[0].x==initialRoll.words[0].x&&before.words[0].baseline==initialRoll.words[0].baseline);
  assert(during.words.size()==2);bool currentVisible=false;std::vector<std::size_t> retained;
  for(const auto& run:during.words){assert(run.style.opacity>=0&&run.style.opacity<=1);assert(std::find(retained.begin(),retained.end(),run.wordIndex)==retained.end());retained.push_back(run.wordIndex);assert(run.wordIndex<=1);if(run.state==WordState::Current){assert(run.style.opacity==rolling.style.current.opacity);currentVisible=true;}else assert(run.style.opacity==rolling.style.spoken.opacity);}
  assert(currentVisible&&after.words.size()==finishedRoll.words.size());
  const auto later=rollFrame(2.09,creative);bool outgoingFades=false;retained.clear();
  for(const auto& run:later.words){assert(std::find(retained.begin(),retained.end(),run.wordIndex)==retained.end());retained.push_back(run.wordIndex);if(run.wordIndex==0&&run.style.opacity<rolling.style.spoken.opacity)outgoingFades=true;if(run.state==WordState::Current)assert(run.style.opacity==rolling.style.current.opacity);}
  assert(outgoingFades);
  for(std::size_t index=0;index<after.words.size();++index)assert(after.words[index].x==finishedRoll.words[index].x&&after.words[index].baseline==finishedRoll.words[index].baseline&&after.words[index].style.fontSize==finishedRoll.words[index].style.fontSize&&after.words[index].style.opacity==finishedRoll.words[index].style.opacity);
  const auto again=rollFrame(1.09,creative);for(std::size_t index=0;index<during.words.size();++index)assert(again.words[index].x==during.words[index].x&&again.words[index].baseline==during.words[index].baseline&&again.words[index].style.opacity==during.words[index].style.opacity);
  if(transition==4)for(const auto& run:during.words){if(run.wordIndex==1)assert(run.style.fontSize<10&&run.style.fontSize>=8);else assert(run.style.fontSize==10);}
  for(int direction:{1,2,3,4}){creative.direction=direction;const auto frame=rollFrame(direction>=3?2.09:1.09,creative);assert(!frame.words.empty());for(const auto& run:frame.words)assert(std::isfinite(run.x)&&std::isfinite(run.baseline)&&run.width>0);}
 }
 assert(sampledRollUpSettings(1,2,.18,1,0,.35,1,2,1,1,1,3.5).transition==4);
 invalidRoll=roll;invalidRoll.transition=5;rejects([&]{rollFrame(.5,invalidRoll);});
 // Repeated words need at most one shaped metric read for each distinct font
 // state per render in rolling layout.
 Document repeated;repeated.containers.push_back({"many",false,{}});for(std::size_t index=0;index<1000;++index)repeated.containers[0].words.push_back({"same",index*.1,index*.1+.1,false});
 int metricReads=0;const auto repeatedFrame=layoutFrame(repeated,50,{0,0,300,200},[&](const std::string& text,const WordStyle& style){++metricReads;return measure(text,style);},56,.6,{},1,roll);
 assert(metricReads<=3&&repeatedFrame.words.size()<30);
 // Per-side geometry survives v7 persistence and reserves exterior margins.
 auto geometry=axes;auto& gs=geometry.style.current;gs.paddingTop=2;gs.paddingRight=9;gs.paddingBottom=7;gs.paddingLeft=4;gs.marginLeft=3;gs.marginRight=5;gs.marginTop=6;gs.marginBottom=8;gs.radiusTL=0;gs.radiusBR=14;
 const auto geoBytes=encode(geometry);assert(decode(geoBytes).schemaVersion==kSchemaVersion&&encode(decode(geoBytes))==geoBytes);assert(decode(geoBytes).style.current.radiusBR==14);
 const auto geoFrame=layoutFrame(geometry,.5,{0,0,200,300},measure);assert(geoFrame.words[0].width==41&&geoFrame.words[0].height==43);
 auto negative=geometry;negative.style.current.marginLeft=-4;validate(negative);assert(encode(decode(encode(negative)))==encode(negative));
 auto invalidGeo=geometry;invalidGeo.style.current.paddingTop=-2;rejects([&]{validate(invalidGeo);});invalidGeo=geometry;invalidGeo.style.current.marginTop=std::numeric_limits<double>::quiet_NaN();rejects([&]{validate(invalidGeo);});
 // Deterministic malformed-buffer stress: decode can reject or return a valid bounded document.
 std::uint32_t seed=17;for(unsigned trial=0;trial<1000;++trial){auto mutated=encoded;seed=1664525*seed+1013904223;auto index=seed%mutated.size();seed=1664525*seed+1013904223;mutated[index]^=static_cast<std::uint8_t>(seed>>24);try{validate(decode(mutated));}catch(const std::invalid_argument&){} }
 lineWrapChecks();
 blankLineChecks();
 std::cout<<"caption_core: grouping, layout, styling, timing, codec and malformed-data checks passed\n";
}
