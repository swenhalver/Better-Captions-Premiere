#pragma once
#include "../core/caption_core.hpp"
#include <cmath>
#include <stdexcept>

namespace better_captions::adobe {
// Native controls modulate the document instead of replacing its state styles.
// 64 and RGB white are neutral. Called on a render-local document copy only.
inline void applyNativeStyle(Document& document,double globalSize,const Color& tint,double sx,double sy) {
 if(!std::isfinite(globalSize)||globalSize<=0||!std::isfinite(sx)||sx<=0||!std::isfinite(sy)||sy<=0)
  throw std::invalid_argument("Invalid native style scale");
 for(double c:{tint.r,tint.g,tint.b})if(!std::isfinite(c)||c<0||c>1)throw std::invalid_argument("Invalid native text tint");
 for(auto* style:{&document.style.upcoming,&document.style.current,&document.style.spoken}) {
  style->fontSize*=globalSize/64.0*sy;
  style->color.r*=tint.r;style->color.g*=tint.g;style->color.b*=tint.b;
  style->padding*=sy;style->radius*=sy;style->outlineWidth*=sy;
  style->shadowBlur*=sy;style->shadowX*=sx;style->shadowY*=sy;
 }
 document.style.wordSpacing*=sx;
 // Includes style bounds after scaling; oversized output fails explicitly.
 validate(document);
}
}
