#pragma once
#include "AE_Effect.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "parameters.hpp"
#include <cstring>
namespace better_captions::adobe::boundaries {
// These are new, real native streams. Percent controls use authored 0..100
// values; the renderer converts to normalized viewport-relative fractions.
inline PF_Err addEdge(PF_InData* in_data,const char* name,int firstId,int groupId,int endId){
 PF_ParamDef def{};
 PF_ADD_TOPICX(name,PF_ParamFlag_START_COLLAPSED,groupId);
 PF_ADD_FLOAT_SLIDERX("Inset, %",0,100,0,100,0,PF_Precision_TENTHS,0,0,firstId);
 std::memset(&def,0,sizeof(def));PF_ADD_CHECKBOX("Fade enabled","",TRUE,0,firstId+1);
 PF_ADD_FLOAT_SLIDERX("Fade width, %",0,100,0,100,20,PF_Precision_TENTHS,0,0,firstId+2);
 PF_ADD_FLOAT_SLIDERX("Fade amount, %",0,100,0,100,100,PF_Precision_TENTHS,0,0,firstId+3);
 PF_ADD_POPUPX("Fade curve",4,2,"Linear|Smooth|Gentle start|Gentle finish",0,firstId+4);
 std::memset(&def,0,sizeof(def));PF_END_TOPIC(endId);
 return PF_Err_NONE;
}
inline PF_Err add(PF_InData* in_data){
 using namespace parameters;PF_ParamDef def{};
 PF_ADD_TOPICX("Boundaries",PF_ParamFlag_START_COLLAPSED,BoundariesGroupId);
 PF_ADD_POPUPX("Boundary mode",2,1,"Directional edge|Independent edges",0,BoundaryModeId);
 PF_Err error=addEdge(in_data,"Top",TopInsetId,TopBoundaryGroupId,TopBoundaryEndId);if(error)return error;
 error=addEdge(in_data,"Bottom",BottomInsetId,BottomBoundaryGroupId,BottomBoundaryEndId);if(error)return error;
 error=addEdge(in_data,"Left",LeftInsetId,LeftBoundaryGroupId,LeftBoundaryEndId);if(error)return error;
 error=addEdge(in_data,"Right",RightInsetId,RightBoundaryGroupId,RightBoundaryEndId);if(error)return error;
 std::memset(&def,0,sizeof(def));PF_END_TOPIC(BoundariesEndId);
 return PF_Err_NONE;
}
}
