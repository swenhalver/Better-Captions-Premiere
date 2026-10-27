#pragma once
#include "parameters.hpp"
#include "dimension_defaults.hpp"
#include "purposeful_controls.hpp"
// Draw-only Program Monitor caption bounds; never used by frame rendering.
// Pointer editing is a separate opt-in experiment and is off in production.
#include "AE_EffectUI.h"
#include "AE_EffectSuites.h"
#include <adobesdk/DrawbotSuite.h>
#include <SPBasic.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <ctime>
#include <cmath>
#include <cstdio>
#if !defined(_WIN32)
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace better_captions::adobe::ui_probe {
using namespace better_captions::adobe::parameters;
// Owner-only regular flag enables bounded, non-content diagnostics without
// changing Premiere preferences or enabling the experimental pointer handlers.
inline bool boundsDiagnosticsFlag(const char* path) {
#if defined(_WIN32)
 (void)path;return false;
#else
 const int file=::open(path,O_RDONLY|O_NOFOLLOW|O_NONBLOCK);if(file<0)return false;
 struct stat status{};const bool enabled=::fstat(file,&status)==0&&S_ISREG(status.st_mode)&&status.st_uid==::getuid()&&(status.st_mode&0077)==0&&status.st_nlink==1;
 ::close(file);return enabled;
#endif
}
inline bool boundsDiagnosticsEnabled() {
#if defined(_WIN32)
 return false;
#else
 static std::atomic<long long> last{-1};static std::atomic<bool> enabled{false};
 struct timespec now{};if(::clock_gettime(CLOCK_MONOTONIC,&now))return false;
 auto previous=last.load(std::memory_order_relaxed);
 if(previous!=now.tv_sec&&last.compare_exchange_strong(previous,now.tv_sec,std::memory_order_relaxed))enabled.store(boundsDiagnosticsFlag("/tmp/better-captions-native-bounds-diagnostics.enabled"),std::memory_order_relaxed);
 return enabled.load(std::memory_order_relaxed);
#endif
}
inline void log(const char* action,long event,long window,long error=0,long x=0,long y=0,long continuation=0,long sendDrag=0,long lastTime=0) {
#if defined(BC_UI_PROBE_TEST_LOG)
 BC_UI_PROBE_TEST_LOG(action,event,window,error,x,y,continuation,sendDrag,lastTime);return;
#elif defined(BC_UI_PROBE_TEST_NO_LOG) || defined(_WIN32)
 (void)action;(void)event;(void)window;(void)error;(void)x;(void)y;(void)continuation;(void)sendDrag;(void)lastTime;return;
#else
#if BC_ENABLE_CUSTOM_UI_PROBE
 const char* path="/tmp/better-captions-native-ui-probe.log";
#else
 if(!boundsDiagnosticsEnabled())return;
 const char* path="/tmp/better-captions-native-bounds-diagnostics.log";
#endif
 const int file=::open(path,O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW|O_NONBLOCK,0600);
 if(file<0)return;struct stat status{};
 if(::fstat(file,&status)==0&&S_ISREG(status.st_mode)&&status.st_uid==::getuid()&&(status.st_mode&0077)==0&&status.st_nlink==1&&status.st_size<1024*1024){
  char line[280];const int n=std::snprintf(line,sizeof(line),"%s pid=%ld event=%ld window=%ld error=%ld x=%ld y=%ld continuation=%ld sendDrag=%ld lastTime=%ld\n",action,long(::getpid()),event,window,error,x,y,continuation,sendDrag,lastTime);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
 }
 ::close(file);
#endif
}
template<class T>class Suite {
 SPBasicSuite* basic_;const char* name_;int version_;const T* suite_=nullptr;long error_=-1;
 public:Suite(PF_InData* in,const char* name,int version):basic_(in->pica_basicP),name_(name),version_(version){if(basic_){const void* acquired=nullptr;error_=basic_->AcquireSuite(name_,version_,&acquired);if(!error_)suite_=static_cast<const T*>(acquired);}}
 ~Suite(){if(suite_)basic_->ReleaseSuite(name_,version_);}const T* operator->()const{return suite_;}explicit operator bool()const{return suite_!=nullptr;}long error()const{return error_;}
};
inline PF_Err registerUI(PF_InData* in) {
 if(!in->inter.register_ui){log("register-missing",0,0);return PF_Err_NONE;}
 PF_CustomUIInfo info{};info.events=PF_CustomEFlag_COMP|PF_CustomEFlag_EFFECT;info.comp_ui_alignment=PF_UIAlignment_NONE;
 const auto err=in->inter.register_ui(in->effect_ref,&info);log("register",0,0,err,info.events,info.comp_ui_alignment);
 // An optional probe must not make a working renderer unavailable.
 return PF_Err_NONE;
}
inline bool transform(PF_InData* in,PF_EventExtra* e,PF_FixedPoint& point,bool toFrame) {
 PF_Err err=0;
 if(toFrame&&(!e->cbs.source_to_frame||!e->cbs.layer_to_comp)){log("transform-missing-forward",e->e_type,0);return false;}
 if(!toFrame&&(!e->cbs.frame_to_source||!e->cbs.comp_to_layer)){log("transform-missing-reverse",e->e_type,0);return false;}
 if(toFrame){
  err=e->cbs.layer_to_comp(e->cbs.refcon,e->contextH,in->current_time,in->time_scale,&point);
  if(err){log("layer-to-comp-failed",e->e_type,0,err);return false;}
  err=e->cbs.source_to_frame(e->cbs.refcon,e->contextH,&point);
 }else{
  err=e->cbs.frame_to_source(e->cbs.refcon,e->contextH,&point);
  if(err){log("frame-to-source-failed",e->e_type,0,err);return false;}
  err=e->cbs.comp_to_layer(e->cbs.refcon,e->contextH,in->current_time,in->time_scale,&point);
 }
 if(err)log("coordinate-transform-failed",e->e_type,0,err);
 return err==0;
}
inline PF_Fixed fixed(double value){return static_cast<PF_Fixed>(std::max(-32767.0,std::min(32767.0,value))*65536);}
// 0=center(move), 1=right(width), 2=bottom(height), 3=bottom-right(both).
inline std::array<PF_FixedPoint,4> handles(PF_ParamDef* p[],PF_InData* in=nullptr){
 const auto x=p[Position]->u.td.x_value,y=p[Position]->u.td.y_value;
 const auto halfW=fixed(resolveDimension(p[Width]->u.fs_d.value,in,true)/2),halfH=fixed(resolveDimension(p[Height]->u.fs_d.value,in,false)/2);
 return {{{x,y},{x+halfW,y},{x,y+halfH},{x+halfW,y+halfH}}};
}
// Point parameters are already downsampled by the host. Pixel-distance sliders
// are not; apply exactly the same anisotropic factors as the frame renderer.
inline bool frameBounds(PF_InData* in,PF_ParamDef* p[],PF_EventExtra* e,std::array<PF_FixedPoint,4>& corners) {
 if(!in||!p||!p[Position]||!p[Width]||!p[Height]){log("bounds-parameters-missing",0,0);return false;}
 const double sx=in->downsample_x.den?double(in->downsample_x.num)/in->downsample_x.den:1;
 const double sy=in->downsample_y.den?double(in->downsample_y.num)/in->downsample_y.den:1;
 const double x=p[Position]->u.td.x_value/65536.0,y=p[Position]->u.td.y_value/65536.0;
 const double w=resolveDimension(p[Width]->u.fs_d.value,in,true)*sx,h=resolveDimension(p[Height]->u.fs_d.value,in,false)*sy;
 if(!std::isfinite(x)||!std::isfinite(y)||!std::isfinite(w)||!std::isfinite(h)||w<=0||h<=0){log("bounds-values-invalid",e->e_type,0);return false;}
 corners={{{fixed(x-w/2),fixed(y-h/2)},{fixed(x+w/2),fixed(y-h/2)},{fixed(x+w/2),fixed(y+h/2)},{fixed(x-w/2),fixed(y+h/2)}}};
 for(auto& point:corners)if(!transform(in,e,point,true))return false;
 return true;
}
inline bool draw(PF_InData* in,PF_ParamDef* p[],PF_EventExtra* e) {
 if(e->evt_in_flags&PF_EI_DONT_DRAW){log("draw-suppressed",e->e_type,PF_Window_COMP,0,e->evt_in_flags,e->evt_out_flags);return false;}
 std::array<PF_FixedPoint,4> corners{};if(!frameBounds(in,p,e,corners))return false;
 Suite<PF_EffectCustomUISuite1> ui(in,kPFEffectCustomUISuite,kPFEffectCustomUISuiteVersion1);
 Suite<DRAWBOT_DrawbotSuite1> drawbot(in,kDRAWBOT_DrawSuite,kDRAWBOT_DrawSuite_Version1);
 Suite<DRAWBOT_SurfaceSuite1> surface(in,kDRAWBOT_SurfaceSuite,kDRAWBOT_SurfaceSuite_Version1);
 Suite<DRAWBOT_SupplierSuite1> supplier(in,kDRAWBOT_SupplierSuite,kDRAWBOT_SupplierSuite_Version1);
 Suite<DRAWBOT_PathSuite1> path(in,kDRAWBOT_PathSuite,kDRAWBOT_PathSuite_Version1);
 if(!ui){log("suite-custom-ui-failed",e->e_type,PF_Window_COMP,ui.error());return false;}
 if(!drawbot){log("suite-drawbot-failed",e->e_type,PF_Window_COMP,drawbot.error());return false;}
 if(!surface){log("suite-surface-failed",e->e_type,PF_Window_COMP,surface.error());return false;}
 if(!supplier){log("suite-supplier-failed",e->e_type,PF_Window_COMP,supplier.error());return false;}
 if(!path){log("suite-path-failed",e->e_type,PF_Window_COMP,path.error());return false;}
 if(!ui->PF_GetDrawingReference||!drawbot->GetSurface||!drawbot->GetSupplier||!surface->StrokePath||!surface->PaintRect||!supplier->NewPen||!supplier->NewPath||!supplier->ReleaseObject||!path->MoveTo||!path->LineTo||!path->Close){log("drawing-callback-missing",e->e_type,PF_Window_COMP);return false;}
 DRAWBOT_DrawRef ref=nullptr;DRAWBOT_SurfaceRef canvas=nullptr;DRAWBOT_SupplierRef provider=nullptr;
 auto error=ui->PF_GetDrawingReference(e->contextH,&ref);if(error||!ref){log("drawing-reference-failed",e->e_type,PF_Window_COMP,error);return false;}
 error=drawbot->GetSurface(ref,&canvas);if(error||!canvas){log("drawing-surface-failed",e->e_type,PF_Window_COMP,error);return false;}
 error=drawbot->GetSupplier(ref,&provider);if(error||!provider){log("drawing-supplier-failed",e->e_type,PF_Window_COMP,error);return false;}
 const DRAWBOT_ColorRGBA color{0.2f,0.7f,1.0f,1.0f};
 DRAWBOT_PenRef pen=nullptr;DRAWBOT_PathRef outline=nullptr;
 auto cleanup=[&]{if(outline)supplier->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(outline));if(pen)supplier->ReleaseObject(reinterpret_cast<DRAWBOT_ObjectRef>(pen));};
 error=supplier->NewPen(provider,&color,1.0f,&pen);if(error||!pen){log("drawing-pen-failed",e->e_type,PF_Window_COMP,error);cleanup();return false;}
 error=supplier->NewPath(provider,&outline);if(error||!outline){log("drawing-path-failed",e->e_type,PF_Window_COMP,error);cleanup();return false;}
 auto xy=[](const PF_FixedPoint& point){return DRAWBOT_PointF32{float(point.x/65536.0),float(point.y/65536.0)};};
 auto first=xy(corners[0]);bool ok=!path->MoveTo(outline,first.x,first.y);
 for(std::size_t i=1;ok&&i<corners.size();++i){const auto point=xy(corners[i]);ok=!path->LineTo(outline,point.x,point.y);}
 if(ok)ok=!path->Close(outline);if(ok)ok=!surface->StrokePath(canvas,pen,outline);
 // Eight fixed screen-size markers follow each transformed corner and edge.
 // They communicate the independent text area, but accept no pointer input.
 for(std::size_t i=0;ok&&i<corners.size();++i){
  const auto a=xy(corners[i]),b=xy(corners[(i+1)%corners.size()]);
  const DRAWBOT_RectF32 corner{a.x-3,a.y-3,6,6},middle{(a.x+b.x)/2-3,(a.y+b.y)/2-3,6,6};
  ok=!surface->PaintRect(canvas,&color,&corner)&&!surface->PaintRect(canvas,&color,&middle);
 }
 if(ok)log("draw-handles",e->e_type,PF_Window_COMP,0,std::lround(corners[0].x/65536.0),std::lround(corners[0].y/65536.0),std::lround(corners[2].x/65536.0),std::lround(corners[2].y/65536.0),e->evt_in_flags);
 else log("drawing-path-or-paint-failed",e->e_type,PF_Window_COMP);
 cleanup();return ok;
}
inline PF_Err event(PF_InData* in,PF_ParamDef* p[],PF_EventExtra* e) {
 if(!e||!e->contextH||!*e->contextH){log("event-context-missing",0,-1);return PF_Err_NONE;}
 const auto window=(*e->contextH)->w_type;
 if(e->e_type!=PF_Event_IDLE)log("event",e->e_type,window,0,e->evt_in_flags,e->evt_out_flags);
 if(window==PF_Window_EFFECT)return better_captions::adobe::purposeful_controls::event(in,p,e);
 if(window!=PF_Window_COMP)return PF_Err_NONE;
 if(e->e_type==PF_Event_DRAW){if(draw(in,p,e))e->evt_out_flags|=PF_EO_HANDLED_EVENT;return PF_Err_NONE;}
#if BC_ENABLE_CUSTOM_UI_PROBE
 if(e->e_type==PF_Event_DO_CLICK||e->e_type==PF_Event_DRAG){
  const auto& click=e->u.do_click;log("pointer",e->e_type,window,0,click.screen_point.h,click.screen_point.v,static_cast<long>(click.continue_refcon[0]),click.send_drag,click.last_time);
 }
 // Match the official CCU sample: some continuation callbacks retain DO_CLICK.
 if(e->e_type==PF_Event_DO_CLICK&&e->u.do_click.send_drag)e->e_type=PF_Event_DRAG;
 if(e->e_type==PF_Event_DO_CLICK){
  auto points=handles(p,in);const auto mouse=e->u.do_click.screen_point;
  for(std::size_t i=0;i<points.size();++i){auto point=points[i];if(!transform(in,e,point,true))continue;
   if(std::hypot(point.x/65536.0-mouse.h,point.y/65536.0-mouse.v)<=10){e->u.do_click.continue_refcon[0]=i+1;e->u.do_click.send_drag=TRUE;e->evt_out_flags|=PF_EO_HANDLED_EVENT;log("handle-click",e->e_type,window,i+1,mouse.h,mouse.v,i+1,TRUE,e->u.do_click.last_time);return PF_Err_NONE;}}
  log("handle-miss",e->e_type,window,0,mouse.h,mouse.v);
 }
 if(e->e_type==PF_Event_DRAG){
  auto& click=e->u.do_click;const auto mode=click.continue_refcon[0];if(mode<1||mode>4)return PF_Err_NONE;
  PF_FixedPoint point{fixed(click.screen_point.h),fixed(click.screen_point.v)};if(!transform(in,e,point,false))return PF_Err_NONE;
  if(mode==1){p[Position]->u.td.x_value=point.x;p[Position]->u.td.y_value=point.y;p[Position]->uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;}
  if(mode==2||mode==4){p[Width]->u.fs_d.value=std::max(1.0,std::min(8192.0,2*std::abs((double(point.x)-p[Position]->u.td.x_value)/65536.0)));p[Width]->uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;}
  if(mode==3||mode==4){p[Height]->u.fs_d.value=std::max(1.0,std::min(8192.0,2*std::abs((double(point.y)-p[Position]->u.td.y_value)/65536.0)));p[Height]->uu.change_flags|=PF_ChangeFlag_CHANGED_VALUE;}
  click.send_drag=!click.last_time;if(click.last_time)click.continue_refcon[0]=0;
  e->evt_out_flags|=PF_EO_HANDLED_EVENT|PF_EO_ALWAYS_UPDATE;log("native-param-drag",e->e_type,window,mode);
 }
#endif
 return PF_Err_NONE;
}
}
