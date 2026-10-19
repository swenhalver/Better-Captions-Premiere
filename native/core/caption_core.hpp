#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace better_captions {
constexpr std::uint32_t kSchemaVersion = 5;
constexpr std::size_t kMaxWords = 100000;
constexpr std::size_t kMaxDocumentBytes = 16 * 1024 * 1024;
constexpr std::size_t kMaxGroupsPerPage = 100;
// Native integer sliders may interpolate fractional samples between keyframes.
// Round finite host samples consistently; source/editor integer validation stays strict.
std::size_t sampledGroupsPerPage(double);
bool sampledSmartLineFit(double);
int sampledTextAlignment(double); // 1 left, 2 center, 3 right
struct Color { double r=1,g=1,b=1,a=1; };
struct Word { std::string text; double start=0,end=0; bool endOfSentence=false; };
struct WordStyle {
    std::string fontFamily="Arial";
    // Zero / -1 preserve legacy named-face selection until explicitly styled.
    double fontWeight=0;
    int italic=-1, fontWeightOffset=-1; // offset100 means next available heavier
    double fontSize=64, sizeScale=1, opacity=1;
    Color color;
    bool bubble=false, bubbleFillSpaces=false;
    Color bubbleColor{0,0,0,1};
    double padding=8,radius=10,outlineWidth=0;
    Color outlineColor{0,0,0,1};
    double shadowBlur=0,shadowX=0,shadowY=0;
    Color shadowColor{0,0,0,0.5};
};
struct Style { WordStyle upcoming,current,spoken; double wordSpacing=12,lineHeight=1.3; bool titleCase=false; double baseFontWeight=0; int letterCase=0; }; // 0 legacy/as typed/title, 1 upper, 2 lower
struct CaptionContainer { std::string id; bool manualSplit=false; std::vector<Word> words; };
struct Document { std::uint32_t schemaVersion=3; std::vector<CaptionContainer> containers; Style style; double timeOriginSeconds=0; };
struct Phrase { std::string containerId; std::size_t firstWord=0,wordCount=0; double start=0,end=0; };
// Regrouping is derived; source words, container identities and manual splits never mutate.
std::vector<Phrase> regroup(const Document&, std::size_t maxChars=56, double pauseSeconds=0.6);
void validate(const Document&); // throws std::invalid_argument on untrusted/invalid data
std::vector<std::uint8_t> encode(const Document&);
Document decode(const std::vector<std::uint8_t>&);
std::string displayText(const std::string&, bool titleCase, int letterCase=0); // ASCII case conversion; UTF-8 preserved

enum class WordState { Upcoming,Current,Spoken };
struct LayoutBox { double x=0,y=0,width=1536,height=300; int alignment=2; };
struct Metrics { double width=0,ascent=0,descent=0; };
using TransformText=std::function<std::string(const std::string&,const Style&)>;
using MeasureText=std::function<Metrics(const std::string&,const WordStyle&)>;
// Actual shaped advance, maximum across all word states plus bubble padding,
// greedily fills 95% of the box. Character-limit setting stays independent.
std::vector<Phrase> regroupToWidth(const Document&,double width,const MeasureText&,
                                 double pauseSeconds=0.6,const TransformText& transform={});
struct DrawWord {
    std::string text;
    std::string containerId;
    std::size_t wordIndex=0;
    WordState state=WordState::Upcoming;
    WordStyle style;
    double x=0,baseline=0,width=0,height=0;
    // Paint-only extension; never participates in glyph origins or wrapping.
    double bubbleExtraWidth=0;
    // Derived joins flatten only internal touching edges; never serialized.
    bool bubbleJoinLeft=false,bubbleJoinRight=false;
};
struct RollUpSettings {
    bool enabled=false;
    std::size_t visibleLines=2;
    double scrollDuration=.18;
    bool boundaryEnabled=true;
    double boundaryPosition=0,transitionThickness=.35,fadeAmount=1;
    int transitionCurve=2; // 1 linear, 2 smooth, 3 ease-in, 4 ease-out
    int direction=1; // 1 up, 2 down, 3 left, 4 right
    double speed=1;
    bool waitForLine=true;
    int transition=1; // 1 scroll, 2 fade, 3 slide, 4 pop
};
RollUpSettings sampledRollUpSettings(double enabled,double lines,double duration,double boundary,
    double position,double thickness,double fade,double curve,double direction=1,double speed=1,double wait=1,double transition=1);
struct Frame {
    std::vector<DrawWord> words;
    bool overflow=false,rolling=false;
    LayoutBox viewport;
    RollUpSettings rollUp;
};
// Multiplies existing sharp pixels; never blurs or reconstructs the glyph image.
double rollUpAlpha(double x,double y,const Frame&);
// Host supplies real shaped font metrics. Commands retain independent styles and font sizes.
// Box coordinates are top-left pixels; lines are centered within box, clipped by host.
// Consecutive phrase groups share one page; every group starts a new line.
// Pages do not cross manual containers. Source documents/word times stay unchanged.
Frame layoutFrame(const Document&, double time, const LayoutBox&, const MeasureText&,
                  std::size_t maxChars=56,double pauseSeconds=0.6,const TransformText& transform={},
                  std::size_t groupsPerPage=1,bool smartLineFit=false,const RollUpSettings& rollUp={});
} // namespace better_captions
