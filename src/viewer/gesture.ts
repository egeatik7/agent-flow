export type CanvasView={x:number;y:number;z:number}
type Point={x:number;y:number}
/** One-finger pan and anchored two-finger zoom; pointercancel never turns into a tap. */
export class ViewerGesture {
 private points=new Map<number,Point>()
 private start:Point|null=null
 private distance=0
 private moved=false
 private nodeId:string|null=null
 private origin:CanvasView={x:0,y:0,z:1}
 down(id:number,p:Point,view:CanvasView,nodeId:string|null){this.points.set(id,p);if(this.points.size===1){this.start=p;this.nodeId=nodeId;this.moved=false}else this.moved=true;this.rebase(view)}
 private rebase(view:CanvasView){this.origin={...view};const p=[...this.points.values()];this.start=p.length===1?p[0]:p.length>=2?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2}:null;this.distance=p.length>=2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0}
 move(id:number,p:Point):CanvasView|null{if(!this.points.has(id)||!this.start)return null;this.points.set(id,p);const a=[...this.points.values()];if(a.length===1){const dx=p.x-this.start.x,dy=p.y-this.start.y;if(Math.hypot(dx,dy)>7)this.moved=true;return {...this.origin,x:this.origin.x+dx,y:this.origin.y+dy}}const mid={x:(a[0].x+a[1].x)/2,y:(a[0].y+a[1].y)/2},d=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),z=Math.max(.3,Math.min(1.8,this.origin.z*d/Math.max(1,this.distance)));return {z,x:mid.x-(this.start.x-this.origin.x)*z/this.origin.z,y:mid.y-(this.start.y-this.origin.y)*z/this.origin.z}}
 up(id:number,view:CanvasView,cancel=false):string|null{if(!this.points.has(id))return null;this.points.delete(id);const tap=!cancel&&!this.moved&&this.points.size===0?this.nodeId:null;if(cancel)this.moved=true;this.rebase(view);return tap}
 clear(){this.points.clear();this.start=null;this.moved=true}
}
