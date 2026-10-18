// Original resource declaration using the locally installed Adobe resource types.
#include "AEConfig.h"
#include "AE_EffectVers.h"
#include <AE_General.r>
resource 'PiPL' (16000) {{
 Kind { AEEffect },
 Name { "Better Captions Native Probe" },
 Category { "Better Captions" },
 CodeMacARM64 { "EffectMain" },
 AE_PiPL_Version { 2, 0 },
 AE_Effect_Spec_Version { PF_PLUG_IN_VERSION, PF_PLUG_IN_SUBVERS },
 AE_Effect_Version { 32769 },
 AE_Effect_Info_Flags { 0 },
 AE_Effect_Global_OutFlags {
#if BC_ENABLE_CUSTOM_UI_PROBE
 0x00008004
#else
 0x00000004
#endif
 },
 AE_Effect_Global_OutFlags_2 { 0 },
 AE_Effect_Match_Name { "com.swen.bettercaptions.native.experimental" },
 AE_Reserved_Info { 8 },
 AE_Effect_Support_URL { "https://github.com/swenhalver/Better-Captions-Premiere" }
}};
