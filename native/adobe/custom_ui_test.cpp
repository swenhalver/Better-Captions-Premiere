#define BC_UI_PROBE_TEST_NO_LOG 1
#define BC_ENABLE_CUSTOM_UI_PROBE 0
#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "custom_ui.hpp"
#include <cstring>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>
namespace {
using namespace better_captions::adobe::ui_probe;
void check(bool value,const char* reason){if(!value)throw std::runtime_error(reason);}
void near(double a,double b){check(std::abs(a-b)<.0001,"Unexpected bounds coordinate");}
PF_EffectCustomUISuite1 ui{};DRAWBOT_DrawbotSuite1 drawing{};DRAWBOT_SurfaceSuite1 surface{};DRAWBOT_SupplierSuite1 supplier{};DRAWBOT_PathSuite1 path{};
int acquired=0,released=0,objects=0,strokes=0,closed=0,registered=0;bool failPath=false,failPaint=false,failTransform=false;std::string missing;
std::vector<DRAWBOT_PointF32> points;std::vector<DRAWBOT_RectF32> markers;
SPErr acquire(const char* name,int32,const void** result){
 *result=nullptr;if(missing==name){*result=reinterpret_cast<const void*>(99);return 1;}
 if(std::strcmp(name,kPFEffectCustomUISuite)==0)*result=&ui;
 else if(std::strcmp(name,kDRAWBOT_DrawSuite)==0)*result=&drawing;
 else if(std::strcmp(name,kDRAWBOT_SurfaceSuite)==0)*result=&surface;
 else if(std::strcmp(name,kDRAWBOT_SupplierSuite)==0)*result=&supplier;
 else if(std::strcmp(name,kDRAWBOT_PathSuite)==0)*result=&path;
 if(!*result)return 1;++acquired;return 0;
}
SPErr release(const char*,int32){++released;return 0;}
PF_Err reference(PF_ContextH,DRAWBOT_DrawRef* result){*result=reinterpret_cast<DRAWBOT_DrawRef>(1);return 0;}
SPErr getSurface(DRAWBOT_DrawRef,DRAWBOT_SurfaceRef* result){*result=reinterpret_cast<DRAWBOT_SurfaceRef>(2);return 0;}
SPErr getSupplier(DRAWBOT_DrawRef,DRAWBOT_SupplierRef* result){*result=reinterpret_cast<DRAWBOT_SupplierRef>(3);return 0;}
SPErr newPen(DRAWBOT_SupplierRef,const DRAWBOT_ColorRGBA*,float size,DRAWBOT_PenRef* result){near(size,1);*result=reinterpret_cast<DRAWBOT_PenRef>(4);++objects;return 0;}
SPErr newPath(DRAWBOT_SupplierRef,DRAWBOT_PathRef* result){if(failPath)return 1;*result=reinterpret_cast<DRAWBOT_PathRef>(5);++objects;return 0;}
SPErr releaseObject(DRAWBOT_ObjectRef){--objects;return 0;}
SPErr moveTo(DRAWBOT_PathRef,float x,float y){points.push_back({x,y});return 0;}
SPErr lineTo(DRAWBOT_PathRef,float x,float y){points.push_back({x,y});return 0;}
SPErr closePath(DRAWBOT_PathRef){++closed;return 0;}
SPErr stroke(DRAWBOT_SurfaceRef,DRAWBOT_PenRef,DRAWBOT_PathRef){++strokes;return 0;}
SPErr paint(DRAWBOT_SurfaceRef,const DRAWBOT_ColorRGBA*,const DRAWBOT_RectF32* box){if(failPaint)return 1;markers.push_back(*box);return 0;}
// Nonidentity callback fixtures cover viewer zoom/pan and layer placement.
PF_Err screen(void*,PF_ContextH,PF_FixedPoint* p){if(failTransform)return 1;p->x=fixed(p->x/65536.0*2+10);p->y=fixed(p->y/65536.0*3+20);return 0;}
PF_Err layer(void*,PF_ContextH,A_long,A_long,PF_FixedPoint* p){p->x+=fixed(5);p->y+=fixed(7);return 0;}
PF_Err registerUI(PF_ProgPtr,PF_CustomUIInfo* info){check(info->events==PF_CustomEFlag_COMP,"Only Program Monitor COMP events may be registered");++registered;return 0;}
void clear(){points.clear();markers.clear();strokes=closed=0;failPath=failPaint=failTransform=false;missing.clear();}
}
int main(){try{
 ui.PF_GetDrawingReference=reference;drawing.GetSurface=getSurface;drawing.GetSupplier=getSupplier;surface.PaintRect=paint;surface.StrokePath=stroke;supplier.NewPen=newPen;supplier.NewPath=newPath;supplier.ReleaseObject=releaseObject;path.MoveTo=moveTo;path.LineTo=lineTo;path.Close=closePath;
 SPBasicSuite basic{};basic.AcquireSuite=acquire;basic.ReleaseSuite=release;
 PF_InData in{};in.pica_basicP=&basic;in.inter.register_ui=registerUI;in.downsample_x={1,2};in.downsample_y={1,4};
 check(better_captions::adobe::ui_probe::registerUI(&in)==0&&registered==1,"Bounds registration failed");
 PF_Context context{};context.w_type=PF_Window_COMP;PF_ContextPtr ptr=&context;
 PF_EventExtra e{};e.contextH=&ptr;e.cbs.source_to_frame=screen;e.cbs.layer_to_comp=layer;
 std::array<PF_ParamDef,4> values{};std::array<PF_ParamDef*,4> p{};for(int i=0;i<4;++i)p[i]=&values[i];
 p[1]->u.td.x_value=fixed(320);p[1]->u.td.y_value=fixed(270);p[2]->u.fs_d.value=400;p[3]->u.fs_d.value=100;
 const auto untouched=values;
 e.e_type=PF_Event_DRAW;check(event(&in,p.data(),&e)==0,"Draw event failed");check(e.evt_out_flags==PF_EO_HANDLED_EVENT,"Successful draw was not handled");
 check(points.size()==4&&closed==1&&strokes==1&&markers.size()==8,"Bounds path or eight handles missing");
 // Renderer-space box (220,257.5)-(420,282.5), then layer+viewer transform.
 near(points[0].x,460);near(points[0].y,813.5);near(points[1].x,860);near(points[1].y,813.5);near(points[2].x,860);near(points[2].y,888.5);near(points[3].x,460);near(points[3].y,888.5);
 near(markers[0].left,457);near(markers[0].top,810.5);near(markers[1].left,657);near(markers[1].top,810.5);near(markers[0].width,6);near(markers[0].height,6);
 check(objects==0&&acquired==released,"Draw resources were leaked");check(std::memcmp(values.data(),untouched.data(),sizeof(values))==0,"Drawing changed parameter bytes");
 for(auto type:{PF_Event_DO_CLICK,PF_Event_DRAG,PF_Event_ADJUST_CURSOR,PF_Event_IDLE}){
  e.e_type=type;e.evt_out_flags=0;e.u.do_click.screen_point.h=460;e.u.do_click.screen_point.v=813;e.u.do_click.send_drag=TRUE;e.u.do_click.continue_refcon[0]=2;
  const auto click=e.u.do_click;check(event(&in,p.data(),&e)==0,"Non-draw event failed");check(e.e_type==type&&e.evt_out_flags==0,"Production bounds intercepted input");check(std::memcmp(&click,&e.u.do_click,sizeof(click))==0,"Production bounds mutated pointer continuation");check(std::memcmp(values.data(),untouched.data(),sizeof(values))==0,"Production bounds mutated parameters");
 }
 clear();p[1]->u.td.x_value=fixed(340);p[1]->u.td.y_value=fixed(280);p[2]->u.fs_d.value=600;p[3]->u.fs_d.value=200;
 e.e_type=PF_Event_DRAW;e.evt_out_flags=0;check(event(&in,p.data(),&e)==0&&points.size()==4,"Updated geometry was not drawn");near(points[0].x,400);near(points[0].y,806);values=untouched;
 clear();p[2]->u.fs_d.value=std::numeric_limits<double>::quiet_NaN();e.evt_out_flags=0;check(event(&in,p.data(),&e)==0&&points.empty()&&!e.evt_out_flags,"Invalid dimensions must not reach Drawbot");values=untouched;
 clear();e.e_type=PF_Event_DRAW;e.evt_out_flags=0;e.evt_in_flags=PF_EI_DONT_DRAW;check(event(&in,p.data(),&e)==0&&points.empty()&&!e.evt_out_flags,"Hidden controls must not draw");e.evt_in_flags=0;
 context.w_type=PF_Window_EFFECT;check(event(&in,p.data(),&e)==0&&points.empty()&&!e.evt_out_flags,"Bounds must not draw in Effect Controls");context.w_type=PF_Window_COMP;
 for(const auto& unavailable:{std::string(kPFEffectCustomUISuite),std::string(kDRAWBOT_PathSuite)}){clear();missing=unavailable;check(event(&in,p.data(),&e)==0&&!e.evt_out_flags,"Unavailable drawing suites must be harmless");check(objects==0&&acquired==released,"Unavailable suite leaked references");}
 clear();failTransform=true;check(event(&in,p.data(),&e)==0&&!e.evt_out_flags&&points.empty(),"Failed coordinate transform must skip draw");
 clear();failPath=true;check(event(&in,p.data(),&e)==0&&!e.evt_out_flags&&objects==0,"Failed path allocation leaked pen");
 clear();failPaint=true;check(event(&in,p.data(),&e)==0&&!e.evt_out_flags&&objects==0,"Failed drawing leaked objects");
 check(acquired==released,"Suite references leaked");
 std::cout<<"Draw-only caption bounds passed against real Adobe SDK declarations (anisotropic geometry, nonidentity transforms, pointer isolation and resource cleanup). Host selection/event routing remains a live acceptance check.\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
