#pragma once
// Premiere ignores custom-drawn FLOAT_SLIDER controls. Keep saved float streams
// hidden and expose stock, UI-only popup/checkbox controls that supervise them.
#include "parameters.hpp"
#include "dimension_defaults.hpp"
#include "AE_EffectUI.h"
#include "AE_EffectSuites.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include <SPBasic.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstring>

namespace better_captions::adobe::purposeful_controls {
using namespace better_captions::adobe::parameters;
struct DimensionChoice {int parameter,uiParameter,diskId,uiDiskId;const char* title;int sliderMaximum;};
inline const std::array<DimensionChoice,2> dimensions{{
 {Width,WidthUI,WidthId,WidthUIId,"Width, px",3840},
 {Height,HeightUI,HeightId,HeightUIId,"Height, px",2160}
}};
inline const DimensionChoice* dimensionChoice(int parameter){for(const auto& item:dimensions)if(item.parameter==parameter||item.uiParameter==parameter)return &item;return nullptr;}
inline PF_Err addDimension(PF_InData* in_data,const char* storedName,int diskId){
 const DimensionChoice* item=nullptr;for(const auto& candidate:dimensions)if(candidate.diskId==diskId)item=&candidate;if(!item)return PF_Err_BAD_CALLBACK_PARAM;
 PF_ParamDef def{};def.ui_flags=PF_PUI_INVISIBLE;def.flags=PF_ParamFlag_SUPERVISE;
 PF_ADD_FLOAT_SLIDER(storedName,-1,8192,-1,item->sliderMaximum,AEFX_DEFAULT_CURVE_TOLERANCE,kAutoDimension,PF_Precision_TENTHS,0,false,diskId);
 AEFX_CLR_STRUCT(def);def.ui_flags=PF_PUI_STD_CONTROL_ONLY;def.flags=PF_ParamFlag_SUPERVISE|PF_ParamFlag_CANNOT_TIME_VARY;
 PF_ADD_FLOAT_SLIDER(item->title,-1,8192,-1,item->sliderMaximum,AEFX_DEFAULT_CURVE_TOLERANCE,kAutoDimension,PF_Precision_TENTHS,0,false,item->uiDiskId);
 return PF_Err_NONE;
}
struct Choice {int parameter;int uiParameter;int diskId;int uiDiskId;const char* title;int first;int count;std::array<const char*,4> labels;const char* menu;bool toggle;};
inline const std::array<Choice,7> choices{{
 {TextAlignment,TextAlignmentUI,TextAlignmentId,TextAlignmentUIId,"Alignment",1,3,{"Left","Center","Right",nullptr},"Left|Center|Right",false},
 {RollUpEnabled,RollUpEnabledUI,RollUpEnabledId,RollUpEnabledUIId,"Enable scrolling",0,2,{"Off","On",nullptr,nullptr},nullptr,true},
 {RollUpBoundary,RollUpBoundaryUI,RollUpBoundaryId,RollUpBoundaryUIId,"Fade at boundary",0,2,{"Off","On",nullptr,nullptr},nullptr,true},
 {RollUpCurve,RollUpCurveUI,RollUpCurveId,RollUpCurveUIId,"Easing",1,4,{"Linear","Smooth","Gentle start","Gentle finish"},"Linear|Smooth|Gentle start|Gentle finish",false},
 {RollUpDirection,RollUpDirectionUI,RollUpDirectionId,RollUpDirectionUIId,"Direction",1,4,{"Up","Down","Left","Right"},"Up|Down|Left|Right",false},
 {RollUpWait,RollUpWaitUI,RollUpWaitId,RollUpWaitUIId,"Finish current line first",0,2,{"Off","On",nullptr,nullptr},nullptr,true},
 {LineTransition,LineTransitionUI,LineTransitionId,LineTransitionUIId,"New line animation",1,4,{"Scroll","Fade","Slide","Pop"},"Scroll|Fade|Slide|Pop",false}
}};
inline const Choice* choice(int parameter){for(const auto& item:choices)if(item.parameter==parameter||item.uiParameter==parameter)return &item;return nullptr;}
inline int selected(const Choice& item,double value){return std::isfinite(value)?int(std::round(std::clamp(value,double(item.first),double(item.first+item.count-1))))-item.first:0;}
inline const char* label(const Choice& item,double value){return item.labels[selected(item,value)];}
inline PF_Err add(PF_InData* in_data,const char* name,int minimum,int maximum,int defaultValue,int diskId){
 const Choice* item=nullptr;for(const auto& candidate:choices)if(candidate.diskId==diskId)item=&candidate;
 if(!item)return PF_Err_BAD_CALLBACK_PARAM;
 PF_ParamDef def{};def.ui_flags=PF_PUI_INVISIBLE;def.flags=PF_ParamFlag_SUPERVISE;
 PF_ADD_FLOAT_SLIDER(name,minimum,maximum,minimum,maximum,AEFX_DEFAULT_CURVE_TOLERANCE,defaultValue,PF_Precision_INTEGER,0,false,diskId);
 AEFX_CLR_STRUCT(def);def.ui_flags=PF_PUI_STD_CONTROL_ONLY;def.flags=PF_ParamFlag_SUPERVISE;
 if(item->toggle){PF_ADD_CHECKBOX(item->title,"",defaultValue,PF_ParamFlag_SUPERVISE,item->uiDiskId);}
 else {PF_ADD_POPUP(item->title,item->count,defaultValue-item->first+1,item->menu,item->uiDiskId);}
 return PF_Err_NONE;
}
template<class T>class Suite {
 SPBasicSuite* basic_;const char* name_;int version_;const T* ptr_=nullptr;
 public:Suite(PF_InData* in,const char* name,int version):basic_(in->pica_basicP),name_(name),version_(version){const void* value=nullptr;if(basic_&&!basic_->AcquireSuite(name_,version_,&value))ptr_=static_cast<const T*>(value);}
 ~Suite(){if(ptr_)basic_->ReleaseSuite(name_,version_);}const T* operator->()const{return ptr_;}explicit operator bool()const{return ptr_;}
};
inline PF_Err refresh(PF_InData* in,PF_ParamDef* params[]){
 Suite<PF_ParamUtilsSuite3> ui(in,kPFParamUtilsSuite,kPFParamUtilsSuiteVersion3);
 if(!ui||!ui->PF_UpdateParamUI)return PF_Err_NONE;
 const bool animation=params&&params[ShowAnimationUI]&&params[ShowAnimationUI]->u.bd.value;
 for(const auto& item:dimensions){if(!params||!params[item.parameter]||!params[item.uiParameter])continue;
  auto storedUI=*params[item.parameter];if(animation)storedUI.ui_flags&=~PF_PUI_INVISIBLE;else storedUI.ui_flags|=PF_PUI_INVISIBLE;
  const PF_Err visibilityError=ui->PF_UpdateParamUI(in->effect_ref,item.parameter,&storedUI);if(visibilityError)return visibilityError;
  auto display=*params[item.uiParameter];display.u.fs_d.value=resolveDimension(params[item.parameter]->u.fs_d.value,in,item.parameter==Width);
  const PF_Err error=ui->PF_UpdateParamUI(in->effect_ref,item.uiParameter,&display);if(error)return error;
 }

 for(const auto& item:choices){if(!params||!params[item.parameter]||!params[item.uiParameter])continue;
  // Premiere explicitly permits dynamic PF_PUI_INVISIBLE in UpdateParamUI.
  // Reveal original streams only for deliberate advanced keyframe editing.
  auto storedUI=*params[item.parameter];
  if(animation)storedUI.ui_flags&=~PF_PUI_INVISIBLE;else storedUI.ui_flags|=PF_PUI_INVISIBLE;
  const PF_Err visibilityError=ui->PF_UpdateParamUI(in->effect_ref,item.parameter,&storedUI);if(visibilityError)return visibilityError;
  auto display=*params[item.uiParameter];const int option=selected(item,params[item.parameter]->u.fs_d.value);
  if(item.toggle)display.u.bd.value=option;else display.u.pd.value=option+1;
  // UI-only values are refreshed through UpdateParamUI, never CHANGED_VALUE.
  const PF_Err error=ui->PF_UpdateParamUI(in->effect_ref,item.uiParameter,&display);if(error)return error;
 }
 return PF_Err_NONE;
}
inline PF_Err changed(PF_InData* in,PF_OutData* out,PF_ParamDef* params[],const PF_UserChangedParamExtra* extra){
 if(!extra)return PF_Err_NONE;
 if(params){for(const auto& item:dimensions){
  if(!params[item.parameter]||!params[item.uiParameter])continue;
  const bool resetAll=extra->param_index==Input&&params[item.uiParameter]->u.fs_d.value==kAutoDimension;
  if(extra->param_index!=item.uiParameter&&!resetAll)continue;
  const double requested=params[item.uiParameter]->u.fs_d.value;
  if(!std::isfinite(requested))return PF_Err_BAD_CALLBACK_PARAM;
  const double value=requested==kAutoDimension?resolveDimension(requested,in,item.parameter==Width):std::clamp(requested,1.0,8192.0);
  auto& stored=*params[item.parameter];const double before=stored.u.fs_d.value;
  if(before!=value){stored.u.fs_d.value=value;stored.uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;if(out)out->out_flags|=PF_OutFlag_FORCE_RERENDER;}
  logDimensionDefaults(in,dimensionDefaults(in),"dimension-proxy-change",item.uiParameter,requested,value);
 }}
 if(extra->param_index==Input||extra->param_index==ShowAnimationUI||dimensionChoice(extra->param_index))return refresh(in,params);const auto* item=choice(extra->param_index);if(!item||!params||!params[item->parameter]||!params[item->uiParameter])return PF_Err_NONE;
 if(extra->param_index==item->uiParameter){
  auto& stored=*params[item->parameter];auto& display=*params[item->uiParameter];
  const int option=item->toggle?(display.u.bd.value?1:0):std::clamp(int(display.u.pd.value)-1,0,item->count-1);
  const double value=item->first+option;
  if(stored.u.fs_d.value!=value){stored.u.fs_d.value=value;stored.uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;if(out)out->out_flags|=PF_OutFlag_FORCE_RERENDER;}
 }
 return refresh(in,params);
}
// Stock controls now handle events. Program Monitor dispatch remains independent.
inline PF_Err event(PF_InData*,PF_ParamDef*[],PF_EventExtra*){return PF_Err_NONE;}
}
#define BC_ADD_CHOICE_SLIDER(NAME,MINIMUM,MAXIMUM,DEFAULT_VALUE,DISK_ID) \
 do {const auto choiceError=better_captions::adobe::purposeful_controls::add(in_data,NAME,MINIMUM,MAXIMUM,DEFAULT_VALUE,DISK_ID);if(choiceError)return choiceError;}while(0)

#define BC_ADD_DIMENSION_SLIDER(NAME,DISK_ID) \
 do {const auto dimensionError=better_captions::adobe::purposeful_controls::addDimension(in_data,NAME,DISK_ID);if(dimensionError)return dimensionError;}while(0)
