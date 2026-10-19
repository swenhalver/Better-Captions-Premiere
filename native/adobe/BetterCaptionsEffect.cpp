// Original experimental adapter; Adobe declarations are included from a local SDK.
#include "AEConfig.h"
#include "entry.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "../macos/caption_rasterizer.hpp"
#include "caption_arbitrary.hpp"
#include "render_style.hpp"
#include "parameters.hpp"
#include "parameter_sections.hpp"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#if BC_ENABLE_CUSTOM_UI_PROBE || BC_ENABLE_CAPTION_BOUNDS_UI
#include "custom_ui.hpp"
#endif
#include "source_time.hpp"
#if BC_ENABLE_RENDER_TIME_DIAGNOSTICS
#include "render_time_diagnostics.hpp"
#endif

namespace {
using namespace better_captions::adobe::parameters;
better_captions::Document demo();
PF_Err wordParameters(PF_InData* in_data,const char* name,int firstId,int groupId,int endId) {
 PF_ParamDef def{};
 PF_ADD_TOPICX(name,0,groupId);
 PF_ADD_FLOAT_SLIDERX("Size, %",1,400,25,200,100,PF_Precision_TENTHS,0,0,firstId);
 std::memset(&def,0,sizeof(def));PF_ADD_COLOR("Text tint",255,255,255,firstId+1);
 PF_ADD_FLOAT_SLIDERX("Opacity, %",0,100,0,100,100,PF_Precision_TENTHS,0,0,firstId+2);
 PF_ADD_POPUPX("Word bubble",3,1,"Document|On|Off",0,firstId+3);
 std::memset(&def,0,sizeof(def));PF_ADD_COLOR("Bubble tint",255,255,255,firstId+4);
 PF_ADD_FLOAT_SLIDERX("Bubble opacity, %",0,100,0,100,100,PF_Precision_TENTHS,0,0,firstId+5);
 PF_ADD_FLOAT_SLIDERX("Bubble padding, %",0,400,0,200,100,PF_Precision_TENTHS,0,0,firstId+6);
 PF_ADD_FLOAT_SLIDERX("Bubble corners, %",0,400,0,200,100,PF_Precision_TENTHS,0,0,firstId+7);
 std::memset(&def,0,sizeof(def));PF_END_TOPIC(endId);
 return PF_Err_NONE;
}
PF_Err parameters(PF_InData* in_data, PF_OutData* out_data) {
 PF_ParamDef def{};
 PF_ADD_POINT("Position",50,90,FALSE,PositionId);
 PF_ADD_FLOAT_SLIDERX("Width",1,8192,1,3840,1536,PF_Precision_TENTHS,0,0,WidthId);
 PF_ADD_FLOAT_SLIDERX("Height",1,8192,1,2160,150,PF_Precision_TENTHS,0,0,HeightId);
 PF_ADD_FLOAT_SLIDERX("Characters per caption",1,500,1,100,56,PF_Precision_INTEGER,0,0,MaxCharsId);
 BC_ADD_SECTION_SLIDER("Global font size (64 = 1x)",1,512,1,200,64,PF_Precision_TENTHS,0,0,SizeId);
 std::memset(&def,0,sizeof(def));PF_ADD_COLOR("Global text tint",255,255,255,ColorId);
 std::memset(&def,0,sizeof(def));
 auto defaultDocument=better_captions::adobe::make(in_data,better_captions::encode(demo()));
 PF_ADD_ARBITRARY2("Caption document (experimental)",0,0,PF_ParamFlag_CANNOT_TIME_VARY,PF_PUI_NO_ECW_UI,defaultDocument,TranscriptId,nullptr);
 PF_Err err=wordParameters(in_data,"Current word",CurrentSizeId,CurrentGroupId,CurrentEndId);if(err)return err;
 err=wordParameters(in_data,"Previously spoken words",SpokenSizeId,SpokenGroupId,SpokenEndId);if(err)return err;
 err=wordParameters(in_data,"Upcoming words",UpcomingSizeId,UpcomingGroupId,UpcomingEndId);if(err)return err;
 BC_ADD_SECTION_SLIDER("Groups per page",1,100,1,10,1,PF_Precision_INTEGER,0,0,GroupsPerPageId);
 PF_ADD_FLOAT_SLIDERX("Smart line fit",0,1,0,1,0,PF_Precision_INTEGER,0,0,SmartLineFitId);
 BC_ADD_SECTION_SLIDER("Roll-up enabled",0,1,0,1,0,PF_Precision_INTEGER,0,0,RollUpEnabledId);
 PF_ADD_FLOAT_SLIDERX("Visible lines",1,8,1,8,2,PF_Precision_INTEGER,0,0,RollUpLinesId);
 PF_ADD_FLOAT_SLIDERX("Scroll duration",0,2,0,1,.18,PF_Precision_HUNDREDTHS,0,0,RollUpDurationId);
 PF_ADD_FLOAT_SLIDERX("Soft fade boundary",0,1,0,1,1,PF_Precision_INTEGER,0,0,RollUpBoundaryId);
 PF_ADD_FLOAT_SLIDERX("Boundary position",0,1,0,1,0,PF_Precision_HUNDREDTHS,0,0,RollUpPositionId);
 PF_ADD_FLOAT_SLIDERX("Transition thickness",0,1,0,1,.35,PF_Precision_HUNDREDTHS,0,0,RollUpThicknessId);
 PF_ADD_FLOAT_SLIDERX("Fade amount",0,1,0,1,1,PF_Precision_HUNDREDTHS,0,0,RollUpFadeId);
 PF_ADD_FLOAT_SLIDERX("Transition curve",1,4,1,4,2,PF_Precision_INTEGER,0,0,RollUpCurveId);
 PF_ADD_FLOAT_SLIDERX("Scroll direction",1,4,1,4,1,PF_Precision_INTEGER,0,0,RollUpDirectionId);
 PF_ADD_FLOAT_SLIDERX("Scroll speed",.1,10,.1,3,1,PF_Precision_HUNDREDTHS,0,0,RollUpSpeedId);
 PF_ADD_FLOAT_SLIDERX("Wait for line to finish",0,1,0,1,1,PF_Precision_INTEGER,0,0,RollUpWaitId);
 PF_ADD_FLOAT_SLIDERX("Line transition",1,4,1,4,1,PF_Precision_INTEGER,0,0,LineTransitionId);
 PF_ADD_FLOAT_SLIDERX("Text alignment",1,3,1,3,2,PF_Precision_INTEGER,0,0,TextAlignmentId);
 out_data->num_params=Count;
#if BC_ENABLE_CUSTOM_UI_PROBE || BC_ENABLE_CAPTION_BOUNDS_UI
 return better_captions::adobe::ui_probe::registerUI(in_data);
#else
 return PF_Err_NONE;
#endif
}
better_captions::adobe::NativeWordControls wordControls(PF_ParamDef* params[],int first) {
 auto color=[](const PF_Pixel& value){return better_captions::Color{value.red/255.0,value.green/255.0,value.blue/255.0,1};};
 better_captions::adobe::NativeWordControls result;
 result.sizePercent=params[first]->u.fs_d.value;
 result.textTint=color(params[first+1]->u.cd.value);
 result.opacityPercent=params[first+2]->u.fs_d.value;
 result.bubbleMode=params[first+3]->u.pd.value;
 result.bubbleTint=color(params[first+4]->u.cd.value);
 result.bubbleOpacityPercent=params[first+5]->u.fs_d.value;
 result.paddingPercent=params[first+6]->u.fs_d.value;
 result.radiusPercent=params[first+7]->u.fs_d.value;
 return result;
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
 // SDK PF_InData: host already adjusts point parameters for downsampling.
 // Scalar pixel-distance sliders still need sx/sy (see official CCU sample).
 const double x=double(params[Position]->u.td.x_value)/65536.0;
 const double y=double(params[Position]->u.td.y_value)/65536.0;
 LayoutBox box{x-width/2,y-height/2,width,height};
 box.alignment=sampledTextAlignment(params[TextAlignment]?params[TextAlignment]->u.fs_d.value:2.0);
 const bool missingDocument=!params[Transcript]->u.arb_d.value;
 auto document=missingDocument?demo():decode(adobe::bytes(in_data,params[Transcript]->u.arb_d.value));
 // Only the exact built-in fixture bypasses persisted-origin mapping. Matching
 // its ID alone is insufficient; edited/custom documents must use their origin.
 auto demoComparison=document;demoComparison.schemaVersion=kSchemaVersion;
 const bool demoMode=missingDocument||encode(demoComparison)==encode(demo());
 const auto color=params[TextColor]->u.cd.value;
 adobe::NativeAppearanceControls appearances;
 appearances.current=wordControls(params,CurrentSize);
 appearances.spoken=wordControls(params,SpokenSize);
 appearances.upcoming=wordControls(params,UpcomingSize);
 adobe::applyNativeStyle(document,params[adobe::parameters::Size]->u.fs_d.value,
                        {color.red/255.0,color.green/255.0,color.blue/255.0,1},sx,sy,appearances);
 double time=in_data->time_scale?double(in_data->current_time)/in_data->time_scale:0;
#if BC_ENABLE_RENDER_TIME_DIAGNOSTICS
 adobe::source_time_probe::OwnLayerClock timeTrace;
#endif
#if BC_ENABLE_ADJUSTMENT_TIME_PROBE
 adobe::source_time_probe::adjustmentDiagnostics(in_data);
#else
 if(!demoMode){
#if BC_ENABLE_RENDER_TIME_DIAGNOSTICS
  const auto timeError=adobe::source_time_probe::documentSeconds(in_data,document.timeOriginSeconds,time,&timeTrace);
  adobe::logRenderTime(in_data,timeTrace,document,time,box,demoMode,timeError,-1);
#else
  const auto timeError=adobe::source_time_probe::documentSeconds(in_data,document.timeOriginSeconds,time);
#endif
  if(timeError)return timeError;
 }
#if BC_ENABLE_SOURCE_TIME_PROBE
 adobe::source_time_probe::mediaSeconds(in_data,time); // diagnostics never alter mapping
#endif
#endif
 // Short fixture repeats so every point on a long scratch clip remains testable.
 if(demoMode)time=std::fmod(std::max(0.0,time),8.0);
 const auto sample=[&](int index,double fallback){return params[index]?params[index]->u.fs_d.value:fallback;};
 const auto rollUp=sampledRollUpSettings(sample(RollUpEnabled,0),sample(RollUpLines,2),sample(RollUpDuration,.18),sample(RollUpBoundary,1),
   sample(RollUpPosition,0),sample(RollUpThickness,.35),sample(RollUpFade,1),sample(RollUpCurve,2),sample(RollUpDirection,1),sample(RollUpSpeed,1),sample(RollUpWait,1),sample(LineTransition,1));
 auto bitmap=macos::rasterize(document,time,box,output->width,output->height,
                            static_cast<std::size_t>(std::max(1.0,params[MaxChars]->u.fs_d.value)),0.6,
                            sampledGroupsPerPage(params[GroupsPerPage]?params[GroupsPerPage]->u.fs_d.value:1.0),
                            sampledSmartLineFit(params[SmartLineFit]?params[SmartLineFit]->u.fs_d.value:0.0),rollUp);
#if BC_ENABLE_RENDER_TIME_DIAGNOSTICS
 long long alphaCount=0;for(std::size_t i=3;i<bitmap.pixels.size();i+=4)if(bitmap.pixels[i])++alphaCount;
 adobe::logRenderTime(in_data,timeTrace,document,time,box,demoMode,PF_Err_NONE,alphaCount);
#endif
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
   case PF_Cmd_GLOBAL_SETUP:out_data->my_version=PF_VERSION(0,1,0,PF_Stage_DEVELOP,1);out_data->out_flags=PF_OutFlag_NON_PARAM_VARY;
#if BC_ENABLE_CUSTOM_UI_PROBE || BC_ENABLE_CAPTION_BOUNDS_UI
    out_data->out_flags|=PF_OutFlag_CUSTOM_UI;
#endif
    break;
   case PF_Cmd_PARAMS_SETUP:return parameters(in_data,out_data);
   case PF_Cmd_RENDER:return render(in_data,params,output);
   case PF_Cmd_ARBITRARY_CALLBACK:return better_captions::adobe::arbitrary(in_data,static_cast<PF_ArbParamsExtra*>(extra),demo());
#if BC_ENABLE_CUSTOM_UI_PROBE || BC_ENABLE_CAPTION_BOUNDS_UI
   case PF_Cmd_EVENT:return better_captions::adobe::ui_probe::event(in_data,params,static_cast<PF_EventExtra*>(extra));
#endif
   default:break;
  }
  return PF_Err_NONE;
 } catch(...) {return PF_Err_INTERNAL_STRUCT_DAMAGED;}
}
