#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "boundary_parameters.hpp"
#include <vector>
#include <set>
#include <iostream>
#include <stdexcept>
using namespace better_captions::adobe::parameters;
std::vector<PF_ParamDef> added;
PF_Err capture(PF_ProgPtr,PF_ParamIndex,PF_ParamDefPtr def){added.push_back(*def);return 0;}
void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
int main(){try{
 PF_InData in{};in.inter.add_param=capture;check(better_captions::adobe::boundaries::add(&in)==0,"Could not register boundary controls");
 check(added.size()==31,"Independent boundary hierarchy has wrong parameter count");std::set<int> ids;for(const auto& param:added)check(ids.insert(param.uu.id).second,"Boundary disk IDs collide");
 check(added[0].uu.id==BoundariesGroupId&&added.back().uu.id==BoundariesEndId,"Boundary parent group is malformed");
 const auto& mode=added[1];check(mode.uu.id==BoundaryModeId&&mode.param_type==PF_Param_POPUP&&mode.u.pd.value==1&&mode.u.pd.num_choices==2,"Legacy direction mode must remain default native popup");
 const int groups[]={TopBoundaryGroupId,BottomBoundaryGroupId,LeftBoundaryGroupId,RightBoundaryGroupId};const int first[]={TopInsetId,BottomInsetId,LeftInsetId,RightInsetId};
 for(int edge=0;edge<4;++edge){const int base=2+edge*7;check(added[base].uu.id==groups[edge]&&added[base+6].uu.id==groups[edge]+1,"Edge collapsible group is malformed");
  for(int offset:{0,2,3}){const auto& value=added[base+1+offset];check(value.param_type==PF_Param_FLOAT_SLIDER&&value.uu.id==first[edge]+offset&&value.u.fs_d.valid_min==0&&value.u.fs_d.valid_max==100,"Edge percent parameter range/type/ID is invalid");check(value.u.fs_d.value==(offset==0?0:offset==2?20:100),"Edge default changed");check(value.flags==0&&value.ui_flags==0,"Edge percent control must be a real native animated stream");}
  const auto& enabled=added[base+2];check(enabled.uu.id==first[edge]+1&&enabled.param_type==PF_Param_CHECKBOX&&enabled.u.bd.value,"Edge fade enable is not a native checked checkbox");
  const auto& curve=added[base+5];check(curve.uu.id==first[edge]+4&&curve.param_type==PF_Param_POPUP&&curve.u.pd.value==2&&curve.u.pd.num_choices==4,"Edge fade curve must default to named Smooth popup");
 }
 check(TopInset==TopBoundaryGroup+1&&TopFadeCurve==TopInset+4&&TopBoundaryEnd==TopFadeCurve+1,"Top enum order differs from registration");
 check(BottomInset==BottomBoundaryGroup+1&&BottomFadeCurve==BottomInset+4&&LeftInset==LeftBoundaryGroup+1&&LeftFadeCurve==LeftInset+4&&RightInset==RightBoundaryGroup+1&&RightFadeCurve==RightInset+4,"Other edge enum order differs from registration");
 check(BoundariesGroup>LineTransitionUI&&BoundariesEnd<RollUpEnd,"Boundary controls belong inside scrolling text");check(TopInsetId==48&&RightFadeCurveId==67&&TextAlignmentId==46&&ShowAnimationUIId==308,"Saved IDs must remain stable and new edge IDs isolated");
 std::cout<<"Independent boundary controls: named mode, four collapsed groups, 20 real animated streams, stable IDs and legacy defaults passed.\n";
 }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
