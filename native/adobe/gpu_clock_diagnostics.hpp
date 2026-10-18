#pragma once
// Original ABI-only diagnostic. No GPU output, CPU clock cache, or pixel writes.
#include <PrSDKGPUFilter.h>
#include <PrSDKVideoSegmentSuite.h>
#include <PrSDKMemoryManagerSuite.h>
#include <SPBasic.h>
#include <atomic>
#include <cstdio>
#include <algorithm>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
namespace better_captions::adobe::gpu_clock_probe {
inline void paramsLog(int file,const PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* params){
 if(!params||!instance->piSuites||!instance->piSuites->utilFuncs||!instance->piSuites->utilFuncs->getSPBasicSuite)return;
 auto* basic=instance->piSuites->utilFuncs->getSPBasicSuite();if(!basic)return;
 const PrSDKVideoSegmentSuite* graph=nullptr;const PrSDKMemoryManagerSuite* memory=nullptr;
 basic->AcquireSuite(kPrSDKVideoSegmentSuite,kPrSDKVideoSegmentSuiteVersion,reinterpret_cast<const void**>(&graph));
 basic->AcquireSuite(kPrSDKMemoryManagerSuite,kPrSDKMemoryManagerSuiteVersion,reinterpret_cast<const void**>(&memory));
 csSDK_int32 count=0;prSuiteError ec=-1,ea=-1,ep=-1;PrParam arb{},point{};unsigned bytes=0;unsigned header[16]{};double x=0,y=0;
 if(graph&&graph->GetParamCount&&graph->GetParam){ec=graph->GetParamCount(instance->inNodeID,&count);
  if(!ec&&count>6)ea=graph->GetParam(instance->inNodeID,6,params->inClipTime,&arb);
  // Copy the bounded header before another GetParam can reuse borrowed storage.
  if(!ea&&arb.mType==kPrParamType_PrMemoryPtr&&arb.mMemoryPtr&&memory&&memory->GetPtrSize){bytes=memory->GetPtrSize(arb.mMemoryPtr);if(bytes>=16&&bytes<=16*1024*1024)for(int i=0;i<16;++i)header[i]=reinterpret_cast<const unsigned char*>(arb.mMemoryPtr)[i];}
  if(!ec&&count>0)ep=graph->GetParam(instance->inNodeID,0,params->inClipTime,&point);
  if(!ep&&point.mType==kPrParamType_Point){x=point.mPoint.x;y=point.mPoint.y;}
 }
 // GetParam pointer ownership is unspecified: do not dispose or reinterpret as PF_Handle.
 char line[550];const int n=std::snprintf(line,sizeof(line),"gpu-param node=%d count=%d errCount=%ld arbType=%d arbErr=%ld arbBytes=%u header16=%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u pointType=%d pointErr=%ld pointX=%.12g pointY=%.12g\n",int(instance->inNodeID),int(count),long(ec),int(arb.mType),long(ea),bytes,header[0],header[1],header[2],header[3],header[4],header[5],header[6],header[7],header[8],header[9],header[10],header[11],header[12],header[13],header[14],header[15],int(point.mType),long(ep),x,y);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
 if(memory)basic->ReleaseSuite(kPrSDKMemoryManagerSuite,kPrSDKMemoryManagerSuiteVersion);if(graph)basic->ReleaseSuite(kPrSDKVideoSegmentSuite,kPrSDKVideoSegmentSuiteVersion);
}
inline void log(int phase,const PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* params){
 if(!instance||(!instance->inNodeID&&!instance->inTimelineID))return;
 static std::atomic<unsigned> count{0};if(count.fetch_add(1,std::memory_order_relaxed)>=4096)return;
 const int file=::open("/tmp/better-captions-native-gpu-clock.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);if(file<0)return;
 struct stat st{};if(!::fstat(file,&st)&&S_ISREG(st.st_mode)&&st.st_uid==::getuid()&&st.st_size<1024*1024){
  char line[400];const int n=std::snprintf(line,sizeof(line),"gpu phase=%d timeline=%d node=%d device=%u hasFrame=%d clipTime=%lld sequenceTime=%lld ticksPerFrame=%lld width=%u height=%u\n",phase,int(instance->inTimelineID),int(instance->inNodeID),unsigned(instance->inDeviceIndex),int(params!=nullptr),params?(long long)params->inClipTime:0,params?(long long)params->inSequenceTime:0,params?(long long)params->inRenderTicksPerFrame:0,params?unsigned(params->inRenderWidth):0,params?unsigned(params->inRenderHeight):0);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
  if(phase==2)paramsLog(file,instance,params);
 }::close(file);
}
inline prSuiteError create(PrGPUFilterInstance* instance){if(!instance)return suiteError_InvalidParms;instance->ioPrivatePluginData=nullptr;instance->outIsRealtime=0;log(0,instance,nullptr);return suiteError_NoError;}
inline prSuiteError dispose(PrGPUFilterInstance* instance){log(1,instance,nullptr);return suiteError_NoError;}
inline prSuiteError dependencies(PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* params,csSDK_int32*,PrGPUFilterFrameDependency*){log(2,instance,params);return suiteError_NotImplemented;}
inline prSuiteError precompute(PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* params,csSDK_int32,PPixHand){log(3,instance,params);return suiteError_NotImplemented;}
inline prSuiteError render(PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* params,const PPixHand*,csSDK_size_t,PPixHand* out){log(4,instance,params);if(out)*out=nullptr;return suiteError_NotImplemented;}
}
extern "C" __attribute__((visibility("default"))) prSuiteError xGPUFilterEntry(csSDK_uint32 version,csSDK_int32* index,prBool startup,piSuitesPtr,PrGPUFilter* filter,PrGPUFilterInfo* info){
 using namespace better_captions::adobe::gpu_clock_probe;
 if(!startup)return suiteError_NoError;
 if(version<PrSDKGPUFilterInterfaceVersion||!index||*index!=0||!filter||!info)return suiteError_InvalidParms;
 *filter={};filter->CreateInstance=create;filter->DisposeInstance=dispose;filter->GetFrameDependencies=dependencies;filter->Precompute=precompute;filter->Render=render;
 *info={};info->outInterfaceVersion=PrSDKGPUFilterInterfaceVersion; // null match name uses module PiPL, per SDK
 return suiteError_NoError;
}
