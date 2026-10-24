#pragma once
#include "AE_Effect.h"
#include "parameters.hpp"
#include <PrSDKAESupport.h>
#include <PrSDKSequenceInfoSuite.h>
#include <SPBasic.h>
#include <algorithm>
#include <cstdio>
#include <cmath>
#if !defined(_WIN32)
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif
namespace better_captions::adobe {
inline constexpr double kAutoDimension=-1.0;
struct DimensionDefaults {double width=kAutoDimension,height=kAutoDimension;bool hostDimensions=false,sequenceDimensions=false;};
template<class T>class DimensionSuite {
 SPBasicSuite* basic_;const char* name_;int version_;const T* value_=nullptr;
 public:DimensionSuite(const PF_InData* in,const char* name,int version):basic_(in?in->pica_basicP:nullptr),name_(name),version_(version){const void* acquired=nullptr;if(basic_&&!basic_->AcquireSuite(name_,version_,&acquired))value_=static_cast<const T*>(acquired);}
 ~DimensionSuite(){if(value_)basic_->ReleaseSuite(name_,version_);}const T* operator->()const{return value_;}explicit operator bool()const{return value_!=nullptr;}
};
inline bool sequenceDimensions(const PF_InData* in,A_long& width,A_long& height){
 if(!in||!in->effect_ref||!in->pica_basicP)return false;
 DimensionSuite<PF_UtilitySuite10> utility(in,kPFUtilitySuite,kPFUtilitySuiteVersion10);
 if(!utility||!utility->GetContainingTimelineID)return false;
 PrTimelineID timeline{};if(utility->GetContainingTimelineID(in->effect_ref,&timeline))return false;
 DimensionSuite<PrSDKSequenceInfoSuite> sequence(in,kPrSDKSequenceInfoSuite,kPrSDKSequenceInfoSuiteVersion);
 if(!sequence||!sequence->GetFrameRect)return false;
 prRect rect{};if(sequence->GetFrameRect(timeline,&rect))return false;
 const auto w=static_cast<long long>(rect.right)-rect.left,h=static_cast<long long>(rect.bottom)-rect.top;
 if(w<=0||h<=0||w>32768||h>32768)return false;
 width=static_cast<A_long>(w);height=static_cast<A_long>(h);return true;
}
inline DimensionDefaults dimensionDefaults(const PF_InData* in){
 DimensionDefaults result;A_long width=0,height=0;
 result.sequenceDimensions=sequenceDimensions(in,width,height);
 if(!result.sequenceDimensions&&in){width=in->width;height=in->height;}
 if(width>0&&height>0){result.width=std::clamp(width*.9,1.0,8192.0);result.height=std::clamp(height*.9,1.0,8192.0);result.hostDimensions=true;}
 return result;
}
// Bounded metadata-only registration diagnostics establish what Premiere
// actually supplies during PARAMS_SETUP. No project paths, content or pointers.
inline void logDimensionDefaults(const PF_InData* in,const DimensionDefaults& value,const char* action="params-setup",int parameter=0,double before=0,double after=0){
#if !defined(_WIN32)
 if(!in)return;
 const int file=::open("/tmp/better-captions-native-params-setup.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW|O_NONBLOCK,0600);if(file<0)return;
 struct stat status{};
 if(!::fstat(file,&status)&&S_ISREG(status.st_mode)&&status.st_uid==::getuid()&&(status.st_mode&0077)==0&&status.st_nlink==1&&status.st_size<65536){
  char line[340];const int count=std::snprintf(line,sizeof(line),"%s pid=%ld inputWidth=%ld inputHeight=%ld widthDefault=%.12g heightDefault=%.12g hostDimensions=%d sequenceDimensions=%d parameter=%d before=%.12g after=%.12g\n",action,long(::getpid()),long(in->width),long(in->height),value.width,value.height,int(value.hostDimensions),int(value.sequenceDimensions),parameter,before,after);if(count>0)::write(file,line,std::min<int>(count,sizeof(line)-1));
 }
 ::close(file);
#else
 (void)in;(void)value;(void)action;(void)parameter;(void)before;(void)after;
#endif
}
// Rendering can resolve a new instance's Auto default without mutating a saved
// stream. Positive authored pixel values remain byte-for-byte authoritative.
inline double resolvedDimension(double value,A_long fullResolutionExtent){
 if(value!=kAutoDimension)return value;
 return fullResolutionExtent>0?std::clamp(fullResolutionExtent*.9,1.0,8192.0):1.0;
}
inline double resolveDimension(double value,const PF_InData* in,bool isWidth){
 if(value!=kAutoDimension)return value;
 const auto defaults=dimensionDefaults(in);return defaults.hostDimensions?(isWidth?defaults.width:defaults.height):1.0;
}
inline PF_Err changedDimension(PF_InData* in,PF_OutData* out,PF_ParamDef* params[],const PF_UserChangedParamExtra* extra){
 using namespace parameters;
 if(!in||!extra||!params||(extra->param_index!=Input&&extra->param_index!=Width&&extra->param_index!=Height))return PF_Err_NONE;
 const auto defaults=dimensionDefaults(in);
 for(int index:{int(Width),int(Height)}){
  if(extra->param_index!=Input&&extra->param_index!=index)continue;if(!params[index])continue;
  auto& param=*params[index];const double before=param.u.fs_d.value;
  if(before==kAutoDimension){
   if(defaults.hostDimensions){param.u.fs_d.value=index==Width?defaults.width:defaults.height;param.uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;if(out)out->out_flags|=PF_OutFlag_FORCE_RERENDER;}
  }else if(extra->param_index!=Input&&std::isfinite(before)&&before<1){
   // Retain the old minimum for manual numeric edits. Only exact -1 means Auto.
   param.u.fs_d.value=1;param.uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;if(out)out->out_flags|=PF_OutFlag_FORCE_RERENDER;
  }
  logDimensionDefaults(in,defaults,"dimension-user-change",index,before,param.u.fs_d.value);
 }
 return PF_Err_NONE;
}
}
