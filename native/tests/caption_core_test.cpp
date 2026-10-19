#ifdef NDEBUG
#undef NDEBUG // Test checks remain active in Release builds.
#endif
#include "../core/caption_core.hpp"
#include <cassert>
#include <cmath>
#include <cstring>
#include <iostream>
#include <fstream>
#include <iterator>
#include <limits>
#include <stdexcept>
using namespace better_captions;
template<class F> void rejects(F f){bool rejected=false;try{f();}catch(const std::invalid_argument&){rejected=true;}assert(rejected);}
Document sample(){Document d;d.containers.push_back({"original",false,{{"HELLO",0,0.4,false},{"world",0.4,0.8,false},{"again.",0.8,1.2,true},{"later",2,3,false}}});d.style.current.color={1,0,0,1};d.style.spoken.opacity=0.5;return d;}
Metrics measure(const std::string& text,const WordStyle& s){double px=s.fontSize*s.sizeScale;return {text.size()*px*0.5,px*0.8,px*0.2};}
int main(int argc,char** argv){
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
 d.containers.push_back({"razor-right",true,{{"separate",3,4,false}}});assert(regroup(d,500).size()==3);assert(d.containers[1].manualSplit);
 auto encoded=encode(d);auto copy=decode(encoded);assert(encode(copy)==encoded&&copy.containers[1].manualSplit&&copy.style.spoken.opacity==0.5);
 // Schema 2 adds a persistent source/sequence origin without rewriting word times.
 auto versionTwo=d;versionTwo.schemaVersion=2;const auto versionTwoBytes=encode(versionTwo);
 auto originDoc=versionTwo;originDoc.timeOriginSeconds=3600;auto originBytes=encode(originDoc);auto originCopy=decode(originBytes);
 assert(originCopy.schemaVersion==2&&originCopy.timeOriginSeconds==3600&&originCopy.containers[0].words[0].start==d.containers[0].words[0].start);
 originDoc.timeOriginSeconds=-864000;assert(decode(encode(originDoc)).timeOriginSeconds==-864000);originDoc.timeOriginSeconds=864000;assert(decode(encode(originDoc)).timeOriginSeconds==864000);
 auto legacy=versionTwoBytes;legacy.resize(legacy.size()-8);legacy[4]=1;auto legacyCopy=decode(legacy);assert(legacyCopy.schemaVersion==1&&legacyCopy.timeOriginSeconds==0&&legacyCopy.containers[0].words[0].text=="HELLO");
 assert(encode(legacyCopy)==legacy&&encode(decode(versionTwoBytes))==versionTwoBytes); // Untouched v1/v2 bytes stay exact.
 legacyCopy.timeOriginSeconds=3600;assert(decode(encode(legacyCopy)).schemaVersion==2);
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
 assert(typographyCopy.schemaVersion==3&&typographyCopy.style.baseFontWeight==400);
 assert(typographyCopy.style.current.fontWeight==700&&typographyCopy.style.current.fontWeightOffset==100&&typographyCopy.style.current.italic==1);
 assert(typographyCopy.style.upcoming.italic==0&&typographyCopy.style.spoken.fontWeightOffset==0&&encode(typographyCopy)==typographyBytes);
 assert(typographyBytes.size()==versionTwoBytes.size()+56);
 for(double invalidWeight:{0.999,1000.001,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}){auto invalid=typography;invalid.style.current.fontWeight=invalidWeight;rejects([&]{encode(invalid);});invalid=typography;invalid.style.baseFontWeight=invalidWeight;rejects([&]{encode(invalid);});}
 auto invalidTypography=typography;invalidTypography.style.current.italic=2;rejects([&]{encode(invalidTypography);});invalidTypography=typography;invalidTypography.style.current.fontWeightOffset=50;rejects([&]{encode(invalidTypography);});
 for(std::size_t offset:{typographyBytes.size()-40,typographyBytes.size()-36}){auto malformed=typographyBytes;malformed[offset]=3;rejects([&]{decode(malformed);});}
 auto bad=encoded;bad[4]=99;rejects([&]{decode(bad);});bad=encoded;bad.pop_back();rejects([&]{decode(bad);});bad=encoded;bad.push_back(0);rejects([&]{decode(bad);});rejects([&]{decode({});});
 bad=encoded;bad[8]=255;bad[9]=255;rejects([&]{decode(bad);});
 auto invalid=d;invalid.containers[1].id="original";rejects([&]{validate(invalid);});invalid=d;invalid.containers[0].words[0].start=std::numeric_limits<double>::quiet_NaN();rejects([&]{validate(invalid);});invalid=d;invalid.style.current.opacity=2;rejects([&]{validate(invalid);});rejects([&]{regroup(d,0);});
 d.style.titleCase=true;auto frame=layoutFrame(d,0.4,{0,0,1200,300},measure);assert(frame.words.size()==3);assert(frame.words[0].state==WordState::Spoken&&frame.words[1].state==WordState::Current&&frame.words[2].state==WordState::Upcoming);assert(frame.words[0].text=="Hello"&&d.containers[0].words[0].text=="HELLO");
 assert(frame.words[0].style.opacity==0.5&&frame.words[1].style.color.r==1&&frame.words[1].style.color.g==0);
 auto narrow=layoutFrame(d,0.4,{0,0,200,1000},measure);assert(narrow.words.size()==3&&narrow.words[1].baseline>narrow.words[0].baseline);assert(narrow.words[1].style.fontSize==frame.words[1].style.fontSize&&narrow.words[1].width==frame.words[1].width);
 auto shortBox=layoutFrame(d,0.4,{0,0,1200,10},measure);assert(shortBox.overflow&&shortBox.words[0].x==frame.words[0].x&&shortBox.words[0].width==frame.words[0].width);
 assert(layoutFrame(d,1.2,{0,0,1200,300},measure).words.empty());assert(layoutFrame(d,2,{0,0,1200,300},measure).words.size()==1);
 assert(displayText("don't STOP naïve café",true)=="Don't Stop Naïve Café");
 assert(displayText("Mixed-case",false,1)=="MIXED-CASE"&&displayText("Mixed-case",false,2)=="mixed-case");
 for(int mode:{1,2}){auto cased=sample();cased.style.letterCase=mode;const auto bytes=encode(cased),roundtrip=encode(decode(bytes));assert(bytes==roundtrip&&decode(bytes).schemaVersion==4);auto cf=layoutFrame(cased,.4,{0,0,1200,300},measure);assert(cf.words[0].text==(mode==1?"HELLO":"hello"));assert(cased.containers[0].words[0].text=="HELLO");}
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
 assert(layoutFrame(pages,2.95,{0,0,1200,1000},measure,11,.6,{},3).words.empty()); // Inter-page gap.
 const auto lastPage=layoutFrame(pages,3.1,{0,0,1200,1000},measure,11,.6,{},3);
 assert(lastPage.words.size()==2&&lastPage.words[0].wordIndex==6&&lastPage.words[0].baseline==threeGroups.words[0].baseline);
 const auto pageReflow=layoutFrame(pages,1.2,{0,0,180,1000},measure,11,.6,{},3);
 assert(pageReflow.words.size()==6&&pageReflow.words[1].baseline>pageReflow.words[0].baseline&&pageReflow.words[2].baseline>pageReflow.words[1].baseline);
 assert(layoutFrame(pages,1.2,{0,0,1200,100},measure,11,.6,{},3).overflow);
 // A page remains visible during an internal pause, without inventing a current
 // word, but does not bridge separate manually split caption containers.
 auto paused=pages;for(std::size_t i=2;i<paused.containers[0].words.size();++i){paused.containers[0].words[i].start+=2;paused.containers[0].words[i].end+=2;}
 const auto pausedPage=layoutFrame(paused,2,{0,0,1200,1000},measure,11,.6,{},3);
 assert(pausedPage.words.size()==6);for(const auto& run:pausedPage.words)assert(run.state!=WordState::Current);
 auto splitPages=pages;splitPages.containers.push_back({"manual-next",true,{{"separate",5,6,false}}});
 const auto splitFrame=layoutFrame(splitPages,3.1,{0,0,1200,1000},measure,11,.6,{},100);
 assert(splitFrame.words.size()==8);for(const auto& run:splitFrame.words)assert(run.containerId=="page-source");
 assert(layoutFrame(splitPages,5.2,{0,0,1200,1000},measure,11,.6,{},100).words.size()==1);
 assert(encode(pages)==pageBytes); // Layout never modifies the carrier/word clock.
 rejects([&]{layoutFrame(pages,1.2,{0,0,1200,1000},measure,11,.6,{},0);});
 rejects([&]{layoutFrame(pages,1.2,{0,0,1200,1000},measure,11,.6,{},101);});
 assert(sampledGroupsPerPage(1)==1&&sampledGroupsPerPage(1.49)==1&&sampledGroupsPerPage(1.5)==2&&sampledGroupsPerPage(2.7)==3);
 assert(sampledGroupsPerPage(-1e308)==1&&sampledGroupsPerPage(0)==1&&sampledGroupsPerPage(100.4)==100&&sampledGroupsPerPage(1e308)==100);
 for(double badGroups:{std::numeric_limits<double>::infinity(),-std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()})rejects([&]{sampledGroupsPerPage(badGroups);});
 assert(layoutFrame(pages,1.2,{0,0,1200,1000},measure,11,.6,{},sampledGroupsPerPage(2.7)).words.size()==6);
 // Deterministic malformed-buffer stress: decode can reject or return a valid bounded document.
 std::uint32_t seed=17;for(unsigned trial=0;trial<1000;++trial){auto mutated=encoded;seed=1664525*seed+1013904223;auto index=seed%mutated.size();seed=1664525*seed+1013904223;mutated[index]^=static_cast<std::uint8_t>(seed>>24);try{validate(decode(mutated));}catch(const std::invalid_argument&){} }
 std::cout<<"caption_core: grouping, layout, styling, timing, codec and malformed-data checks passed\n";
}
