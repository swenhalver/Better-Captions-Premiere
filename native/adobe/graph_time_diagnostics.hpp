#pragma once
// Read-only, bounded host investigation. No graph value selects caption time.
#include <PrSDKVideoSegmentSuite.h>
#include <PrSDKVideoSegmentProperties.h>
#include <PrSDKMemoryManagerSuite.h>
#include <atomic>
#include <algorithm>
#include <cstdlib>
#include <cstring>
namespace better_captions::adobe::source_time_probe {
inline bool graphCallbacksReady(const PrSDKVideoSegmentSuite* graph,const PrSDKMemoryManagerSuite* memory){return graph&&memory&&graph->GetNodeProperty&&graph->ReleaseVideoNodeID&&graph->GetNodeOperatorCount&&graph->AcquireOperatorNodeID&&graph->GetNodeInputCount&&graph->AcquireInputNodeID&&graph->AcquireOperatorOwnerNodeID&&graph->TransformNodeTime&&graph->AcquireVideoSegmentsID&&graph->ReleaseVideoSegmentsID&&graph->AcquireNodeForTime&&memory->GetPtrSize&&memory->PrDisposePtr;}
struct GraphTrace {
 const PrSDKVideoSegmentSuite* graph;const PrSDKMemoryManagerSuite* memory;
 int file;A_long filter;PrTime pf,sequence;int visited=0,matches=0;
 struct Entry{csSDK_int32 node=0;PrTime edgeOffset=0;int edgeKind=0;};Entry path[17]{};PrTime rootOffset=0;
 bool number(csSDK_int32 node,const char* key,long long& out){
  PrMemoryPtr value=nullptr;if(graph->GetNodeProperty(node,key,&value)||!value)return false;
  const auto size=memory->GetPtrSize(value);bool ok=false;
  if(size&&size<=256&&std::memchr(value,0,size)){char* end=nullptr;const auto parsed=std::strtoll(reinterpret_cast<const char*>(value),&end,10);if(end!=reinterpret_cast<const char*>(value)&&*end==0){out=parsed;ok=true;}}
  memory->PrDisposePtr(value);return ok;
 }
 void dumpPath(int depth,int candidate){
  for(int i=0;i<=depth;++i){
   const auto node=path[i].node;char type[kMaxNodeTypeStringSize]{};prPluginID hash{};csSDK_int32 flags=0;prSuiteError info=-1;
   if(graph->GetNodeInfo)info=graph->GetNodeInfo(node,type,&hash,&flags);
   int kind=0;const char* kinds[]={kVideoSegment_NodeType_Clip,kVideoSegment_NodeType_Compositor,kVideoSegment_NodeType_Disabled,kVideoSegment_NodeType_Effect,kVideoSegment_NodeType_Transition,kVideoSegment_NodeType_Media,kVideoSegment_NodeType_Preview,kVideoSegment_NodeType_SolidColor,kVideoSegment_NodeType_Multicam,kVideoSegment_NodeType_Adjustment,kVideoSegment_NodeType_AdjustmentEffect};
   if(!info)for(int j=0;j<11;++j)if(!std::strncmp(type,kinds[j],sizeof(type))){kind=j+1;break;}
   long long start=0,end=0;const bool startOK=number(node,kVideoSegmentProperty_Clip_TrackItemStartAsTicks,start),endOK=number(node,kVideoSegmentProperty_Clip_TrackItemEndAsTicks,end);
   PrTime zero=0,fromPF=0,fromSeq=0;const auto ez=graph->TransformNodeTime(node,0,&zero),ep=graph->TransformNodeTime(node,pf,&fromPF),es=graph->TransformNodeTime(node,sequence,&fromSeq);
   char line[700];const int n=std::snprintf(line,sizeof(line),"graph-path filterId=%ld candidate=%d index=%d node=%d kind=%d infoErr=%ld flags=%d edgeKind=%d edgeOffset=%lld rootOffset=%lld startOK=%d start=%lld endOK=%d end=%lld transform0=%lld transformPF=%lld transformSequence=%lld transformErrors=%ld,%ld,%ld PFticks=%lld seq=%lld\n",long(filter),candidate,i,int(node),kind,long(info),int(flags),path[i].edgeKind,(long long)path[i].edgeOffset,(long long)rootOffset,int(startOK),start,int(endOK),end,(long long)zero,(long long)fromPF,(long long)fromSeq,long(ez),long(ep),long(es),(long long)pf,(long long)sequence);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
  }
 }
 void walk(csSDK_int32 node,int depth,PrTime offset,int candidate,PrTime edgeOffset=0,int edgeKind=0){
  if(depth>16||visited++>=256)return;
  path[depth]={node,edgeOffset,edgeKind};if(depth==0)rootOffset=offset;
  long long instance=-1;
  if(number(node,kVideoSegmentProperty_Effect_RuntimeInstanceID,instance)&&instance==filter){
   ++matches;dumpPath(depth,candidate);csSDK_int32 owner=0;const auto ownerErr=graph->AcquireOperatorOwnerNodeID(node,&owner);
   long long start=0,end=0;bool startOK=false,endOK=false;PrTime zero=0,fromPF=0,fromSequence=0;prSuiteError e0=-1,ep=-1,es=-1;
   if(!ownerErr){startOK=number(owner,kVideoSegmentProperty_Clip_TrackItemStartAsTicks,start);endOK=number(owner,kVideoSegmentProperty_Clip_TrackItemEndAsTicks,end);e0=graph->TransformNodeTime(owner,0,&zero);ep=graph->TransformNodeTime(owner,pf,&fromPF);es=graph->TransformNodeTime(owner,sequence,&fromSequence);graph->ReleaseVideoNodeID(owner);}
   char line[700];const int n=std::snprintf(line,sizeof(line),"graph filterId=%ld candidate=%d node=%d depth=%d parentOffsetSum=%lld ownerErr=%ld ownerStartOK=%d ownerStart=%lld ownerEndOK=%d ownerEnd=%lld transform0=%lld transformPF=%lld transformSequence=%lld transformErrors=%ld,%ld,%ld PFticks=%lld seq=%lld\n",long(filter),candidate,int(node),depth,(long long)offset,long(ownerErr),int(startOK),start,int(endOK),end,(long long)zero,(long long)fromPF,(long long)fromSequence,long(e0),long(ep),long(es),(long long)pf,(long long)sequence);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));
  }
  csSDK_int32 count=0;
  if(!graph->GetNodeOperatorCount(node,&count))for(int i=0;i<std::min<int>(count,32)&&visited<256;++i){csSDK_int32 child=0;if(!graph->AcquireOperatorNodeID(node,i,&child)){walk(child,depth+1,offset,candidate,0,1);graph->ReleaseVideoNodeID(child);}}
  count=0;if(!graph->GetNodeInputCount(node,&count))for(int i=0;i<std::min<int>(count,32)&&visited<256;++i){csSDK_int32 child=0;PrTime childOffset=0;if(!graph->AcquireInputNodeID(node,i,&childOffset,&child)){walk(child,depth+1,offset+childOffset,candidate,childOffset,2);graph->ReleaseVideoNodeID(child);}}
 }
};
inline void graphTimeDiagnostics(PF_InData* in,const PF_UtilitySuite10* utility,const OwnLayerClock& c){
 if(!in->effect_ref)return;
 static std::atomic<unsigned> requests{0};if(requests.fetch_add(1,std::memory_order_relaxed)>=1024)return;
 const int file=::open("/tmp/better-captions-native-graph-time.log",O_WRONLY|O_CREAT|O_APPEND|O_NOFOLLOW,0600);if(file<0)return;
 struct stat st{};if(::fstat(file,&st)||!S_ISREG(st.st_mode)||st.st_uid!=::getuid()||st.st_size>=2*1024*1024){::close(file);return;}
 Suite<PrSDKVideoSegmentSuite> graph(in,kPrSDKVideoSegmentSuite,kPrSDKVideoSegmentSuiteVersion);
 Suite<PrSDKMemoryManagerSuite> memory(in,kPrSDKMemoryManagerSuite,kPrSDKMemoryManagerSuiteVersion);
 PrTimelineID timeline{};csSDK_int32 segments=0;PF_Err timelineErr=-1;prSuiteError segmentsErr=-1;
 if(utility->GetContainingTimelineID)timelineErr=utility->GetContainingTimelineID(in->effect_ref,&timeline);
 const bool ready=graphCallbacksReady(graph.operator->(),memory.operator->());
 int visited=0,matches=0;
 if(ready&&!timelineErr&&!c.errFilterInstance&&!c.errSequence&&in->time_scale>0){
  segmentsErr=graph->AcquireVideoSegmentsID(timeline,&segments);
  if(!segmentsErr){
   const PrTime pf=static_cast<PrTime>(static_cast<long double>(in->current_time)*c.ticksPerSecond/in->time_scale);
   const PrTime times[]={c.sequenceTime,pf,c.sequenceTime-static_cast<PrTime>(c.trackStartFrame)*c.frameTicks};
   GraphTrace trace{graph.operator->(),memory.operator->(),file,c.filterInstanceId,pf,c.sequenceTime};
   for(int i=0;i<3;++i){trace.visited=0;csSDK_int32 root=0;PrTime offset=0;if(!graph->AcquireNodeForTime(segments,times[i],&root,&offset)){trace.walk(root,0,offset,i);graph->ReleaseVideoNodeID(root);}visited+=trace.visited;}
   matches=trace.matches;graph->ReleaseVideoSegmentsID(segments);
  }
 }
 char line[250];const int n=std::snprintf(line,sizeof(line),"graph-summary filterId=%ld ready=%d timelineErr=%ld segmentsErr=%ld visited=%d matches=%d\n",long(c.filterInstanceId),int(ready),long(timelineErr),long(segmentsErr),visited,matches);if(n>0)::write(file,line,std::min<int>(n,sizeof(line)-1));::close(file);
}
}
