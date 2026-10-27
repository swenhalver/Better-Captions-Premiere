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
 PF_ADD_FLOAT_SLIDERX("Current line position",1,8,1,8,1,PF_Precision_INTEGER,0,0,better_captions::adobe::parameters::RollUpCurrentLineId);
 return PF_Err_NONE;
}
void check(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
}
int main(){try{
 PF_InData input{};input.inter.add_param=capture;check(sliders(&input)==PF_Err_NONE,"Could not capture native parameter registration");
 check(added.size()==8,"Visual sections added unexpected native parameter slots");
 for(std::size_t index=0;index<6;index+=2){auto original=added[index],section=added[index+1];
  check(original.ui_flags==0&&section.ui_flags==PF_PUI_ECW_SEPARATOR,"Section did not use Premiere's documented visual grouping flag");
  section.ui_flags=original.ui_flags;
  check(std::memcmp(&original,&section,sizeof(PF_ParamDef))==0,"Visual grouping changed an existing ID, default, name, range, flag or type");
 }
 check(added[6].ui_flags==0&&added.back().ui_flags==0,"A visual section leaked into a following ordinary parameter");
 using namespace better_captions::adobe::parameters;
 check(RollUpCurrentLineId==68&&RollUpCurrentLine==RollUpLines+1&&RollUpBlankLineSeconds==RollUpCurrentLine+1&&RollUpDuration==RollUpBlankLineSeconds+1&&RollUpBlankLineSecondsId==69,"Current line position identity or registration order changed");
 check(added.back().uu.id==RollUpCurrentLineId&&added.back().u.fs_d.value==1&&added.back().u.fs_d.precision==PF_Precision_INTEGER,"Current line position must be an integer slider defaulting to one");
 check(PositionId==1&&WidthId==2&&HeightId==3&&TranscriptId==7&&RollUpDirectionId==42&&TextAlignmentId==46,"Saved disk IDs changed");
 check(LayoutGroup<Position&&Height<LayoutEnd&&TextGroup<better_captions::adobe::parameters::Size&&TextAlignment<TextEnd&&WordStylesGroup<CurrentGroup&&UpcomingEnd<WordStylesEnd&&CaptionGroup<GroupsPerPage&&GroupsPerPage<CaptionEnd&&RollUpGroup<RollUpEnabled&&LineTransition<RollUpEnd,"Collapsible group hierarchy is invalid");
 std::cout<<"Premiere visual sections preserve stock parameter bytes, saved disk IDs and collapsible group boundaries.\n";return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
