#include "caption_arbitrary.hpp"
#include <cstdlib>
#include <iostream>
#include <map>
#include <stdexcept>
namespace {
std::map<PF_Handle,A_u_longlong> allocations;
PF_Handle allocate(A_u_longlong size){auto h=static_cast<PF_Handle>(std::malloc(sizeof(void*)));if(!h)return nullptr;*h=static_cast<char*>(std::malloc(size));if(!*h){std::free(h);return nullptr;}allocations[h]=size;return h;}
void* lock(PF_Handle h){return *h;}
void unlock(PF_Handle){}
void dispose(PF_Handle h){allocations.erase(h);std::free(*h);std::free(h);}
A_u_longlong size(PF_Handle h){return allocations.at(h);}
void check(bool value){if(!value)throw std::runtime_error("Arbitrary callback test failed");}
}
int main(){try{
 _PF_UtilCallbacks utils{};utils.host_new_handle=allocate;utils.host_lock_handle=lock;utils.host_unlock_handle=unlock;utils.host_dispose_handle=dispose;utils.host_get_handle_size=size;
 PF_InData in{};in.utils=&utils;better_captions::Document doc;doc.containers.push_back({"fixture",false,{{"Hello",0,1,false},{"world",1,2,true}}});
 PF_ArbitraryH original=nullptr,copy=nullptr,reopened=nullptr;PF_ArbParamsExtra e{};
 auto call=[&](PF_FunctionSelector selector){e.which_function=selector;return better_captions::adobe::arbitrary(&in,&e,doc);};
 e.u.new_func_params.arbPH=&original;check(call(PF_Arbitrary_NEW_FUNC)==0);
 e.u.copy_func_params.src_arbH=original;e.u.copy_func_params.dst_arbPH=&copy;check(call(PF_Arbitrary_COPY_FUNC)==0);check(copy!=original);
 A_u_long length=0;e.u.flat_size_func_params.arbH=original;e.u.flat_size_func_params.flat_data_sizePLu=&length;check(call(PF_Arbitrary_FLAT_SIZE_FUNC)==0);
 std::vector<std::uint8_t> flat(length);e.u.flatten_func_params={nullptr,original,length,flat.data()};check(call(PF_Arbitrary_FLATTEN_FUNC)==0);
 e.u.unflatten_func_params={nullptr,length,flat.data(),&reopened};check(call(PF_Arbitrary_UNFLATTEN_FUNC)==0);check(better_captions::adobe::bytes(&in,reopened)==flat);
 auto text=better_captions::adobe::printable(flat);check(better_captions::adobe::scan(text.data(),text.size())==flat);
 auto corrupt=flat;corrupt[0]^=0xff;PF_ArbitraryH rejected=nullptr;e.u.unflatten_func_params={nullptr,length,corrupt.data(),&rejected};check(call(PF_Arbitrary_UNFLATTEN_FUNC)!=0);check(rejected==nullptr);
 PF_ArbCompareResult result=PF_ArbCompare_NOT_EQUAL;e.u.compare_func_params={nullptr,original,reopened,&result};check(call(PF_Arbitrary_COMPARE_FUNC)==0&&result==PF_ArbCompare_EQUAL);
 for(auto h:{original,copy,reopened}){e.u.dispose_func_params={nullptr,h};check(call(PF_Arbitrary_DISPOSE_FUNC)==0);}check(allocations.empty());
 std::cout<<"Arbitrary callbacks passed: host handles, copy, flatten/reopen, printable scan, malformed rejection, dispose. Not Premiere persistence proof.\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
