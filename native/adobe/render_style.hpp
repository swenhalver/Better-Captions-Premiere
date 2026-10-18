#pragma once
#include "../core/caption_core.hpp"
#include <cmath>
#include <stdexcept>

namespace better_captions::adobe {
struct NativeWordControls {
 double sizePercent=100;
 Color textTint{1,1,1,1};
 double opacityPercent=100;
 int bubbleMode=1; // 1=document, 2=on, 3=off
 Color bubbleTint{1,1,1,1};
 double bubbleOpacityPercent=100,paddingPercent=100,radiusPercent=100;
};
struct NativeAppearanceControls { NativeWordControls upcoming,current,spoken; };
inline void applyNativeWordControls(WordStyle& style,const NativeWordControls& controls) {
 auto range=[](double value,double lo,double hi){if(!std::isfinite(value)||value<lo||value>hi)throw std::invalid_argument("Invalid native appearance control");};
 range(controls.sizePercent,1,400);range(controls.opacityPercent,0,100);
 range(controls.bubbleOpacityPercent,0,100);range(controls.paddingPercent,0,400);range(controls.radiusPercent,0,400);
 if(controls.bubbleMode<1||controls.bubbleMode>3)throw std::invalid_argument("Invalid native bubble mode");
 for(const auto* tint:{&controls.textTint,&controls.bubbleTint})for(double channel:{tint->r,tint->g,tint->b})range(channel,0,1);
 style.fontSize*=controls.sizePercent/100;
 style.color.r*=controls.textTint.r;style.color.g*=controls.textTint.g;style.color.b*=controls.textTint.b;
 style.opacity*=controls.opacityPercent/100;
 if(controls.bubbleMode!=1)style.bubble=controls.bubbleMode==2;
 style.bubbleColor.r*=controls.bubbleTint.r;style.bubbleColor.g*=controls.bubbleTint.g;style.bubbleColor.b*=controls.bubbleTint.b;
 style.bubbleColor.a*=controls.bubbleOpacityPercent/100;
 style.padding*=controls.paddingPercent/100;style.radius*=controls.radiusPercent/100;
}
// Native controls modulate the document instead of replacing its state styles.
// 64 and RGB white are neutral. Called on a render-local document copy only.
inline void applyNativeStyle(Document& document,double globalSize,const Color& tint,double sx,double sy,const NativeAppearanceControls& appearances={}) {
 if(!std::isfinite(globalSize)||globalSize<=0||!std::isfinite(sx)||sx<=0||!std::isfinite(sy)||sy<=0)
  throw std::invalid_argument("Invalid native style scale");
 for(double c:{tint.r,tint.g,tint.b})if(!std::isfinite(c)||c<0||c>1)throw std::invalid_argument("Invalid native text tint");
 applyNativeWordControls(document.style.upcoming,appearances.upcoming);
 applyNativeWordControls(document.style.current,appearances.current);
 applyNativeWordControls(document.style.spoken,appearances.spoken);
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
