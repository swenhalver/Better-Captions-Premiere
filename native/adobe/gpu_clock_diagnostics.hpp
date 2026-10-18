#pragma once
// Original ABI-only diagnostic. No GPU output, CPU clock cache, or pixel writes.
#include <PrSDKGPUFilter.h>
#include "../core/caption_core.hpp"
#include <cstring>
#include <PrSDKVideoSegmentSuite.h>
#include <PrSDKMemoryManagerSuite.h>
#include <SPBasic.h>
#include <PrSDKGPUDeviceSuite.h>
#include <atomic>
#include <cstdio>
#include <algorithm>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
namespace better_captions::adobe::gpu_clock_probe {
struct CarrierMetadata {std::uint64_t fingerprint=0;std::size_t normalizedBytes=0,words=0;unsigned schema=0;double origin=0;bool decoded=false;};
inline CarrierMetadata carrierMetadata(const unsigned char* data,std::size_t size){
 CarrierMetadata result;if(!data||size==0||size>16*1024*1024)return result;
 const char prefix[]="BCDOC1:";bool text=size>=14&&size%2==0;
 for(std::size_t i=0;text&&i<7;++i)text=data[2*i]==static_cast<unsigned char>(prefix[i])&&data[2*i+1]==0;
 if(text&&size>=2&&!data[size-2]&&!data[size-1])size-=2;
 result.normalizedBytes=size;result.fingerprint=14695981039346656037ULL;
 for(std::size_t i=0;i<size;++i){result.fingerprint^=data[i];result.fingerprint*=1099511628211ULL;}
 try{
  std::vector<std::uint8_t> binary;
  if(text){
   if(size<14||(size-14)%4)return result;binary.reserve((size-14)/4);
   auto digit=[](unsigned char c)->int{return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;};
   for(std::size_t i=14;i<size;i+=4){const int a=digit(data[i]),b=digit(data[i+2]);if(data[i+1]||data[i+3]||a<0||b<0)return result;binary.push_back(static_cast<std::uint8_t>(a*16+b));}
  }else if(size>=4&&!std::memcmp(data,"BCAP",4))binary.assign(data,data+size);else return result;
  if(binary.size()>=8)result.schema=unsigned(binary[4])|(unsigned(binary[5])<<8)|(unsigned(binary[6])<<16)|(unsigned(binary[7])<<24);
  const auto doc=better_captions::decode(binary);result.origin=doc.timeOriginSeconds;for(const auto& container:doc.containers)result.words+=container.words.size();result.decoded=true;
 }catch(...){result.decoded=false;}
 return result;
}
inline void colorParamsLog(int file,const PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* params,const PrSDKVideoSegmentSuite* graph,const PrSDKMemoryManagerSuite* memory,csSDK_int32 count){
 if(!graph||!graph->GetParam)return;
 constexpr int indexes[]={5,9,12,19,22,29,32};
 for(const auto index:indexes){
  if(index>=count)continue;PrParam value{};const auto error=graph->GetParam(instance->inNodeID,index,params->inClipTime,&value);
  char typed[200]{};
  if(!error){
   if(value.mType==kPrParamType_Int32){const auto number=static_cast<std::uint32_t>(value.mInt32);std::snprintf(typed,sizeof(typed),"u32=%u hex32=%08x",unsigned(number),unsigned(number));}
   else if(value.mType==kPrParamType_Int64){const auto number=static_cast<std::uint64_t>(value.mInt64);std::snprintf(typed,sizeof(typed),"u64=%llu hex64=%016llx",(unsigned long long)number,(unsigned long long)number);}
   else if(value.mType==kPrParamType_Float32)std::snprintf(typed,sizeof(typed),"float32=%.9g",double(value.mFloat32));
   else if(value.mType==kPrParamType_Float64)std::snprintf(typed,sizeof(typed),"float64=%.17g",value.mFloat64);
   else if(value.mType==kPrParamType_PrMemoryPtr&&value.mMemoryPtr&&memory&&memory->GetPtrSize){
    const auto bytes=memory->GetPtrSize(value.mMemoryPtr);char hex[65]{};
    if(bytes<=32){const auto* data=reinterpret_cast<const unsigned char*>(value.mMemoryPtr);constexpr char digits[]="0123456789abcdef";for(unsigned i=0;i<bytes;++i){hex[2*i]=digits[data[i]>>4];hex[2*i+1]=digits[data[i]&15];}}
    std::snprintf(typed,sizeof(typed),"memoryBytes=%u payloadHex=%s",unsigned(bytes),hex);
   }
  }
  char line[350];const int n=std::snprintf(line,sizeof(line),"gpu-color pid=%ld node=%d index=%d type=%d error=%ld %s\n",long(::getpid()),int(instance->inNodeID),index,int(value.mType),long(error),typed);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
 }
}
inline void paramsLog(int file,const PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* params){
 if(!params||!instance->piSuites||!instance->piSuites->utilFuncs||!instance->piSuites->utilFuncs->getSPBasicSuite)return;
 auto* basic=instance->piSuites->utilFuncs->getSPBasicSuite();if(!basic)return;
 const PrSDKVideoSegmentSuite* graph=nullptr;const PrSDKMemoryManagerSuite* memory=nullptr;
 basic->AcquireSuite(kPrSDKVideoSegmentSuite,kPrSDKVideoSegmentSuiteVersion,reinterpret_cast<const void**>(&graph));
 basic->AcquireSuite(kPrSDKMemoryManagerSuite,kPrSDKMemoryManagerSuiteVersion,reinterpret_cast<const void**>(&memory));
 csSDK_int32 count=0;prSuiteError ec=-1,ea=-1,ep=-1;PrParam arb{},point{};unsigned bytes=0;unsigned header[16]{};double x=0,y=0;CarrierMetadata carrier;
 if(graph&&graph->GetParamCount&&graph->GetParam){ec=graph->GetParamCount(instance->inNodeID,&count);
  if(!ec&&count>6)ea=graph->GetParam(instance->inNodeID,6,params->inClipTime,&arb);
  // Copy the bounded header before another GetParam can reuse borrowed storage.
  if(!ea&&arb.mType==kPrParamType_PrMemoryPtr&&arb.mMemoryPtr&&memory&&memory->GetPtrSize){bytes=memory->GetPtrSize(arb.mMemoryPtr);if(bytes>=16&&bytes<=16*1024*1024){const auto* data=reinterpret_cast<const unsigned char*>(arb.mMemoryPtr);for(int i=0;i<16;++i)header[i]=data[i];carrier=carrierMetadata(data,bytes);}}
  if(!ec&&count>0)ep=graph->GetParam(instance->inNodeID,0,params->inClipTime,&point);
  if(!ep&&point.mType==kPrParamType_Point){x=point.mPoint.x;y=point.mPoint.y;}
 }
 // GetParam pointer ownership is unspecified: do not dispose or reinterpret as PF_Handle.
 char line[800];const int n=std::snprintf(line,sizeof(line),"gpu-param pid=%ld node=%d count=%d errCount=%ld arbType=%d arbErr=%ld arbBytes=%u carrierBytes=%zu carrierFNV64=%llu decoded=%d schema=%u origin=%.15g words=%zu header16=%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u pointType=%d pointErr=%ld pointX=%.12g pointY=%.12g\n",long(::getpid()),int(instance->inNodeID),int(count),long(ec),int(arb.mType),long(ea),bytes,carrier.normalizedBytes,(unsigned long long)carrier.fingerprint,int(carrier.decoded),carrier.schema,carrier.origin,carrier.words,header[0],header[1],header[2],header[3],header[4],header[5],header[6],header[7],header[8],header[9],header[10],header[11],header[12],header[13],header[14],header[15],int(point.mType),long(ep),x,y);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
 if(!ec)colorParamsLog(file,instance,params,graph,memory,count);
 if(memory)basic->ReleaseSuite(kPrSDKMemoryManagerSuite,kPrSDKMemoryManagerSuiteVersion);if(graph)basic->ReleaseSuite(kPrSDKVideoSegmentSuite,kPrSDKVideoSegmentSuiteVersion);
}
inline void log(int phase,const PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* params){
 if(!instance||(!instance->inNodeID&&!instance->inTimelineID))return;
 static std::atomic<unsigned> count{0};if(count.fetch_add(1,std::memory_order_relaxed)>=4096)return;
 const int file=::open("/tmp/better-captions-native-gpu-clock.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);if(file<0)return;
 struct stat st{};if(!::fstat(file,&st)&&S_ISREG(st.st_mode)&&st.st_uid==::getuid()&&st.st_size<1024*1024){
  char line[400];const int n=std::snprintf(line,sizeof(line),"gpu pid=%ld phase=%d timeline=%d node=%d device=%u hasFrame=%d clipTime=%lld sequenceTime=%lld ticksPerFrame=%lld width=%u height=%u\n",long(::getpid()),phase,int(instance->inTimelineID),int(instance->inNodeID),unsigned(instance->inDeviceIndex),int(params!=nullptr),params?(long long)params->inClipTime:0,params?(long long)params->inSequenceTime:0,params?(long long)params->inRenderTicksPerFrame:0,params?unsigned(params->inRenderWidth):0,params?unsigned(params->inRenderHeight):0);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
  if(phase==2)paramsLog(file,instance,params);
 }::close(file);
}
inline void deviceLog(const PrGPUFilterInstance* instance){
 if(!instance||(!instance->inNodeID&&!instance->inTimelineID)||!instance->piSuites||!instance->piSuites->utilFuncs||!instance->piSuites->utilFuncs->getSPBasicSuite)return;
 auto* basic=instance->piSuites->utilFuncs->getSPBasicSuite();if(!basic)return;
 const PrSDKGPUDeviceSuite* suite=nullptr;basic->AcquireSuite(kPrSDKGPUDeviceSuite,kPrSDKGPUDeviceSuiteVersion,reinterpret_cast<const void**>(&suite));
 PrGPUDeviceInfo info{};prSuiteError error=suite&&suite->GetDeviceInfo?suite->GetDeviceInfo(kPrSDKGPUDeviceSuiteVersion,instance->inDeviceIndex,&info):suiteError_NotImplemented;
 static std::atomic<unsigned> count{0};
 if(count.fetch_add(1,std::memory_order_relaxed)<4096){
  const int file=::open("/tmp/better-captions-native-gpu-clock.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);
  if(file>=0){struct stat st{};if(!::fstat(file,&st)&&S_ISREG(st.st_mode)&&st.st_uid==::getuid()&&st.st_size<1024*1024){
   char line[220];const int n=std::snprintf(line,sizeof(line),"gpu-device pid=%ld timeline=%d node=%d device=%u error=%ld framework=%d minimumAcceleration=%d\n",long(::getpid()),int(instance->inTimelineID),int(instance->inNodeID),unsigned(instance->inDeviceIndex),long(error),int(info.outDeviceFramework),int(info.outMeetsMinimumRequirementsForAcceleration));if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
  }::close(file);}
 }
 if(suite)basic->ReleaseSuite(kPrSDKGPUDeviceSuite,kPrSDKGPUDeviceSuiteVersion);
}
inline void realtimeLog(const PrGPUFilterInstance* instance,prBool incoming,prBool returned){
 if(!instance||(!instance->inNodeID&&!instance->inTimelineID))return;
 static std::atomic<unsigned> count{0};if(count.fetch_add(1,std::memory_order_relaxed)>=4096)return;
 const int file=::open("/tmp/better-captions-native-gpu-clock.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);if(file<0)return;
 struct stat st{};if(!::fstat(file,&st)&&S_ISREG(st.st_mode)&&st.st_uid==::getuid()&&st.st_size<1024*1024){char line[230];const int n=std::snprintf(line,sizeof(line),"gpu-realtime pid=%ld timeline=%d node=%d incoming=%d returned=%d\n",long(::getpid()),int(instance->inTimelineID),int(instance->inNodeID),int(incoming),int(returned));if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));}::close(file);
}
inline prSuiteError create(PrGPUFilterInstance* instance){if(!instance)return suiteError_InvalidParms;const auto incoming=instance->outIsRealtime;instance->ioPrivatePluginData=nullptr;log(0,instance,nullptr);deviceLog(instance);realtimeLog(instance,incoming,instance->outIsRealtime);return suiteError_NoError;}
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
