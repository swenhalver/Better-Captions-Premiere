#pragma once
// Optional real-SDK Program Monitor event probe. Never used by frame rendering.
// Host routing, keyframe/undo semantics and coordinate handling require acceptance.
#include "AE_EffectUI.h"
#include "AE_EffectSuites.h"
#include <adobesdk/DrawbotSuite.h>
#include <SPBasic.h>
#include <array>
#include <cmath>
#include <cstdio>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

namespace better_captions::adobe::ui_probe {
inline void log(const char* action,long event,long window,long error=0,long x=0,long y=0,long continuation=0,long sendDrag=0,long lastTime=0) {
#ifdef BC_UI_PROBE_TEST_NO_LOG
 (void)action;(void)event;(void)window;(void)error;(void)x;(void)y;(void)continuation;(void)sendDrag;(void)lastTime;return;
#else
 const int file=::open("/tmp/better-captions-native-ui-probe.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);
 if(file<0)return;struct stat status{};
 if(::fstat(file,&status)==0&&S_ISREG(status.st_mode)&&status.st_uid==::getuid()&&status.st_size<1024*1024){
  char line[280];const int n=std::snprintf(line,sizeof(line),"%s event=%ld window=%ld error=%ld x=%ld y=%ld continuation=%ld sendDrag=%ld lastTime=%ld\n",action,event,window,error,x,y,continuation,sendDrag,lastTime);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
 }
 ::close(file);
#endif
}
template<class T>class Suite {
 SPBasicSuite* basic_;const char* name_;int version_;const T* suite_=nullptr;
 public:Suite(PF_InData* in,const char* name,int version):basic_(in->pica_basicP),name_(name),version_(version){if(basic_)basic_->AcquireSuite(name_,version_,reinterpret_cast<const void**>(&suite_));}
 ~Suite(){if(suite_)basic_->ReleaseSuite(name_,version_);}const T* operator->()const{return suite_;}explicit operator bool()const{return suite_!=nullptr;}
};
inline PF_Err registerUI(PF_InData* in) {
 if(!in->inter.register_ui){log("register-missing",0,0);return PF_Err_NONE;}
 PF_CustomUIInfo info{};info.events=PF_CustomEFlag_COMP;info.comp_ui_alignment=PF_UIAlignment_NONE;
 const auto err=in->inter.register_ui(in->effect_ref,&info);log("register",0,0,err);
 // An optional probe must not make a working renderer unavailable.
 return PF_Err_NONE;
}
inline bool transform(PF_InData* in,PF_EventExtra* e,PF_FixedPoint& point,bool toFrame) {
 if(!e->cbs.source_to_frame||!e->cbs.frame_to_source||!e->cbs.layer_to_comp||!e->cbs.comp_to_layer)return false;
 PF_Err err=0;
 if(toFrame){err=e->cbs.layer_to_comp(e->cbs.refcon,e->contextH,in->current_time,in->time_scale,&point);if(!err)err=e->cbs.source_to_frame(e->cbs.refcon,e->contextH,&point);}
 else{err=e->cbs.frame_to_source(e->cbs.refcon,e->contextH,&point);if(!err)err=e->cbs.comp_to_layer(e->cbs.refcon,e->contextH,in->current_time,in->time_scale,&point);}
 return err==0;
}
inline PF_Fixed fixed(double value){return static_cast<PF_Fixed>(std::max(-32767.0,std::min(32767.0,value))*65536);}
// 0=center(move), 1=right(width), 2=bottom(height), 3=bottom-right(both).
inline std::array<PF_FixedPoint,4> handles(PF_ParamDef* p[]){
 const auto x=p[1]->u.td.x_value,y=p[1]->u.td.y_value;
 const auto halfW=fixed(p[2]->u.fs_d.value/2),halfH=fixed(p[3]->u.fs_d.value/2);
 return {{{x,y},{x+halfW,y},{x,y+halfH},{x+halfW,y+halfH}}};
}
inline void draw(PF_InData* in,PF_ParamDef* p[],PF_EventExtra* e) {
 if(e->evt_in_flags&PF_EI_DONT_DRAW)return;
 Suite<PF_EffectCustomUISuite1> ui(in,kPFEffectCustomUISuite,kPFEffectCustomUISuiteVersion1);
 Suite<DRAWBOT_DrawbotSuite1> drawbot(in,kDRAWBOT_DrawSuite,kDRAWBOT_DrawSuite_Version1);
 Suite<DRAWBOT_SurfaceSuite1> surface(in,kDRAWBOT_SurfaceSuite,kDRAWBOT_SurfaceSuite_Version1);
 if(!ui||!drawbot||!surface){log("draw-suite-unavailable",e->e_type,PF_Window_COMP);return;}
 DRAWBOT_DrawRef ref=nullptr;DRAWBOT_SurfaceRef canvas=nullptr;
 if(ui->PF_GetDrawingReference(e->contextH,&ref)||!ref||drawbot->GetSurface(ref,&canvas)||!canvas){log("draw-reference-unavailable",e->e_type,PF_Window_COMP);return;}
 // Small actual overlay handles, never included in exported frame pixels.
 const DRAWBOT_ColorRGBA color{0.2f,0.7f,1.0f,1.0f};
 auto points=handles(p);for(auto point:points){if(!transform(in,e,point,true))continue;DRAWBOT_RectF32 box{float(point.x/65536.0-4),float(point.y/65536.0-4),8,8};surface->PaintRect(canvas,&color,&box);}
 log("draw-handles",e->e_type,PF_Window_COMP);
}
inline PF_Err event(PF_InData* in,PF_ParamDef* p[],PF_EventExtra* e) {
 if(!e||!e->contextH||!*e->contextH)return PF_Err_NONE;
 const auto window=(*e->contextH)->w_type;
 if(e->e_type!=PF_Event_IDLE)log("event",e->e_type,window);
 if(window!=PF_Window_COMP)return PF_Err_NONE;
 if(e->e_type==PF_Event_DO_CLICK||e->e_type==PF_Event_DRAG){
  const auto& click=e->u.do_click;log("pointer",e->e_type,window,0,click.screen_point.h,click.screen_point.v,static_cast<long>(click.continue_refcon[0]),click.send_drag,click.last_time);
 }
 // Match the official CCU sample: some continuation callbacks retain DO_CLICK.
 if(e->e_type==PF_Event_DO_CLICK&&e->u.do_click.send_drag)e->e_type=PF_Event_DRAG;
 if(e->e_type==PF_Event_DRAW){draw(in,p,e);e->evt_out_flags|=PF_EO_HANDLED_EVENT;return PF_Err_NONE;}
 if(e->e_type==PF_Event_DO_CLICK){
  auto points=handles(p);const auto mouse=e->u.do_click.screen_point;
  for(std::size_t i=0;i<points.size();++i){auto point=points[i];if(!transform(in,e,point,true))continue;
   if(std::hypot(point.x/65536.0-mouse.h,point.y/65536.0-mouse.v)<=10){e->u.do_click.continue_refcon[0]=i+1;e->u.do_click.send_drag=TRUE;e->evt_out_flags|=PF_EO_HANDLED_EVENT;log("handle-click",e->e_type,window,i+1,mouse.h,mouse.v,i+1,TRUE,e->u.do_click.last_time);return PF_Err_NONE;}}
  log("handle-miss",e->e_type,window,0,mouse.h,mouse.v);
 }
 if(e->e_type==PF_Event_DRAG){
  auto& click=e->u.do_click;const auto mode=click.continue_refcon[0];if(mode<1||mode>4)return PF_Err_NONE;
  PF_FixedPoint point{fixed(click.screen_point.h),fixed(click.screen_point.v)};if(!transform(in,e,point,false))return PF_Err_NONE;
  if(mode==1){p[1]->u.td.x_value=point.x;p[1]->u.td.y_value=point.y;p[1]->uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;}
  if(mode==2||mode==4){p[2]->u.fs_d.value=std::max(1.0,std::min(8192.0,2*std::abs((double(point.x)-p[1]->u.td.x_value)/65536.0)));p[2]->uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;}
  if(mode==3||mode==4){p[3]->u.fs_d.value=std::max(1.0,std::min(8192.0,2*std::abs((double(point.y)-p[1]->u.td.y_value)/65536.0)));p[3]->uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;}
  click.send_drag=!click.last_time;if(click.last_time)click.continue_refcon[0]=0;
  e->evt_out_flags|=PF_EO_HANDLED_EVENT|PF_EO_ALWAYS_UPDATE;log("native-param-drag",e->e_type,window,mode);
 }
 return PF_Err_NONE;
}
}
