#include "gpu_clock_diagnostics.hpp"
#include <dlfcn.h>
#include <stdexcept>
#include <iostream>
void check(bool ok){if(!ok)throw std::runtime_error("GPU clock ABI diagnostic failed");}
int main(int argc,char** argv){try{check(argc==2);void* binary=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(binary);auto entry=reinterpret_cast<PrGPUFilterEntry>(dlsym(binary,PrGPUFilterEntryPointName));check(entry);
 csSDK_int32 index=0;PrGPUFilter filter{};PrGPUFilterInfo info{};check(entry(PrSDKGPUFilterInterfaceVersion,&index,1,nullptr,&filter,&info)==0);check(info.outInterfaceVersion==2&&filter.CreateInstance&&filter.Render&&filter.GetFrameDependencies);
 check(filter.CreateInstance(nullptr)!=0);PrGPUFilterInstance instance{};
 for(prBool realtime:{0,1}){instance.outIsRealtime=realtime;check(filter.CreateInstance(&instance)==0&&!instance.ioPrivatePluginData&&instance.outIsRealtime==realtime);check(filter.DisposeInstance(&instance)==0);}
 instance.outIsRealtime=1;check(filter.CreateInstance(&instance)==0&&instance.outIsRealtime==1);
 PrGPUFilterRenderParams params{};params.inClipTime=123;params.inSequenceTime=456;params.inRenderTicksPerFrame=789;PrGPUFilterFrameDependency dependency{};check(filter.GetFrameDependencies(&instance,&params,&index,&dependency)==suiteError_NotImplemented);
 PPixHand output=reinterpret_cast<PPixHand>(1);check(filter.Render(&instance,&params,nullptr,0,&output)==suiteError_NotImplemented&&!output);check(filter.DisposeInstance(&instance)==0);
 // Exercise the same pure helper used before the next host GetParam call.
 using namespace better_captions;using namespace better_captions::adobe::gpu_clock_probe;
 Document document;document.timeOriginSeconds=3600;CaptionContainer container;container.id="numeric-probe";container.words.push_back({"x",0,1,false});document.containers.push_back(container);
 const auto encoded=encode(document);check(encoded.size()>=8&&encoded[4]==3);const char digits[]="0123456789abcdef";std::string text="BCDOC1:";for(auto byte:encoded){text+=digits[byte>>4];text+=digits[byte&15];}
 std::vector<unsigned char> carrier;for(auto character:text){carrier.push_back(static_cast<unsigned char>(character));carrier.push_back(0);}
 const auto plain=carrierMetadata(carrier.data(),carrier.size());check(plain.decoded&&plain.schema==3&&plain.origin==3600&&plain.words==1&&plain.normalizedBytes==carrier.size());
 carrier.push_back(0);carrier.push_back(0);const auto terminated=carrierMetadata(carrier.data(),carrier.size());check(terminated.decoded&&terminated.fingerprint==plain.fingerprint&&terminated.normalizedBytes==plain.normalizedBytes);
 const auto raw=carrierMetadata(encoded.data(),encoded.size());check(raw.decoded&&raw.schema==3&&raw.origin==3600&&raw.words==1);
 carrier[14]='!';const auto malformed=carrierMetadata(carrier.data(),carrier.size());check(!malformed.decoded&&malformed.fingerprint!=plain.fingerprint);
 carrier[14]='0';carrier[15]=1;check(!carrierMetadata(carrier.data(),carrier.size()).decoded);check(!carrierMetadata(nullptr,0).decoded);check(!carrierMetadata(reinterpret_cast<const unsigned char*>(1),16*1024*1024+1).decoded);
 index=1;check(entry(2,&index,1,nullptr,&filter,&info)!=0);check(entry(2,nullptr,0,nullptr,nullptr,nullptr)==0);dlclose(binary);std::cout<<"GPU diagnostic passed: realtime0/1 preserved, unsupported render without fake output, carrier BCAP3/NUL/fingerprint/malformed bounds; not host dispatch proof.\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
