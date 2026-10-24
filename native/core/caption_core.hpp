#pragma once
#include <cstdint>
#include <array>
#include <functional>
#include <string>
#include <vector>

namespace better_captions {
constexpr std::uint32_t kSchemaVersion = 11;
// BCAP v12 appends line position styles. Only documents that have one are
// written as v12; all others keep kSchemaVersion bytes. Renumber here only.
constexpr std::uint32_t kPositionStylesVersion = 12;
constexpr std::uint32_t kMaxWireVersion = kPositionStylesVersion;
constexpr std::size_t kMaxLinePositions = 8;
constexpr std::size_t kMaxWords = 100000;
constexpr std::size_t kMaxDocumentBytes = 16 * 1024 * 1024;
constexpr std::size_t kMaxGroupsPerPage = 100;
// A line never lasts longer than this (first word start to last word end),
// unless one word or glued run alone does. Matches the panel's grouping.
constexpr double kMaxLineSeconds = 5.5;
// Native integer sliders may interpolate fractional samples between keyframes.
// Round finite host samples consistently; source/editor integer validation stays strict.
std::size_t sampledGroupsPerPage(double);
int sampledTextAlignment(double); // 1 left, 2 center, 3 right
struct Color { double r=1,g=1,b=1,a=1; };
// MergeEdge (v10) renders like Break; the panel clears it, and Join, on reflow.
enum class LineBreakBefore : std::uint32_t { Auto=0,Break=1,Join=2,MergeEdge=3 };
struct Word { std::string text; double start=0,end=0; bool endOfSentence=false; LineBreakBefore lineBreakBefore=LineBreakBefore::Auto; std::uint32_t pauseLinesRemoved=0; };
struct WordStyle {
    std::string fontFamily="Arial";
    // Zero / -1 preserve legacy named-face selection until explicitly styled.
    double fontWeight=0;
    int italic=-1, underline=-1, fontWeightOffset=-1; // offset100 means next available heavier
    double fontSize=64, sizeScale=1, opacity=1;
    Color color;
    bool bubble=false, bubbleFillSpaces=false;
    Color bubbleColor{0,0,0,1};
    double padding=8,radius=10,outlineWidth=0;
    double bubblePaddingInline=-1,bubblePaddingBlock=-1; // -1 inherits legacy uniform padding
    double paddingTop=-1;double paddingRight=-1;double paddingBottom=-1;double paddingLeft=-1;double radiusTL=-1;double radiusTR=-1;double radiusBR=-1;double radiusBL=-1;double marginTop=0;double marginRight=0;double marginBottom=0;double marginLeft=0;
    double topPadding()const{return paddingTop<0?blockPadding():paddingTop;}
    double rightPadding()const{return paddingRight<0?inlinePadding():paddingRight;}
    double bottomPadding()const{return paddingBottom<0?blockPadding():paddingBottom;}
    double leftPadding()const{return paddingLeft<0?inlinePadding():paddingLeft;}
    double horizontalPadding()const{return leftPadding()+rightPadding();}
    double verticalPadding()const{return topPadding()+bottomPadding();}
    void scaleGeometry(double sx,double sy){if(paddingTop>=0)paddingTop*=sy;if(paddingRight>=0)paddingRight*=sx;if(paddingBottom>=0)paddingBottom*=sy;if(paddingLeft>=0)paddingLeft*=sx;if(radiusTL>=0)radiusTL*=sy;if(radiusTR>=0)radiusTR*=sy;if(radiusBR>=0)radiusBR*=sy;if(radiusBL>=0)radiusBL*=sy;marginTop*=sy;marginRight*=sx;marginBottom*=sy;marginLeft*=sx;}
    double inlinePadding()const{return bubblePaddingInline<0?padding:bubblePaddingInline;}
    double blockPadding()const{return bubblePaddingBlock<0?padding:bubblePaddingBlock;}
    Color outlineColor{0,0,0,1};
    double shadowBlur=0,shadowX=0,shadowY=0;
    Color shadowColor{0,0,0,0.5};
};
// How words fill the lines between hard breaks (v11). Fill packs each line;
// Balance keeps Fill's line count with even lengths; Pretty is Fill unless the
// last line is short or a single word, then the last two lines are split again.
enum class LineWrap : std::uint32_t { Fill=0,Balance=1,Pretty=2 };
// One slot of the visible caption window, in screen order: Line 1 is the top
// line. A line takes its slot's overrides on top of each word's
// Past/Current/Next style while it sits there. Only flagged fields apply.
enum PositionField : std::uint32_t {
 PositionFontFamily=1u<<0,PositionWeight=1u<<1,PositionItalic=1u<<2,PositionUnderline=1u<<3,PositionFontSize=1u<<4,
 PositionColor=1u<<5,PositionOpacity=1u<<6,PositionBubble=1u<<7,PositionBubbleFillSpaces=1u<<8,PositionBubbleColor=1u<<9,PositionBubbleOpacity=1u<<10,
 PositionPaddingTop=1u<<11,PositionPaddingRight=1u<<12,PositionPaddingBottom=1u<<13,PositionPaddingLeft=1u<<14,
 PositionRadiusTL=1u<<15,PositionRadiusTR=1u<<16,PositionRadiusBR=1u<<17,PositionRadiusBL=1u<<18,
 PositionMarginTop=1u<<19,PositionMarginRight=1u<<20,PositionMarginBottom=1u<<21,PositionMarginLeft=1u<<22,
 PositionOutlineWidth=1u<<23,PositionOutlineColor=1u<<24,PositionOutlineOpacity=1u<<25,
 PositionShadowBlur=1u<<26,PositionShadowX=1u<<27,PositionShadowY=1u<<28,PositionShadowColor=1u<<29,PositionShadowOpacity=1u<<30,
};
constexpr std::uint32_t kPositionFieldMask=(1u<<31)-1;
// fontSize is the effective size (sizeScale 1). Colors set RGB only; their
// alpha is the separate *Opacity field. Italic/underline are explicit 0/1.
struct PositionStyle { std::uint32_t fields=0; WordStyle value; bool empty()const{return fields==0;} };
struct Style { WordStyle upcoming,current,spoken; double wordSpacing=12,lineHeight=1.3; bool titleCase=false; double baseFontWeight=0; int letterCase=0; LineWrap lineWrap=LineWrap::Fill; // 0 legacy/as typed/title, 1 upper, 2 lower
 // Index 0 is Line 1. Slots beyond Visible lines are kept but unused.
 std::array<PositionStyle,kMaxLinePositions> positions{};
};
bool hasPositionStyles(const Style&,std::size_t lines=kMaxLinePositions);
// Precedence: a position's set fields win over the word's state style.
WordStyle applyPositionStyle(const WordStyle& state,const PositionStyle& position);
// The weight a style actually renders with: its absolute weight, or the
// document base weight plus its relative step, resolved against the faces the
// font engine has. Hosts supply their engine's resolution; nominalWeight is
// the fallback without one (base or 400, a relative step adding 100).
using ResolveWeight=std::function<double(const WordStyle&)>;
double nominalWeight(const WordStyle&,double baseWeight);
// A line moving between slots blends both slot styles. t<=0 returns a and
// t>=1 returns b exactly. Numbers and colors interpolate; a background or
// font choice switches halfway, a background fading in from zero alpha.
// Weights in one family interpolate between their resolved weights, so a
// relative bold step blends numerically too.
WordStyle blendWordStyles(const WordStyle& a,const WordStyle& b,double t,const ResolveWeight& resolve={});
struct CaptionContainer { std::string id; bool manualSplit=false; std::vector<Word> words; };
struct Document { std::uint32_t schemaVersion=kSchemaVersion; std::vector<CaptionContainer> containers; Style style; double timeOriginSeconds=0; };
struct WordRef { std::size_t containerIndex=0,wordIndex=0; };
struct Phrase {
    // The first word's source identity and the total number of words remain
    // available; wordRefs resolves every word in a cross-container line.
    std::string containerId; std::size_t firstWord=0,wordCount=0; double start=0,end=0;
    std::vector<WordRef> wordRefs;
};
// pauseLinesRemoved (0..8) belongs to the next line's first source word.
// Joined interior-word overrides stay stored until that word starts a line again.
// Regrouping is derived; explicit word breaks/joins govern lines. Containers
// are storage only. Source words, IDs, metadata and word times never mutate.
// Hard breaks (manual/merge-edge breaks, sentence ends, pauses) are never
// crossed; between them document style.lineWrap places the automatic breaks.
std::vector<Phrase> regroup(const Document&, std::size_t maxChars=56, double pauseSeconds=0.6);
// For each word of the flat stream, whether it starts a line. Mirrors
// webview-ui/src/lib/native-effect/line-wrap.ts exactly, including ties.
std::vector<bool> lineStarts(const std::vector<const Word*>& words, std::size_t maxChars, double pauseSeconds, LineWrap mode);
void validate(const Document&); // throws std::invalid_argument on untrusted/invalid data
std::vector<std::uint8_t> encode(const Document&);
Document decode(const std::vector<std::uint8_t>&);
std::string displayText(const std::string&, bool titleCase, int letterCase=0); // ASCII case conversion; UTF-8 preserved

enum class WordState { Upcoming,Current,Spoken };
struct LayoutBox { double x=0,y=0,width=1536,height=300; int alignment=2; };
struct Metrics { double width=0,ascent=0,descent=0; };
using TransformText=std::function<std::string(const std::string&,const Style&)>;
using MeasureText=std::function<Metrics(const std::string&,const WordStyle&)>;
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
struct RollUpEdge {
    double inset=0;
    bool fadeEnabled=true;
    double thickness=.2,amount=1;
    int curve=2; // 1 linear, 2 smooth, 3 ease-in, 4 ease-out
};
// Fractions are 0..1; native percentage controls divide by 100 before sampling.
RollUpEdge sampledRollUpEdge(double inset,double fadeEnabled,double thickness,double amount,double curve);
struct RollUpSettings {
    bool enabled=false;
    // Maximum visible rolling rows. Physical box height limits actual capacity;
    // fonts and style geometry always retain their authored values.
    std::size_t visibleLines=2;
    // Current row slot counted from the entry edge; 1 retains full history.
    std::size_t currentLine=1;
    // Seconds per complete silence row; zero follows the average spoken line.
    double blankLineSeconds=0;
    double scrollDuration=.18;
    bool boundaryEnabled=true;
    double boundaryPosition=0,transitionThickness=.35,fadeAmount=1;
    int transitionCurve=2; // 1 linear, 2 smooth, 3 ease-in, 4 ease-out
    int direction=1; // 1 up, 2 down, 3 left, 4 right
    double speed=1;
    bool waitForLine=true;
    int transition=1; // 1 scroll, 2 fade, 3 slide, 4 pop
    int boundaryMode=0; // 0 directional boundary, 1 independent edges
    std::array<RollUpEdge,4> edges{}; // top, bottom, left, right; inward fractions
};
RollUpSettings sampledRollUpSettings(double enabled,double lines,double duration,double boundary,
    double position,double thickness,double fade,double curve,double direction=1,double speed=1,double wait=1,double transition=1,double currentLine=1,double blankLineSeconds=0);
struct Frame {
    std::vector<DrawWord> words;
    bool overflow=false,rolling=false;
    LayoutBox viewport;
    RollUpSettings rollUp;
    // Stable paint-only allowances, top/bottom/left/right. Used only by the
    // default directional boundary; never move rows or explicit crop edges.
    std::array<double,4> directionalPaintOutset{};
};
// Multiplies existing sharp pixels; never blurs or reconstructs the glyph image.
double rollUpAlpha(double x,double y,const Frame&);
// Host supplies real shaped font metrics. Commands retain independent styles and font sizes.
// Box coordinates are top-left pixels; the box places text without cropping it.
// Actual output-frame edges and explicitly enabled boundaries can crop paint.
// Consecutive phrase groups share one page; every group starts a new line.
// Pages consume consecutive lines across storage containers. Source documents
// and word times stay unchanged; pause lines occupy ordinary line slots.
// resolveWeight resolves weights for blends between line position styles;
// without it nominalWeight with the document base weight is used.
Frame layoutFrame(const Document&, double time, const LayoutBox&, const MeasureText&,
                  std::size_t maxChars=56,double pauseSeconds=0.6,const TransformText& transform={},
                  std::size_t groupsPerPage=1,const RollUpSettings& rollUp={},const ResolveWeight& resolveWeight={});
} // namespace better_captions
