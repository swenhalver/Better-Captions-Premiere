#pragma once
// Isolated eligibility experiment only; no float CPU renderer is implemented.
namespace better_captions::adobe::gpu_float_probe {
inline PF_Err setup(PF_InData* in,PF_OutData* out){
 out->out_flags2|=PF_OutFlag2_FLOAT_COLOR_AWARE;
 if(!in||in->appl_id!=kAppID_Premiere||!in->effect_ref)return PF_Err_NONE;
 source_time_probe::Suite<PF_PixelFormatSuite1> formats(in,kPFPixelFormatSuite,kPFPixelFormatSuiteVersion1);
 if(!formats||!formats->ClearSupportedPixelFormats||!formats->AddSupportedPixelFormat)return PF_Err_INVALID_CALLBACK;
 PF_Err error=formats->ClearSupportedPixelFormats(in->effect_ref);if(error)return error;
 error=formats->AddSupportedPixelFormat(in->effect_ref,PrPixelFormat_BGRA_4444_32f);if(error)return error;
 return formats->AddSupportedPixelFormat(in->effect_ref,PrPixelFormat_ARGB_4444_8u);
}
inline PF_Err guard(PF_InData* in,PF_ParamDef* params[],PF_LayerDef* output){
 if(!in||!in->effect_ref||in->appl_id!=kAppID_Premiere)return PF_Err_NONE;
 source_time_probe::Suite<PF_PixelFormatSuite1> formats(in,kPFPixelFormatSuite,kPFPixelFormatSuiteVersion1);
 if(!formats||!formats->GetPixelFormat||!params||!params[0]||!output)return PF_Err_INVALID_CALLBACK;
 PrPixelFormat inputFormat{},outputFormat{};
 if(formats->GetPixelFormat(&params[0]->u.ld,&inputFormat)||formats->GetPixelFormat(output,&outputFormat))return PF_Err_INVALID_CALLBACK;
 return inputFormat==PrPixelFormat_ARGB_4444_8u&&outputFormat==PrPixelFormat_ARGB_4444_8u?PF_Err_NONE:PF_Err_BAD_CALLBACK_PARAM;
}
}
