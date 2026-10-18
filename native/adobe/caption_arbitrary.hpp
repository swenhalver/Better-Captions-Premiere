#pragma once
// Uses only actual Adobe host handle callbacks. Persist portable encoded bytes,
// never a C++ allocation address. The panel transport remains a separate probe.
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "../core/caption_core.hpp"
#include <cstring>
#include <stdexcept>

namespace better_captions::adobe {
inline std::vector<std::uint8_t> bytes(PF_InData* in_data,PF_ArbitraryH handle) {
 if(!handle)throw std::invalid_argument("Missing caption document");
 const auto size=PF_GET_HANDLE_SIZE(handle);
 if(size<=0||size>kMaxDocumentBytes)throw std::invalid_argument("Invalid caption document size");
 const auto* p=static_cast<const std::uint8_t*>(PF_LOCK_HANDLE(handle));
 if(!p)throw std::bad_alloc();
 try {std::vector<std::uint8_t> result(p,p+size);PF_UNLOCK_HANDLE(handle);return result;}
 catch(...){PF_UNLOCK_HANDLE(handle);throw;}
}
inline PF_ArbitraryH make(PF_InData* in_data,const std::vector<std::uint8_t>& data) {
 (void)decode(data); // validate schema, bounds and contents before allocation
 auto handle=reinterpret_cast<PF_ArbitraryH>(PF_NEW_HANDLE(data.size()));
 if(!handle)throw std::bad_alloc();
 void* p=PF_LOCK_HANDLE(handle);if(!p){PF_DISPOSE_HANDLE(handle);throw std::bad_alloc();}
 std::memcpy(p,data.data(),data.size());PF_UNLOCK_HANDLE(handle);return handle;
}
inline std::string printable(const std::vector<std::uint8_t>& data) {
 static constexpr char digits[]="0123456789abcdef";
 std::string result="BCDOC1:";result.reserve(7+data.size()*2);
 for(auto value:data){result+=digits[value>>4];result+=digits[value&15];}return result;
}
inline std::vector<std::uint8_t> scan(const char* data,std::size_t size) {
 if(size&&data[size-1]==0)--size;
 if(size<7||size>7+kMaxDocumentBytes*2||std::memcmp(data,"BCDOC1:",7)||(size-7)%2)throw std::invalid_argument("Invalid caption document text");
 auto nibble=[](char c)->unsigned{if(c>='0'&&c<='9')return c-'0';if(c>='a'&&c<='f')return c-'a'+10;throw std::invalid_argument("Invalid hex");};
 std::vector<std::uint8_t> result;result.reserve((size-7)/2);
 for(std::size_t i=7;i<size;i+=2)result.push_back(static_cast<std::uint8_t>(nibble(data[i])*16+nibble(data[i+1])));
 (void)decode(result);return result;
}
inline PF_Err arbitrary(PF_InData* in_data,PF_ArbParamsExtra* extra,const Document& defaults) {
 if(!extra||!in_data||!in_data->utils)return PF_Err_BAD_CALLBACK_PARAM;
 try {
  auto read=[&](PF_ArbitraryH h){return h?bytes(in_data,h):encode(defaults);};
  switch(extra->which_function){
   case PF_Arbitrary_NEW_FUNC:*extra->u.new_func_params.arbPH=make(in_data,encode(defaults));break;
   case PF_Arbitrary_DISPOSE_FUNC:if(extra->u.dispose_func_params.arbH)PF_DISPOSE_HANDLE(extra->u.dispose_func_params.arbH);break;
   case PF_Arbitrary_COPY_FUNC:*extra->u.copy_func_params.dst_arbPH=make(in_data,read(extra->u.copy_func_params.src_arbH));break;
   case PF_Arbitrary_FLAT_SIZE_FUNC:*extra->u.flat_size_func_params.flat_data_sizePLu=static_cast<A_u_long>(read(extra->u.flat_size_func_params.arbH).size());break;
   case PF_Arbitrary_FLATTEN_FUNC:{auto& p=extra->u.flatten_func_params;auto data=read(p.arbH);if(!p.flat_dataPV||p.buf_sizeLu<data.size())return PF_Err_BAD_CALLBACK_PARAM;std::memcpy(p.flat_dataPV,data.data(),data.size());break;}
   case PF_Arbitrary_UNFLATTEN_FUNC:{auto& p=extra->u.unflatten_func_params;if(!p.flat_dataPV||p.buf_sizeLu>kMaxDocumentBytes)return PF_Err_BAD_CALLBACK_PARAM;const auto* b=static_cast<const std::uint8_t*>(p.flat_dataPV);*p.arbPH=make(in_data,{b,b+p.buf_sizeLu});break;}
   case PF_Arbitrary_INTERP_FUNC:{auto& p=extra->u.interp_func_params;*p.interpPH=make(in_data,read(p.tF<1?p.left_arbH:p.right_arbH));break;}
   case PF_Arbitrary_COMPARE_FUNC:{auto& p=extra->u.compare_func_params;*p.compareP=read(p.a_arbH)==read(p.b_arbH)?PF_ArbCompare_EQUAL:PF_ArbCompare_NOT_EQUAL;break;}
   case PF_Arbitrary_PRINT_SIZE_FUNC:{auto& p=extra->u.print_size_func_params;*p.print_sizePLu=static_cast<A_u_long>(printable(read(p.arbH)).size()+1);break;}
   case PF_Arbitrary_PRINT_FUNC:{auto& p=extra->u.print_func_params;auto text=printable(read(p.arbH));if(!p.print_bufferPC||p.print_sizeLu<text.size()+1)return PF_Err_BAD_CALLBACK_PARAM;std::memcpy(p.print_bufferPC,text.c_str(),text.size()+1);break;}
   case PF_Arbitrary_SCAN_FUNC:{auto& p=extra->u.scan_func_params;if(!p.bufPC)return PF_Err_BAD_CALLBACK_PARAM;*p.arbPH=make(in_data,scan(p.bufPC,p.bytes_to_scanLu));break;}
   default:return PF_Err_BAD_CALLBACK_PARAM;
  }
  return PF_Err_NONE;
 }catch(const std::bad_alloc&){return PF_Err_OUT_OF_MEMORY;}
 catch(...){return PF_Err_BAD_CALLBACK_PARAM;}
}
}
