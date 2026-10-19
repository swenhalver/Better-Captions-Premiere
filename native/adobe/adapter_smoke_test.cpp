// Calls the compiled binary with real SDK structures; this is NOT Premiere proof.
#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "caption_arbitrary.hpp"
#include "parameters.hpp"
#include <dlfcn.h>
#include <array>
#include <iostream>
#include <stdexcept>
#include <vector>
#define BC_SOURCE_TIME_TEST_NO_LOG 1
#include "source_time.hpp"
#include <cstring>
namespace {
PF_InData* clockInput=nullptr;
A_long sourceStart=0,layerStart=0;double sequenceOffsetSeconds=0;std::size_t carrierBytes=0;
PF_Err mockSequence(PF_ProgPtr,PrTime* out){*out=static_cast<PrTime>((double(clockInput->current_time)/clockInput->time_scale+sequenceOffsetSeconds)*254016000000LL);return 0;}
PF_Err mockMedia(PF_ProgPtr,csSDK_uint32,bool,PrTime sequence,PrTime* out,PrTime* frame,PF_TimeDisplay* display){*out=sequence;*frame=8467200000LL;*display=PF_TimeDisplay_30NonDrop;return 0;}
PF_Err mockStart(PF_ProgPtr,A_long* out){*out=sourceStart;return 0;}
PF_Err mockLayerStart(PF_ProgPtr,A_long* out){*out=layerStart;return 0;}
PF_Err mockRate(PF_ProgPtr,PrTime* out){*out=8467200000LL;return 0;}
PF_Err mockSpeed(PF_ProgPtr,double* out){*out=1;return 0;}
prSuiteError mockClock(PrTime* out){*out=254016000000LL;return 0;}
void* mockLock(PF_Handle handle){return *handle;}
void mockUnlock(PF_Handle){}
A_u_longlong mockHandleSize(PF_Handle){return carrierBytes;}
PF_UtilitySuite10 testUtility{};PrSDKTimeSuite testClock{};
SPErr acquireTime(const char* name,int32_t,const void** out){if(!std::strcmp(name,kPFUtilitySuite)){*out=&testUtility;return 0;}if(!std::strcmp(name,kPrSDKTimeSuite)){*out=&testClock;return 0;}return -1;}
SPErr releaseTime(const char*,int32_t){return 0;}
}
using Entry=PF_Err(*)(PF_Cmd,PF_InData*,PF_OutData*,PF_ParamDef*[],PF_LayerDef*,void*);
void check(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
int main(int argc,char** argv){try{
 check(argc==2,"pass plugin binary path");void* binary=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);if(!binary)throw std::runtime_error(dlerror());
 auto main=reinterpret_cast<Entry>(dlsym(binary,"EffectMain"));check(main,"missing EffectMain");
 PF_InData in{};PF_OutData out{};check(main(PF_Cmd_GLOBAL_SETUP,&in,&out,nullptr,nullptr,nullptr)==0,"global setup failed");
 SPBasicSuite basic{};basic.AcquireSuite=acquireTime;basic.ReleaseSuite=releaseTime;in.pica_basicP=&basic;clockInput=&in;testUtility.GetSequenceTime=mockSequence;testUtility.GetSourceTrackCurrentMediaTimeInfo=mockMedia;testClock.GetTicksPerSecond=mockClock;testUtility.GetUnscaledClipStart=mockStart;testUtility.GetTrackItemStart=mockLayerStart;testUtility.GetMediaFrameRate=mockRate;testUtility.GetClipSpeed=mockSpeed;
 check(out.out_flags==(PF_OutFlag_NON_PARAM_VARY
#if BC_ENABLE_CUSTOM_UI_PROBE || BC_ENABLE_CAPTION_BOUNDS_UI
 |PF_OutFlag_CUSTOM_UI
#endif
 ),"unexpected flags");check(out.my_version==PF_VERSION(0,1,0,PF_Stage_DEVELOP,1),"version mismatch");
 using namespace better_captions::adobe::parameters;
 std::array<PF_ParamDef,Count> values{};std::array<PF_ParamDef*,Count> params{};for(int i=0;i<Count;++i)params[i]=&values[i];
 for(int first:{CurrentSize,SpokenSize,UpcomingSize}){
  values[first].u.fs_d.value=100;values[first+1].u.cd.value={255,255,255,255};values[first+2].u.fs_d.value=100;
  values[first+3].u.pd.value=1;values[first+4].u.cd.value={255,255,255,255};
  for(int offset:{5,6,7})values[first+offset].u.fs_d.value=100;
 }
 const int width=640,height=360;std::vector<PF_Pixel8> source(width*height),pixels(width*height);
 for(auto& p:source){p.alpha=255;p.red=10;p.green=20;p.blue=30;}
 values[0].u.ld.data=source.data();values[0].u.ld.width=width;values[0].u.ld.height=height;values[0].u.ld.rowbytes=width*4;
 values[1].u.td.x_value=320*65536;values[1].u.td.y_value=270*65536;
 values[2].u.fs_d.value=500;values[3].u.fs_d.value=160;values[4].u.fs_d.value=56;values[5].u.fs_d.value=36;
 values[GroupsPerPage].u.fs_d.value=1;
 values[6].u.cd.value={255,255,255,255};in.width=width;in.height=height;in.downsample_x={1,1};in.downsample_y={1,1};in.time_scale=100;in.current_time=125;
 PF_LayerDef output{};output.data=pixels.data();output.width=width;output.height=height;output.rowbytes=width*4;
 check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"render failed");
 std::size_t changed=0;for(std::size_t i=0;i<pixels.size();++i){check(pixels[i].alpha==255,"bad alpha composite");if(pixels[i].red!=source[i].red||pixels[i].green!=source[i].green||pixels[i].blue!=source[i].blue)++changed;}
 check(changed>100,"caption not visible");auto first=pixels;
 check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"repeat render failed");
 check(std::equal(pixels.begin(),pixels.end(),first.begin(),[](auto a,auto b){return a.alpha==b.alpha&&a.red==b.red&&a.green==b.green&&a.blue==b.blue;}),"render not deterministic");
 values[CurrentOpacity].u.fs_d.value=0;
 check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"current-word opacity render failed");
 check(!std::equal(pixels.begin(),pixels.end(),first.begin(),[](auto a,auto b){return a.red==b.red&&a.green==b.green&&a.blue==b.blue;}),"current-word native opacity failed to affect pixels");
 values[CurrentOpacity].u.fs_d.value=100;
 values[2].u.fs_d.value=220;check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"width render failed");
 check(!std::equal(pixels.begin(),pixels.end(),first.begin(),[](auto a,auto b){return a.red==b.red&&a.green==b.green&&a.blue==b.blue;}),"width failed to change rendered layout");
 auto center=[](const std::vector<PF_Pixel8>& frame,int w,int h){double x=0,y=0,n=0;for(int row=0;row<h;++row)for(int col=0;col<w;++col){auto p=frame[row*w+col];if(p.red!=10||p.green!=20||p.blue!=30){x+=col;y+=row;++n;}}check(n>100,"No caption pixels for downsample probe");return std::array<double,2>{x/n,y/n};};
 values[2].u.fs_d.value=1200;values[5].u.fs_d.value=24;check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"full-resolution reference failed");auto fullCenter=center(pixels,width,height);
 // Actual SDK contract: point values are already downsampled by host, scalars are not.
 in.downsample_x={1,2};in.downsample_y={1,2};values[1].u.td.x_value=160*65536;values[1].u.td.y_value=135*65536;
 values[0].u.ld.width=width/2;values[0].u.ld.height=height/2;values[0].u.ld.rowbytes=width*2;
 output.width=width/2;output.height=height/2;output.rowbytes=width*2;
 check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"half-resolution render failed");auto halfCenter=center(pixels,width/2,height/2);
 if(std::abs(fullCenter[0]/2-halfCenter[0])>=3||std::abs(fullCenter[1]/2-halfCenter[1])>=3)std::cerr<<"full centroid "<<fullCenter[0]<<','<<fullCenter[1]<<" half "<<halfCenter[0]<<','<<halfCenter[1]<<'\n';
 check(std::abs(fullCenter[0]/2-halfCenter[0])<3&&std::abs(fullCenter[1]/2-halfCenter[1])<3,"Point scaled twice at half resolution");
 // Compare real compiled frame pixels before/after synthetic-origin+Razor map.
 in.downsample_x={1,1};in.downsample_y={1,1};in.time_scale=30;in.current_time=150;
 values[0].u.ld.width=width;values[0].u.ld.height=height;values[0].u.ld.rowbytes=width*4;
 output.width=width;output.height=height;output.rowbytes=width*4;values[1].u.td.x_value=320*65536;values[1].u.td.y_value=270*65536;
 values[2].u.fs_d.value=500;values[3].u.fs_d.value=160;values[5].u.fs_d.value=36;
 better_captions::Document fixture;fixture.containers.push_back({"native-probe-demo",false,{{"Native",0,2,false},{"edited",2,4,false},{"stay",4,10,true}}});
 auto carrier=better_captions::adobe::textCarrier(better_captions::encode(fixture),true);carrierBytes=carrier.size();char* raw=reinterpret_cast<char*>(carrier.data());values[7].u.arb_d.value=reinterpret_cast<PF_ArbitraryH>(&raw);
 _PF_UtilCallbacks utils{};utils.host_lock_handle=mockLock;utils.host_unlock_handle=mockUnlock;utils.host_get_handle_size=mockHandleSize;in.utils=&utils;
 check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"origin reference render failed");auto originReference=pixels;(void)center(originReference,width,height);
 fixture.timeOriginSeconds=3600;carrier=better_captions::adobe::textCarrier(better_captions::encode(fixture),true);carrierBytes=carrier.size();raw=reinterpret_cast<char*>(carrier.data());
 sourceStart=108120;layerStart=120;in.current_time=150;check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"adjustment Razor origin render failed");
 check(std::equal(pixels.begin(),pixels.end(),originReference.begin(),[](auto a,auto b){return a.alpha==b.alpha&&a.red==b.red&&a.green==b.green&&a.blue==b.blue;}),"persisted origin changed source5 frame after Razor");
 layerStart=300;in.current_time=30;sequenceOffsetSeconds=10;check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"moved adjustment render failed");
 check(std::equal(pixels.begin(),pixels.end(),originReference.begin(),[](auto a,auto b){return a.alpha==b.alpha&&a.red==b.red&&a.green==b.green&&a.blue==b.blue;}),"footage-local clock changed moved adjustment frame");
 // Render a BCAP3 carrier through the actual dynamically loaded effect entry.
 // This checks document decode -> CoreText typography -> ARGB compositing,
 // independently of panel contracts and direct rasterizer unit tests.
 sourceStart=0;layerStart=0;sequenceOffsetSeconds=0;in.current_time=30;
 fixture=better_captions::Document{};fixture.containers.push_back({"typography",false,{{"Caption",0,10,false}}});
 fixture.style.baseFontWeight=400;fixture.style.current.fontWeight=400;fixture.style.current.italic=0;
 values[5].u.fs_d.value=48;
 auto typographyFrame=[&](){carrier=better_captions::adobe::textCarrier(better_captions::encode(fixture),true);carrierBytes=carrier.size();raw=reinterpret_cast<char*>(carrier.data());check(main(PF_Cmd_RENDER,&in,&out,params.data(),&output,nullptr)==0,"BCAP3 typography render failed");return pixels;};
 const auto regularFrame=typographyFrame();fixture.style.current.fontWeightOffset=100;const auto boldFrame=typographyFrame();
 auto differs=[](const auto& a,const auto& b){return !std::equal(a.begin(),a.end(),b.begin(),[](auto p,auto q){return p.alpha==q.alpha&&p.red==q.red&&p.green==q.green&&p.blue==q.blue;});};
 check(differs(regularFrame,boldFrame),"Compiled B mode did not change native glyph pixels");
 fixture.style.current.fontWeightOffset=0;fixture.style.current.italic=1;const auto italicFrame=typographyFrame();
 check(differs(regularFrame,italicFrame),"Compiled italic did not change native glyph pixels");
 fixture.style.current.fontFamily="Impact";fixture.style.current.italic=0;const auto plainOnlyFrame=typographyFrame();
 fixture.style.current.italic=1;check(differs(plainOnlyFrame,typographyFrame()),"Compiled synthetic italic did not change glyph pixels");
 fixture=better_captions::Document{};fixture.containers.push_back({"page-count",false,{{"First.",0,1,true},{"Second.",1,2,true},{"Third.",2,3,true},{"Fourth.",3,4,true}}});
 values[5].u.fs_d.value=24;values[3].u.fs_d.value=240;in.current_time=45;
 values[GroupsPerPage].u.fs_d.value=1;const auto singleGroupPixels=typographyFrame();
 values[GroupsPerPage].u.fs_d.value=3;check(differs(singleGroupPixels,typographyFrame()),"Compiled groups-per-page scalar did not change native caption rendering");
 const auto threeGroupPixels=typographyFrame();values[GroupsPerPage].u.fs_d.value=2.7;
 check(!differs(threeGroupPixels,typographyFrame()),"Compiled fractional group sample did not round consistently");
 fixture=better_captions::Document{};fixture.containers.push_back({"smart-fit",false,{{"iii",0,.5,false},{"iii",.5,1,false},{"iii",1,1.5,false},{"iii",1.5,2,false}}});
 values[GroupsPerPage].u.fs_d.value=1;values[MaxChars].u.fs_d.value=1;values[Width].u.fs_d.value=200;in.current_time=20;
 values[SmartLineFit].u.fs_d.value=0;const auto fixedCharacterPixels=typographyFrame();
 values[SmartLineFit].u.fs_d.value=1;check(differs(fixedCharacterPixels,typographyFrame()),"Compiled smart-line-fit scalar did not change native phrase rendering");
 fixture=better_captions::Document{};fixture.containers.push_back({"native-roll",false,{{"First.",0,1,true},{"Second.",1,2,true},{"Third.",2,3,true},{"Fourth.",3,4,true}}});
 values[MaxChars].u.fs_d.value=56;values[Width].u.fs_d.value=500;values[Height].u.fs_d.value=240;values[SmartLineFit].u.fs_d.value=0;
 values[RollUpEnabled].u.fs_d.value=1;values[RollUpLines].u.fs_d.value=2;values[RollUpDuration].u.fs_d.value=.18;values[RollUpBoundary].u.fs_d.value=0;
 values[RollUpPosition].u.fs_d.value=0;values[RollUpThickness].u.fs_d.value=.35;values[RollUpFade].u.fs_d.value=1;values[RollUpCurve].u.fs_d.value=2;
 values[RollUpDirection].u.fs_d.value=1;values[RollUpSpeed].u.fs_d.value=1;values[RollUpWait].u.fs_d.value=1;
 in.time_scale=100;in.current_time=109;const auto rollTransitionPixels=typographyFrame();in.current_time=119;
 check(differs(rollTransitionPixels,typographyFrame()),"Compiled roll-up source clock did not animate the lines");
 values[RollUpBoundary].u.fs_d.value=1;const auto fadingRollPixels=typographyFrame();values[RollUpBoundary].u.fs_d.value=0;
 check(differs(fadingRollPixels,typographyFrame()),"Compiled roll-up fade did not change sharp text pixels");
 in.current_time=109;values[LineTransition].u.fs_d.value=1;const auto scrollingPixels=typographyFrame();
 for(int transition:{2,3,4}){values[LineTransition].u.fs_d.value=transition;check(differs(scrollingPixels,typographyFrame()),"Compiled creative line transition did not change caption pixels");}
 fixture.style.current.color={0,1,0,1};values[LineTransition].u.fs_d.value=2;const auto readableFade=typographyFrame();
 std::size_t greenCurrent=0;for(const auto& pixel:readableFade)if(pixel.green>200&&pixel.red<30)++greenCurrent;
 check(greenCurrent>20,"Compiled Fade did not keep the currently spoken word legible");
 dlclose(binary);std::cout<<"Compiled adapter smoke passed: ARGB/determinism/reflow/half-resolution and pixel-equal persisted adjustment-origin Razor frames; not host acceptance.\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
