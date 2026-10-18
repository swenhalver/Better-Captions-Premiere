#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include <PrSDKAESupport.h>
#include <SPBasic.h>
#include <dlfcn.h>
#include <cstring>
#include <iostream>
#include <stdexcept>
namespace {
PF_PixelFormatSuite1 suite{};int additions=0;bool clear=false;PrPixelFormat format=PrPixelFormat_BGRA_4444_32f;
PF_Err clearFormats(PF_ProgPtr){clear=true;return 0;}
PF_Err addFormat(PF_ProgPtr,PrPixelFormat value){if((additions==0&&value!=PrPixelFormat_BGRA_4444_32f)||(additions==1&&value!=PrPixelFormat_ARGB_4444_8u))return PF_Err_BAD_CALLBACK_PARAM;++additions;return 0;}
PF_Err getFormat(PF_EffectWorld*,PrPixelFormat* out){*out=format;return 0;}
SPErr acquire(const char* name,int32_t,const void** out){if(std::strcmp(name,kPFPixelFormatSuite))return -1;*out=&suite;return 0;}SPErr release(const char*,int32_t){return 0;}
void check(bool ok){if(!ok)throw std::runtime_error("Float eligibility guard failed");}
}
int main(int argc,char** argv){try{check(argc==2);void* binary=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(binary);using Entry=PF_Err(*)(PF_Cmd,PF_InData*,PF_OutData*,PF_ParamDef*[],PF_LayerDef*,void*);auto entry=reinterpret_cast<Entry>(dlsym(binary,"EffectMain"));check(entry);
 suite.ClearSupportedPixelFormats=clearFormats;suite.AddSupportedPixelFormat=addFormat;suite.GetPixelFormat=getFormat;SPBasicSuite basic{};basic.AcquireSuite=acquire;basic.ReleaseSuite=release;PF_InData in{};in.appl_id=kAppID_Premiere;in.effect_ref=reinterpret_cast<PF_ProgPtr>(1);in.pica_basicP=&basic;PF_OutData out{};
 check(entry(PF_Cmd_GLOBAL_SETUP,&in,&out,nullptr,nullptr,nullptr)==0&&clear&&additions==2&&(out.out_flags2&PF_OutFlag2_FLOAT_COLOR_AWARE));
 unsigned char pixels[64];std::memset(pixels,0x5a,sizeof(pixels));PF_LayerDef output{};output.data=reinterpret_cast<PF_PixelPtr>(pixels);output.width=2;output.height=2;output.rowbytes=32;PF_ParamDef input{};PF_ParamDef* params[]={&input};
 check(entry(PF_Cmd_RENDER,&in,&out,params,&output,nullptr)==PF_Err_BAD_CALLBACK_PARAM);for(auto byte:pixels)check(byte==0x5a);
 suite.GetPixelFormat=nullptr;check(entry(PF_Cmd_RENDER,&in,&out,params,&output,nullptr)==PF_Err_INVALID_CALLBACK);for(auto byte:pixels)check(byte==0x5a);
 dlclose(binary);std::cout<<"Float eligibility passed: advertised formats, FLOAT flag, float/missing-query rejected before pixel writes.\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
