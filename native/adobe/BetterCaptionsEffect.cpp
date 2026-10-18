// Original experimental adapter; Adobe declarations are included from a local SDK.
#include "AEConfig.h"
#include "entry.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "../macos/caption_rasterizer.hpp"
#include "caption_arbitrary.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace {
// Disk IDs are permanent even if UI ordering changes. This prototype is demo-only.
enum Param { Input, Position, Width, Height, MaxChars, Size, TextColor, Transcript, Count };
enum DiskId { PositionId=1, WidthId=2, HeightId=3, MaxCharsId=4, SizeId=5, ColorId=6, TranscriptId=7 };
better_captions::Document demo();
PF_Err parameters(PF_InData* in_data, PF_OutData* out_data) {
 PF_ParamDef def{};
 PF_ADD_POINT("Position",50,75,FALSE,PositionId);
 PF_ADD_FLOAT_SLIDERX("Width",1,8192,1,3840,1536,PF_Precision_TENTHS,0,0,WidthId);
 PF_ADD_FLOAT_SLIDERX("Height",1,8192,1,2160,300,PF_Precision_TENTHS,0,0,HeightId);
 PF_ADD_FLOAT_SLIDERX("Characters per caption",1,500,1,100,56,PF_Precision_INTEGER,0,0,MaxCharsId);
 PF_ADD_FLOAT_SLIDERX("Font size",1,512,1,200,64,PF_Precision_TENTHS,0,0,SizeId);
 std::memset(&def,0,sizeof(def));PF_ADD_COLOR("Text color",255,255,255,ColorId);
 std::memset(&def,0,sizeof(def));
 auto defaultDocument=better_captions::adobe::make(in_data,better_captions::encode(demo()));
 PF_ADD_ARBITRARY2("Caption document (experimental)",0,0,PF_ParamFlag_CANNOT_TIME_VARY,PF_PUI_NO_ECW_UI,defaultDocument,TranscriptId,nullptr);
 out_data->num_params=Count;return PF_Err_NONE;
}
better_captions::Document demo() {
 using namespace better_captions;
 Document d;CaptionContainer c;c.id="native-probe-demo";
 const char* words[]={"Better","Captions","renders","inside","Premiere.","Change","width","to","reflow","this","caption.","Native","controls","animate","the","box."};
 double time=0;for(const char* text:words){c.words.push_back({text,time,time+0.45,false});time+=0.5;}d.containers.push_back(c);
 d.style.current.bubble=true;d.style.current.bubbleColor={0.1,0.2,0.8,0.9};
 d.style.spoken.opacity=0.65;return d;
}
PF_Err render(PF_InData* in_data, PF_ParamDef* params[], PF_LayerDef* output) {
 using namespace better_captions;
 if(!output||!output->data||output->width<=0||output->height<=0||PF_WORLD_IS_DEEP(output))return PF_Err_BAD_CALLBACK_PARAM;
 const auto& input=params[Input]->u.ld;
 const double sx=in_data->downsample_x.den?double(in_data->downsample_x.num)/in_data->downsample_x.den:1;
 const double sy=in_data->downsample_y.den?double(in_data->downsample_y.num)/in_data->downsample_y.den:1;
 const double width=params[Width]->u.fs_d.value*sx,height=params[Height]->u.fs_d.value*sy;
 const double x=double(params[Position]->u.td.x_value)/65536.0*sx;
 const double y=double(params[Position]->u.td.y_value)/65536.0*sy;
 LayoutBox box{x-width/2,y-height/2,width,height};
 const bool demoMode=!params[Transcript]->u.arb_d.value;
 auto document=demoMode?demo():decode(adobe::bytes(in_data,params[Transcript]->u.arb_d.value));
 const auto color=params[TextColor]->u.cd.value;
 for(auto* style:{&document.style.upcoming,&document.style.current,&document.style.spoken}) {
  style->fontSize=params[Size]->u.fs_d.value*sy;style->color={color.red/255.0,color.green/255.0,color.blue/255.0,1};
  style->padding*=sx;style->radius*=sx;
 }
 document.style.wordSpacing*=sx;
 double time=in_data->time_scale?double(in_data->current_time)/in_data->time_scale:0;
 // Short fixture repeats so every point on a long scratch clip remains testable.
 if(demoMode)time=std::fmod(std::max(0.0,time),8.0);
 auto bitmap=macos::rasterize(document,time,box,output->width,output->height,
                            static_cast<std::size_t>(std::max(1.0,params[MaxChars]->u.fs_d.value)));
 for(A_long row=0;row<output->height;++row) {
  auto* dst=reinterpret_cast<PF_Pixel8*>(reinterpret_cast<char*>(output->data)+row*output->rowbytes);
  const auto* src=(input.data&&row<input.height)?reinterpret_cast<const PF_Pixel8*>(reinterpret_cast<const char*>(input.data)+row*input.rowbytes):nullptr;
  for(A_long col=0;col<output->width;++col) {
   const auto* fg=&bitmap.pixels[row*bitmap.stride+col*4];const unsigned inv=255-fg[3];
   PF_Pixel8 bg{};if(src&&col<input.width)bg=src[col];
   // SDK baseline format is premultiplied ARGB_8u; CoreGraphics is RGBA.
   dst[col].alpha=static_cast<A_u_char>(fg[3]+(unsigned(bg.alpha)*inv+127)/255);
   dst[col].red=static_cast<A_u_char>(std::min(255u,unsigned(fg[0])+(unsigned(bg.red)*inv+127)/255));
   dst[col].green=static_cast<A_u_char>(std::min(255u,unsigned(fg[1])+(unsigned(bg.green)*inv+127)/255));
   dst[col].blue=static_cast<A_u_char>(std::min(255u,unsigned(fg[2])+(unsigned(bg.blue)*inv+127)/255));
  }
 }
 return PF_Err_NONE;
}
}
extern "C" DllExport PF_Err PluginDataEntryFunction2(PF_PluginDataPtr inPtr,PF_PluginDataCB2 inPluginDataCallBackPtr,SPBasicSuite*,const char*,const char*) {
 PF_Err result=PF_Err_INVALID_CALLBACK;
 result=PF_REGISTER_EFFECT_EXT2(inPtr,inPluginDataCallBackPtr,"Better Captions Native Probe","com.swen.bettercaptions.native.experimental","Better Captions",AE_RESERVED_INFO,"EffectMain","https://github.com/swenhalver/Better-Captions-Premiere");
 return result;
}
extern "C" DllExport PF_Err EffectMain(PF_Cmd cmd,PF_InData* in_data,PF_OutData* out_data,PF_ParamDef* params[],PF_LayerDef* output,void* extra) {
 try {
  switch(cmd) {
   case PF_Cmd_ABOUT:std::snprintf(out_data->return_msg,sizeof(out_data->return_msg),"Better Captions Native Probe 0.1: synthetic embedded transcript, not migrated captions.");break;
   case PF_Cmd_GLOBAL_SETUP:out_data->my_version=PF_VERSION(0,1,0,PF_Stage_DEVELOP,1);out_data->out_flags=PF_OutFlag_NON_PARAM_VARY;break;
   case PF_Cmd_PARAMS_SETUP:return parameters(in_data,out_data);
   case PF_Cmd_RENDER:return render(in_data,params,output);
   case PF_Cmd_ARBITRARY_CALLBACK:return better_captions::adobe::arbitrary(in_data,static_cast<PF_ArbParamsExtra*>(extra),demo());
   default:break;
  }
  return PF_Err_NONE;
 } catch(...) {return PF_Err_INTERNAL_STRUCT_DAMAGED;}
}
