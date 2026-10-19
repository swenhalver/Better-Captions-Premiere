#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "parameter_sections.hpp"
#include "parameters.hpp"
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <vector>
namespace {
std::vector<PF_ParamDef> added;
PF_Err capture(PF_ProgPtr,PF_ParamIndex index,PF_ParamDefPtr def) {
 if(index!=-1||!def)return PF_Err_BAD_CALLBACK_PARAM;
 added.push_back(*def);return PF_Err_NONE;
}
PF_Err sliders(PF_InData* in_data) {
 PF_ParamDef def{};
 PF_ADD_FLOAT_SLIDERX("Global font size (64 = 1x)",1,512,1,200,64,PF_Precision_TENTHS,0,0,better_captions::adobe::parameters::SizeId);
 BC_ADD_SECTION_SLIDER("Global font size (64 = 1x)",1,512,1,200,64,PF_Precision_TENTHS,0,0,better_captions::adobe::parameters::SizeId);
 PF_ADD_FLOAT_SLIDERX("Groups per page",1,100,1,10,1,PF_Precision_INTEGER,0,0,better_captions::adobe::parameters::GroupsPerPageId);
 BC_ADD_SECTION_SLIDER("Groups per page",1,100,1,10,1,PF_Precision_INTEGER,0,0,better_captions::adobe::parameters::GroupsPerPageId);
 PF_ADD_FLOAT_SLIDERX("Roll-up enabled",0,1,0,1,0,PF_Precision_INTEGER,0,0,better_captions::adobe::parameters::RollUpEnabledId);
 BC_ADD_SECTION_SLIDER("Roll-up enabled",0,1,0,1,0,PF_Precision_INTEGER,0,0,better_captions::adobe::parameters::RollUpEnabledId);
 // The next ordinary control must not inherit the separator from a section.
 PF_ADD_FLOAT_SLIDERX("Visible lines",1,8,1,8,2,PF_Precision_INTEGER,0,0,better_captions::adobe::parameters::RollUpLinesId);
 return PF_Err_NONE;
}
void check(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
}
int main(){try{
 PF_InData input{};input.inter.add_param=capture;check(sliders(&input)==PF_Err_NONE,"Could not capture native parameter registration");
 check(added.size()==7,"Visual sections added unexpected native parameter slots");
 for(std::size_t index=0;index<6;index+=2){auto original=added[index],section=added[index+1];
  check(original.ui_flags==0&&section.ui_flags==PF_PUI_ECW_SEPARATOR,"Section did not use Premiere's documented visual grouping flag");
  section.ui_flags=original.ui_flags;
  check(std::memcmp(&original,&section,sizeof(PF_ParamDef))==0,"Visual grouping changed an existing ID, default, name, range, flag or type");
 }
 check(added.back().ui_flags==0,"A visual section leaked into a following ordinary parameter");
 using namespace better_captions::adobe::parameters;
 check(Position==1&&Width==2&&Height==3&&MaxChars==4&&better_captions::adobe::parameters::Size==5&&TextColor==6&&Transcript==7,"Original native prefix indexes moved");
 check(CurrentGroup==8&&CurrentEnd==17&&SpokenGroup==18&&SpokenEnd==27&&UpcomingGroup==28&&UpcomingEnd==37,"Existing collapsible state group indexes moved");
 check(GroupsPerPage==38&&SmartLineFit==39&&RollUpEnabled==40&&LineTransition==51&&TextAlignment==52&&Count==53,"Appended native parameter indexes moved");
 std::cout<<"Premiere visual sections preserve stock parameter bytes, every index and all three collapsible state topics.\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
