#include "render_style.hpp"
#include <cmath>
#include <iostream>
#include <stdexcept>
void check(bool value){if(!value)throw std::runtime_error("Native independent-style test failed");}
bool near(double a,double b){return std::abs(a-b)<1e-10;}
int main(){try{
 using namespace better_captions;Document source;
 source.style.upcoming.fontSize=24;source.style.upcoming.color={0.2,0.4,0.6,0.7};
 source.style.current.fontSize=48;source.style.current.sizeScale=1.4;source.style.current.color={0.9,0.3,0.1,0.6};source.style.current.opacity=0.8;
 source.style.spoken.fontSize=18;source.style.spoken.color={0.1,0.8,0.4,0.5};
 source.style.current.outlineWidth=4;source.style.current.shadowBlur=8;source.style.current.shadowX=10;source.style.current.shadowY=12;source.style.wordSpacing=14;
 auto neutral=source;adobe::applyNativeStyle(neutral,64,{1,1,1,1},1,1);
 check(encode(neutral)==encode(source));
 auto scaled=source;adobe::applyNativeStyle(scaled,128,{0.5,0.25,1,1},1,1);
 check(scaled.style.upcoming.fontSize==48&&scaled.style.current.fontSize==96&&scaled.style.spoken.fontSize==36);
 check(near(scaled.style.current.color.r,0.45)&&near(scaled.style.current.color.g,0.075)&&scaled.style.current.color.b==0.1);
 check(scaled.style.current.color.a==0.6&&scaled.style.current.opacity==0.8&&scaled.style.current.sizeScale==1.4);
 check(scaled.style.current.bubbleColor.r==source.style.current.bubbleColor.r&&scaled.style.current.outlineColor.a==source.style.current.outlineColor.a);
 auto half=source;adobe::applyNativeStyle(half,64,{1,1,1,1},0.5,0.5);
 check(half.style.current.fontSize==24&&half.style.current.outlineWidth==2&&half.style.current.shadowBlur==4&&half.style.current.shadowX==5&&half.style.current.shadowY==6&&half.style.wordSpacing==7);
 check(encode(source)!=encode(scaled)); // original was not changed through copy
 adobe::NativeAppearanceControls controls;
 auto neutralAppearances=source;adobe::applyNativeStyle(neutralAppearances,64,{1,1,1,1},1,1,controls);
 check(encode(neutralAppearances)==encode(source));
 controls.current.sizePercent=150;controls.current.textTint={0.5,1,0.5,1};controls.current.opacityPercent=40;
 controls.current.bubbleMode=2;controls.current.bubbleTint={0.5,0.25,1,1};controls.current.bubbleOpacityPercent=30;
 controls.current.paddingPercent=200;controls.current.radiusPercent=50;
 auto appearance=source;adobe::applyNativeStyle(appearance,64,{1,1,1,1},1,1,controls);
 check(near(appearance.style.current.fontSize,72)&&near(appearance.style.current.opacity,0.32));
 check(appearance.style.current.sizeScale==source.style.current.sizeScale&&appearance.style.current.color.a==source.style.current.color.a);
 check(near(appearance.style.current.color.r,source.style.current.color.r*0.5)&&appearance.style.current.bubble);
 check(near(appearance.style.current.bubbleColor.a,source.style.current.bubbleColor.a*0.3));
 check(appearance.style.current.padding==source.style.current.padding*2&&appearance.style.current.radius==source.style.current.radius/2);
 auto untouched=source;untouched.style.current=appearance.style.current;check(encode(untouched)==encode(appearance));
 auto appearanceHalf=source;adobe::applyNativeStyle(appearanceHalf,128,{1,1,1,1},0.5,0.5,controls);
 check(appearanceHalf.style.current.fontSize==source.style.current.fontSize*1.5);
 check(appearanceHalf.style.current.padding==source.style.current.padding&&appearanceHalf.style.current.radius==source.style.current.radius/4);
 auto axes=source;axes.style.current.bubblePaddingInline=10;axes.style.current.bubblePaddingBlock=3;
 adobe::applyNativeStyle(axes,64,{1,1,1,1},.5,.25,controls);
 check(axes.style.current.bubblePaddingInline==10&&axes.style.current.bubblePaddingBlock==1.5); // native Padding% then axis-specific downsampling
 controls.current.bubbleMode=3;auto off=source;adobe::applyNativeStyle(off,64,{1,1,1,1},1,1,controls);check(!off.style.current.bubble);
 bool rejected=false;controls.current.sizePercent=0;try{adobe::applyNativeStyle(off,64,{1,1,1,1},1,1,controls);}catch(const std::invalid_argument&){rejected=true;}check(rejected);
 std::cout<<"Native styles passed: neutral byte equality, independent state overrides, bubble mode/tint/opacity/extents, alpha preservation and downsampling.\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<'\n';return 1;}}
