// Original SDR source-over kernel. No Adobe implementation source.
#include <metal_stdlib>
using namespace metal;
struct CaptionCompositeParams {
 uint width,height,inputPitch,overlayPitch,outputPitch;
 uint inputHalf,overlayHalf,outputHalf,overlayStraight,inputStraight,outputStraight;
};
kernel void captionComposite(device const uchar* input [[buffer(0)]],
 device const uchar* overlay [[buffer(1)]],device uchar* output [[buffer(2)]],
 constant CaptionCompositeParams& p [[buffer(3)]],uint2 xy [[thread_position_in_grid]]) {
 if(xy.x>=p.width||xy.y>=p.height)return;
 device const uchar* a=input+xy.y*p.inputPitch;
 device const uchar* b=overlay+xy.y*p.overlayPitch;
 device uchar* c=output+xy.y*p.outputPitch;
 float4 bg=p.inputHalf?float4(((device const half4*)a)[xy.x]):((device const float4*)a)[xy.x];
 float4 fg=p.overlayHalf?float4(((device const half4*)b)[xy.x]):((device const float4*)b)[xy.x];
 float alpha=clamp(fg.a,0.0f,1.0f);
 // No caption coverage: preserve untouched source bits/hidden RGB without
 // associate/unassociate rounding when input and output conventions match.
 if(alpha==0.0f&&p.inputStraight==p.outputStraight){
  if(p.outputHalf)((device half4*)c)[xy.x]=half4(bg);
  else ((device float4*)c)[xy.x]=bg;
  return;
 }
 float backgroundAlpha=clamp(bg.a,0.0f,1.0f);
 float3 foregroundPremult=p.overlayStraight?fg.rgb*alpha:fg.rgb;
 float3 backgroundPremult=p.inputStraight?bg.rgb*backgroundAlpha:bg.rgb;
 float outputAlpha=alpha+backgroundAlpha*(1.0f-alpha);
 float3 resultRGB=foregroundPremult+backgroundPremult*(1.0f-alpha);
 if(p.outputStraight)resultRGB=outputAlpha>0.0f?resultRGB/outputAlpha:float3(0.0f);
 float4 result=float4(resultRGB,outputAlpha);
 // RGB is intentionally not clamped: source footage values must survive.
 if(p.outputHalf)((device half4*)c)[xy.x]=half4(result);
 else ((device float4*)c)[xy.x]=result;
}
