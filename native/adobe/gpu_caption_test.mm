#ifdef NDEBUG
#undef NDEBUG // Keep test checks enabled for optimized builds.
#endif
// Original local test; no Adobe implementation source or host calls.
#include "gpu_caption_renderer.hpp"
#include <array>
#include <cassert>
#include <iostream>
using namespace better_captions;
using namespace better_captions::adobe::gpu_caption_renderer;
template<class F>void rejects(F f){bool bad=false;try{f();}catch(...){bad=true;}assert(bad);}
int main(int argc,char** argv){
 if(argc!=2){std::cerr<<"Usage: gpu_caption_test /absolute/path/CaptionComposite.metallib\n";return 2;}
 @autoreleasepool {
 // BGRP8 copy has explicit CPU lower-left origin, signed stride and premult data.
 macos::Bitmap b{2,2,8,{255,0,0,255, 0,64,0,128, 0,0,32,64, 1,2,3,4},false};
 for(int stride:{12,-12}){std::array<unsigned char,48> bytes;bytes.fill(0xa5);auto* base=bytes.data()+(stride<0?20:8);copyOverlay(b,reinterpret_cast<char*>(base),stride);
  assert(base[0]==32&&base[1]==0&&base[2]==0&&base[3]==64);assert(base[stride]==0&&base[stride+2]==255&&base[stride+3]==255);
  std::array<bool,48> touched{};for(int y=0;y<2;++y)for(int x=0;x<8;++x)touched[(base-bytes.data())+y*stride+x]=true;for(unsigned i=0;i<48;++i)if(!touched[i])assert(bytes[i]==0xa5);
 }
 rejects([&]{copyOverlay(b,nullptr,8);});rejects([&]{copyOverlay(b,reinterpret_cast<char*>(b.pixels.data()),7);});auto shortBitmap=b;shortBitmap.pixels.pop_back();rejects([&]{copyOverlay(shortBitmap,reinterpret_cast<char*>(b.pixels.data()),8);});
 PrParam param{};param.mType=kPrParamType_Float32;param.mFloat32=7.5;assert(number(param)==7.5);param.mType=kPrParamType_Float64;param.mFloat64=1.0/3;assert(number(param)==1.0/3);param.mType=kPrParamType_Point;rejects([&]{number(param);});param.mType=kPrParamType_Int32;param.mInt32=-1;rejects([&]{tint(param);});
 struct Observed {std::uint64_t bits;double r,g,b;};
 for(const auto& sample:std::array<Observed,5>{{{0xff00ff00ff00ff00ULL,1,1,1},{0xff00ff0000000000ULL,1,0,0},{0xff000000ff000000ULL,0,1,0},{0xff0000000000ff00ULL,0,0,1},{0xff0011002b005b00ULL,17/255.0,43/255.0,91/255.0}}}){
  param.mType=kPrParamType_Int64;param.mInt64=static_cast<std::int64_t>(sample.bits);auto color=tint(param);assert(color.r==sample.r&&color.g==sample.g&&color.b==sample.b&&color.a==1);
 }
 for(std::uint64_t unsupported:{0xffff000000000000ULL,0x0000ffff00000000ULL,0x00000000ffff0000ULL,0x000000000000ffffULL}){param.mType=kPrParamType_Int64;param.mInt64=static_cast<std::int64_t>(unsupported);rejects([&]{tint(param);});}
 param.mType=kPrParamType_Int64;param.mInt64=0x000011002b005b00LL;assert(tint(param).a==1); // Host tint alpha is deliberately ignored.

 // Verified GPU popup indexing differs from the PF CPU representation.
 for(int value=0;value<=2;++value){param.mType=kPrParamType_Int32;param.mInt32=value;assert(bubbleMode(param)==value+1);}
 for(int value:{-1,3,2147483647}){param.mType=kPrParamType_Int32;param.mInt32=value;rejects([&]{bubbleMode(param);});}
 // Native integer sliders interpolate floating samples between keyframes.
 // Extraction shares the exact CPU rounding/clamping policy instead of failing
 // the GPU callback (and displaying a black Program Monitor frame).
 param.mType=kPrParamType_Float64;param.mFloat64=1.5;assert(sampledGroupsPerPage(number(param))==2);
 param.mFloat64=2.49;assert(sampledGroupsPerPage(number(param))==2);
 param.mFloat64=2.5;assert(sampledGroupsPerPage(number(param))==3);
 param.mFloat64=101;assert(sampledGroupsPerPage(number(param))==100);
 param.mFloat64=.49;assert(!sampledSmartLineFit(number(param)));param.mFloat64=.5;assert(sampledSmartLineFit(number(param)));
 param.mFloat64=2.7;const auto rollSample=sampledRollUpSettings(1,number(param),.18,1,0,.35,1,1.5,3.5,1,.5);
 assert(rollSample.enabled&&rollSample.visibleLines==3&&rollSample.transitionCurve==2&&rollSample.direction==4&&rollSample.waitForLine);
 assert(sampledRollUpSettings(1,2,.18,1,0,.35,1,2,1,1,1,3.5).transition==4);
 param.mFloat64=1.49;assert(sampledTextAlignment(number(param))==1);param.mFloat64=1.5;assert(sampledTextAlignment(number(param))==2);param.mFloat64=2.5;assert(sampledTextAlignment(number(param))==3);
 param.mType=kPrParamType_Int64;param.mInt64=0;rejects([&]{bubbleMode(param);});
 // Host-observed divisor normalization must preserve full/half/quarter caption
 // selection, grouping, wrapping and pixel-sized styles without mutating source.
 Document previewSource;previewSource.containers.push_back({"preview",false,{{"Caption",0,1,false},{"reflow",1,2,false},{"checks",2,3,false}}});
 previewSource.timeOriginSeconds=3600;
 for(auto* style:{&previewSource.style.current,&previewSource.style.upcoming,&previewSource.style.spoken}){
  style->fontSize=64;style->padding=10;style->radius=14;style->outlineWidth=2;style->shadowBlur=4;style->shadowX=6;style->shadowY=8;
 }
 previewSource.style.current.bubble=true;previewSource.style.current.bubbleColor={0,.8,.2,1};
 const auto originalPreviewBytes=encode(previewSource);
 auto near=[](double a,double b){assert(std::abs(a-b)<1e-8);};
 auto measured=[](const std::string& text,const WordStyle& style){double font=style.fontSize*style.sizeScale;return Metrics{text.size()*font*.5,font*.8,font*.2};};
 for(double time:{.5,1.5,2.5}){
  auto fullGeometry=previewGeometry(1,1,.5,.75,400,220,1280,720);
  auto fullDoc=previewSource;better_captions::adobe::applyNativeStyle(fullDoc,64,{1,1,1,1},fullGeometry.sx,fullGeometry.sy);
  const auto fullFrame=layoutFrame(fullDoc,time,fullGeometry.box,measured);
  const auto fullGroups=regroup(fullDoc,56);
  for(unsigned divisor:{1u,2u,4u}){
   const auto geometry=previewGeometry(divisor,divisor,.5,.75,400,220,1280/divisor,720/divisor);
   auto scaledDoc=previewSource;better_captions::adobe::applyNativeStyle(scaledDoc,64,{1,1,1,1},geometry.sx,geometry.sy);
   const auto scaledFrame=layoutFrame(scaledDoc,time,geometry.box,measured);
   near(geometry.box.x*divisor,fullGeometry.box.x);near(geometry.box.y*divisor,fullGeometry.box.y);near(geometry.box.width*divisor,400);near(geometry.box.height*divisor,220);
   assert(scaledFrame.words.size()==3&&scaledFrame.overflow==fullFrame.overflow);
   for(std::size_t index=0;index<scaledFrame.words.size();++index){const auto& run=scaledFrame.words[index];const auto& baseRun=fullFrame.words[index];
    assert(run.wordIndex==baseRun.wordIndex&&run.state==baseRun.state&&run.text==baseRun.text);
    near(run.x*divisor,baseRun.x);near(run.baseline*divisor,baseRun.baseline);near(run.width*divisor,baseRun.width);
    near(run.style.fontSize*divisor,64);near(run.style.padding*divisor,10);near(run.style.radius*divisor,14);near(run.style.outlineWidth*divisor,2);near(run.style.shadowBlur*divisor,4);near(run.style.shadowX*divisor,6);near(run.style.shadowY*divisor,8);
   }
   near(scaledDoc.style.wordSpacing*divisor,previewSource.style.wordSpacing);
   auto scaledGroups=regroup(scaledDoc,56);assert(scaledGroups.size()==fullGroups.size());for(std::size_t index=0;index<scaledGroups.size();++index)assert(scaledGroups[index].containerId==fullGroups[index].containerId&&scaledGroups[index].firstWord==fullGroups[index].firstWord&&scaledGroups[index].wordCount==fullGroups[index].wordCount);
   auto actual=macos::rasterize(scaledDoc,time,geometry.box,1280/divisor,720/divisor);bool visible=false;for(std::size_t index=3;index<actual.pixels.size();index+=4)visible=visible||actual.pixels[index]!=0;assert(visible);
  }
 }
 assert(encode(previewSource)==originalPreviewBytes);
 // Fractional divisors are valid; do not round them or assume power-of-two.
 auto fractional=previewGeometry(1.5,1.5,.25,.75,600,180,854,480);near(fractional.sx,2.0/3);near(fractional.box.width,400);near(fractional.box.height,120);near(fractional.box.x,13.5);near(fractional.box.y,300);
 // Independent divisor/box scales retain the existing SY font vs SX spacing
 // contract, without asserting anisotropic glyph/PAR rendering acceptance.
 auto anisotropic=previewGeometry(2,4,.5,.75,400,220,640,180);near(anisotropic.box.x,220);near(anisotropic.box.y,107.5);near(anisotropic.box.width,200);near(anisotropic.box.height,55);
 auto anisotropicDoc=previewSource;better_captions::adobe::applyNativeStyle(anisotropicDoc,64,{1,1,1,1},anisotropic.sx,anisotropic.sy);near(anisotropicDoc.style.current.fontSize,16);near(anisotropicDoc.style.current.padding,2.5);near(anisotropicDoc.style.current.outlineWidth,.5);near(anisotropicDoc.style.current.shadowX,3);near(anisotropicDoc.style.current.shadowY,2);near(anisotropicDoc.style.wordSpacing,6);
 for(double invalid:{0.,-1.,.5,std::numeric_limits<double>::infinity(),std::numeric_limits<double>::quiet_NaN()}){rejects([&]{previewGeometry(invalid,1,.5,.75,400,220,1280,720);});rejects([&]{previewGeometry(1,invalid,.5,.75,400,220,1280,720);});}
 rejects([&]{previewGeometry(1,1,.5,.75,400,220,0,720);});rejects([&]{previewGeometry(1,1,.5,.75,400,220,8193,1);});rejects([&]{previewGeometry(1,1,.5,.75,400,220,8192,8192);});
 rejects([&]{previewGeometry(1,1,.5,.75,0,220,1280,720);});rejects([&]{previewGeometry(1,1,std::numeric_limits<double>::infinity(),.75,400,220,1280,720);});
 (void)previewGeometry(1,1,.5,.5,400,220,8192,4096); // Existing pixel-count cap boundary.
 // Shader reference accepts premult overlay, all mixed16/32f combinations and
 // padded pitches. Sentinel padding and no-opacity RGB identity are checked.
 auto device=MTLCreateSystemDefaultDevice();assert(device);NSError* error=nil;
 auto library=[device newLibraryWithURL:[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]] error:&error];assert(library);auto function=[library newFunctionWithName:@"captionComposite"];assert(function);auto pipeline=[device newComputePipelineStateWithFunction:function error:&error];assert(pipeline);auto queue=[device newCommandQueue];assert(queue);
 // Independently vary foreground/input/output association, CPU-reference alpha,
 // and half/float buffers. Read back actual quantized input for a fair reference.
 for(unsigned ih:{0u,1u})for(unsigned oh:{0u,1u})for(unsigned straight:{0u,1u})
 for(unsigned inputStraight:{0u,1u})for(unsigned outputStraight:{0u,1u})
 for(float bgAlpha:{0.f,.25f,1.f})for(float fgAlpha:{0.f,.5f,1.f}){
  unsigned inputPitch=2*(ih?8:16)+16,overlayPitch=2*(oh?8:16)+16;
  CompositeParams p{2,2,inputPitch,overlayPitch,inputPitch,ih,oh,ih,straight,inputStraight,outputStraight};
  auto input=[device newBufferWithLength:inputPitch*2 options:MTLResourceStorageModeShared];auto overlay=[device newBufferWithLength:overlayPitch*2 options:MTLResourceStorageModeShared];auto output=[device newBufferWithLength:inputPitch*2 options:MTLResourceStorageModeShared];memset(input.contents,0,input.length);memset(overlay.contents,0,overlay.length);memset(output.contents,0xa5,output.length);
  auto write=[](id<MTLBuffer> buffer,unsigned pitch,bool half,unsigned x,unsigned y,unsigned c,float v){if(half)reinterpret_cast<_Float16*>((char*)buffer.contents+y*pitch)[x*4+c]=v;else reinterpret_cast<float*>((char*)buffer.contents+y*pitch)[x*4+c]=v;};
  auto read=[](id<MTLBuffer> buffer,unsigned pitch,bool half,unsigned x,unsigned y,unsigned c){return half?float(reinterpret_cast<_Float16*>((char*)buffer.contents+y*pitch)[x*4+c]):reinterpret_cast<float*>((char*)buffer.contents+y*pitch)[x*4+c];};
  for(unsigned y=0;y<2;++y)for(unsigned x=0;x<2;++x){
   float bg[]={.2f,.4f,1.2f,bgAlpha};float alpha=x?0:fgAlpha;float fg[]={.8f,.2f,0.f,alpha};
   for(unsigned c=0;c<3;++c){if(bgAlpha==0)bg[c]=0;else if(!inputStraight)bg[c]*=bgAlpha;if(alpha==0)fg[c]=0;else if(!straight)fg[c]*=alpha;}
   for(unsigned c=0;c<4;++c){write(input,inputPitch,ih,x,y,c,bg[c]);write(overlay,overlayPitch,oh,x,y,c,fg[c]);}
  }
  auto command=[queue commandBuffer];auto enc=[command computeCommandEncoder];[enc setComputePipelineState:pipeline];[enc setBuffer:input offset:0 atIndex:0];[enc setBuffer:overlay offset:0 atIndex:1];[enc setBuffer:output offset:0 atIndex:2];[enc setBytes:&p length:sizeof(p) atIndex:3];[enc dispatchThreads:MTLSizeMake(2,2,1) threadsPerThreadgroup:MTLSizeMake(2,2,1)];[enc endEncoding];[command commit];[command waitUntilCompleted];assert(command.status==MTLCommandBufferStatusCompleted);
  for(unsigned y=0;y<2;++y)for(unsigned x=0;x<2;++x){
   float a=read(overlay,overlayPitch,oh,x,y,3),ba=read(input,inputPitch,ih,x,y,3),outAlpha=a+ba*(1-a);
   for(unsigned c=0;c<4;++c){
    float bg=read(input,inputPitch,ih,x,y,c),fg=read(overlay,overlayPitch,oh,x,y,c),expected=outAlpha;
    if(c<3){if(a==0&&inputStraight==outputStraight)expected=bg;else{expected=(straight?fg*a:fg)+(inputStraight?bg*ba:bg)*(1-a);if(outputStraight)expected=outAlpha>0?expected/outAlpha:0;}}
    float actual=read(output,inputPitch,ih,x,y,c);assert(std::abs(actual-expected)<.003);
   }
   if(a==0&&inputStraight==outputStraight)assert(!std::memcmp((char*)input.contents+y*inputPitch+x*(ih?8:16),(char*)output.contents+y*inputPitch+x*(ih?8:16),ih?8:16));
   for(unsigned k=2*(ih?8:16);k<inputPitch;++k)assert(((unsigned char*)output.contents)[y*inputPitch+k]==0xa5);
  }
  [input release];[overlay release];[output release];
 }

 [queue release];[pipeline release];[function release];[library release];[device release];
 std::cout<<"GPU caption local checks passed: observed Int64 host colors/type/range rejection; actual Metal mixed half/float source-over, independently straight/premult foreground/input/output and transparent/partial/opaque alpha reference, unclamped exact input identity, padded pitches; CPU origin/swizzle/signed strides and malformed storage rejection. Not host upload/dispatch proof.\n";
}}
