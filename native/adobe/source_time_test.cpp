#define BC_SOURCE_TIME_TEST_NO_LOG 1
#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "source_time.hpp"
#include <cstring>
#include <iostream>
#include <stdexcept>
namespace {
PrTime sequence=5000,media=5000,ticks=1000;bool available=true,mediaOK=true;int queries=0;
A_long startFrame=120,trackStartFrame=0;PrTime effectFrameTicks=8467200000LL;double speed=1;bool startOK=true,sequenceOK=true,trackOK=true;int originalRateCalls=0;
PF_Err sequenceTime(PF_ProgPtr,PrTime* out){if(!sequenceOK)return PF_Err_INVALID_CALLBACK;*out=sequence;return 0;}
PF_Err mediaTime(PF_ProgPtr,csSDK_uint32 index,bool sound,PrTime input,PrTime* out,PrTime* frame,PF_TimeDisplay* display){++queries;if(index||sound||input!=sequence||!mediaOK)return PF_Err_BAD_CALLBACK_PARAM;*out=media;*frame=40;*display=PF_TimeDisplay_25;return 0;}
prSuiteError clockTime(PrTime* out){*out=ticks;return 0;}
PF_Err clipStart(PF_ProgPtr,A_long* out){if(!startOK)return PF_Err_INVALID_CALLBACK;*out=startFrame;return 0;}
PF_Err trackStart(PF_ProgPtr,A_long* out){if(!trackOK)return PF_Err_INVALID_CALLBACK;*out=trackStartFrame;return 0;}
PF_Err frameRate(PF_ProgPtr,PrTime* out){*out=effectFrameTicks;return 0;}
PF_Err clipSpeed(PF_ProgPtr,double* out){*out=speed;return 0;}
PF_Err originalRate(PF_ProgPtr,PrTime* out){++originalRateCalls;*out=10584000000LL;return 0;} // actual24fps source, NOT effect30fps
PF_UtilitySuite10 utility{};PrSDKTimeSuite clockSuite{};
SPErr acquire(const char* name,int32_t version,const void** out){if(!available)return -1;if(!std::strcmp(name,kPFUtilitySuite)&&version==10){*out=&utility;return 0;}if(!std::strcmp(name,kPrSDKTimeSuite)&&version==1){*out=&clockSuite;return 0;}return -1;}
SPErr release(const char*,int32_t){return 0;}
void check(bool ok){if(!ok)throw std::runtime_error("Source-time suite probe test failed");}
}
int main(){try{
 utility.GetSequenceTime=sequenceTime;utility.GetSourceTrackCurrentMediaTimeInfo=mediaTime;clockSuite.GetTicksPerSecond=clockTime;
 SPBasicSuite basic{};basic.AcquireSuite=acquire;basic.ReleaseSuite=release;PF_InData in{};in.pica_basicP=&basic;in.current_time=25;in.time_scale=25;
 double value=1;check(better_captions::adobe::source_time_probe::mediaSeconds(&in,value)==0&&value==1&&queries==3);
 sequence=12000;media=5000;queries=0;check(better_captions::adobe::source_time_probe::mediaSeconds(&in,value)==0&&value==1&&queries==3);
 media=7000;check(better_captions::adobe::source_time_probe::mediaSeconds(&in,value)==0&&value==1);
 media=3000;check(better_captions::adobe::source_time_probe::mediaSeconds(&in,value)==0&&value==1);
 available=false;check(better_captions::adobe::source_time_probe::mediaSeconds(&in,value)==0&&value==1);available=true;
 mediaOK=false;check(better_captions::adobe::source_time_probe::mediaSeconds(&in,value)==0&&value==1);mediaOK=true;
 ticks=0;check(better_captions::adobe::source_time_probe::mediaSeconds(&in,value)==0&&value==1);
 // Host calibration: actual24fps media in30fps sequence reports start120,
 // effect frame ticks8467200000 and clock254016000000. At local1 => source5.
 utility.GetUnscaledClipStart=clipStart;utility.GetTrackItemStart=trackStart;utility.GetMediaFrameRate=frameRate;utility.GetClipSpeed=clipSpeed;utility.GetOriginalClipFrameRate=originalRate;
 ticks=254016000000LL;sequence=ticks;in.current_time=30;in.time_scale=30;value=-1;
 check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)==0&&value==5&&originalRateCalls==0);
 sequence=2794176000000LL;trackStartFrame=300; // same sourcein4, movedtrack10 at CTI11: still source5
 check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)==0&&value==5);
 startFrame=0;trackStartFrame=0;sequence=5*ticks;in.current_time=150;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)==0&&value==5); // before Razor
 // Timeline29.97: each host frame advances1001/30000 seconds, not1/30.
 startFrame=120;effectFrameTicks=8475667200LL;in.current_time=30030;in.time_scale=30000;sequence=254270016000LL;
 check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)==0&&std::abs(value-5.005)<1e-12);
 const double frame2997=value;in.current_time+=1001;sequence+=effectFrameTicks;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)==0&&std::abs((value-frame2997)-1001.0/30000)<1e-12);
 // Timeline23.976:96 timelineframes of in-point plus24 localframes =5.005s.
 startFrame=96;effectFrameTicks=10594584000LL;in.current_time=24024;in.time_scale=24000;sequence=254270016000LL;
 check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)==0&&std::abs(value-5.005)<1e-12);
 const double frame23976=value;in.current_time+=1001;sequence+=effectFrameTicks;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)==0&&std::abs((value-frame23976)-1001.0/24000)<1e-12);
 check(originalRateCalls==0);
 effectFrameTicks=8467200000LL;in.time_scale=30;
 startFrame=120;in.current_time=30;
 // Explicit adjustment document origin preserves synthetic1h in-point and Razor.
 startFrame=108000;sequence=ticks;check(better_captions::adobe::source_time_probe::documentSeconds(&in,3600,value)==0&&value==1);
 startFrame=108120;trackStartFrame=120;sequence=5*ticks;in.current_time=150;check(better_captions::adobe::source_time_probe::documentSeconds(&in,3600,value)==0&&value==5); // PF5 from underlying footage, layerlocal1
 in.current_time=99999;check(better_captions::adobe::source_time_probe::documentSeconds(&in,3600,value)==0&&value==5); // PF clock cannot affect real document
 sequence=2794176000000LL;trackStartFrame=300;in.current_time=30;check(better_captions::adobe::source_time_probe::documentSeconds(&in,3600,value)==0&&value==5); // moved item unchanged
 startFrame=0;trackStartFrame=0;sequence=ticks;check(better_captions::adobe::source_time_probe::documentSeconds(&in,-4,value)==0&&value==5);
 check(better_captions::adobe::source_time_probe::documentSeconds(&in,864001,value)!=0);
 startFrame=120;
 for(double unsupported:{2.0,0.5,-1.0}){speed=unsupported;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)!=0);}speed=1;
 effectFrameTicks=0;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)!=0);effectFrameTicks=8467200000LL;
 startOK=false;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)!=0);startOK=true;
 sequenceOK=false;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)!=0);sequenceOK=true;
 trackOK=false;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)!=0);trackOK=true;
 available=false;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)!=0);available=true;
 ticks=0;check(better_captions::adobe::source_time_probe::ordinaryMediaSeconds(&in,value)!=0);
 std::cout<<"Source time passed host-number crossFPS/Razor/moved and fractional29.97/23.976 timeline steps, originalFPS exclusion and explicit retime/error rejection; diagnostic candidates remain read-only.\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
