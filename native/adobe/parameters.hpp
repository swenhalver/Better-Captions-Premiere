#pragma once
// Parameter positions are shared only by this compiled adapter and its tests.
// Host CEP/UXP indexes must still be discovered from actual parameter metadata.
namespace better_captions::adobe::parameters {
enum Param {
 Input=0, LayoutGroup, Position, Width, WidthUI, Height, HeightUI, LayoutEnd,
 TextGroup, Size, TextColor, TextAlignment, TextAlignmentUI, Transcript, TextEnd,
 WordStylesGroup,
 CurrentGroup, CurrentSize, CurrentTint, CurrentOpacity, CurrentBubble, CurrentBubbleTint, CurrentBubbleOpacity, CurrentPadding, CurrentRadius, CurrentEnd,
 SpokenGroup, SpokenSize, SpokenTint, SpokenOpacity, SpokenBubble, SpokenBubbleTint, SpokenBubbleOpacity, SpokenPadding, SpokenRadius, SpokenEnd,
 UpcomingGroup, UpcomingSize, UpcomingTint, UpcomingOpacity, UpcomingBubble, UpcomingBubbleTint, UpcomingBubbleOpacity, UpcomingPadding, UpcomingRadius, UpcomingEnd,
 WordStylesEnd, CaptionGroup, MaxChars, GroupsPerPage, CaptionEnd,
 RollUpGroup, RollUpEnabled, RollUpEnabledUI, RollUpLines, RollUpCurrentLine, RollUpBlankLineSeconds, RollUpDuration, DirectionalFadeGroup, RollUpBoundary, RollUpBoundaryUI, RollUpPosition, RollUpThickness, RollUpFade, RollUpCurve, RollUpCurveUI, DirectionalFadeEnd,
 RollUpDirection, RollUpDirectionUI, RollUpSpeed, RollUpWait, RollUpWaitUI, LineTransition, LineTransitionUI,
 BoundariesGroup, BoundaryMode,
 TopBoundaryGroup, TopInset, TopFadeEnabled, TopFadeWidth, TopFadeAmount, TopFadeCurve, TopBoundaryEnd,
 BottomBoundaryGroup, BottomInset, BottomFadeEnabled, BottomFadeWidth, BottomFadeAmount, BottomFadeCurve, BottomBoundaryEnd,
 LeftBoundaryGroup, LeftInset, LeftFadeEnabled, LeftFadeWidth, LeftFadeAmount, LeftFadeCurve, LeftBoundaryEnd,
 RightBoundaryGroup, RightInset, RightFadeEnabled, RightFadeWidth, RightFadeAmount, RightFadeCurve, RightBoundaryEnd,
 BoundariesEnd, RollUpEnd,
 ShowAnimationUI, EditBoundsLease,
 Count
};
enum DiskId {
 PositionId=1, WidthId=2, HeightId=3, MaxCharsId=4, SizeId=5, ColorId=6, TranscriptId=7,
 CurrentSizeId=8, CurrentTintId=9, CurrentOpacityId=10, CurrentBubbleId=11, CurrentBubbleTintId=12, CurrentBubbleOpacityId=13, CurrentPaddingId=14, CurrentRadiusId=15,
 SpokenSizeId=16, SpokenTintId=17, SpokenOpacityId=18, SpokenBubbleId=19, SpokenBubbleTintId=20, SpokenBubbleOpacityId=21, SpokenPaddingId=22, SpokenRadiusId=23,
 UpcomingSizeId=24, UpcomingTintId=25, UpcomingOpacityId=26, UpcomingBubbleId=27, UpcomingBubbleTintId=28, UpcomingBubbleOpacityId=29, UpcomingPaddingId=30, UpcomingRadiusId=31,
 CurrentGroupId=100, CurrentEndId=101, SpokenGroupId=102, SpokenEndId=103, UpcomingGroupId=104, UpcomingEndId=105,
 GroupsPerPageId=32,
 RollUpEnabledId=34, RollUpLinesId=35, RollUpDurationId=36, RollUpBoundaryId=37, RollUpPositionId=38, RollUpThicknessId=39, RollUpFadeId=40, RollUpCurveId=41,
 RollUpDirectionId=42, RollUpSpeedId=43, RollUpWaitId=44, LineTransitionId=45, TextAlignmentId=46,
 BoundaryModeId=47,
 TopInsetId=48,TopFadeEnabledId=49,TopFadeWidthId=50,TopFadeAmountId=51,TopFadeCurveId=52,
 BottomInsetId=53,BottomFadeEnabledId=54,BottomFadeWidthId=55,BottomFadeAmountId=56,BottomFadeCurveId=57,
 LeftInsetId=58,LeftFadeEnabledId=59,LeftFadeWidthId=60,LeftFadeAmountId=61,LeftFadeCurveId=62,
 RightInsetId=63,RightFadeEnabledId=64,RightFadeWidthId=65,RightFadeAmountId=66,RightFadeCurveId=67,
 RollUpCurrentLineId=68, RollUpBlankLineSecondsId=69,
 LayoutGroupId=200, LayoutEndId=201, TextGroupId=202, TextEndId=203, WordStylesGroupId=204, WordStylesEndId=205, CaptionGroupId=206, CaptionEndId=207, RollUpGroupId=208, RollUpEndId=209, EditBoundsLeaseId=210,
 BoundariesGroupId=211,BoundariesEndId=212,
 TopBoundaryGroupId=213,TopBoundaryEndId=214,BottomBoundaryGroupId=215,BottomBoundaryEndId=216,
 LeftBoundaryGroupId=217,LeftBoundaryEndId=218,RightBoundaryGroupId=219,RightBoundaryEndId=220,
 DirectionalFadeGroupId=221,DirectionalFadeEndId=222,
 TextAlignmentUIId=300,RollUpEnabledUIId=302,RollUpBoundaryUIId=303,RollUpCurveUIId=304,RollUpDirectionUIId=305,RollUpWaitUIId=306,LineTransitionUIId=307,ShowAnimationUIId=308,WidthUIId=309,HeightUIId=310
};
// Disk IDs, rather than registration positions, preserve saved values and keys.
static_assert(PositionId==1&&WidthId==2&&HeightId==3&&TranscriptId==7&&TextAlignmentId==46,"Saved parameter IDs must remain stable");
}
