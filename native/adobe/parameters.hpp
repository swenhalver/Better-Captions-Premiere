#pragma once
// Parameter positions are shared only by this compiled adapter and its tests.
// Host CEP/UXP indexes must still be discovered from actual parameter metadata.
namespace better_captions::adobe::parameters {
enum Param {
 Input=0, Position=1, Width=2, Height=3, MaxChars=4, Size=5, TextColor=6, Transcript=7,
 CurrentGroup, CurrentSize, CurrentTint, CurrentOpacity, CurrentBubble, CurrentBubbleTint, CurrentBubbleOpacity, CurrentPadding, CurrentRadius, CurrentEnd,
 SpokenGroup, SpokenSize, SpokenTint, SpokenOpacity, SpokenBubble, SpokenBubbleTint, SpokenBubbleOpacity, SpokenPadding, SpokenRadius, SpokenEnd,
 UpcomingGroup, UpcomingSize, UpcomingTint, UpcomingOpacity, UpcomingBubble, UpcomingBubbleTint, UpcomingBubbleOpacity, UpcomingPadding, UpcomingRadius, UpcomingEnd,
 GroupsPerPage,
 SmartLineFit,
 RollUpEnabled, RollUpLines, RollUpDuration, RollUpBoundary, RollUpPosition, RollUpThickness, RollUpFade, RollUpCurve,
 RollUpDirection, RollUpSpeed, RollUpWait,
 LineTransition,
 Count
};
enum DiskId {
 PositionId=1, WidthId=2, HeightId=3, MaxCharsId=4, SizeId=5, ColorId=6, TranscriptId=7,
 CurrentSizeId=8, CurrentTintId=9, CurrentOpacityId=10, CurrentBubbleId=11, CurrentBubbleTintId=12, CurrentBubbleOpacityId=13, CurrentPaddingId=14, CurrentRadiusId=15,
 SpokenSizeId=16, SpokenTintId=17, SpokenOpacityId=18, SpokenBubbleId=19, SpokenBubbleTintId=20, SpokenBubbleOpacityId=21, SpokenPaddingId=22, SpokenRadiusId=23,
 UpcomingSizeId=24, UpcomingTintId=25, UpcomingOpacityId=26, UpcomingBubbleId=27, UpcomingBubbleTintId=28, UpcomingBubbleOpacityId=29, UpcomingPaddingId=30, UpcomingRadiusId=31,
 CurrentGroupId=100, CurrentEndId=101, SpokenGroupId=102, SpokenEndId=103, UpcomingGroupId=104, UpcomingEndId=105,
 GroupsPerPageId=32, SmartLineFitId=33,
 RollUpEnabledId=34, RollUpLinesId=35, RollUpDurationId=36, RollUpBoundaryId=37, RollUpPositionId=38, RollUpThicknessId=39, RollUpFadeId=40, RollUpCurveId=41,
 RollUpDirectionId=42, RollUpSpeedId=43, RollUpWaitId=44, LineTransitionId=45
};
static_assert(Transcript==7 && TranscriptId==7,"Existing carrier position and disk ID are permanent");
static_assert(UpcomingEnd==37&&GroupsPerPage==38&&GroupsPerPageId==32,"Page grouping must append after all existing native controls");
static_assert(SmartLineFit==39&&SmartLineFitId==33,"Smart fit must append without moving saved native parameter identities");
static_assert(RollUpEnabled==40&&RollUpCurve==47&&RollUpWait==50&&RollUpWaitId==44,"Roll-up controls must append without moving saved controls");
static_assert(LineTransition==51&&LineTransitionId==45,"Line transition must append after every existing native control");
}
