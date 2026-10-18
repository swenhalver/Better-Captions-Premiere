#pragma once
// Experimental ordinary 100%-speed trim mapping plus opt-in diagnostics.
// Moved adjustment-layer rendering passed; unmoved QE Razor rendering still fails.
// Premiere and Adobe effect SDKs are external build dependencies.
#include <PrSDKTimeSuite.h>
#include <PrSDKAESupport.h>
#include <SPBasic.h>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <cstdio>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace better_captions::adobe::source_time_probe {
template<class T>class Suite {
 SPBasicSuite* basic_;const char* name_;int version_;const T* suite_=nullptr;
 public:Suite(PF_InData* in,const char* name,int version):basic_(in->pica_basicP),name_(name),version_(version){if(basic_)basic_->AcquireSuite(name_,version_,reinterpret_cast<const void**>(&suite_));}
 ~Suite(){if(suite_)basic_->ReleaseSuite(name_,version_);}const T* operator->()const{return suite_;}explicit operator bool()const{return suite_!=nullptr;}
};
struct Sample {
 bool hostContext=false;
 A_long current=0,scale=0,step=0,localStep=0,clipStart=0,unscaledStart=0,trackStart=0;
 A_long trimmedFrame=0,untrimmedFrame=0,mediaStartFrame=0;
 PrTime sequence=0,media=0,mediaFrame=0,ticksPerSecond=0,sourceFrameTicks=0;
 std::int64_t layerIndex=0;
 PF_Err sequenceError=-1,mediaError=-1,clockError=-1;
 PF_Err trimmedError=-1,untrimmedError=-1,rateError=-1;
 bool synthetic=false;double speed=0;
 PF_Err startError=-1,speedError=-1,syntheticError=-1;
};
struct OwnLayerClock {
 A_long startFrame=0,trackStartFrame=0;PrTime sequenceTime=0,frameTicks=0,ticksPerSecond=0;double speed=0;
 PF_Err errSequence=-1,errTrack=-1,errStart=-1,errRate=-1,errSpeed=-1,errClock=-1;
};
inline void log(const Sample& s,const char* status) {
#if (BC_ENABLE_SOURCE_TIME_PROBE || BC_ENABLE_ADJUSTMENT_TIME_PROBE) && !defined(BC_SOURCE_TIME_TEST_NO_LOG)
 if(!s.hostContext)return; // dlopen smoke harness has no host effect_ref.
 const int file=::open("/tmp/better-captions-native-source-time-probe.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);
 if(file<0)return;struct stat st{};
 if(::fstat(file,&st)==0&&S_ISREG(st.st_mode)&&st.st_uid==::getuid()&&st.st_size<2*1024*1024){
  char line[900];const int n=std::snprintf(line,sizeof(line),"status=%s PF=%ld/%ld step=%ld localStep=%ld seq=%lld layerIndex=%lld media=%lld frameTicks=%lld ticksPerSecond=%lld clipStart=%ld unscaledStart=%ld trackStart=%ld trimFrame=%ld untrimFrame=%ld mediaStartFrame=%ld sourceFrameTicks=%lld speed=%.12g synthetic=%d errSeq=%ld errMedia=%ld errClock=%ld errTrim=%ld errUntrim=%ld errRate=%ld errStart=%ld errSpeed=%ld errSynthetic=%ld\n",status,long(s.current),long(s.scale),long(s.step),long(s.localStep),(long long)s.sequence,(long long)s.layerIndex,(long long)s.media,(long long)s.mediaFrame,(long long)s.ticksPerSecond,long(s.clipStart),long(s.unscaledStart),long(s.trackStart),long(s.trimmedFrame),long(s.untrimmedFrame),long(s.mediaStartFrame),(long long)s.sourceFrameTicks,s.speed,int(s.synthetic),long(s.sequenceError),long(s.mediaError),long(s.clockError),long(s.trimmedError),long(s.untrimmedError),long(s.rateError),long(s.startError),long(s.speedError),long(s.syntheticError));
  if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
 }
 ::close(file);
#else
 (void)s;(void)status;
#endif
}
inline void adjustmentDiagnostics(PF_InData* in) {
 Sample s;s.hostContext=in->effect_ref!=nullptr;s.current=in->current_time;s.scale=in->time_scale;s.step=in->time_step;s.localStep=in->local_time_step;
 Suite<PF_UtilitySuite10> utility(in,kPFUtilitySuite,kPFUtilitySuiteVersion10);
 Suite<PrSDKTimeSuite> clock(in,kPrSDKTimeSuite,kPrSDKTimeSuiteVersion);
 if(clock&&clock->GetTicksPerSecond)s.clockError=clock->GetTicksPerSecond(&s.ticksPerSecond);
 if(!utility){log(s,"adjustment-diagnostic-only-utility-unavailable");return;}
 if(utility->GetSequenceTime)s.sequenceError=utility->GetSequenceTime(in->effect_ref,&s.sequence);
 if(utility->GetClipStart)utility->GetClipStart(in->effect_ref,&s.clipStart);
 if(utility->GetUnscaledClipStart)s.startError=utility->GetUnscaledClipStart(in->effect_ref,&s.unscaledStart);
 if(utility->GetTrackItemStart)utility->GetTrackItemStart(in->effect_ref,&s.trackStart);
 if(utility->GetMediaFrameRate)s.rateError=utility->GetMediaFrameRate(in->effect_ref,&s.sourceFrameTicks);
 if(utility->GetClipSpeed)s.speedError=utility->GetClipSpeed(in->effect_ref,&s.speed);
 if(utility->IsTrackItemEffectAppliedToSynthetic)s.syntheticError=utility->IsTrackItemEffectAppliedToSynthetic(in->effect_ref,&s.synthetic);
 PF_TimeDisplay display=PF_TimeDisplay_Invalid;
 if(utility->GetMediaTimecode2){s.trimmedError=utility->GetMediaTimecode2(in->effect_ref,true,&s.trimmedFrame,&display);s.untrimmedError=utility->GetMediaTimecode2(in->effect_ref,false,&s.untrimmedFrame,&display);}
 if(utility->GetMediaTimecode)utility->GetMediaTimecode(in->effect_ref,&s.mediaStartFrame,&display);
 // Only this effect's layer is queried: never inspect the footage below it.
 log(s,"adjustment-diagnostic-only-PF-relative-render");
}
inline PF_Err ordinaryMediaSeconds(PF_InData* in,double& seconds,OwnLayerClock* trace=nullptr) {
 if(!in)return PF_Err_BAD_CALLBACK_PARAM;
 Suite<PF_UtilitySuite10> utility(in,kPFUtilitySuite,kPFUtilitySuiteVersion10);
 Suite<PrSDKTimeSuite> clock(in,kPrSDKTimeSuite,kPrSDKTimeSuiteVersion);
 if(!utility||!clock||!utility->GetSequenceTime||!utility->GetTrackItemStart||!utility->GetUnscaledClipStart||!utility->GetMediaFrameRate||!utility->GetClipSpeed||!clock->GetTicksPerSecond)return PF_Err_INVALID_CALLBACK;
 OwnLayerClock local;auto& c=trace?*trace:local;c={};
 if((c.errSequence=utility->GetSequenceTime(in->effect_ref,&c.sequenceTime))||
    (c.errTrack=utility->GetTrackItemStart(in->effect_ref,&c.trackStartFrame))||
    (c.errStart=utility->GetUnscaledClipStart(in->effect_ref,&c.startFrame))||
    (c.errRate=utility->GetMediaFrameRate(in->effect_ref,&c.frameTicks))||
    (c.errSpeed=utility->GetClipSpeed(in->effect_ref,&c.speed))||
    (c.errClock=clock->GetTicksPerSecond(&c.ticksPerSecond)))return PF_Err_INVALID_CALLBACK;
 // Retimed/reversed clips require separate host acceptance; never guess their map.
 if(!std::isfinite(c.speed)||std::abs(c.speed-1.0)>1e-9||c.frameTicks<=0||c.ticksPerSecond<=0)return PF_Err_BAD_CALLBACK_PARAM;
 // Query the render sequence clock and this layer's start rather than relying
 // on PF current_time. This formula has not resolved the observed unmoved QE
 // adjustment-layer split failure. Startup logs are speculative render requests,
 // not proof of the CTI; actual UI Add Edit comparison remains pending.
 const long double mapped=(static_cast<long double>(c.sequenceTime)+
                           (static_cast<long double>(c.startFrame)-c.trackStartFrame)*c.frameTicks)/c.ticksPerSecond;
 const auto value=static_cast<double>(mapped);if(!std::isfinite(value))return PF_Err_BAD_CALLBACK_PARAM;
 seconds=value;return PF_Err_NONE;
}
inline PF_Err documentSeconds(PF_InData* in,double origin,double& seconds,OwnLayerClock* trace=nullptr) {
 if(!std::isfinite(origin)||std::abs(origin)>864000)return PF_Err_BAD_CALLBACK_PARAM;
 const auto err=ordinaryMediaSeconds(in,seconds,trace);if(err)return err;
 seconds-=origin;return std::isfinite(seconds)?PF_Err_NONE:PF_Err_BAD_CALLBACK_PARAM;
}
inline PF_Err mediaSeconds(PF_InData* in,double& seconds) {
 (void)seconds; // Diagnostic revision: retain the caller's old PF time unchanged.
 Sample sample;sample.hostContext=in->effect_ref!=nullptr;sample.current=in->current_time;sample.scale=in->time_scale;
 Suite<PF_UtilitySuite10> utility(in,kPFUtilitySuite,kPFUtilitySuiteVersion10);
 Suite<PrSDKTimeSuite> clock(in,kPrSDKTimeSuite,kPrSDKTimeSuiteVersion);
 if(!utility||!clock){log(sample,"diagnostic-only-required-suite-unavailable");return PF_Err_NONE;}
 if(!utility->GetSequenceTime||!utility->GetSourceTrackCurrentMediaTimeInfo||!clock->GetTicksPerSecond){log(sample,"diagnostic-only-required-callback-unavailable");return PF_Err_NONE;}
 sample.sequenceError=utility->GetSequenceTime(in->effect_ref,&sample.sequence);
 sample.clockError=clock->GetTicksPerSecond(&sample.ticksPerSecond);
 if(utility->GetClipStart)utility->GetClipStart(in->effect_ref,&sample.clipStart);
 if(utility->GetUnscaledClipStart)utility->GetUnscaledClipStart(in->effect_ref,&sample.unscaledStart);
 if(utility->GetTrackItemStart)utility->GetTrackItemStart(in->effect_ref,&sample.trackStart);
 PF_TimeDisplay display=PF_TimeDisplay_Invalid;
 if(utility->GetMediaTimecode2){sample.trimmedError=utility->GetMediaTimecode2(in->effect_ref,true,&sample.trimmedFrame,&display);sample.untrimmedError=utility->GetMediaTimecode2(in->effect_ref,false,&sample.untrimmedFrame,&display);}
 if(utility->GetMediaTimecode)utility->GetMediaTimecode(in->effect_ref,&sample.mediaStartFrame,&display);
 if(utility->GetMediaFrameRate)sample.rateError=utility->GetMediaFrameRate(in->effect_ref,&sample.sourceFrameTicks);
 for(std::int64_t candidate:{std::int64_t(0),std::int64_t(0xffffffffu),std::int64_t(1)}){
  sample.layerIndex=candidate;sample.media=0;sample.mediaFrame=0;sample.mediaError=-1;
  if(!sample.sequenceError)sample.mediaError=utility->GetSourceTrackCurrentMediaTimeInfo(in->effect_ref,static_cast<csSDK_uint32>(candidate),false,sample.sequence,&sample.media,&sample.mediaFrame,&display);
  log(sample,sample.mediaError?"diagnostic-only-candidate-failed":"diagnostic-only-candidate-returned");
 }
 return PF_Err_NONE;
}
}
