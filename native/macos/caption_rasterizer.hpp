#pragma once
#include "../core/caption_core.hpp"
#include <cstddef>
#include <cstdint>
#include <vector>

namespace better_captions::macos {
// Premultiplied RGBA, top-left row order. Adobe adapter must explicitly convert
// the requested PF pixel format; this buffer is not an Adobe PF_EffectWorld.
struct Bitmap { std::size_t width=0,height=0,stride=0; std::vector<std::uint8_t> pixels; bool overflow=false; };
Metrics measureText(const std::string&,const WordStyle&);
Bitmap rasterize(const Document&,double time,const LayoutBox&,std::size_t width,std::size_t height,
                 std::size_t maxChars=56,double pauseSeconds=0.6);
}
