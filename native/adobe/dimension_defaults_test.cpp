#include "AEConfig.h"
#include "dimension_defaults.hpp"
#include <iostream>
#include <stdexcept>
#include <cmath>
#include <array>
void check(bool value,const char* why){if(!value)throw std::runtime_error(why);}
namespace {
PF_UtilitySuite10 utility{};PrSDKSequenceInfoSuite sequence{};int acquired=0,released=0;bool failFrame=false;A_long seqWidth=1920,seqHeight=1080;
PF_Err timeline(PF_ProgPtr,PrTimelineID* id){*id=42;return 0;}
prSuiteError frame(PrTimelineID id,prRect* rect){check(id==42,"Reset must query its containing sequence");if(failFrame)return 1;rect->left=3;rect->top=5;rect->right=3+seqWidth;rect->bottom=5+seqHeight;return 0;}
SPErr acquire(const char* name,SPInt32,const void** value){*value=nullptr;if(!std::strcmp(name,kPFUtilitySuite))*value=&utility;else if(!std::strcmp(name,kPrSDKSequenceInfoSuite))*value=&sequence;if(!*value)return 1;++acquired;return 0;}
SPErr release(const char*,SPInt32){++released;return 0;}
}
int main(){try{
 PF_InData in{};in.width=720;in.height=1280;auto value=better_captions::adobe::dimensionDefaults(&in);check(value.hostDimensions&&value.width==648&&value.height==1152,"720x1280 native reset must use 648x1152");
 in.width=1920;in.height=1080;value=better_captions::adobe::dimensionDefaults(&in);check(value.width==1728&&value.height==972,"Landscape reset must use actual frame dimensions");
 in.width=3840;in.height=2160;value=better_captions::adobe::dimensionDefaults(&in);check(value.width==3456&&value.height==1944,"UHD reset must use actual dimensions");
 in.downsample_x={1,2};in.downsample_y={1,2};auto half=better_captions::adobe::dimensionDefaults(&in);check(half.width==value.width&&half.height==value.height,"PF input dimensions are full resolution and must not double-scale");
 in.width=0;value=better_captions::adobe::dimensionDefaults(&in);check(!value.hostDimensions,"Missing PARAMS_SETUP context must not claim sequence dimensions");
 std::array<PF_ParamDef,better_captions::adobe::parameters::Count> data{};std::array<PF_ParamDef*,better_captions::adobe::parameters::Count> params{};for(std::size_t i=0;i<data.size();++i)params[i]=&data[i];
 using namespace better_captions::adobe::parameters;in.width=720;in.height=1280;PF_OutData out{};PF_UserChangedParamExtra change{Width};
 data[Width].u.fs_d.value=-1;data[Height].u.fs_d.value=201;better_captions::adobe::changedDimension(&in,&out,params.data(),&change);check(data[Width].u.fs_d.value==648&&data[Height].u.fs_d.value==201,"Native Width reset must resolve only its Auto sentinel");check(data[Width].uu.change_flags&PF_ChangeFlag_CHANGED_VALUE,"Native host must receive resolved reset value");
 data[Width].u.fs_d.value=1536;data[Width].uu.change_flags=0;better_captions::adobe::changedDimension(&in,&out,params.data(),&change);check(data[Width].u.fs_d.value==1536&&data[Width].uu.change_flags==0,"Legitimate 1536 pixel edit must remain untouched");
 change.param_index=Height;data[Height].u.fs_d.value=-1;better_captions::adobe::changedDimension(&in,&out,params.data(),&change);check(data[Height].u.fs_d.value==1152,"Native Height reset must use 90 percent of source height");
 change.param_index=Input;data[Width].u.fs_d.value=-1;data[Height].u.fs_d.value=-1;better_captions::adobe::changedDimension(&in,&out,params.data(),&change);check(data[Width].u.fs_d.value==648&&data[Height].u.fs_d.value==1152,"Effect Reset must resolve both sentinels");
 check(better_captions::adobe::resolveDimension(-1,&in,true)==648&&better_captions::adobe::resolveDimension(-1,&in,false)==1152,"New-instance rendering must resolve dimensions without a callback");check(better_captions::adobe::resolveDimension(674,&in,true)==674,"Positive saved geometry must be preserved");
 SPBasicSuite basic{};basic.AcquireSuite=acquire;basic.ReleaseSuite=release;utility.GetContainingTimelineID=timeline;sequence.GetFrameRect=frame;in.pica_basicP=&basic;in.effect_ref=reinterpret_cast<PF_ProgPtr>(1);in.width=720;in.height=1280;
 value=better_captions::adobe::dimensionDefaults(&in);check(value.sequenceDimensions&&value.width==1728&&value.height==972,"Containing HD sequence must override portrait source dimensions");
 change.param_index=Input;data[Width].u.fs_d.value=-1;data[Height].u.fs_d.value=-1;better_captions::adobe::changedDimension(&in,&out,params.data(),&change);check(data[Width].u.fs_d.value==1728&&data[Height].u.fs_d.value==972,"Native Reset must use containing sequence rather than source size");
 check(better_captions::adobe::resolveDimension(-1,&in,true)==1728&&better_captions::adobe::resolveDimension(-1,&in,false)==972,"Auto render fallback must also use containing sequence");
 seqWidth=3840;seqHeight=2160;value=better_captions::adobe::dimensionDefaults(&in);check(value.width==3456&&value.height==1944,"Changing containing sequence dimensions must not use cached source dimensions");
 in.width=0;in.height=0;value=better_captions::adobe::dimensionDefaults(&in);check(value.hostDimensions&&value.sequenceDimensions&&value.width==3456,"Available sequence suite must work even with missing PF source dimensions");
 failFrame=true;in.width=720;in.height=1280;value=better_captions::adobe::dimensionDefaults(&in);check(!value.sequenceDimensions&&value.width==648&&value.height==1152,"Unavailable sequence metadata must preserve input-size fallback");check(acquired==released,"Containing sequence suite acquisition leaked");
 std::cout<<"Native reset dimensions: containing sequence overrides source size, exact Auto sentinel, portrait/HD/UHD, suite fallback and positive-value preservation passed.\n";
 }catch(const std::exception& error){std::cerr<<error.what()<<'\n';return 1;}}
