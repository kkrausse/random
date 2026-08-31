const ORIGIN = [-122.4586, 37.7752];
const API = 'https://valhalla1.openstreetmap.de/isochrone';
const modeNames = { pedestrian: 'Walking', bicycle: 'Biking', multimodal: 'Transit', auto: 'Driving' };
const modePhrases = { pedestrian: 'walk', bicycle: 'bike ride', multimodal: 'transit trip', auto: 'drive' };
const colors = ['#1f6b5e', '#61a56f', '#b7ce75', '#efd577'];
let activeMode = 'pedestrian';
let activeMinutes = 20;
let requestId = 0;

const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
  center: ORIGIN, zoom: 12.65, minZoom: 4.5, maxZoom: 17.5,
  maxBounds: [[-130, 30], [-108, 45]], attributionControl: false
});
map.addControl(new maplibregl.NavigationControl({ showCompass:false }), 'top-right');
map.addControl(new maplibregl.AttributionControl({ compact:true }), 'bottom-right');
const markerNode = document.createElement('div'); markerNode.className = 'market-marker'; markerNode.title = 'Arguello Market';
new maplibregl.Marker({ element:markerNode }).setLngLat(ORIGIN).setPopup(new maplibregl.Popup({offset:18}).setHTML('<strong>Arguello Market</strong><br><small>782 Arguello Blvd</small>')).addTo(map);

function contours() {
  const step = Math.max(5, Math.round(activeMinutes / 4 / 5) * 5);
  return [...new Set([step, step*2, step*3, activeMinutes].filter(n => n <= activeMinutes))].sort((a,b)=>a-b);
}
function updateText() {
  document.querySelector('#time-output').textContent = `${activeMinutes} min`;
  document.querySelector('#mode-summary').textContent = modeNames[activeMode];
  document.querySelector('#map-caption').textContent = `A ${activeMinutes} minute ${modePhrases[activeMode]} from the market`;
  document.querySelector('#legend-items').innerHTML = contours().map((m,i)=>`<div class="legend-item"><i class="swatch" style="background:${colors[i]}"></i>${m} minutes</div>`).join('');
}
function setStatus(message, ready=false) {
  document.querySelector('#status').textContent = message;
  document.querySelector('.status-dot').classList.toggle('ready', ready);
}
function fallbackGeoJSON() {
  const speeds = { pedestrian:.075, bicycle:.22, multimodal:.30, auto:.42 };
  return { type:'FeatureCollection', features:contours().map((time,index)=>{
    const radius = time * speeds[activeMode]; const points=[];
    for(let i=0;i<=80;i++){ const a=(i/80)*Math.PI*2; const wobble=1+.10*Math.sin(a*3)+.06*Math.cos(a*7); points.push([ORIGIN[0]+Math.cos(a)*radius*wobble/54,ORIGIN[1]+Math.sin(a)*radius*wobble/69]); }
    return { type:'Feature', properties:{ contour:time, color:colors[index] }, geometry:{type:'Polygon',coordinates:[points]} };
  })};
}
function milesBetween(a, b) {
  const toRad = value => value * Math.PI / 180;
  const earthMiles = 3958.8;
  const dLat = toRad(b.lat - a[1]);
  const dLon = toRad(b.lng - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return earthMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function enableContourHover() {
  const popup = new maplibregl.Popup({ closeButton:false, closeOnClick:false, offset:10, className:'contour-popup' });
  map.on('mousemove', 'iso-fill', event => {
    if (!event.features.length) return;
    map.getCanvas().style.cursor = 'crosshair';
    const minutes = event.features[0].properties.contour;
    const miles = milesBetween(ORIGIN, event.lngLat);
    popup.setLngLat(event.lngLat).setHTML(`<strong>${minutes} min ${modePhrases[activeMode]}</strong><span>${miles < .1 ? `${Math.round(miles * 5280)} ft` : `${miles.toFixed(1)} mi`} from Arguello Market</span>`).addTo(map);
  });
  map.on('mouseleave', 'iso-fill', () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
}
function draw(data) {
  const source = map.getSource('isochrones');
  if(source) source.setData(data); else {
    map.addSource('isochrones',{type:'geojson',data});
    map.addLayer({id:'iso-fill',type:'fill',source:'isochrones',paint:{'fill-color':['coalesce',['get','color'],'#4d9a74'],'fill-opacity':.22}});
    map.addLayer({id:'iso-line',type:'line',source:'isochrones',paint:{'line-color':['coalesce',['get','color'],'#287263'],'line-width':2,'line-opacity':.9}});
    enableContourHover();
  }
}
async function refresh() {
  updateText(); setStatus('Calculating routes…'); const thisRequest=++requestId;
  const payload={locations:[{lat:ORIGIN[1],lon:ORIGIN[0]}],costing:activeMode,contours:contours().map((time,i)=>({time,color:colors[i].slice(1)})),polygons:true,denoise:.6,generalize:80};
  try {
    const response=await fetch(`${API}?json=${encodeURIComponent(JSON.stringify(payload))}`,{headers:{'X-Client-Id':'from-arguello-static-map'}});
    if(!response.ok) throw new Error(`Routing service ${response.status}`); const data=await response.json(); if(thisRequest!==requestId)return;
    draw(data); setStatus('Live route data',true);
  } catch(error) { if(thisRequest!==requestId)return; draw(fallbackGeoJSON()); setStatus('Estimated reach',true); console.warn(error); }
}

document.querySelectorAll('.mode').forEach(button=>button.addEventListener('click',()=>{
  activeMode=button.dataset.mode; document.querySelectorAll('.mode').forEach(b=>{const on=b===button;b.classList.toggle('active',on);b.setAttribute('aria-checked',on)}); refresh();
}));
let rangeTimer; document.querySelector('#time-range').addEventListener('input',event=>{activeMinutes=+event.target.value;updateText();clearTimeout(rangeTimer);rangeTimer=setTimeout(refresh,250)});
document.querySelector('#recenter').addEventListener('click',()=>map.easeTo({center:ORIGIN,zoom:12.65,duration:800}));
map.on('load',refresh); updateText();
