#pragma once
#include "../core/caption_core.hpp"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstddef>

namespace better_captions::adobe {
// This is an explicitly temporary rendered guide, independent of effect-header
// selection. The parameter has no keys and contains absolute wall-clock expiry.
// The CEP worker clears it after 800ms idle to invalidate cached monitor frames.
inline double temporaryBoundsNow() {
 return std::chrono::duration<double>(std::chrono::system_clock::now().time_since_epoch()).count();
}
inline bool temporaryBoundsLeaseActive(double expires,double now) {
 // Reject stale saved projects, bad values and long-lived manual assignments.
 return std::isfinite(expires)&&std::isfinite(now)&&expires>now&&expires-now<=2.0;
}
template<class Pixel>
inline bool drawTemporaryBoundsPixels(Pixel* data,int width,int height,std::ptrdiff_t rowbytes,
 const LayoutBox& box,double expires,double now,double sx=1,double sy=1) {
 if(!temporaryBoundsLeaseActive(expires,now)||!data||width<=0||height<=0||rowbytes<static_cast<std::ptrdiff_t>(width)*sizeof(Pixel)||
    !std::isfinite(box.x)||!std::isfinite(box.y)||!std::isfinite(box.width)||!std::isfinite(box.height)||box.width<=0||box.height<=0||
    !std::isfinite(sx)||!std::isfinite(sy)||sx<=0||sy<=0)return false;
 // box is already in output pixels: point params are host-downsampled and
 // scalar distances are scaled by the caller, exactly as caption layout is.
 const double left=box.x,top=box.y,right=box.x+box.width,bottom=box.y+box.height;
 if(!std::isfinite(right)||!std::isfinite(bottom))return false;
 const double tx=std::max(1.0,2.0*sx),ty=std::max(1.0,2.0*sy);
 const int x0=static_cast<int>(std::clamp(std::floor(left),0.0,double(width)));
 const int y0=static_cast<int>(std::clamp(std::floor(top),0.0,double(height)));
 const int x1=static_cast<int>(std::clamp(std::ceil(right),0.0,double(width)));
 const int y1=static_cast<int>(std::clamp(std::ceil(bottom),0.0,double(height)));
 bool drawn=false;
 for(int y=y0;y<y1;y++) {
  auto* row=reinterpret_cast<Pixel*>(reinterpret_cast<std::uint8_t*>(data)+y*rowbytes);
  for(int x=x0;x<x1;x++) {
   const double px=x+.5,py=y+.5;
   if(px-left>=tx&&right-px>=tx&&py-top>=ty&&bottom-py>=ty)continue;
   // Opaque premultiplied ARGB cyan matches the monitor guide reference.
   row[x].alpha=255;row[x].red=0;row[x].green=210;row[x].blue=255;drawn=true;
  }
 }
 return drawn;
}
template<class World>
inline bool drawTemporaryBounds(World* output,const LayoutBox& box,double expires,double sx=1,double sy=1) {
 return output&&drawTemporaryBoundsPixels(static_cast<PF_Pixel8*>(output->data),output->width,output->height,output->rowbytes,box,expires,temporaryBoundsNow(),sx,sy);
}
}
