#define BC_UI_PROBE_TEST_NO_LOG 1
#include "AEConfig.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "custom_ui.hpp"
#include <iostream>
#include <stdexcept>
namespace {
PF_Err screen(void*,PF_ContextH,PF_FixedPoint*){return 0;}
PF_Err layer(void*,PF_ContextH,A_long,A_long,PF_FixedPoint*){return 0;}
void check(bool value){if(!value)throw std::runtime_error("custom UI probe test failed");}
}
int main(){try{
 using namespace better_captions::adobe::ui_probe;
 PF_InData in{};PF_Context context{};context.w_type=PF_Window_COMP;PF_ContextPtr ptr=&context;
 PF_EventExtra e{};e.contextH=&ptr;e.cbs.source_to_frame=screen;e.cbs.frame_to_source=screen;e.cbs.layer_to_comp=layer;e.cbs.comp_to_layer=layer;
 std::array<PF_ParamDef,4> values{};std::array<PF_ParamDef*,4> p{};for(int i=0;i<4;++i)p[i]=&values[i];
 p[1]->u.td.x_value=fixed(320);p[1]->u.td.y_value=fixed(270);p[2]->u.fs_d.value=400;p[3]->u.fs_d.value=100;
 e.e_type=PF_Event_DO_CLICK;e.u.do_click.screen_point.h=520;e.u.do_click.screen_point.v=270;check(event(&in,p.data(),&e)==0);check(e.u.do_click.continue_refcon[0]==2&&e.u.do_click.send_drag);
 e.e_type=PF_Event_DRAG;e.u.do_click.screen_point.h=470;check(event(&in,p.data(),&e)==0);check(p[2]->u.fs_d.value==300&&p[3]->u.fs_d.value==100);check(p[2]->uu.change_flags&PF_ChangeFlag_CHANGED_VALUE);
 e.e_type=PF_Event_DO_CLICK;e.u.do_click.screen_point.h=320;e.u.do_click.screen_point.v=320;check(event(&in,p.data(),&e)==0);check(e.u.do_click.continue_refcon[0]==3);
 e.e_type=PF_Event_DRAG;e.u.do_click.screen_point.v=345;e.u.do_click.last_time=TRUE;check(event(&in,p.data(),&e)==0);check(p[2]->u.fs_d.value==300&&p[3]->u.fs_d.value==150&&!e.u.do_click.send_drag);
 e={};e.contextH=&ptr;e.cbs.source_to_frame=screen;e.cbs.frame_to_source=screen;e.cbs.layer_to_comp=layer;e.cbs.comp_to_layer=layer;e.e_type=PF_Event_DO_CLICK;e.u.do_click.screen_point.h=320;e.u.do_click.screen_point.v=270;check(event(&in,p.data(),&e)==0);check(e.u.do_click.continue_refcon[0]==1);
 e.e_type=PF_Event_DRAG;e.u.do_click.screen_point.h=330;e.u.do_click.screen_point.v=280;check(event(&in,p.data(),&e)==0);check(p[1]->u.td.x_value==fixed(330)&&p[1]->u.td.y_value==fixed(280));
 context.w_type=PF_Window_EFFECT;e.e_type=PF_Event_DRAG;e.u.do_click.screen_point.h=999;check(event(&in,p.data(),&e)==0);check(p[1]->u.td.x_value==fixed(330));
 std::cout<<"Custom UI event logic passed with identity callback mocks; not Program Monitor event routing proof.\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
