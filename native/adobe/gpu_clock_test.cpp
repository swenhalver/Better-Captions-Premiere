#include <PrSDKGPUFilter.h>
#include <dlfcn.h>
#include <stdexcept>
#include <iostream>
void check(bool ok){if(!ok)throw std::runtime_error("GPU clock ABI diagnostic failed");}
int main(int argc,char** argv){try{check(argc==2);void* binary=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(binary);auto entry=reinterpret_cast<PrGPUFilterEntry>(dlsym(binary,PrGPUFilterEntryPointName));check(entry);
 csSDK_int32 index=0;PrGPUFilter filter{};PrGPUFilterInfo info{};check(entry(PrSDKGPUFilterInterfaceVersion,&index,1,nullptr,&filter,&info)==0);check(info.outInterfaceVersion==2&&filter.CreateInstance&&filter.Render&&filter.GetFrameDependencies);
 check(filter.CreateInstance(nullptr)!=0);PrGPUFilterInstance instance{};check(filter.CreateInstance(&instance)==0&&!instance.ioPrivatePluginData&&!instance.outIsRealtime);
 PrGPUFilterRenderParams params{};params.inClipTime=123;params.inSequenceTime=456;params.inRenderTicksPerFrame=789;PrGPUFilterFrameDependency dependency{};check(filter.GetFrameDependencies(&instance,&params,&index,&dependency)==suiteError_NotImplemented);
 PPixHand output=reinterpret_cast<PPixHand>(1);check(filter.Render(&instance,&params,nullptr,0,&output)==suiteError_NotImplemented&&!output);check(filter.DisposeInstance(&instance)==0);
 index=1;check(entry(2,&index,1,nullptr,&filter,&info)!=0);check(entry(2,nullptr,0,nullptr,nullptr,nullptr)==0);dlclose(binary);std::cout<<"GPU companion ABI passed: version, callbacks, unsupported render without fake output; not host dispatch proof.\n";return 0;
 }catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
