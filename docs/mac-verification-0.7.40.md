# Mac verification 0.7.40

Installed the UXP panel, CEP service and rebuilt native effect in Premiere Pro 26.5.2. Native production builds now enable DRAW-only bounds UI by default. No overlay pixels are added to rendered video or exports.

On the active 720 by 1280 production sequence, clicking the actual panel Width reset set Width to 648 while preserving Height 201. Clicking Height reset set Height to 1152 while preserving Width 648. Host parameter readback confirmed both values. The Program Monitor box resized with the changes. A Position X drag moved 360 to 380, and the monitor rectangle followed while the panel stayed stationary.

Activated the native effect header in Effect Controls. The bounds remained visible after returning to Better Captions, editing dimensions, dragging Position and restoring the user's original geometry. Premiere custom-UI event routing still depends on the native effect being selected; the public scripting APIs do not provide automatic effect-header activation. This fixes the disabled-build regression and leaves the current caption selected with working bounds, but universal automatic activation after selecting another effect is not verified.

An unrelated native Premiere Graphic clip has no projectItem. Discovery now handles that absence while retaining strict identity checks for native caption sources. A regression test covers the case. The existing Graphic was preserved.

Restored Position [0.5, 0.8421875], Width 674 and Height 201 after testing. All six sequence graphs matched the fresh pre-update snapshot exactly, including clip identities, source/timeline ticks, component parameters and caption documents. Saved the project and left Premiere open.

Validation: Svelte zero errors/warnings; JavaScript 1008 passed, two expected skips; native real Adobe SDK smoke, arbitrary data, render style, custom UI and source-time checks passed. Native installed binary SHA256 f53c49313bca999a5d55f2303c2c2493c185df237fa506c3fc60055c68c338a7.
