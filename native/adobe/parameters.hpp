#pragma once
// Parameter positions are shared only by this compiled adapter and its tests.
// Host CEP/UXP indexes must still be discovered from actual parameter metadata.
namespace better_captions::adobe::parameters {
enum Param {
 Input=0, Position=1, Width=2, Height=3, MaxChars=4, Size=5, TextColor=6, Transcript=7,
 CurrentGroup, CurrentSize, CurrentTint, CurrentOpacity, CurrentBubble, CurrentBubbleTint, CurrentBubbleOpacity, CurrentPadding, CurrentRadius, CurrentEnd,
 SpokenGroup, SpokenSize, SpokenTint, SpokenOpacity, SpokenBubble, SpokenBubbleTint, SpokenBubbleOpacity, SpokenPadding, SpokenRadius, SpokenEnd,
 UpcomingGroup, UpcomingSize, UpcomingTint, UpcomingOpacity, UpcomingBubble, UpcomingBubbleTint, UpcomingBubbleOpacity, UpcomingPadding, UpcomingRadius, UpcomingEnd,
 Count
};
enum DiskId {
 PositionId=1, WidthId=2, HeightId=3, MaxCharsId=4, SizeId=5, ColorId=6, TranscriptId=7,
 CurrentSizeId=8, CurrentTintId=9, CurrentOpacityId=10, CurrentBubbleId=11, CurrentBubbleTintId=12, CurrentBubbleOpacityId=13, CurrentPaddingId=14, CurrentRadiusId=15,
 SpokenSizeId=16, SpokenTintId=17, SpokenOpacityId=18, SpokenBubbleId=19, SpokenBubbleTintId=20, SpokenBubbleOpacityId=21, SpokenPaddingId=22, SpokenRadiusId=23,
 UpcomingSizeId=24, UpcomingTintId=25, UpcomingOpacityId=26, UpcomingBubbleId=27, UpcomingBubbleTintId=28, UpcomingBubbleOpacityId=29, UpcomingPaddingId=30, UpcomingRadiusId=31,
 CurrentGroupId=100, CurrentEndId=101, SpokenGroupId=102, SpokenEndId=103, UpcomingGroupId=104, UpcomingEndId=105
};
static_assert(Transcript==7 && TranscriptId==7,"Existing carrier position and disk ID are permanent");
}
