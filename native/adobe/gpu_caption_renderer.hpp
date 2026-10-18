#pragma once
// Original experimental companion; compile in ONE Objective-C++ translation unit.
// No Adobe implementation source. Main release builds do not include this file.
#ifndef __OBJC__
#error gpu_caption_renderer.hpp requires Objective-C++
#endif
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <PrSDKGPUFilter.h>
#include <PrSDKGPUDeviceSuite.h>
#include <PrSDKPPixSuite.h>
#include <PrSDKTimeSuite.h>
#include <PrSDKVideoSegmentSuite.h>
#include <PrSDKMemoryManagerSuite.h>
#include "caption_arbitrary.hpp"
#include "parameters.hpp"
#include "render_style.hpp"
#include "../macos/caption_rasterizer.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <atomic>
#include <cstdio>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace better_captions::adobe::gpu_caption_renderer {
// Verified on Premiere 26.5.2: native color GetParam is Int64 with four
// 16-bit lanes A,R,G,B, each observed 8-bit channel stored <<8 (full=65280).
// CPU native tint behavior ignores alpha; preserve the document's own alpha.
// Host PNG/CPU-reference acceptance found BGRP8 precompute converted to straight
// GPU BGRA32f. Multiply overlay RGB by its alpha; both modes remain testable.
// Transparent-source PNG/CPU-reference acceptance also proved straight input
// and output. Association stays explicit so premultiplied paths remain testable.
#ifndef BC_GPU_OVERLAY_STRAIGHT
#define BC_GPU_OVERLAY_STRAIGHT 1
#endif
#ifndef BC_GPU_INPUT_STRAIGHT
#define BC_GPU_INPUT_STRAIGHT 1
#endif
#ifndef BC_GPU_OUTPUT_STRAIGHT
#define BC_GPU_OUTPUT_STRAIGHT 1
#endif
struct CompositeParams {
 std::uint32_t width,height,inputPitch,overlayPitch,outputPitch;
 std::uint32_t inputHalf,overlayHalf,outputHalf,overlayStraight,inputStraight,outputStraight;
};
static_assert(sizeof(CompositeParams)==44,"Metal argument layout");
struct RendererError:std::invalid_argument {using std::invalid_argument::invalid_argument;};
inline void require(bool ok,const char* message){if(!ok)throw RendererError(message);}
template<class T> struct Suite {
 SPBasicSuite* basic=nullptr;const T* ptr=nullptr;const char* name=nullptr;int version=0;
 Suite(SPBasicSuite* b,const char* n,int v):basic(b),name(n),version(v){
  if(!b||b->AcquireSuite(n,v,reinterpret_cast<const void**>(&ptr))||!ptr)throw RendererError("GPU suite unavailable");
 }
 ~Suite(){if(ptr)basic->ReleaseSuite(name,version);}
 Suite(const Suite&)=delete;Suite& operator=(const Suite&)=delete;
 const T* operator->()const{return ptr;}
};
struct State {
 SPBasicSuite* basic;
 Suite<PrSDKGPUDeviceSuite> gpu;
 Suite<PrSDKPPixSuite> ppix;
 Suite<PrSDKTimeSuite> clock;
 Suite<PrSDKVideoSegmentSuite> graph;
 Suite<PrSDKMemoryManagerSuite> memory;
 PrGPUDeviceInfo device{};PrTime ticksPerSecond=0;
 id<MTLComputePipelineState> pipeline=nil;
 explicit State(SPBasicSuite* b,unsigned index):basic(b),gpu(b,kPrSDKGPUDeviceSuite,kPrSDKGPUDeviceSuiteVersion),ppix(b,kPrSDKPPixSuite,kPrSDKPPixSuiteVersion),clock(b,kPrSDKTimeSuite,kPrSDKTimeSuiteVersion),graph(b,kPrSDKVideoSegmentSuite,kPrSDKVideoSegmentSuiteVersion),memory(b,kPrSDKMemoryManagerSuite,kPrSDKMemoryManagerSuiteVersion){
  require(!gpu->GetDeviceInfo(kPrSDKGPUDeviceSuiteVersion,index,&device)&&device.outDeviceFramework==PrGPUDeviceFramework_Metal,"Metal device required");
  require(device.outDeviceHandle&&device.outCommandQueueHandle,"Missing host Metal handles");
  require(!clock->GetTicksPerSecond(&ticksPerSecond)&&ticksPerSecond>0,"Invalid host timebase");
  @autoreleasepool {
   NSBundle* bundle=[NSBundle bundleWithIdentifier:@"ca.swen.bettercaptions.nativeprobe"];
   NSString* path=[bundle pathForResource:@"CaptionComposite" ofType:@"metallib"];
   require(path!=nil,"CaptionComposite.metallib missing");NSError* error=nil;
   id<MTLLibrary> library=[(id<MTLDevice>)device.outDeviceHandle newLibraryWithURL:[NSURL fileURLWithPath:path] error:&error];
   require(library!=nil,"Metal library load failed");
   id<MTLFunction> function=[library newFunctionWithName:@"captionComposite"];
   if(!function){[library release];throw RendererError("Metal function missing");}
   pipeline=[(id<MTLDevice>)device.outDeviceHandle newComputePipelineStateWithFunction:function error:&error];
   [function release];[library release];require(pipeline!=nil,"Metal pipeline creation failed");
  }
 }
 ~State(){[pipeline release];}
};
// Numeric diagnostics only. Reason strings come exclusively from our fixed
// RendererError literals and exact static core/style/carrier whitelist matches.
// Unknown decoder/OS/allocation exceptions remain generic.
struct TraceData {long long count=-1,index=-1;unsigned cpuFormat=0,inputFormat=0,overlayFormat=0,outputFormat=0;long long cpuPitch=0,inputPitch=0,overlayPitch=0,outputPitch=0;int popupType=0,popupValue=0;};
inline void trace(int phase,const PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* r,int success,const char* reason,const TraceData& d={}){
 static std::atomic<unsigned> count{0};if(count.fetch_add(1,std::memory_order_relaxed)>=4096)return;
 int file=::open("/tmp/better-captions-native-gpu-render.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);if(file<0)return;
 struct stat st{};if(!::fstat(file,&st)&&S_ISREG(st.st_mode)&&st.st_uid==::getuid()&&st.st_size<1024*1024){
  const auto* s=instance?static_cast<const State*>(instance->ioPrivatePluginData):nullptr;
  const double fps=s&&r&&r->inRenderTicksPerFrame>0?double(s->ticksPerSecond)/double(r->inRenderTicksPerFrame):0;
  char line[900];int n=std::snprintf(line,sizeof(line),"gpu-render pid=%ld phase=%d success=%d reason=%s node=%d clip=%lld seq=%lld ticksPerFrame=%lld fps=%.12g width=%u height=%u count=%lld index=%lld cpuFormat=%u inputFormat=%u overlayFormat=%u outputFormat=%u cpuPitch=%lld inputPitch=%lld overlayPitch=%lld outputPitch=%lld popupType=%d popupValue=%d\n",long(::getpid()),phase,success,reason,instance?int(instance->inNodeID):0,r?static_cast<long long>(r->inClipTime):0,r?static_cast<long long>(r->inSequenceTime):0,r?static_cast<long long>(r->inRenderTicksPerFrame):0,fps,r?unsigned(r->inRenderWidth):0,r?unsigned(r->inRenderHeight):0,d.count,d.index,d.cpuFormat,d.inputFormat,d.overlayFormat,d.outputFormat,d.cpuPitch,d.inputPitch,d.overlayPitch,d.outputPitch,d.popupType,d.popupValue);
  if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
 }::close(file);
}
inline const char* knownValidationReason(const char* value){
 // Return OUR literal, never arbitrary exception data; exact equality only.
 static const char* const known[]={"Numeric parameter type mismatch","invalid UTF-8","truncated UTF-8","invalid UTF-8 continuation","invalid UTF-8 scalar","control characters are unsupported","invalid color","invalid font family","invalid font size","invalid size scale","invalid opacity","invalid font weight","invalid italic mode","invalid relative weight mode","invalid style extent","invalid shadow offset","truncated document","invalid boolean","string limit exceeded","unsupported schema version","invalid document time origin","too many containers","invalid base font weight","invalid container id","too many words","invalid word text","invalid word timing","duplicate container id","text limit exceeded","invalid word spacing","invalid line height","invalid character count","invalid pause","document size exceeded","invalid document magic","invalid native typography mode","trailing document bytes","invalid time","invalid layout box","missing text measurer","layout geometry exceeds bounds","invalid text metrics","Invalid native appearance control","Invalid native bubble mode","Invalid native style scale","Invalid native text tint","Caption document exceeds transport limit","Invalid caption carrier size","Caption carrier must be UTF-16LE","Caption carrier must contain ASCII hex","Missing caption document","Invalid caption document text","Invalid hex"};
 if(value)for(const char* literal:known)if(std::strcmp(value,literal)==0)return literal;
 return "external-validation-or-allocation";
}
inline prSuiteError failure(int phase,const PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* r,const TraceData& d={}){
 try{throw;}catch(const RendererError& error){trace(phase,instance,r,0,error.what(),d);}catch(const std::invalid_argument& error){trace(phase,instance,r,0,knownValidationReason(error.what()),d);}catch(...){trace(phase,instance,r,0,"external-validation-or-allocation",d);}return suiteError_Fail;
}
inline State& state(PrGPUFilterInstance* instance){require(instance&&instance->ioPrivatePluginData,"Missing GPU instance");return *static_cast<State*>(instance->ioPrivatePluginData);}
inline PrParam param(State& s,const PrGPUFilterInstance& instance,int index,PrTime time){
 require(index>0,"Input is not a parameter");PrParam value{};
 require(!s.graph->GetParam(instance.inNodeID,index-1,time,&value),"GPU parameter unavailable");return value;
}
inline double number(const PrParam& p){
 double value=0;switch(p.mType){case kPrParamType_Float64:value=p.mFloat64;break;case kPrParamType_Float32:value=p.mFloat32;break;case kPrParamType_Int32:value=p.mInt32;break;default:throw std::invalid_argument("Numeric parameter type mismatch");}
 require(std::isfinite(value),"Nonfinite parameter");return value;
}
inline Color tint(const PrParam& p){
 require(p.mType==kPrParamType_Int64,"Color parameter must be verified Int64 transport");
 const auto bits=static_cast<std::uint64_t>(p.mInt64);
 const auto alpha=static_cast<std::uint16_t>(bits>>48),red=static_cast<std::uint16_t>(bits>>32),green=static_cast<std::uint16_t>(bits>>16),blue=static_cast<std::uint16_t>(bits);
 require(alpha<=65280&&red<=65280&&green<=65280&&blue<=65280,"Color lane exceeds verified host range");
 return {red/65280.0,green/65280.0,blue/65280.0,1};
}

// Host-observed GPU/MCP popup values are 0/1/2; PF popup controls use 1/2/3.
inline int bubbleMode(const PrParam& p){
 require(p.mType==kPrParamType_Int32,"Popup parameter type mismatch");
 require(p.mInt32>=0&&p.mInt32<=2,"GPU bubble popup outside verified range");
 return p.mInt32+1;
}
inline NativeWordControls wordControls(State& s,const PrGPUFilterInstance& i,PrTime time,int first,const PrGPUFilterRenderParams* renderParams=nullptr){
 auto read=[&](int index){return param(s,i,index,time);};NativeWordControls c;
 c.sizePercent=number(read(first));c.textTint=tint(read(first+1));c.opacityPercent=number(read(first+2));
 const auto popup=read(first+3);TraceData info;info.index=first+3;info.popupType=popup.mType;info.popupValue=popup.mType==kPrParamType_Int32?popup.mInt32:-1;trace(6,&i,renderParams,1,"bubble-popup",info);c.bubbleMode=bubbleMode(popup);
 c.bubbleTint=tint(read(first+4));c.bubbleOpacityPercent=number(read(first+5));c.paddingPercent=number(read(first+6));c.radiusPercent=number(read(first+7));return c;
}
struct Snapshot {Document document;LayoutBox box;std::size_t maxChars=56;double seconds=0;};
inline Snapshot snapshot(State& s,const PrGPUFilterInstance& i,const PrGPUFilterRenderParams& r){
 using namespace parameters;
 require(r.inRenderWidth>0&&r.inRenderHeight>0&&r.inRenderWidth<=8192&&r.inRenderHeight<=8192&&std::uint64_t(r.inRenderWidth)*r.inRenderHeight<=33554432,"Render dimensions exceed bounds");
 require(r.inRenderTicksPerFrame>0,"Missing timeline frame duration");
 csSDK_int32 count=0;require(!s.graph->GetParamCount(i.inNodeID,&count)&&count>=Transcript,"Incomplete caption parameters");
 // GetParam owns this pointer. Copy/normalize it BEFORE any further GetParam call.
 auto carrier=param(s,i,Transcript,r.inClipTime);require(carrier.mType==kPrParamType_PrMemoryPtr&&carrier.mMemoryPtr,"Caption carrier type mismatch");
 const auto size=s.memory->GetPtrSize(carrier.mMemoryPtr);require(size>0&&size<=kMaxCarrierBytes,"Caption carrier exceeds bounds");
 auto binary=normalizeCarrier(reinterpret_cast<const std::uint8_t*>(carrier.mMemoryPtr),size);
 Snapshot result;result.document=decode(binary);trace(7,&i,&r,1,"stage-document-decoded");
 auto point=param(s,i,Position,r.inClipTime);require(point.mType==kPrParamType_Point&&std::isfinite(point.mPoint.x)&&std::isfinite(point.mPoint.y),"Position parameter type mismatch");
 const double sx=r.inDownsampleFactorX,sy=r.inDownsampleFactorY;
 require(std::isfinite(sx)&&std::isfinite(sy)&&sx>0&&sy>0&&sx<=1&&sy<=1,"Invalid downsample scale");
 const double width=number(param(s,i,Width,r.inClipTime))*sx,height=number(param(s,i,Height,r.inClipTime))*sy;
 result.box={point.mPoint.x*r.inRenderWidth-width/2,point.mPoint.y*r.inRenderHeight-height/2,width,height};
 const double chars=number(param(s,i,MaxChars,r.inClipTime));require(chars>=1&&chars<=500&&std::floor(chars)==chars,"Invalid grouping count");result.maxChars=static_cast<std::size_t>(chars);
 trace(7,&i,&r,1,"stage-layout-controls");NativeAppearanceControls c;
 if(count>=Count-1){c.current=wordControls(s,i,r.inClipTime,CurrentSize,&r);c.spoken=wordControls(s,i,r.inClipTime,SpokenSize,&r);c.upcoming=wordControls(s,i,r.inClipTime,UpcomingSize,&r);}
 trace(7,&i,&r,1,"stage-word-controls");applyNativeStyle(result.document,number(param(s,i,Size,r.inClipTime)),tint(param(s,i,TextColor,r.inClipTime)),sx,sy,c);trace(7,&i,&r,1,"stage-style-applied");
 // No source-FPS assumption, 30fps conversion, rounding, or second animation clock.
 result.seconds=double(r.inClipTime)/double(s.ticksPerSecond)-result.document.timeOriginSeconds;
 require(std::isfinite(result.seconds),"Invalid media sample time");return result;
}
// CoreText is top-left; ordinary CPU PPix is lower-left. Preserve premultiplication
// by explicitly requesting BGRP8, rather than copying premult RGB into BGRA8.
inline void copyOverlay(const macos::Bitmap& bitmap,char* destination,std::int32_t stride){
 require(destination&&bitmap.width&&bitmap.height&&bitmap.width<=8192&&bitmap.height<=8192,"Missing or oversized overlay pixels");
 require(bitmap.stride>=bitmap.width*4&&bitmap.stride<=bitmap.pixels.size()/bitmap.height,"Invalid bitmap storage");
 const std::int64_t magnitude=stride<0?-std::int64_t(stride):stride;
 require(magnitude>=std::int64_t(bitmap.width*4),"Overlay stride too short");
 require(std::uint64_t(magnitude)*(bitmap.height-1)<=std::uint64_t(std::numeric_limits<std::ptrdiff_t>::max()),"Overlay stride overflow");
 for(std::size_t y=0;y<bitmap.height;++y){auto* dst=reinterpret_cast<std::uint8_t*>(destination+std::ptrdiff_t(y)*stride);const auto* src=bitmap.pixels.data()+(bitmap.height-1-y)*bitmap.stride;
  for(std::size_t x=0;x<bitmap.width;++x){dst[x*4]=src[x*4+2];dst[x*4+1]=src[x*4+1];dst[x*4+2]=src[x*4];dst[x*4+3]=src[x*4+3];}
 }
}
inline prSuiteError create(PrGPUFilterInstance* instance){
 try{require(instance&&instance->piSuites&&instance->piSuites->utilFuncs&&instance->piSuites->utilFuncs->getSPBasicSuite,"Missing plugin suites");
  instance->ioPrivatePluginData=nullptr;auto* basic=instance->piSuites->utilFuncs->getSPBasicSuite();
  instance->ioPrivatePluginData=new State(basic,instance->inDeviceIndex);trace(0,instance,nullptr,1,"ok");return suiteError_NoError;
 }catch(...){return failure(0,instance,nullptr);}
}
inline prSuiteError dispose(PrGPUFilterInstance* instance){if(!instance)return suiteError_InvalidParms;delete static_cast<State*>(instance->ioPrivatePluginData);instance->ioPrivatePluginData=nullptr;return suiteError_NoError;}
inline prSuiteError dependencies(PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* r,csSDK_int32* query,PrGPUFilterFrameDependency* dependency){
 TraceData info;info.index=query?*query:-1;
 try{(void)state(instance);require(r&&query&&dependency,"Missing dependency arguments");if(*query!=0){trace(2,instance,r,1,"no-additional-dependencies",info);return suiteError_NotImplemented;}
  require(r->inRenderWidth&&r->inRenderHeight&&r->inRenderWidth<=8192&&r->inRenderHeight<=8192&&std::uint64_t(r->inRenderWidth)*r->inRenderHeight<=33554432,"Invalid precompute dimensions");
  require(r->inRenderPARNum&&r->inRenderPARDen,"Invalid pixel aspect");*dependency={};dependency->outDependencyType=PrGPUDependency_Precompute;dependency->outSequenceTime=r->inSequenceTime;
  dependency->outPrecomputePixelFormat=PrPixelFormat_BGRP_4444_8u;dependency->outPrecomputeFrameWidth=r->inRenderWidth;dependency->outPrecomputeFrameHeight=r->inRenderHeight;
  dependency->outPrecomputeFramePARNumerator=r->inRenderPARNum;dependency->outPrecomputeFramePARDenominator=r->inRenderPARDen;dependency->outPrecomputeFrameFieldType=r->inRenderFieldType;info.cpuFormat=PrPixelFormat_BGRP_4444_8u;/* Sole dependency: leave query unchanged; increment only when another exists. */trace(2,instance,r,1,"ok",info);return suiteError_NoError;
 }catch(...){return failure(2,instance,r,info);}
}
inline prSuiteError precompute(PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* r,csSDK_int32 index,PPixHand frame){
 TraceData info;info.index=index;trace(3,instance,r,2,"enter",info);
 try{auto& s=state(instance);require(r&&frame&&index==0,"Invalid overlay precompute index");PrPixelFormat format{};prRect bounds{};csSDK_int32 stride=0;char* pixels=nullptr;
  const auto formatError=s.ppix->GetPixelFormat(frame,&format);info.cpuFormat=static_cast<unsigned>(format);require(!formatError&&format==PrPixelFormat_BGRP_4444_8u,"Unexpected precompute format");
  require(!s.ppix->GetBounds(frame,&bounds)&&bounds.left==0&&bounds.top==0&&bounds.right==int(r->inRenderWidth)&&bounds.bottom==int(r->inRenderHeight),"Unexpected precompute bounds");
  const auto pitchError=s.ppix->GetRowBytes(frame,&stride);info.cpuPitch=stride;require(!pitchError&&!s.ppix->GetPixels(frame,PrPPixBufferAccess_WriteOnly,&pixels)&&pixels,"Precompute buffer inaccessible");
  auto snap=snapshot(s,*instance,*r);trace(7,instance,r,1,"stage-snapshot-ready",info);auto bitmap=macos::rasterize(snap.document,snap.seconds,snap.box,r->inRenderWidth,r->inRenderHeight,snap.maxChars);trace(7,instance,r,1,"stage-raster-ready",info);copyOverlay(bitmap,pixels,stride);trace(3,instance,r,1,"ok",info);return suiteError_NoError;
 }catch(...){return failure(3,instance,r,info);}
}
struct GPUFrame {id<MTLBuffer> buffer=nil;std::uint32_t stride=0;bool half=false;};
inline GPUFrame gpuFrame(State& s,PPixHand frame,const PrGPUFilterRenderParams& r,unsigned device,PrPixelFormat* actual=nullptr,TraceData* traceData=nullptr,int role=0){
 require(frame,"Missing GPU frame");PrPixelFormat format{};prRect bounds{};csSDK_int32 stride=0;csSDK_uint32 frameDevice=0;void* pointer=nullptr;
 const auto formatError=s.ppix->GetPixelFormat(frame,&format);if(traceData){auto& field=role==0?traceData->inputFormat:role==1?traceData->overlayFormat:traceData->outputFormat;field=static_cast<unsigned>(format);}
 require(!formatError&&(format==PrPixelFormat_GPU_BGRA_4444_16f||format==PrPixelFormat_GPU_BGRA_4444_32f),"Unsupported GPU format");
 require(!s.ppix->GetBounds(frame,&bounds)&&bounds.left==0&&bounds.top==0&&bounds.right==int(r.inRenderWidth)&&bounds.bottom==int(r.inRenderHeight),"Unsupported GPU bounds");
 const bool half=format==PrPixelFormat_GPU_BGRA_4444_16f;
 const auto pitchError=s.ppix->GetRowBytes(frame,&stride);if(traceData){auto& field=role==0?traceData->inputPitch:role==1?traceData->overlayPitch:traceData->outputPitch;field=stride;}
 require(!pitchError&&stride>=std::int64_t(r.inRenderWidth)*(half?8:16)&&stride%(half?8:16)==0,"Invalid or misaligned GPU pitch");
 require(!s.gpu->GetGPUPPixDeviceIndex(frame,&frameDevice)&&frameDevice==device,"Cross-device frame rejected");
 require(!s.gpu->GetGPUPPixData(frame,&pointer)&&pointer,"Missing GPU allocation");
 auto buffer=(id<MTLBuffer>)pointer;require(buffer.length>=std::uint64_t(stride)*r.inRenderHeight,"GPU allocation shorter than frame");if(actual)*actual=format;
 return {buffer,static_cast<std::uint32_t>(stride),half};
}
inline prSuiteError render(PrGPUFilterInstance* instance,const PrGPUFilterRenderParams* r,const PPixHand* frames,csSDK_size_t frameCount,PPixHand* out){
 PPixHand owned=nullptr;TraceData info;info.count=static_cast<long long>(frameCount);trace(4,instance,r,2,"enter",info);
 try{auto& s=state(instance);require(r&&frames&&frameCount==2&&out,"Expected current input and one overlay dependency");
  PrPixelFormat inputFormat{};auto input=gpuFrame(s,frames[0],*r,instance->inDeviceIndex,&inputFormat,&info,0);auto overlay=gpuFrame(s,frames[1],*r,instance->inDeviceIndex,nullptr,&info,1);
  require(!s.gpu->CreateGPUPPix(instance->inDeviceIndex,inputFormat,r->inRenderWidth,r->inRenderHeight,r->inRenderPARNum,r->inRenderPARDen,r->inRenderFieldType,&owned)&&owned,"GPU output allocation failed");
  auto output=gpuFrame(s,owned,*r,instance->inDeviceIndex,nullptr,&info,2);CompositeParams p{r->inRenderWidth,r->inRenderHeight,input.stride,overlay.stride,output.stride,input.half,overlay.half,output.half,BC_GPU_OVERLAY_STRAIGHT,BC_GPU_INPUT_STRAIGHT,BC_GPU_OUTPUT_STRAIGHT};
  @autoreleasepool {
   id<MTLCommandBuffer> command=[(id<MTLCommandQueue>)s.device.outCommandQueueHandle commandBuffer];require(command!=nil,"Missing GPU command buffer");
   id<MTLComputeCommandEncoder> encoder=[command computeCommandEncoder];require(encoder!=nil,"Missing GPU encoder");
   [encoder setComputePipelineState:s.pipeline];[encoder setBuffer:input.buffer offset:0 atIndex:0];[encoder setBuffer:overlay.buffer offset:0 atIndex:1];[encoder setBuffer:output.buffer offset:0 atIndex:2];[encoder setBytes:&p length:sizeof(p) atIndex:3];
   const auto groupWidth=std::min<NSUInteger>(s.pipeline.threadExecutionWidth,32);const auto groupHeight=std::max<NSUInteger>(1,std::min<NSUInteger>(8,s.pipeline.maxTotalThreadsPerThreadgroup/groupWidth));
   [encoder dispatchThreads:MTLSizeMake(p.width,p.height,1) threadsPerThreadgroup:MTLSizeMake(groupWidth,groupHeight,1)];[encoder endEncoding];[command commit];
   // Prototype correctness first: synchronous completion retains dependencies and
   // exposes command errors; this is a known throughput cost, not final caching.
   [command waitUntilCompleted];require(command.status==MTLCommandBufferStatusCompleted,"Metal caption composite failed");
  }
  *out=owned;owned=nullptr;trace(4,instance,r,1,"ok",info);return suiteError_NoError;
 }catch(...){if(owned&&instance&&instance->ioPrivatePluginData)static_cast<State*>(instance->ioPrivatePluginData)->ppix->Dispose(owned);return failure(4,instance,r,info);}
}
} // namespace better_captions::adobe::gpu_caption_renderer
extern "C" __attribute__((visibility("default"))) prSuiteError xGPUFilterEntry(csSDK_uint32 version,csSDK_int32* index,prBool startup,piSuitesPtr,PrGPUFilter* filter,PrGPUFilterInfo* info){
 using namespace better_captions::adobe::gpu_caption_renderer;
 if(!startup)return suiteError_NoError;
 if(version<PrSDKGPUFilterInterfaceVersion||!index||*index!=0||!filter||!info)return suiteError_InvalidParms;
 *filter={};filter->CreateInstance=create;filter->DisposeInstance=dispose;filter->GetFrameDependencies=dependencies;filter->Precompute=precompute;filter->Render=render;
 *info={};info->outInterfaceVersion=PrSDKGPUFilterInterfaceVersion;return suiteError_NoError;
}
