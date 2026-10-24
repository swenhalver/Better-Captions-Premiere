#include <cassert>
#include <cstdint>
#include <iostream>
#include <limits>
#include <vector>
// Production PF_Pixel8 layout (ARGB), declared here to keep helper tests portable.
struct PF_Pixel8 { std::uint8_t alpha,red,green,blue; };
#include "temporary_bounds.hpp"
using namespace better_captions;
using namespace better_captions::adobe;
int main(){
 assert(temporaryBoundsLeaseActive(1001.5,1000));
 assert(!temporaryBoundsLeaseActive(1000,1000));
 assert(!temporaryBoundsLeaseActive(999,1000));
 assert(!temporaryBoundsLeaseActive(1003,1000));
 assert(!temporaryBoundsLeaseActive(std::numeric_limits<double>::infinity(),1000));
 const int width=20,height=20,stride=24;
 std::vector<PF_Pixel8> pixels(stride*height,PF_Pixel8{77,10,20,30});
 LayoutBox box{4,5,10,8};
 assert(drawTemporaryBoundsPixels(pixels.data(),width,height,stride*sizeof(PF_Pixel8),box,1001,1000));
 const auto color=[&](int x,int y){const auto p=pixels[y*stride+x];return p.alpha==255&&p.red==0&&p.green==210&&p.blue==255;};
 assert(color(4,5)&&color(13,12)&&color(4,9)&&color(10,5));
 assert(!color(9,9)&&!color(3,5)&&!color(14,12));
 for(int y=0;y<height;y++)for(int x=width;x<stride;x++)assert(pixels[y*stride+x].alpha==77);
 const auto before=pixels;
 assert(!drawTemporaryBoundsPixels(pixels.data(),width,height,stride*sizeof(PF_Pixel8),box,1000,1000));
 for(std::size_t i=0;i<pixels.size();i++)assert(pixels[i].alpha==before[i].alpha);
 // A partly offscreen box is clipped without inventing an edge on the frame.
 pixels.assign(stride*height,PF_Pixel8{});box={-10,5,20,8};
 assert(drawTemporaryBoundsPixels(pixels.data(),width,height,stride*sizeof(PF_Pixel8),box,1001,1000,.5,.5));
 assert(color(0,5)&&color(9,9)&&!color(0,9));
 box={1,1,std::numeric_limits<double>::infinity(),5};
 assert(!drawTemporaryBoundsPixels(pixels.data(),width,height,stride*sizeof(PF_Pixel8),box,1001,1000));
 std::cout<<"Temporary rendered bounds: lease, scaling, clipping, ARGB and row stride passed\n";
}
