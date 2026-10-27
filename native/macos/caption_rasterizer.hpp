#pragma once
#include "../core/caption_core.hpp"
#include <cstddef>
#include <cstdint>
#include <vector>

namespace better_captions::macos {
// Premultiplied RGBA, top-left row order. Adobe adapter must explicitly convert
// the requested PF pixel format; this buffer is not an Adobe PF_EffectWorld.
struct Bitmap { std::size_t width=0,height=0,stride=0; std::vector<std::uint8_t> pixels; bool overflow=false; };
// Diagnostic font selection uses the same CoreText path as measuring/drawing.
// The selected weight is an actual face or a value on a real variable axis.
struct FontSelection {
 std::string family,postscriptName;
 double weight=400;
 bool nativeItalic=false,syntheticItalic=false;
 std::vector<double> availableWeights;
};
FontSelection fontSelection(const WordStyle&,double baseWeight=400);
Metrics measureText(const std::string&,const WordStyle&,double baseWeight=400);
Bitmap rasterize(const Document&,double time,const LayoutBox&,std::size_t width,std::size_t height,
                 std::size_t maxChars=56,double pauseSeconds=0.6,std::size_t groupsPerPage=1,const RollUpSettings& rollUp={});
}
