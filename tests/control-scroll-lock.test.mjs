import test from 'node:test';
import assert from 'node:assert/strict';
import {lockControlScroll} from '../webview-ui/src/lib/control-scroll-lock.ts';
class Element extends EventTarget {
 constructor(parent=null,top=0,left=0){super();this.parentElement=parent;this.scrollTop=top;this.scrollLeft=left;}
}
test('scrubbing preserves nested panel and popover scroll positions and blocks wheel/touch only until release',()=>{
 const doc=new EventTarget(),root=new Element(null,4),panel=new Element(root,230,12),popover=new Element(panel,38,7),control=new Element(popover);
 doc.scrollingElement=root;control.ownerDocument=doc;
 const unlock=lockControlScroll(control);
 panel.scrollTop=300;panel.scrollLeft=32;panel.dispatchEvent(new Event('scroll'));
 assert.equal(panel.scrollTop,230);assert.equal(panel.scrollLeft,12);
 popover.scrollTop=99;popover.dispatchEvent(new Event('scroll'));assert.equal(popover.scrollTop,38);
 root.scrollTop=50;root.dispatchEvent(new Event('scroll'));assert.equal(root.scrollTop,4);
 for(const type of ['wheel','touchmove']){const e=new Event(type,{cancelable:true});doc.dispatchEvent(e);assert.equal(e.defaultPrevented,true);}
 unlock();unlock();
 panel.scrollTop=500;panel.dispatchEvent(new Event('scroll'));assert.equal(panel.scrollTop,500);
 for(const type of ['wheel','touchmove']){const e=new Event(type,{cancelable:true});doc.dispatchEvent(e);assert.equal(e.defaultPrevented,false);}
});
