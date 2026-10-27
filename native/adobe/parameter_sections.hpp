#pragma once
// Adobe AE_Effect.h documents PF_PUI_ECW_SEPARATOR specifically for Premiere:
// visual parameter grouping "without adding groups". Group start/end rows
// would consume new slots and move persisted PF/GPU/CEP parameter indexes.
// This preserves the stock float-slider definition byte for byte, except for
// its supported Premiere section separator. Existing state topics stay intact.
#define BC_ADD_SECTION_SLIDER(NAME, VALID_MIN, VALID_MAX, SLIDER_MIN, SLIDER_MAX, DFLT, PREC, DISP, FLAGS, ID) \
 do { \
  AEFX_CLR_STRUCT(def); \
  def.flags = (FLAGS); \
  def.ui_flags = PF_PUI_ECW_SEPARATOR; \
  PF_ADD_FLOAT_SLIDER(NAME, VALID_MIN, VALID_MAX, SLIDER_MIN, SLIDER_MAX, AEFX_DEFAULT_CURVE_TOLERANCE, DFLT, PREC, DISP, false, ID); \
 } while (0)
