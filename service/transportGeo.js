const toRad=(v)=>(Number(v)*Math.PI)/180;
export function distanceKm(a,b){if(!a||!b||a.lat==null||b.lat==null)return null;const R=6371,dLat=toRad(b.lat-a.lat),dLng=toRad(b.lng-a.lng),x=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
export async function geocodeAddress(address){const query=String(address||"").trim();if(!query)return null;const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`;const response=await fetch(url,{headers:{"User-Agent":"ViaPet.app/1.0 (contato@app.viapet.app)","Accept-Language":"pt-BR"}});if(!response.ok)throw new Error("Servico de localizacao indisponivel.");const data=await response.json();if(!data?.[0])return null;return{lat:Number(data[0].lat),lng:Number(data[0].lon),displayName:data[0].display_name||query,provider:"openstreetmap"};}
export function nearestRegion(point,regions,maxKm=2){return(regions||[]).map(r=>({region:r,distance:distanceKm(point,{lat:Number(r.centerLat),lng:Number(r.centerLng)})})).filter(x=>x.distance!=null&&x.distance<=Number(r.radiusKm||maxKm)).sort((a,b)=>a.distance-b.distance)[0]||null;}
export function optimizeNearestNeighbor(stops,start=null){
 const pending=[...(stops||[])],ordered=[];
 let cursor=start&&start.lat!=null&&start.lng!=null?start:null;
 while(pending.length){
  let bestIndex=0,best=cursor?Infinity:0;
  if(cursor){pending.forEach((item,index)=>{const d=distanceKm(cursor,item);if(d!=null&&d<best){best=d;bestIndex=index;}});}
  const[next]=pending.splice(bestIndex,1);
  ordered.push({...next,distanceFromPreviousKm:Number.isFinite(best)?Number(best.toFixed(2)):0});
  cursor=next;
 }
 return ordered;
}

export function summarizeRoute(stops,{averageSpeedKmH=28}={}){
 const distanceKmTotal=(stops||[]).reduce((total,stop)=>total+Number(stop.distanceFromPreviousKm||0),0);
 const drivingMinutes=Math.round((distanceKmTotal/Math.max(1,Number(averageSpeedKmH)))*60);
 const stopMinutes=Math.max(0,(stops||[]).length-1)*5;
 return{distanceKm:Number(distanceKmTotal.toFixed(2)),estimatedMinutes:drivingMinutes+stopMinutes};
}
