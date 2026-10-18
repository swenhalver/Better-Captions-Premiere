// Calls the compiled binary with real SDK structures; this is NOT Premiere proof.
#include "AEConfig.h"
#include "AE_Effect.h"
#include <dlfcn.h>
#include <array>
#include <iostream>
#include <stdexcept>
#include <vector>
using Entry=PF_Err(*)(PF_Cmd,PF_InData*,PF_OutData*,PF_ParamDef*[],PF_LayerDef*,void*);
void check(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
int main(int argc,char** argv){try{
 check(argc==2,"pass plugin binary path");void* binary=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);if(!binary)throw std::runtime_error(dlerror());
 auto main=reinterpret_cast<Entry>(dlsym(binary,"EffectMain"));check(main,"missing EffectMain");
 PF_InData in{};PF_OutData out{};check(main(PF_Cmd_GLOBAL_SETUP,&in,&out,nullptr,nullptr,nullptr)==0,"global setup failed");
 check(out.out_flags==PF_OutFlag_NON_PARAM_VARY,"unexpected flags");check(out.my_version==PF_VERSION(0,1,0,PF_Stage_DEVELOP,1),"version mismatch");
 std::array<PF_ParamDef,8> values{};std::array<PF_ParamDef*,8> params{};for(int i=0;i<8;++i)params[i]=&values[i];
 const int width=640,height=360;std::vector<PF_Pixel8> source(width*height),pixels(width*height);
 for(auto& p:source){p.alpha=255;p.red=10;p.green=20;p.blue=30;}
 values[0].u.ld.data=source.data();values[0].u.ld.width=width;values[0].u.ld.height=height;values[0].u.ld.rowbytes=width*4;
 values[1].u.td.x_value=320*65536;values[1].u.td.y_value=270*65536;
 values[2].u.fs_d.value=500;values[3].u.fs_d.value=160;values[4].u.fs_d.value=56;values[5].u.fs_d.value=36;
 values[6].u.cd.value={255,255,255,255};in.width=width;in.height=height;in.downsample_x={1,1};in.downsample_y={1,1};in.time_scale=100;in.current_time=125;
 PF_LayerDef output{};output.data=pixels.data();output.width=width;output.height=height;output.rowbytes=width*4;
 check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"render failed");
 std::size_t changed=0;for(std::size_t i=0;i<pixels.size();++i){check(pixels[i].alpha==255,"bad alpha composite");if(pixels[i].red!=source[i].red||pixels[i].green!=source[i].green||pixels[i].blue!=source[i].blue)++changed;}
 check(changed>100,"caption not visible");auto first=pixels;
 check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"repeat render failed");
 check(std::equal(pixels.begin(),pixels.end(),first.begin(),[](auto a,auto b){return a.alpha==b.alpha&&a.red==b.red&&a.green==b.green&&a.blue==b.blue;}),"render not deterministic");
 values[2].u.fs_d.value=220;check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"width render failed");
 check(!std::equal(pixels.begin(),pixels.end(),first.begin(),[](auto a,auto b){return a.red==b.red&&a.green==b.green&&a.blue==b.blue;}),"width failed to change rendered layout");
 dlclose(binary);std::cout<<"Compiled adapter smoke passed: setup, ARGB composite, determinism, width change; not host acceptance.\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
