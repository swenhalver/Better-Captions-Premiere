#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "purposeful_controls.hpp"
#include <iostream>
#include <stdexcept>
#include <vector>
namespace pc=better_captions::adobe::purposeful_controls;
using namespace better_captions::adobe::parameters;
void check(bool v,const char* why){if(!v)throw std::runtime_error(why);}
namespace {
std::vector<PF_ParamDef> added;PF_ParamUtilsSuite3 utilities{};int refreshed=0,acquired=0,released=0;std::array<PF_ParamDef,Count> displayed{};
PF_Err capture(PF_ProgPtr,PF_ParamIndex,PF_ParamDefPtr param){added.push_back(*param);return 0;}
PF_Err update(PF_ProgPtr,PF_ParamIndex index,const PF_ParamDef* param){displayed[index]=*param;++refreshed;return 0;}
SPErr acquire(const char* name,SPInt32,const void** value){*value=nullptr;if(std::strcmp(name,kPFParamUtilsSuite))return 1;*value=&utilities;++acquired;return 0;}
SPErr release(const char*,SPInt32){++released;return 0;}
}
int main(){try{
 PF_InData in{};in.inter.add_param=capture;SPBasicSuite basic{};basic.AcquireSuite=acquire;basic.ReleaseSuite=release;in.pica_basicP=&basic;utilities.PF_UpdateParamUI=update;
 std::array<PF_ParamDef,Count> values{};std::array<PF_ParamDef*,Count> params{};for(int i=0;i<Count;i++)params[i]=&values[i];
 in.width=720;in.height=1280;
 for(const auto& item:pc::dimensions){check(pc::addDimension(&in,item.parameter==Width?"Width":"Height",item.diskId)==0,"Dimension proxy registration failed");const auto stored=added[added.size()-2],ui=added.back();
  check(stored.param_type==PF_Param_FLOAT_SLIDER&&stored.uu.id==item.diskId&&(stored.ui_flags&PF_PUI_INVISIBLE),"Original dimension stream identity/type must remain hidden and stable");
  check(ui.param_type==PF_Param_FLOAT_SLIDER&&ui.uu.id==item.uiDiskId&&(ui.ui_flags&PF_PUI_STD_CONTROL_ONLY)&&(ui.flags&PF_ParamFlag_SUPERVISE),"Dimension display must be a supervised UI-only float");
  check(ui.flags&PF_ParamFlag_CANNOT_TIME_VARY,"Dimension proxy must not expose a separate animation stream");
  check(ui.u.fs_d.value==-1&&ui.u.fs_d.dephault==-1&&ui.u.fs_d.valid_min==-1&&ui.u.fs_d.slider_min==-1,"New proxy must retain an unclamped unambiguous Reset sentinel");
  values[item.parameter]=stored;values[item.parameter].uu.change_flags=0;values[item.uiParameter]=ui;values[item.uiParameter].uu.change_flags=0;
 }
 for(const auto& item:pc::choices){
  const int initial=item.first;check(pc::add(&in,"Stored float",item.first,item.first+item.count-1,initial,item.diskId)==0,"Native registration failed");
  const auto& stored=added[added.size()-2];const auto& ui=added.back();
  check(stored.param_type==PF_Param_FLOAT_SLIDER&&stored.uu.id==item.diskId&&stored.u.fs_d.value==initial,"Original float ID/type/default changed");check(stored.ui_flags&PF_PUI_INVISIBLE,"Raw numeric stream remains visible");
  check(ui.uu.id==item.uiDiskId&&(ui.ui_flags&PF_PUI_STD_CONTROL_ONLY)&&(ui.flags&PF_ParamFlag_SUPERVISE),"Named control must be supervised and UI only");
  check(ui.param_type==(item.toggle?PF_Param_CHECKBOX:PF_Param_POPUP),"Named control is not a stock popup/checkbox");
  values[item.parameter]=stored;values[item.uiParameter]=ui;values[item.uiParameter].uu.change_flags=0;
  for(int option=0;option<item.count;option++){
   values[item.parameter].u.fs_d.value=item.first+option;values[item.parameter].uu.change_flags=0;
   pc::refresh(&in,params.data());const auto& shown=displayed[item.uiParameter];check((item.toggle?int(shown.u.bd.value):int(shown.u.pd.value)-1)==option,"Current sampled float did not mirror to named control");check(values[item.parameter].uu.change_flags==0,"UI refresh modified stored animation");
  }
  if(item.toggle)values[item.uiParameter].u.bd.value=0;else values[item.uiParameter].u.pd.value=1;
  PF_UserChangedParamExtra extra{item.uiParameter};PF_OutData out{};check(pc::changed(&in,&out,params.data(),&extra)==0,"Supervised native edit failed");check(values[item.parameter].u.fs_d.value==item.first,"UI edit did not update saved float");check(values[item.parameter].uu.change_flags&PF_ChangeFlag_CHANGED_VALUE,"Host did not receive float edit");check(values[item.uiParameter].uu.change_flags==0,"UI-only control incorrectly creates stream/keyframe");check(out.out_flags&PF_OutFlag_FORCE_RERENDER,"Host refresh not requested");
 }
 // Simulate Premiere retaining an old saved dimension stream's minimum/default.
 values[Width].u.fs_d.valid_min=1;values[Width].u.fs_d.slider_min=1;values[Width].u.fs_d.dephault=1536;values[Width].u.fs_d.value=674;values[WidthUI].u.fs_d.value=-1;
 PF_UserChangedParamExtra dimensionReset{WidthUI};PF_OutData dimensionOut{};check(pc::changed(&in,&dimensionOut,params.data(),&dimensionReset)==0,"New UI Reset failed with old stream metadata");check(values[Width].u.fs_d.value==648,"Width proxy Reset must bypass retained old minimum/default");check(displayed[WidthUI].u.fs_d.value==648,"Width proxy must display resolved positive pixels");check(values[Width].uu.change_flags&PF_ChangeFlag_CHANGED_VALUE,"Width proxy must edit the original animation stream");
 values[WidthUI].u.fs_d.value=1536;pc::changed(&in,&dimensionOut,params.data(),&dimensionReset);check(values[Width].u.fs_d.value==1536,"Typing legitimate 1536 pixels must remain possible");
 values[Width].u.fs_d.value=-1;values[Height].u.fs_d.value=-1;values[Width].uu.change_flags=values[Height].uu.change_flags=0;pc::refresh(&in,params.data());check(displayed[WidthUI].u.fs_d.value==648&&displayed[HeightUI].u.fs_d.value==1152,"New instance must display positive Auto dimensions");check(values[Width].u.fs_d.value==-1&&values[Width].uu.change_flags==0,"Cosmetic initial display must preserve stored dimension streams");
 values[Width].u.fs_d.value=1;values[Height].u.fs_d.value=150;values[WidthUI].u.fs_d.value=-1;values[HeightUI].u.fs_d.value=-1;dimensionReset.param_index=Input;pc::changed(&in,&dimensionOut,params.data(),&dimensionReset);check(values[Width].u.fs_d.value==648&&values[Height].u.fs_d.value==1152,"Whole-effect Reset must resolve fresh UI sentinels despite old positive stream defaults");
 values[ShowAnimationUI].u.bd.value=1;PF_UserChangedParamExtra advanced{ShowAnimationUI};pc::changed(&in,nullptr,params.data(),&advanced);check(!(displayed[Width].ui_flags&PF_PUI_INVISIBLE)&&!(displayed[Height].ui_flags&PF_PUI_INVISIBLE),"Advanced mode must reveal dimension keyframe streams");check(!(displayed[RollUpDirection].ui_flags&PF_PUI_INVISIBLE),"Advanced mode must reveal original keyframe streams");values[ShowAnimationUI].u.bd.value=0;pc::changed(&in,nullptr,params.data(),&advanced);check(displayed[RollUpDirection].ui_flags&PF_PUI_INVISIBLE,"Ordinary mode must hide numeric animation controls");
 check(std::string(pc::label(*pc::choice(RollUpDirection),1))=="Up","Saved direction mapping changed");check(std::string(pc::label(*pc::choice(RollUpCurve),2))=="Smooth","Saved easing mapping changed");check(std::string(pc::label(*pc::choice(LineTransition),4))=="Pop","Saved transition mapping changed");
 values[RollUpCurve].u.fs_d.value=2.3;values[RollUpCurve].uu.change_flags=0;pc::refresh(&in,params.data());check(values[RollUpCurve].u.fs_d.value==2.3&&values[RollUpCurve].uu.change_flags==0,"Readback must not quantize existing animated samples");check(acquired==released&&refreshed>0,"Parameter UI suites leaked");
 std::cout<<"Stock named Effect Controls preserve float streams, saved mappings and sampled animation; UI-only refresh and supervised edits pass.\n";
 }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
