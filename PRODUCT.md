# Better Captions

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Premiere Pro editors working in docked panels, usually 280–480px wide.

## Product Purpose

Transcribe in Premiere, correct timed words, group sentences, style captions and apply them to the main Program Monitor without leaving the editing workflow.

## Operating Context

One visible UXP panel and an invisible CEP renderer. The Svelte browser preview uses synthetic data; native actions require Premiere. The user subsequently authorized opening and using Premiere on this Windows PC and requested Windows/macOS support. Do not rearrange native workspaces. Premiere 26.5.2 now opens normally after the user resolved activation. Native paths, dependencies and installation now support both systems; Adobe's Windows installer returned -903, so installation and new host behavior have not been verified in the current native host. macOS runtime verification also remains outstanding.

## Capabilities and Constraints

- Preserve native “Transcribe in Premiere” and direct Speech to Text, transcription edits, sentence grouping, phrase/word timings, placement, fonts, outline, shadow, animations and timeline actions.
- Independent upcoming, current and previously spoken styles. Current words support a rounded bubble, padding, radius, size/scale, color and opacity.
- Captions appear on Premiere’s main Program Monitor. No plugin canvas, fake monitor or helper window.
- Native Motion controls handle position and independent width/height. Width reflows without changing font size. Position and dimensions can be keyframed. Mac/Premiere runtime verification remains required.
- Preserve agent hooks, style allowlists, protocol, identity/sequence checks, private file bridge, serialized bounded work, heartbeat, ownership and watcher pause/visibility protections. No network command endpoints, arbitrary shell/eval hooks or remote dependencies.
- Approved implementation scope (2026-10-17): replace the production interface with Transcript and Styling tabs; add the single-lane, non-overlapping word editor, independent past/current/next typography and effects, and native text-area keyframe controls. The user explicitly requested a functional Mac-compatible build and GitHub upload. Extend the renderer and optional style fields as needed while preserving existing saved-session appearance, roll-up behavior, clip identity and security protections.

## Brand Commitments

Better Captions is a calm usable editing tool. The user explicitly wants it to feel Premiere native: neutral host surfaces, compact familiar controls and restrained blue selection. Concise copy, deliberate help disclosure, actionable errors and a clear primary workflow. Premiere only.

## Evidence on Hand

Existing caption editor and native adapter at core v0.3.1; automated host, transcript, renderer and security tests. Browser data is synthetic and must be labeled.

## Product Principles

- Keep the transcript central to editing.
- Preserve native host behavior and identities.
- Reveal detail when needed in a narrow panel.
- Make changes and action availability understandable.
