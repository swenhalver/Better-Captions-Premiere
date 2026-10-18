#pragma once
#include "source_time.hpp"
#include "../core/caption_core.hpp"
#include <algorithm>
#include <limits>
namespace better_captions::adobe {
inline void logRenderTime(PF_InData* in,const source_time_probe::OwnLayerClock& c,const Document& doc,double time,const LayoutBox& box,bool demo,PF_Err error,long long alphaCount) {
 if(!in->effect_ref)return; // mock binary tests never mix with actual host evidence
 const int file=::open("/tmp/better-captions-native-render-time.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);
 if(file<0)return;struct stat st{};
 if(::fstat(file,&st)==0&&S_ISREG(st.st_mode)&&st.st_uid==::getuid()&&st.st_size<2*1024*1024){
  std::size_t words=0;double first=std::numeric_limits<double>::infinity(),last=-std::numeric_limits<double>::infinity();
  for(const auto& container:doc.containers)for(const auto& word:container.words){++words;first=std::min(first,word.start);last=std::max(last,word.end);}
  char line[1100];const int n=std::snprintf(line,sizeof(line),"PF=%ld/%ld step=%ld seq=%lld startFrame=%ld trackFrame=%ld frameTicks=%lld ticksPerSecond=%lld speed=%.12g origin=%.15g final=%.15g containers=%zu words=%zu first=%.15g last=%.15g schema=%u demo=%d box=%.6g,%.6g,%.6g,%.6g err=%ld callbacks=%ld,%ld,%ld,%ld,%ld,%ld alphaPixels=%lld\n",long(in->current_time),long(in->time_scale),long(in->time_step),(long long)c.sequenceTime,long(c.startFrame),long(c.trackStartFrame),(long long)c.frameTicks,(long long)c.ticksPerSecond,c.speed,doc.timeOriginSeconds,time,doc.containers.size(),words,first,last,unsigned(doc.schemaVersion),int(demo),box.x,box.y,box.width,box.height,long(error),long(c.errSequence),long(c.errTrack),long(c.errStart),long(c.errRate),long(c.errSpeed),long(c.errClock),alphaCount);
  if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
 }
 ::close(file);
}
}
