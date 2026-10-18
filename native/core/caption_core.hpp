#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace better_captions {
constexpr std::uint32_t kSchemaVersion = 3;
constexpr std::size_t kMaxWords = 100000;
constexpr std::size_t kMaxDocumentBytes = 16 * 1024 * 1024;
struct Color { double r=1,g=1,b=1,a=1; };
struct Word { std::string text; double start=0,end=0; bool endOfSentence=false; };
struct WordStyle {
    std::string fontFamily="Arial";
    // Zero / -1 preserve legacy named-face selection until explicitly styled.
    double fontWeight=0;
    int italic=-1, fontWeightOffset=-1; // offset100 means next available heavier
    double fontSize=64, sizeScale=1, opacity=1;
    Color color;
    bool bubble=false;
    Color bubbleColor{0,0,0,1};
    double padding=8,radius=10,outlineWidth=0;
    Color outlineColor{0,0,0,1};
    double shadowBlur=0,shadowX=0,shadowY=0;
    Color shadowColor{0,0,0,0.5};
};
struct Style { WordStyle upcoming,current,spoken; double wordSpacing=12,lineHeight=1.3; bool titleCase=false; double baseFontWeight=0; };
struct CaptionContainer { std::string id; bool manualSplit=false; std::vector<Word> words; };
struct Document { std::uint32_t schemaVersion=kSchemaVersion; std::vector<CaptionContainer> containers; Style style; double timeOriginSeconds=0; };
struct Phrase { std::string containerId; std::size_t firstWord=0,wordCount=0; double start=0,end=0; };
// Regrouping is derived; source words, container identities and manual splits never mutate.
std::vector<Phrase> regroup(const Document&, std::size_t maxChars=56, double pauseSeconds=0.6);
void validate(const Document&); // throws std::invalid_argument on untrusted/invalid data
std::vector<std::uint8_t> encode(const Document&);
Document decode(const std::vector<std::uint8_t>&);
std::string displayText(const std::string&, bool titleCase); // ASCII case conversion; UTF-8 preserved

enum class WordState { Upcoming,Current,Spoken };
struct LayoutBox { double x=0,y=0,width=1536,height=300; };
struct Metrics { double width=0,ascent=0,descent=0; };
using MeasureText=std::function<Metrics(const std::string&,const WordStyle&)>;
struct DrawWord {
    std::string text;
    std::string containerId;
    std::size_t wordIndex=0;
    WordState state=WordState::Upcoming;
    WordStyle style;
    double x=0,baseline=0,width=0,height=0;
};
struct Frame { std::vector<DrawWord> words; bool overflow=false; };
// Host supplies real shaped font metrics. Commands retain independent styles and font sizes.
// Box coordinates are top-left pixels; lines are centered within box, clipped by host.
Frame layoutFrame(const Document&, double time, const LayoutBox&, const MeasureText&,
                  std::size_t maxChars=56,double pauseSeconds=0.6);
} // namespace better_captions
