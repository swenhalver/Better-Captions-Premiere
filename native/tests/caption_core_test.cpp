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
 const auto explicitCenter=layoutFrame(d,.4,{0,0,1200,300,2},measure),leftAligned=layoutFrame(d,.4,{0,0,1200,300,1},measure),rightAligned=layoutFrame(d,.4,{0,0,1200,300,3},measure);
 for(std::size_t i=0;i<frame.words.size();++i)assert(explicitCenter.words[i].x==frame.words[i].x&&explicitCenter.words[i].baseline==frame.words[i].baseline);
 assert(leftAligned.words[0].x==0&&rightAligned.words.back().x+rightAligned.words.back().width==1200);
 for(int alignment:{1,3}){const auto wrapped=layoutFrame(d,.4,{10,0,200,1000,alignment},measure);assert(wrapped.words.size()==3);for(const auto& word:wrapped.words){if(alignment==1)assert(word.x==10);else assert(word.x+word.width==210);}}
 assert(sampledTextAlignment(1)==1&&sampledTextAlignment(1.49)==1&&sampledTextAlignment(1.5)==2&&sampledTextAlignment(2.5)==3&&sampledTextAlignment(100)==3&&sampledTextAlignment(-100)==1);
 rejects([&]{sampledTextAlignment(std::numeric_limits<double>::infinity());});rejects([&]{layoutFrame(d,.4,{0,0,1200,300,0},measure);});
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
 // Filling spaces is a paint-only extension: source layout, wrapping and final
 // trailing bounds stay identical; current/spoken/upcoming flags are independent.
 for(const auto state:{0,1,2}){
  auto fill=bubbles;fill.style.wordSpacing=37;auto* selected=state==0?&fill.style.current:state==1?&fill.style.spoken:&fill.style.upcoming;
  selected->bubble=true;selected->bubbleFillSpaces=true;
  const double time=state==1?.5:.1;const auto frame=layoutFrame(fill,time,{0,0,1200,300},measure);
  auto without=fill;selected=state==0?&without.style.current:state==1?&without.style.spoken:&without.style.upcoming;selected->bubbleFillSpaces=false;
  const auto baseline=layoutFrame(without,time,{0,0,1200,300},measure);assert(frame.words.size()==baseline.words.size());
  for(std::size_t i=0;i<frame.words.size();++i){const auto& run=frame.words[i];assert(run.x==baseline.words[i].x&&run.width==baseline.words[i].width&&run.baseline==baseline.words[i].baseline);const bool enabled=run.style.bubble&&run.style.bubbleFillSpaces&&i+1<frame.words.size();assert(run.bubbleExtraWidth==(enabled?37:0));}
  const auto bytes=encode(fill);assert(decode(bytes).schemaVersion==5&&encode(decode(bytes))==bytes);
  const auto wrapped=layoutFrame(fill,time,{0,0,160,600},measure);for(const auto& run:wrapped.words)assert(run.bubbleExtraWidth==0);
 }
 auto v5Bad=encode(bubbles);auto v5Fill=bubbles;v5Fill.style.current.bubbleFillSpaces=true;v5Bad=encode(v5Fill);v5Bad.back()=2;rejects([&]{decode(v5Bad);});
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
 // Smart fitting uses shaped pixel advances, independent of a source character
 // limit. Narrow and wide letters therefore produce different phrase sizes.
 Document smart;smart.style.wordSpacing=2;smart.containers.push_back({"smart",false,{{"iii",0,.2,false},{"iii",.3,.5,false},{"WWW",.6,.8,false},{"WWW",.9,1.1,false}}});
 for(auto* style:{&smart.style.current,&smart.style.upcoming,&smart.style.spoken})style->fontSize=10;
 auto variableMeasure=[](const std::string& text,const WordStyle& style){double width=0;for(char c:text)width+=c=='W'?8:1;const auto scale=style.fontSize*style.sizeScale/10;return Metrics{width*scale,8*scale,2*scale};};
 const auto smartBytes=encode(smart);const auto smartGroups=regroupToWidth(smart,40,variableMeasure);
 assert(smartGroups.size()==2&&smartGroups[0].wordCount==3&&smartGroups[1].wordCount==1);
 const auto smartFrame=layoutFrame(smart,.1,{0,0,40,500},variableMeasure,1,.6,{},1,true);
 assert(smartFrame.words.size()==3&&!smartFrame.overflow); // maxChars=1 is preserved, not applied in smart mode.
 const auto smartLeft=layoutFrame(smart,.1,{0,0,40,500,1},variableMeasure,1,.6,{},1,true),smartRight=layoutFrame(smart,.1,{0,0,40,500,3},variableMeasure,1,.6,{},1,true);
 assert(smartLeft.words.size()==smartFrame.words.size()&&smartRight.words.size()==smartFrame.words.size()&&smartLeft.words[0].x==0&&smartRight.words.back().x+smartRight.words.back().width==40);
 assert(layoutFrame(smart,.1,{0,0,40,500},variableMeasure,1).words.size()==1);
 auto skinny=smart;for(auto& word:skinny.containers[0].words)word.text="iii";
 auto wide=smart;for(auto& word:wide.containers[0].words)word.text="WWW";
 assert(regroupToWidth(skinny,40,variableMeasure).size()==1&&regroupToWidth(wide,40,variableMeasure).size()==4);
 // Reserve exactly 5% even when the raw measured text would fit in the box.
 auto margin=skinny;margin.containers[0].words.resize(2);
 auto eighteen=[](const std::string&,const WordStyle&){return Metrics{18,8,2};};
 auto overEighteen=[](const std::string&,const WordStyle&){return Metrics{18.1,8,2};};
 assert(regroupToWidth(margin,40,eighteen).size()==1&&regroupToWidth(margin,40,overEighteen).size()==2);
 // Every word reserves its largest upcoming/current/spoken appearance. The
 // grouping does not jump when a large highlighted/bubbled word becomes active.
 auto reserved=skinny;reserved.style.current.sizeScale=3;reserved.style.current.bubble=true;reserved.style.current.padding=5;
 assert(regroupToWidth(reserved,40,variableMeasure).size()==4);
 const auto reservedEarly=layoutFrame(reserved,.1,{0,0,40,500},variableMeasure,56,.6,{},4,true);
 const auto reservedLater=layoutFrame(reserved,.4,{0,0,40,500},variableMeasure,56,.6,{},4,true);
 assert(reservedEarly.words.size()==4&&reservedLater.words.size()==4);
 for(std::size_t i=0;i<4;++i)assert(reservedEarly.words[i].wordIndex==reservedLater.words[i].wordIndex&&reservedEarly.words[i].containerId==reservedLater.words[i].containerId);
 assert(reservedEarly.words[1].baseline>reservedEarly.words[0].baseline);
 auto spokenReserved=skinny;spokenReserved.style.spoken.fontSize=100;assert(regroupToWidth(spokenReserved,40,variableMeasure).size()==4);
 auto breaks=skinny;breaks.containers[0].words[0].endOfSentence=true;breaks.containers[0].words[2].start=2;breaks.containers[0].words[2].end=2.2;breaks.containers[0].words[3].start=2.3;breaks.containers[0].words[3].end=2.5;
 breaks.containers.push_back({"manual-smart",true,{{"iii",3,4,false}}});
 const auto smartBreaks=regroupToWidth(breaks,1000,variableMeasure);assert(smartBreaks.size()==4&&smartBreaks[0].wordCount==1&&smartBreaks[1].wordCount==1&&smartBreaks[2].wordCount==2&&smartBreaks[3].containerId=="manual-smart");
 const auto overlong=layoutFrame(wide,.1,{0,0,5,500},variableMeasure,56,.6,{},1,true);assert(overlong.words.size()==1&&overlong.words[0].text=="WWW"&&overlong.overflow);
 assert(encode(smart)==smartBytes);
 assert(!sampledSmartLineFit(-100)&&!sampledSmartLineFit(.49)&&sampledSmartLineFit(.5)&&sampledSmartLineFit(100));
 rejects([&]{sampledSmartLineFit(std::numeric_limits<double>::quiet_NaN());});
 rejects([&]{regroupToWidth(smart,0,variableMeasure);});rejects([&]{regroupToWidth(smart,40,[](const std::string&,const WordStyle&){return Metrics{-1,0,0};});});
 // Native roll-up retains stable row packing while revealing only started words.
 // Scrolling is a pure source-time function, so scrubbing backward never depends
 // on previous rendered frames or an external animation clock.
 Document rolling;rolling.containers.push_back({"rolling",false,{{"First.",0,1,true},{"Second.",1,2,true},{"Third.",2,3,true},{"Fourth.",3,4,true}}});
 for(auto* style:{&rolling.style.current,&rolling.style.upcoming,&rolling.style.spoken})style->fontSize=10;
 RollUpSettings roll;roll.enabled=true;roll.boundaryEnabled=false;
 // Rolling geometry uses reserved word slots. Fill ends at the next actual
 // outer edge, including unequal state scales, then follows creative transforms.
 auto spaceRoll=bubbles;for(auto* style:{&spaceRoll.style.current,&spaceRoll.style.upcoming,&spaceRoll.style.spoken}){style->bubble=true;style->bubbleFillSpaces=true;style->fontSize=12;}
 spaceRoll.style.current.sizeScale=1.5;spaceRoll.style.wordSpacing=17;
 for(int direction:{1,2,3,4})for(int transition:{1,2,3,4}){
  auto settings=roll;settings.direction=direction;settings.transition=transition;
  const auto frame=layoutFrame(spaceRoll,.6,{0,0,500,180},measure,56,.6,{},1,false,settings);
  assert(frame.words.size()==2);assert(frame.words[0].bubbleExtraWidth>0);assert(std::abs(frame.words[0].x+frame.words[0].width+frame.words[0].bubbleExtraWidth-frame.words[1].x)<1e-10);
  auto unchanged=spaceRoll;for(auto* style:{&unchanged.style.current,&unchanged.style.upcoming,&unchanged.style.spoken})style->bubbleFillSpaces=false;
  const auto baseline=layoutFrame(unchanged,.6,{0,0,500,180},measure,56,.6,{},1,false,settings);
  for(std::size_t i=0;i<frame.words.size();++i){assert(frame.words[i].x==baseline.words[i].x&&frame.words[i].width==baseline.words[i].width&&frame.words[i].baseline==baseline.words[i].baseline);}
 }
 const auto rollingBytes=encode(rolling);
 auto rollFrame=[&](double time,const RollUpSettings& settings,std::size_t groups=1){return layoutFrame(rolling,time,{0,0,200,100},measure,56,.6,{},groups,false,settings);};
 const auto initialRoll=rollFrame(.5,roll),middleRoll=rollFrame(1.09,roll),finishedRoll=rollFrame(1.18,roll);
 assert(initialRoll.rolling&&initialRoll.words.size()==1&&initialRoll.words[0].wordIndex==0&&initialRoll.words[0].state==WordState::Current);
 assert(initialRoll.viewport.height==26&&initialRoll.viewport.y==37&&initialRoll.words[0].baseline==58);
 assert(middleRoll.words.size()==2&&middleRoll.words[0].baseline<initialRoll.words[0].baseline&&middleRoll.words[0].baseline>finishedRoll.words[0].baseline);
 assert(finishedRoll.words.size()==2&&finishedRoll.words[0].state==WordState::Spoken&&finishedRoll.words[1].state==WordState::Current);
 const auto backwards=rollFrame(.5,roll);assert(backwards.words[0].baseline==initialRoll.words[0].baseline&&backwards.words[0].x==initialRoll.words[0].x);
 const auto ignoredPages=rollFrame(1.18,roll,100);assert(ignoredPages.words.size()==finishedRoll.words.size());
 for(std::size_t index=0;index<finishedRoll.words.size();++index)assert(ignoredPages.words[index].x==finishedRoll.words[index].x&&ignoredPages.words[index].baseline==finishedRoll.words[index].baseline);
 auto continuousRoll=roll;continuousRoll.waitForLine=false;assert(rollFrame(.5,continuousRoll).words[0].baseline<initialRoll.words[0].baseline);
 auto fasterRoll=roll;fasterRoll.speed=2;assert(std::abs(rollFrame(1.045,fasterRoll).words[0].baseline-middleRoll.words[0].baseline)<1e-10);
 auto instantRoll=roll;instantRoll.scrollDuration=0;assert(rollFrame(1,instantRoll).words.size()==2);
 auto downRoll=roll;downRoll.direction=2;assert(rollFrame(.5,downRoll).words[0].baseline==45);assert(rollFrame(1.18,downRoll).words[0].baseline==58);
 auto leftRoll=roll;leftRoll.direction=3;const auto leftBefore=rollFrame(1.5,leftRoll),leftDuring=rollFrame(2.09,leftRoll);
 assert(leftBefore.words.size()==2&&leftDuring.words.size()==3&&leftDuring.words[0].x<leftBefore.words[0].x);
 auto rightRoll=leftRoll;rightRoll.direction=4;assert(rollFrame(2.09,rightRoll).words[0].x>leftBefore.words[0].x);
 for(int direction:{1,2,3,4})for(int alignment:{1,3}){auto alignedRoll=roll;alignedRoll.direction=direction;const auto aligned=layoutFrame(rolling,1.5,{0,0,200,100,alignment},measure,56,.6,{},1,true,alignedRoll);assert(aligned.words.size()==2);for(const auto& word:aligned.words){if(alignment==1)assert(word.x==0);else assert(word.x+word.width==200);}}
 const auto clippedRoll=layoutFrame(rolling,.5,{0,0,200,5},measure,56,.6,{},1,false,roll);assert(clippedRoll.overflow&&clippedRoll.viewport.height==5);
 assert(rollFrame(4,roll).words.empty());
 auto manualRoll=rolling;manualRoll.containers.push_back({"manual-roll",true,{{"New.",5,6,true}}});
 const auto manualFrame=layoutFrame(manualRoll,5.2,{0,0,200,100},measure,56,.6,{},1,false,roll);
 assert(manualFrame.words.size()==1&&manualFrame.words[0].containerId=="manual-roll");
 // Fade is an alpha mask over sharp text. Its exit edge follows direction and
 // curves, including the original hard-zero region above a moved boundary.
 auto mask=initialRoll;mask.rollUp.boundaryEnabled=true;mask.rollUp.transitionCurve=1;mask.rollUp.transitionThickness=.5;mask.rollUp.fadeAmount=1;
 assert(rollUpAlpha(100,37,mask)==0&&rollUpAlpha(100,43.5,mask)==.5&&rollUpAlpha(100,50,mask)==1&&rollUpAlpha(100,36,mask)==0);
 mask.rollUp.direction=2;assert(rollUpAlpha(100,62.9,mask)<.01&&rollUpAlpha(100,56.5,mask)==.5);
 mask.rollUp.direction=3;assert(rollUpAlpha(0,50,mask)==0&&rollUpAlpha(50,50,mask)==.5&&rollUpAlpha(100,50,mask)==1);
 mask.rollUp.direction=4;assert(rollUpAlpha(199.9,50,mask)<.01&&rollUpAlpha(150,50,mask)==.5);
 mask.rollUp.direction=1;mask.rollUp.transitionCurve=3;assert(rollUpAlpha(100,43.5,mask)==.75);mask.rollUp.transitionCurve=4;assert(rollUpAlpha(100,43.5,mask)==.25);
 mask.rollUp.boundaryPosition=.5;mask.rollUp.fadeAmount=0;assert(rollUpAlpha(100,43,mask)==0&&rollUpAlpha(100,51,mask)==1);
 mask.rollUp.boundaryEnabled=false;assert(rollUpAlpha(100,43,mask)==1);
 assert(encode(rolling)==rollingBytes);
 const auto sampledRoll=sampledRollUpSettings(.5,2.7,.18,.5,0,.35,1,1.5,2.7,2,.5);
 assert(sampledRoll.enabled&&sampledRoll.visibleLines==3&&sampledRoll.transitionCurve==2&&sampledRoll.direction==3&&sampledRoll.speed==2&&sampledRoll.waitForLine);
 rejects([&]{sampledRollUpSettings(1,2,std::numeric_limits<double>::infinity(),1,0,.35,1,2);});
 auto invalidRoll=roll;invalidRoll.visibleLines=9;rejects([&]{rollFrame(.5,invalidRoll);});invalidRoll=roll;invalidRoll.speed=0;rejects([&]{rollFrame(.5,invalidRoll);});
 // Creative transitions crossfade the neighbouring settled windows. They keep
 // the default wait policy, source-time determinism and settled row geometry.
 for(int transition:{2,3,4}){
  auto creative=roll;creative.transition=transition;
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
 // state per render, even when smart fitting and rolling layout both use them.
 Document repeated;repeated.containers.push_back({"many",false,{}});for(std::size_t index=0;index<1000;++index)repeated.containers[0].words.push_back({"same",index*.1,index*.1+.1,false});
 int metricReads=0;const auto repeatedFrame=layoutFrame(repeated,50,{0,0,300,200},[&](const std::string& text,const WordStyle& style){++metricReads;return measure(text,style);},56,.6,{},1,true,roll);
 assert(metricReads<=3&&repeatedFrame.words.size()<30);
 // Deterministic malformed-buffer stress: decode can reject or return a valid bounded document.
 std::uint32_t seed=17;for(unsigned trial=0;trial<1000;++trial){auto mutated=encoded;seed=1664525*seed+1013904223;auto index=seed%mutated.size();seed=1664525*seed+1013904223;mutated[index]^=static_cast<std::uint8_t>(seed>>24);try{validate(decode(mutated));}catch(const std::invalid_argument&){} }
 std::cout<<"caption_core: grouping, layout, styling, timing, codec and malformed-data checks passed\n";
}
