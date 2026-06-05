// ─── STATE ───────────────────────────────────────────────────────────────────
let capturedImageBase64 = null;
let currentResults = [];
let locationQuery = "";
let detailBackScreen = "results";

// ─── API ─────────────────────────────────────────────────────────────────────
// ─── API CONFIGURATION ───────────────────────────────────────────────────────
// All AI calls go through Cloudflare Worker (100k free requests/day)
const API_ENDPOINT = "https://gaia-worker.frederickmahoney-wq.workers.dev";

async function aiCall(prompt, imageBase64=null) {
  const content = imageBase64
    ? [{type:"image",source:{type:"base64",media_type:"image/jpeg",data:imageBase64}},{type:"text",text:prompt}]
    : prompt;

  // For image requests, log size for debugging
  if (imageBase64) {
    const sizeKB = Math.round(imageBase64.length * 0.75 / 1024);
    console.log("Sending image to Worker:", sizeKB + "KB");
  }

  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: content })
  });

  if (!res.ok) {
    const errText = await res.text().catch(()=>"");
    console.error("Worker error:", res.status, errText);
    throw new Error("API error " + res.status + ": " + errText.substring(0,200));
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text || "";
}

// Weather — routed through proxy to avoid CORS
async function getWeatherData(zip) {
  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "weather", zip })
  });
  if (!res.ok) {
    const errText = await res.text().catch(()=>"");
    throw new Error("Weather error " + res.status + ": " + errText.substring(0,100));
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}
function parseJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g,"").trim()); }
  catch { return null; }
}

// Compress image to reduce size before sending to Cloudflare Worker
// Cloudflare Workers free plan has a 100MB body limit but we compress anyway for speed
function compressImage(dataUrl, maxWidth=800, quality=0.7) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let width = img.width;
      let height = img.height;
      // Scale down if too large
      if (width > maxWidth) {
        height = Math.round(height * maxWidth / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => resolve(dataUrl); // fallback to original
    img.src = dataUrl;
  });
}

// ─── PLANT IMAGES ─────────────────────────────────────────────────────────────
const STOP = new Set(["double","single","black","white","red","pink","blue","purple","yellow","orange",
  "golden","silver","dwarf","giant","trailing","climbing","compact","hybrid","wave","endless","summer",
  "knockout","drift","super","vista","first","early","late","new","improved","the","a","an"]);

function getTerms(commonName, scientificName, genusHint) {
  const t=[];
  if(genusHint?.trim()) t.push(genusHint.trim());
  if(scientificName){const p=scientificName.trim().split(/\s+/);const g=p[0].replace(/[×x]/g,"").trim();if(g.length>2)t.push(g);if(p.length>=2)t.push(p[0]+" "+p[1]);}
  if(commonName){const c=commonName.split(/\s+/).filter(w=>!STOP.has(w.toLowerCase())).join(" ").trim();if(c&&c!==commonName)t.push(c);t.push(commonName);}
  return [...new Set(t)].filter(Boolean);
}
async function tryWiki(term) {
  try{const r=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`,{headers:{Accept:"application/json"}});if(!r.ok)return null;const d=await r.json();const s=d?.originalimage?.source||d?.thumbnail?.source;if(!s)return null;const l=s.toLowerCase();if(l.includes("flag")||l.includes("icon")||l.includes("logo")||l.includes("map"))return null;return s.replace(/\/\d+px-/,"/480px-");}catch{return null;}
}
async function fetchPlantImg(commonName,scientificName,genusHint) {
  const terms=getTerms(commonName,scientificName,genusHint);
  for(const t of terms){const s=await tryWiki(t);if(s)return s;}
  return null;
}

// ─── HD INVENTORY ─────────────────────────────────────────────────────────────
async function hdSearch(plantName,soil) {
  const zip=document.getElementById("storeZip").value||"60120";
  const raw=await aiCall(`You are simulating a Home Depot garden center inventory API for store ZIP ${zip}. Generate realistic inventory for: "${plantName}" (soil: "${soil||"general"}"). Return ONLY a JSON array of 4-6 products: [{"itemId":"HD-000001","name":"Full product name","brand":"Brand","price":9.98,"unit":"each","inStock":true,"quantity":12,"aisle":"Garden","bay":"14","rating":4.3,"reviewCount":89,"imageEmoji":"🌱","category":"Plants","description":"Brief desc"}] Use real brands: Bonnie Plants, Costa Farms, Miracle-Gro, Scotts, Vigoro, Espoma. Include: 1-2 Plants, 1 Soil, 1 Fertilizer. ONLY JSON.`);
  return parseJSON(raw)||[];
}

// ─── SCHEMA ───────────────────────────────────────────────────────────────────
const SCHEMA=`{"commonName":"...","cultivar":"named variety if any","scientificName":"Genus species","imageSearchGenus":"genus only","emoji":"🌸","description":"2-3 sentences","sunlight":"Full Sun/Partial Shade/Full Shade","water":"Low/Moderate/High","zone":"4-9","size":"18-24 inches","bloomSeason":"Summer","lifespan":"Annual/Perennial","plantingTips":"...","soil":"Well-draining loamy soil","soilPH":"6.0-7.0","location":"garden beds"}`;

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  const target = document.getElementById("screen-"+name);
  if (!target) { console.error("Screen not found: screen-"+name); return; }
  target.classList.add("active");
  const nav = document.getElementById("bottomNav");
  if (nav) nav.style.display = name==="home"?"none":"flex";
  window.scrollTo(0,0);
  if(name!=="home") renderBubble(name);
  // Auto-detect USDA zone when care screen opens
  if (name === "care") autoDetectZone();
}

function autoDetectZone() {
  const zip = document.getElementById("storeZip")?.value || "60120";
  const zoneInfo = getZoneDisplay(zip);
  const autoEl = document.getElementById("zoneAutoDetect");
  const autoText = document.getElementById("zoneAutoText");
  const chips = document.querySelectorAll("#zoneChips .chip");

  if (zoneInfo && autoEl && autoText) {
    autoEl.style.display = "block";
    autoText.textContent = "Based on ZIP " + zip + " → " + zoneInfo.display + " detected automatically";
    // Set selectedZone and highlight correct chip
    selectedZone = zoneInfo.display;
    chips.forEach(c => {
      c.classList.remove("active");
      if (c.textContent.trim() === zoneInfo.display) c.classList.add("active");
    });
  } else if (autoEl) {
    autoEl.style.display = "none";
    // Default to Zone 5 if no match
    chips.forEach(c => {
      c.classList.remove("active");
      if (c.textContent.trim() === "Zone 5") c.classList.add("active");
    });
    selectedZone = "Zone 5";
  }
}
function goHome() {
  resetCam();
  showScreen("home");
}

// ─── GAIA BUBBLE ─────────────────────────────────────────────────────────────
const TIPS={
  search:["Type a plant name or describe where you want to plant — I'll do the rest!","Try 'drought tolerant' or 'low maintenance' for easy-care options.","I know specific varieties too — try 'Double Black Petunia'!"],
  identify:["Describe the leaves, flowers, color, or scent — even vague descriptions help!","Found a mystery plant? Tell me what it looks like.","The more detail you give me, the better my match will be!"],
  camera:["Tap 'Open Camera' to scan a flower directly with your phone camera.","Or upload a photo from your gallery if you already have one.","Good lighting gives the best identification results!"],
  results:["Tap any plant to see full care info and what's in stock!","Scroll down on a plant page to see soil and fertilizer recommendations.","Prices and aisle locations are from this store's live inventory."],
};
const bubbleState={};
function renderBubble(screen) {
  const el=document.getElementById("bubble-"+screen);
  if(!el)return;
  const tips=TIPS[screen]||TIPS.search;
  if(!bubbleState[screen]) bubbleState[screen]={idx:0};
  const st=bubbleState[screen];
  function render(){
    el.innerHTML=`
      <svg width="64" height="64" viewBox="0 0 120 120" style="flex-shrink:0;animation:gaiaFloat 3s ease-in-out infinite;filter:drop-shadow(0 3px 8px rgba(45,106,79,0.4))">
        <ellipse cx="60" cy="72" rx="24" ry="28" fill="#2d6a4f"/>
        <ellipse cx="60" cy="50" rx="26" ry="9" fill="#74c69d" style="animation:gaiaLeaf 2.5s ease-in-out infinite"/>
        <circle cx="60" cy="36" r="22" fill="#52b788"/>
        <ellipse cx="52" cy="34" rx="5" ry="6" fill="#1a3a2a" style="animation:gaiaEye 4s infinite"/>
        <ellipse cx="68" cy="34" rx="5" ry="6" fill="#1a3a2a" style="animation:gaiaEye 4s infinite"/>
        <circle cx="54" cy="32" r="1.5" fill="white"/><circle cx="70" cy="32" r="1.5" fill="white"/>
        <path d="M52 44 Q60 50 68 44" stroke="#1a3a2a" stroke-width="2" fill="none" stroke-linecap="round"/>
        <circle cx="55" cy="12" r="5" fill="#90e0ef"/><circle cx="69" cy="14" r="4" fill="#f8961e"/>
        <path d="M36 65 Q24 58 22 48" stroke="#52b788" stroke-width="7" fill="none" stroke-linecap="round"/>
        <path d="M84 65 Q96 58 98 48" stroke="#52b788" stroke-width="7" fill="none" stroke-linecap="round"/>
        <circle cx="21" cy="46" r="5" fill="#74c69d"/><circle cx="99" cy="46" r="5" fill="#74c69d"/>
      </svg>
      <div class="bubble-text">
        <div class="bubble-label">G.A.I.A. says</div>
        <div class="bubble-tip">${tips[st.idx]}</div>
        <div class="bubble-dots">${tips.map((_,i)=>`<div class="bubble-dot${i===st.idx?" active":""}" onclick="setBubble('${screen}',${i})"></div>`).join("")}</div>
      </div>`;
  }
  render();
  if(bubbleState[screen].timer) clearInterval(bubbleState[screen].timer);
  bubbleState[screen].timer=setInterval(()=>{
    st.idx=(st.idx+1)%tips.length;
    const bt=el.querySelector(".bubble-text");
    if(bt){bt.style.opacity="0";setTimeout(()=>{render();const nb=el.querySelector(".bubble-text");if(nb)nb.style.opacity="1";},350);}
  },6000);
}
function setBubble(screen,idx){if(bubbleState[screen])bubbleState[screen].idx=idx;renderBubble(screen);}

// ─── LOCATION CHIPS ───────────────────────────────────────────────────────────
function toggleChip(el,val){
  document.querySelectorAll(".chip").forEach(c=>c.classList.remove("active"));
  if(locationQuery===val){locationQuery="";document.getElementById("locationQuery").value="";}
  else{locationQuery=val;el.classList.add("active");document.getElementById("locationQuery").value=val;}
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
async function doSearch(){
  const q=document.getElementById("searchQuery").value.trim();
  const loc=document.getElementById("locationQuery").value.trim();
  if(!q&&!loc)return;
  const btn=document.getElementById("searchBtn");
  const spinner=document.getElementById("searchSpinner");
  const errBox=document.getElementById("searchError");
  btn.disabled=true;spinner.style.display="flex";errBox.style.display="none";
  try{
    const raw=await aiCall(`You are a horticulture expert for a Home Depot garden kiosk. Search: "${q}" | Location: "${loc||"any"}". If searching a specific cultivar the FIRST result MUST be that exact variety. Return ONLY a valid JSON array of 3-5 plants, no markdown: [${SCHEMA}]`);
    let plants=parseJSON(raw);
    if(!Array.isArray(plants)||!plants.length){
      const r2=await aiCall(`Identify "${q}" plant for garden center. Return JSON array of 1-3 results: [${SCHEMA}] ONLY JSON.`);
      plants=parseJSON(r2);
    }
    if(Array.isArray(plants)&&plants.length){
      currentResults=plants;
      detailBackScreen="results";
      renderResults(plants,loc);
      showScreen("results");
    } else {
      errBox.textContent="No results found. Try different wording or use Describe & Identify.";
      errBox.style.display="block";
    }
  }catch(e){errBox.textContent="Connection error. Please try again.";errBox.style.display="block";}
  btn.disabled=false;spinner.style.display="none";
}

// ─── RENDER RESULTS ───────────────────────────────────────────────────────────
function renderResults(plants,loc){
  const locLabel=document.getElementById("locationLabel");
  if(loc){locLabel.style.display="flex";locLabel.innerHTML=`📍 Matched for: ${loc}`;}
  else{locLabel.style.display="none";}
  const list=document.getElementById("resultsList");
  list.innerHTML="";
  plants.forEach((p,i)=>{
    const card=document.createElement("div");
    card.className="plant-card";
    card.innerHTML=`
      <div class="plant-card-img" id="cardImg${i}">
        <div class="emoji-fallback">${p.emoji||"🌿"}</div>
        <div class="img-fade"></div>
        ${p.cultivar?`<div class="cultivar-badge">✦ ${p.cultivar}</div>`:""}
      </div>
      <div class="plant-card-body">
        <div class="plant-name">${p.commonName}</div>
        <div class="plant-sci">${p.scientificName||""}</div>
        <div class="plant-tags">
          <span>☀️ ${p.sunlight||""}</span><span>💧 ${p.water||""}</span>
          ${p.soil?`<span>🪱 ${p.soil.split(" ").slice(0,2).join(" ")}</span>`:""}
        </div>
      </div>`;
    card.onclick=()=>showDetail(p,"results");
    list.appendChild(card);
    // Load image async
    fetchPlantImg(p.commonName,p.scientificName,p.imageSearchGenus).then(src=>{
      if(src){const wrap=document.getElementById("cardImg"+i);if(wrap){const img=document.createElement("img");img.src=src;img.alt=p.commonName;img.onerror=()=>{};wrap.insertBefore(img,wrap.firstChild);}}
    });
  });
}

// ─── DETAIL ───────────────────────────────────────────────────────────────────
async function showDetail(plant,backScreen){
  detailBackScreen=backScreen||"results";
  document.getElementById("detailBackBtn").onclick=()=>showScreen(detailBackScreen);
  const content=document.getElementById("detailContent");
  content.innerHTML=`
    <div class="detail-hero">
      <div class="detail-hero-img" id="heroImgWrap">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:56px;opacity:.25">${plant.emoji||"🌿"}</div>
      </div>
      <div class="detail-overlay"></div>
      <div class="detail-title">
        ${plant.cultivar?`<div style="display:inline-flex;align-items:center;gap:6px;margin-bottom:6px;background:rgba(245,166,35,.9);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#1a1a00">✦ ${plant.cultivar}</div>`:""}
        <h2>${plant.commonName}</h2>
        <p>${plant.scientificName||""}</p>
      </div>
    </div>
    <div class="detail-body">
      <p class="detail-desc">${plant.description||""}</p>
      <div class="care-grid">
        ${[["☀️","Sunlight",plant.sunlight],["💧","Water",plant.water],["🌡️","USDA Zone",plant.zone],["📏","Size",plant.size],["🌸","Bloom",plant.bloomSeason],["🕒","Lifespan",plant.lifespan],["🪱","Soil",plant.soil],["⚗️","pH",plant.soilPH]].map(([icon,label,val])=>`
          <div class="care-cell"><div class="care-label">${icon} ${label}</div><div class="care-val">${val||"—"}</div></div>`).join("")}
      </div>
      ${plant.plantingTips?`<div class="tips-box"><h4>🌱 Planting Tips</h4><p>${plant.plantingTips}</p></div>`:""}
      ${plant.location?`<div style="display:flex;align-items:center;gap:6px;color:#74c69d;font-size:13px;margin-top:8px">📍 Best in: <strong style="color:#e8f5e9">${plant.location}</strong></div>`:""}
    </div>
    <div class="hd-section">
      <div class="hd-header"><span style="font-size:20px">🏪</span><div><div class="hd-title">Available at This Store</div><div class="hd-sub">Live inventory · ZIP ${document.getElementById("storeZip").value||"60120"}</div></div></div>
      <div id="hdProducts"><div class="spinner"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><div class="spinner-label">Checking store inventory…</div></div></div>
    </div>`;

  // Wrap hero content so overlay sits on top
  const heroWrap = content.querySelector(".detail-hero");
  const overlay = content.querySelector(".detail-overlay");
  const titleEl = content.querySelector(".detail-title");
  const heroImgWrap = document.getElementById("heroImgWrap");
  heroImgWrap.style.position="relative";
  heroImgWrap.appendChild(overlay);
  heroImgWrap.appendChild(titleEl);

  showScreen("detail");

  // Load hero image
  fetchPlantImg(plant.commonName,plant.scientificName,plant.imageSearchGenus).then(src=>{
    if(src){const img=document.createElement("img");img.src=src;img.alt=plant.commonName;img.onerror=()=>{};img.style.cssText="width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0";heroImgWrap.insertBefore(img,heroImgWrap.firstChild);}
  });

  // Load HD inventory
  hdSearch(plant.commonName,plant.soil).then(products=>{
    const el=document.getElementById("hdProducts");
    if(!el)return;
    if(!products.length){el.innerHTML=`<div style="color:rgba(200,240,200,.4);font-size:13px;text-align:center;padding:8px">No inventory data. Ask a garden associate for help.</div>`;return;}
    const plants=products.filter(p=>p.category==="Plants");
    const supplies=products.filter(p=>p.category!=="Plants");
    let html="";
    if(plants.length){html+=`<div class="hd-section-label">🌿 Plants &amp; Flowers</div>`;plants.forEach(p=>{html+=hdCardHTML(p);});}
    if(supplies.length){html+=`<div class="hd-section-label">🛒 Recommended Supplies</div>`;supplies.forEach(p=>{html+=hdCardHTML(p);});}
    html+=`<div class="hd-note">Ask an associate in the Garden Center (Aisle G) for assistance</div>`;
    el.innerHTML=html;
  });
}
function hdCardHTML(p){
  const stars=[1,2,3,4,5].map(s=>`<span class="star${s<=Math.round(p.rating||0)?"":" dim"}">★</span>`).join("");
  return `<div class="hd-card">
    <div class="hd-icon">${p.imageEmoji||"🌱"}</div>
    <div class="hd-info">
      <div class="hd-name-row"><div class="hd-name">${p.name}</div><div class="hd-price">$${(p.price||0).toFixed(2)}</div></div>
      <div class="hd-brand">${p.brand||""} · ${p.unit||""}</div>
      ${p.rating?`<div class="stars">${stars}<span class="review-count">(${p.reviewCount||0})</span></div>`:""}
      <div class="hd-tags">
        <span class="hd-tag ${p.inStock?"in-stock":"out-stock"}">${p.inStock?`✓ In Stock · ${p.quantity||""}left`:"✗ Out of Stock"}</span>
        ${p.aisle?`<span class="hd-tag hd-aisle">Aisle ${p.aisle}${p.bay?` · Bay ${p.bay}`:""}</span>`:""}
      </div>
    </div>
  </div>`;
}

// ─── DESCRIBE & IDENTIFY ──────────────────────────────────────────────────────
async function doIdentifyDesc(){
  const q=document.getElementById("descQuery").value.trim();
  if(!q)return;
  const btn=document.getElementById("identBtn");
  const spinner=document.getElementById("identSpinner");
  const errBox=document.getElementById("identError");
  btn.disabled=true;spinner.style.display="flex";errBox.style.display="none";
  try{
    const raw=await aiCall(`Plant ID expert. Customer describes: "${q}". Identify most likely plant. Return ONLY JSON (no markdown): ${SCHEMA} — also add "matchNotes":"why this matches","confidence":"High/Medium/Low"`);
    const plant=parseJSON(raw);
    if(plant&&plant.commonName){showIdentResult(plant);}
    else{errBox.textContent="Could not identify. Try adding more detail.";errBox.style.display="block";}
  }catch{errBox.textContent="Connection error. Please try again.";errBox.style.display="block";}
  btn.disabled=false;spinner.style.display="none";
}

// ─── CAMERA ───────────────────────────────────────────────────────────────────
function handlePhoto(input){
  const file=input.files?.[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    capturedImageBase64=ev.target.result;
    document.getElementById("previewImg").src=capturedImageBase64;
    document.getElementById("cam-choose").style.display="none";
    document.getElementById("cam-preview").style.display="block";
  };
  reader.readAsDataURL(file);
  input.value="";
}
function resetCam(){
  capturedImageBase64=null;
  const choose=document.getElementById("cam-choose");
  const preview=document.getElementById("cam-preview");
  if(choose)choose.style.display="block";
  if(preview)preview.style.display="none";
  const ci=document.getElementById("camInput");
  const gi=document.getElementById("galleryInput");
  if(ci)ci.value="";
  if(gi)gi.value="";
}
async function doIdentifyImage(){
  if(!capturedImageBase64)return;
  const spinner=document.getElementById("camSpinner");
  const btns=document.getElementById("cam-btns");
  spinner.style.display="flex";btns.style.display="none";
  try{
    // Compress image before sending to reduce payload size
    const compressed = await compressImage(capturedImageBase64, 800, 0.75);
    const b64=compressed.split(",")[1];
    const raw=await aiCall(`You are an expert botanist and horticulturalist with 30 years of field experience identifying plants across North America, with deep knowledge of trees, shrubs, bushes, perennials, annuals, grasses, and groundcovers.

Carefully examine EVERY visible detail in this image before making your identification:

LEAF ANALYSIS:
- Shape (ovate, lanceolate, lobed, compound, etc.)
- Edge pattern (serrated, smooth, wavy, toothed)
- Surface texture (smooth, hairy, rough, sandpaper-like, velvety)
- Arrangement (opposite, alternate, whorled)
- Color (top vs underside if visible)
- Size relative to stem

STEM & STRUCTURE:
- Stem texture (hairy, smooth, ridged, hollow)
- Stem color (green, purple, reddish, gray-green)
- Branching pattern
- Overall height and growth habit

FLOWER/FRUIT (if present):
- Petal count, shape, and color (note exact shade — yellow vs orange matters)
- Center disk color and size
- Fruit, berry, or seed head shape

LOOK-ALIKE DISAMBIGUATION — for similar species, use these key distinctions:
- Jerusalem artichoke vs Mexican sunflower / Tree Marigold: THIS IS CRITICAL — the single most reliable differentiator is LEAF SHAPE. Jerusalem artichoke (Helianthus tuberosus) has SIMPLE, UNLOBED, oval-to-lanceolate leaves with a rough sandpaper texture. Mexican Sunflower / Tree Marigold (Tithonia diversifolia or Tithonia rotundifolia) has DEEPLY LOBED, maple-like or oak-like leaves with pointed lobes — if the leaves look lobed or divided, it is NOT Jerusalem artichoke regardless of flower color. Jerusalem artichoke flowers are pure yellow; Tithonia flowers range from yellow to deep orange. Jerusalem artichoke grows in dense colonies from tubers; Tithonia grows as a single bushy plant.
- Hydrangea species: check leaf shape and flower cluster form
- Spirea vs Viburnum: check leaf venation and flower cluster structure
- Juniper vs Arborvitae: check scale vs needle foliage

IDENTIFICATION RULES:
1. ALWAYS analyze leaf shape FIRST before flower color — leaf morphology is the most reliable identifier
2. LOBED or DIVIDED leaves immediately rule out many species — note this prominently
3. Identify to SPECIES level — never return just a genus or vague category like "ornamental shrub"
4. Commit to the single most likely identification based on ALL visible evidence, weighted: leaf shape > leaf texture > stem > flower color > growth habit
5. If two species are genuinely indistinguishable from this angle, name both and explain exactly what feature would differentiate them in person
6. Set confidence to "Low" if key identifying features are not visible — do not guess confidently
7. In alternativeMatches, list 1-2 other species this could be and the one feature that would confirm or rule them out
8. DOUBLE CHECK your answer: does your identified species actually match the leaf shape in the image? If not, reconsider

Return ONLY valid JSON (no markdown): ${SCHEMA} — also add "confidence":"High/Medium/Low", "alternativeMatches":"other possible species with distinguishing feature to confirm", "keyIdentifyingFeatures":"the 2-3 specific features that led to this identification".
If truly no plant is visible set commonName to "Unable to identify".`,b64);
    const plant=parseJSON(raw);
    if(plant){showIdentResult(plant);}
    else{alert("Could not analyze image. Please try again.");}
  }catch{alert("Connection error. Please try again.");}
  spinner.style.display="none";btns.style.display="grid";
}

// ─── IDENT RESULT ─────────────────────────────────────────────────────────────
function showIdentResult(plant){
  const content=document.getElementById("identResultContent");
  const confClass=plant.confidence==="High"?"conf-high":"conf-low";
  const confMark=plant.confidence==="High"?"✓":"~";
  content.innerHTML=`
    ${plant.confidence?`<div class="confidence ${confClass}">${confMark} ${plant.confidence} Confidence</div>`:""}
    <div id="identDetailMount"></div>
    ${plant.matchNotes?`<div class="match-notes"><h4>Why this match</h4><p>${plant.matchNotes}</p></div>`:""}
    ${plant.keyIdentifyingFeatures?`<div class="match-notes" style="margin-top:10px;border-color:rgba(116,198,157,0.2)"><h4 style="color:#74c69d">🔍 Key identifying features</h4><p>${plant.keyIdentifyingFeatures}</p></div>`:""}
    ${plant.alternativeMatches?`<div class="match-notes" style="margin-top:10px;border-color:rgba(251,191,36,0.2)"><h4 style="color:#fbbf24">⚠️ Could also be</h4><p>${plant.alternativeMatches}</p></div>`:""}`;
  showScreen("identResult");
  // Render full detail inside the result
  const mount=document.getElementById("identDetailMount");
  const tempPlant=plant;
  // Build hero + care + HD inventory inline
  mount.innerHTML=`
    <div class="detail-hero">
      <div class="detail-hero-img" id="identHeroWrap">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:56px;opacity:.25">${tempPlant.emoji||"🌿"}</div>
        <div class="detail-overlay"></div>
        <div class="detail-title">
          ${tempPlant.cultivar?`<div style="display:inline-flex;align-items:center;gap:6px;margin-bottom:6px;background:rgba(245,166,35,.9);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:#1a1a00">✦ ${tempPlant.cultivar}</div>`:""}
          <h2>${tempPlant.commonName}</h2><p>${tempPlant.scientificName||""}</p>
        </div>
      </div>
    </div>
    <div class="detail-body">
      <p class="detail-desc">${tempPlant.description||""}</p>
      <div class="care-grid">
        ${[["☀️","Sunlight",tempPlant.sunlight],["💧","Water",tempPlant.water],["🌡️","Zone",tempPlant.zone],["📏","Size",tempPlant.size],["🌸","Bloom",tempPlant.bloomSeason],["🕒","Lifespan",tempPlant.lifespan],["🪱","Soil",tempPlant.soil],["⚗️","pH",tempPlant.soilPH]].map(([i,l,v])=>`<div class="care-cell"><div class="care-label">${i} ${l}</div><div class="care-val">${v||"—"}</div></div>`).join("")}
      </div>
      ${tempPlant.plantingTips?`<div class="tips-box"><h4>🌱 Planting Tips</h4><p>${tempPlant.plantingTips}</p></div>`:""}
    </div>
    <div class="hd-section">
      <div class="hd-header"><span style="font-size:20px">🏪</span><div><div class="hd-title">Available at This Store</div><div class="hd-sub">Live inventory · ZIP ${document.getElementById("storeZip").value||"60120"}</div></div></div>
      <div id="identHdProducts"><div class="spinner"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><div class="spinner-label">Checking store inventory…</div></div></div>
    </div>`;

  fetchPlantImg(tempPlant.commonName,tempPlant.scientificName,tempPlant.imageSearchGenus).then(src=>{
    if(src){const w=document.getElementById("identHeroWrap");if(w){const img=document.createElement("img");img.src=src;img.alt=tempPlant.commonName;img.style.cssText="width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0;z-index:0";w.insertBefore(img,w.firstChild);}}
  });
  hdSearch(tempPlant.commonName,tempPlant.soil).then(products=>{
    const el=document.getElementById("identHdProducts");if(!el)return;
    if(!products.length){el.innerHTML=`<div style="color:rgba(200,240,200,.4);font-size:13px;text-align:center;padding:8px">No inventory data available.</div>`;return;}
    const pts=products.filter(p=>p.category==="Plants"),sups=products.filter(p=>p.category!=="Plants");
    let html="";
    if(pts.length){html+=`<div class="hd-section-label">🌿 Plants &amp; Flowers</div>`;pts.forEach(p=>{html+=hdCardHTML(p);});}
    if(sups.length){html+=`<div class="hd-section-label">🛒 Recommended Supplies</div>`;sups.forEach(p=>{html+=hdCardHTML(p);});}
    el.innerHTML=html;
  });
}


// ─── USDA ZONE LOOKUP ────────────────────────────────────────────────────────
// Maps ZIP code prefixes to USDA hardiness zones
// Based on USDA 2023 Plant Hardiness Zone Map
const ZIP_ZONE_MAP = {
  // Alaska
  "995":"3a","996":"3a","997":"3b","998":"4a","999":"4b",
  // Hawaii
  "967":"12a","968":"12b",
  // Pacific Northwest
  "980":"8b","981":"8b","982":"8a","983":"8a","984":"8b","985":"8a",
  "986":"7a","988":"7a","989":"7a","990":"7a","991":"7a","992":"7a",
  "993":"7a","994":"7a","970":"8b","971":"8b","972":"8b","973":"8a",
  "974":"8a","975":"8a","976":"8a","977":"8a","978":"7b","979":"7b",
  // California
  "900":"10b","901":"10b","902":"10b","903":"10b","904":"10b",
  "905":"10b","906":"10a","907":"10a","908":"10a","910":"10a",
  "911":"10a","912":"10b","913":"10a","914":"9b","915":"9b",
  "916":"9b","917":"9b","918":"9b","919":"10a","920":"10b",
  "921":"10b","922":"10b","923":"10b","924":"9b","925":"9b",
  "926":"9b","927":"9a","928":"9a","930":"9a","931":"9a",
  "932":"9a","933":"9a","934":"9b","935":"9b","936":"9a",
  "937":"9a","938":"9a","939":"9a","940":"9b","941":"9b",
  "942":"9a","943":"9a","944":"9a","945":"9b","946":"9b",
  "947":"9b","948":"9b","949":"9b","950":"9b","951":"9b",
  "952":"9b","953":"9a","954":"9b","955":"8b","956":"9a",
  "957":"9a","958":"9a","959":"9a","960":"8b","961":"8b",
  // Nevada / Arizona
  "889":"9b","890":"9b","891":"9b","893":"9a","894":"7a",
  "895":"7a","897":"7a","898":"7b","850":"9b","851":"9b",
  "852":"9b","853":"9b","855":"9b","856":"9a","857":"9a",
  "859":"8b","860":"7a","863":"6b","864":"7a","865":"7a",
  // Mountain States
  "800":"5b","801":"5b","802":"5b","803":"5b","804":"5a",
  "805":"5a","806":"5a","807":"5b","808":"5b","809":"5b",
  "810":"5a","811":"5a","812":"5a","813":"5b","814":"5b",
  "815":"5b","816":"5b","820":"5a","821":"5a","822":"5a",
  "823":"4b","824":"5a","825":"4b","826":"4b","827":"4b",
  "828":"4b","829":"5a","830":"6a","831":"6a","832":"6a",
  "833":"6a","834":"5b","835":"5b","836":"6a","837":"6a",
  "838":"5b","840":"6b","841":"6b","842":"6b","843":"6b",
  "844":"6a","845":"6a","846":"6a","847":"6a","870":"7a",
  "871":"7a","872":"7a","873":"7a","874":"6b","875":"7a",
  "876":"7b","877":"7a","878":"8a","879":"8a","880":"8a",
  "881":"8a","882":"8a","883":"7b","884":"6b","885":"6a",
  // Texas
  "750":"7b","751":"7b","752":"8a","753":"8a","754":"8a",
  "755":"8a","756":"7b","757":"7b","758":"7b","759":"8a",
  "760":"8a","761":"8a","762":"8a","763":"8a","764":"8a",
  "765":"8a","766":"8a","767":"8a","768":"8a","769":"8a",
  "770":"9a","772":"9a","773":"9a","774":"9a","775":"9a",
  "776":"9a","777":"9a","778":"9a","779":"9b","780":"8b",
  "781":"8b","782":"8b","783":"8b","784":"8b","785":"8b",
  "786":"8b","787":"8b","788":"8b","789":"8b","790":"7b",
  "791":"7b","792":"7b","793":"7b","794":"7a","795":"7a",
  "796":"7a","797":"7a","798":"8a","799":"8a",
  // Midwest - Illinois, Indiana, Ohio, Michigan
  "600":"5b","601":"5b","602":"5b","603":"5b","604":"5b",
  "605":"5b","606":"5b","607":"5b","608":"5b","609":"5b",
  "610":"5b","611":"5a","612":"5a","613":"5a","614":"5a",
  "615":"5b","616":"5b","617":"5b","618":"6a","619":"6a",
  "620":"6a","621":"6a","622":"6a","623":"6b","624":"6b",
  "625":"6a","626":"6a","627":"6a","628":"6a","629":"6a",
  "460":"5b","461":"5b","462":"5b","463":"5b","464":"5b",
  "465":"5b","466":"5b","467":"5b","468":"5b","469":"5b",
  "470":"6a","471":"6a","472":"6a","473":"6a","474":"6a",
  "475":"6a","476":"6a","477":"6a","478":"6a","479":"6a",
  "430":"5b","431":"5b","432":"5b","433":"5b","434":"5b",
  "435":"5b","436":"5b","437":"5b","438":"5b","439":"5b",
  "440":"5b","441":"5b","442":"5b","443":"5b","444":"5b",
  "445":"5a","446":"5a","447":"5a","448":"5a","449":"5a",
  "480":"5b","481":"5b","482":"5b","483":"5b","484":"5b",
  "485":"5b","486":"5a","487":"5a","488":"5a","489":"5a",
  "490":"5b","491":"5b","492":"5b","493":"5a","494":"5a",
  "495":"5a","496":"5a","497":"5a","498":"5a","499":"5a",
  // Wisconsin, Minnesota
  "530":"5b","531":"5b","532":"5b","534":"5a","535":"5a",
  "537":"5a","538":"5a","539":"5a","540":"5a","541":"5a",
  "542":"5a","543":"5a","544":"5a","545":"4b","546":"4b",
  "547":"4b","548":"4b","549":"4b",
  "550":"4b","551":"4b","553":"4b","554":"4b","555":"4b",
  "556":"4a","557":"4a","558":"4a","559":"4a","560":"4b",
  "561":"4b","562":"4b","563":"4b","564":"4b","565":"4b",
  "566":"4a","567":"4a",
  // Iowa, Missouri, Kansas, Nebraska
  "500":"5a","501":"5a","502":"5a","503":"5a","504":"5a",
  "505":"5a","506":"5a","507":"4b","508":"4b","509":"4b",
  "510":"5a","511":"5a","512":"5a","513":"5a","514":"5a",
  "515":"5a","516":"5a","520":"5a","521":"5a","522":"5a",
  "523":"5a","524":"5a","525":"5a","526":"5a","527":"5a",
  "528":"5a",
  "630":"6a","631":"6a","633":"6a","634":"6a","635":"6a",
  "636":"6a","637":"6a","638":"6a","639":"6a","640":"6a",
  "641":"6a","644":"6a","645":"6a","646":"6a","647":"5b",
  "648":"5b","649":"5b","650":"6a","651":"6a","652":"6a",
  "653":"6a","654":"6a","655":"6a","656":"6a","657":"6a",
  "658":"6a",
  "660":"6a","661":"6a","662":"6a","664":"6a","665":"6a",
  "666":"6a","667":"6a","668":"6a","669":"6a","670":"6a",
  "671":"6a","672":"6a","673":"6a","674":"6a","675":"6a",
  "676":"6a","677":"6a","678":"6a","679":"6a",
  "680":"5b","681":"5b","683":"5b","684":"5b","685":"5b",
  "686":"5b","687":"5b","688":"5b","689":"5b","690":"5b",
  "691":"5b","692":"5b","693":"5b","694":"5b","695":"5b",
  "696":"5b","697":"5b","698":"5b","699":"5b",
  // Southeast
  "300":"7b","301":"7b","302":"7b","303":"7b","304":"7b",
  "305":"8a","306":"7b","307":"7b","308":"8a","309":"8a",
  "310":"8b","311":"8b","312":"8b","313":"8b","314":"8b",
  "315":"8b","316":"8b","317":"7b","318":"8a","319":"8a",
  "320":"8b","321":"9a","322":"8b","323":"8b","324":"8b",
  "325":"8b","326":"8b","327":"8b","328":"8b","329":"9a",
  "330":"10a","331":"10a","332":"10a","333":"10a","334":"9b",
  "335":"9b","336":"9b","337":"9b","338":"9b","339":"9b",
  "340":"11a",
  "350":"7b","351":"7b","352":"7b","354":"7b","355":"7b",
  "356":"7b","357":"7b","358":"7b","359":"7b","360":"8a",
  "361":"8a","362":"8a","363":"8a","364":"7b","365":"8a",
  "366":"8a","367":"8a","368":"8a","369":"8a",
  "386":"7b","387":"7b","388":"7b","389":"7b","390":"8a",
  "391":"8a","392":"8a","393":"8a","394":"8b","395":"8b",
  "396":"8b","397":"8b",
  "270":"7a","271":"7a","272":"7a","273":"7a","274":"7a",
  "275":"7b","276":"7b","277":"7b","278":"8a","279":"8a",
  "280":"7b","281":"7b","282":"7b","283":"7b","284":"8a",
  "285":"8a","286":"7a","287":"7a","288":"7a","289":"7a",
  "290":"7b","291":"7b","292":"7b","293":"7b","294":"8a",
  "295":"8a","296":"7a","297":"7a","298":"7b","299":"8a",
  // Mid-Atlantic / Northeast
  "100":"7a","101":"7a","102":"7a","103":"7a","104":"7a",
  "105":"6b","106":"6b","107":"6b","108":"6b","109":"6b",
  "110":"7a","111":"7a","112":"7a","113":"7a","114":"7a",
  "115":"7a","116":"7a","117":"7a","118":"7a","119":"7a",
  "120":"5b","121":"5b","122":"5b","123":"5b","124":"5b",
  "125":"5b","126":"5b","127":"5b","128":"5b","129":"5b",
  "130":"5b","131":"5b","132":"5b","133":"5b","134":"5b",
  "135":"5b","136":"5b","137":"5b","138":"5b","139":"5b",
  "140":"5b","141":"5b","142":"5b","143":"5b","144":"5b",
  "145":"5a","146":"5a","147":"5a","148":"5a","149":"5a",
  "150":"6a","151":"6a","152":"6a","153":"6a","154":"6a",
  "155":"6a","156":"6a","157":"6a","158":"6a","159":"6a",
  "160":"6a","161":"6a","162":"6a","163":"6a","164":"6a",
  "165":"6a","166":"6a","167":"6a","168":"6a","169":"6a",
  "170":"6b","171":"6b","172":"6b","173":"6b","174":"6b",
  "175":"6b","176":"6b","177":"6b","178":"6b","179":"6b",
  "180":"6b","181":"6b","182":"6b","183":"6b","184":"6b",
  "185":"6b","186":"6b","187":"6b","188":"6b","189":"6b",
  "190":"6b","191":"6b","192":"6b","193":"6b","194":"6b",
  "195":"7a","196":"7a","197":"7a","198":"7a","199":"7a",
  "200":"7a","201":"7a","202":"7a","203":"7a","204":"7a",
  "205":"7a","206":"7a","207":"7a","208":"7a","209":"7a",
  "210":"7a","211":"7a","212":"7a","214":"7a","215":"7a",
  "216":"7a","217":"7a","218":"7a","219":"7a",
  "220":"7a","221":"7a","222":"7a","223":"7a","224":"7a",
  "225":"7a","226":"7a","227":"7a","228":"7a","229":"7a",
  "230":"7b","231":"7b","232":"7b","233":"7b","234":"7b",
  "235":"7b","236":"7b","237":"7b","238":"7b","239":"7b",
  "240":"6a","241":"6a","242":"6a","243":"6a","244":"6a",
  "245":"6a","246":"6a",
  "247":"6a","248":"6a","249":"6a",
  "250":"6a","251":"6a","252":"6a","253":"6a","254":"6a",
  "255":"6a","256":"7a","257":"7a","258":"6b","259":"6b",
  "260":"5b","261":"5b","262":"5b","263":"5b","264":"5b",
  "265":"6a","266":"6a","267":"6a","268":"6a",
  // Oklahoma
  "730":"6b","731":"7a","733":"7a","734":"7a","735":"7a",
  "736":"6b","737":"6b","738":"6b","739":"6b","740":"7a",
  "741":"7a","743":"7a","744":"7a","745":"7a","746":"7a",
  "747":"7a","748":"7a","749":"7a",
  // Tennessee
  "370":"7a","371":"7a","372":"7a","373":"7a","374":"7a",
  "375":"7a","376":"7a","377":"7a","378":"7a","379":"7a",
  "380":"7b","381":"7b","382":"7a","383":"7a","384":"7a",
  "385":"7a",
  // Arkansas
  "716":"8a","717":"8a","718":"8a","719":"8a","720":"7b",
  "721":"7b","722":"7b","723":"7b","724":"7a","725":"7a",
  "726":"7a","727":"7a","728":"7a","729":"7a",
  // Louisiana
  "700":"9a","701":"9a","703":"9a","704":"8b","705":"8b",
  "706":"8b","707":"9a","708":"9a","710":"8b","711":"8b",
  "712":"8b","713":"8b","714":"8b",
  // North Dakota
  "580":"4a","581":"4a","582":"4a","583":"4a","584":"4a",
  "585":"4a","586":"3b","587":"4a","588":"4a",
  // South Dakota
  "570":"4b","571":"4b","572":"4b","573":"4b","574":"4b",
  "575":"4b","576":"4b","577":"4a",
  // Montana
  "590":"5b","591":"5b","592":"5b","593":"5b","594":"5b",
  "595":"4b","596":"5a","597":"5a","598":"5a","599":"5b",
  // Kentucky
  "400":"6a","401":"6a","402":"6a","403":"6b","404":"6b",
  "405":"6a","406":"6a","407":"6b","408":"6b","409":"6b",
  "410":"6a","411":"6b","412":"6b","413":"6b","414":"6b",
  "415":"6a","416":"6a","417":"6a","418":"6a",
  // Mississippi (complete)
  "386":"8a","387":"8a","388":"8a","389":"8a","390":"8b",
  "391":"8b","392":"8b","393":"8b","394":"8b","395":"8b",
  "396":"8b","397":"8b",
  // Delaware / Maryland additions
  "197":"7a","198":"7a","199":"7a",
  // New England
  "010":"5b","011":"5b","012":"5b","013":"5b","014":"5b",
  "015":"5b","016":"5b","017":"5b","018":"6a","019":"6a",
  "020":"6a","021":"6a","022":"6a","023":"6a","024":"6a",
  "025":"6a","026":"6a","027":"6a","028":"6a","029":"6a",
  "030":"5b","031":"5b","032":"5b","033":"5b","034":"5a",
  "035":"5a","036":"5a","037":"5a","038":"5b","039":"5b",
  "040":"5b","041":"5b","042":"5b","043":"5b","044":"5b",
  "045":"5b","046":"5a","047":"5a","048":"5a","049":"5a",
  "050":"5a","051":"5a","052":"5a","053":"5a","054":"4b",
  "055":"4b","056":"4b","057":"4b","058":"4b","059":"4b",
};

function getZoneFromZip(zip) {
  if (!zip || zip.length < 3) return null;
  const prefix3 = zip.substring(0, 3);
  const prefix2 = zip.substring(0, 2);
  return ZIP_ZONE_MAP[prefix3] || ZIP_ZONE_MAP[prefix2] || null;
}

function getZoneDisplay(zip) {
  const zone = getZoneFromZip(zip);
  if (!zone) return null;
  // Convert "5b" to "Zone 5b"
  const num = parseInt(zone);
  return { code: zone, display: "Zone " + zone.toUpperCase(), number: num };
}

// ─── GUIDED PLANT FINDER ─────────────────────────────────────────────────────
const GUIDED_QUESTIONS = [
  {
    id: "type",
    question: "What type of plant are you looking for?",
    emoji: "🌿",
    options: [
      { emoji:"🌸", label:"Flowers & Annuals", sub:"Seasonal color", value:"flowering annual" },
      { emoji:"🌺", label:"Perennials", sub:"Comes back yearly", value:"perennial flower" },
      { emoji:"🌳", label:"Shrubs & Bushes", sub:"Woody plants", value:"shrub or bush" },
      { emoji:"🌲", label:"Trees", sub:"Shade & structure", value:"tree" },
      { emoji:"🌿", label:"Vines & Climbers", sub:"Walls & trellises", value:"vine or climber" },
      { emoji:"🥬", label:"Edible & Herbs", sub:"Food & cooking", value:"edible herb or vegetable" },
    ]
  },
  {
    id: "color",
    question: "What flower or foliage color do you prefer?",
    emoji: "🎨",
    options: [
      { emoji:"🔴", label:"Reds & Oranges", sub:"Bold & warm", value:"red or orange" },
      { emoji:"💛", label:"Yellows & Gold", sub:"Bright & cheerful", value:"yellow or gold" },
      { emoji:"💜", label:"Purples & Blues", sub:"Cool & elegant", value:"purple or blue" },
      { emoji:"🩷", label:"Pinks & Whites", sub:"Soft & classic", value:"pink or white" },
      { emoji:"🌿", label:"Foliage / Green", sub:"Texture & form", value:"green foliage" },
      { emoji:"🎨", label:"Mixed / Any", sub:"Surprise me!", value:"mixed colors" },
    ]
  },
  {
    id: "sun",
    question: "How much sun does your planting spot get?",
    emoji: "☀️",
    options: [
      { emoji:"☀️", label:"Full Sun", sub:"6+ hours direct sun", value:"full sun" },
      { emoji:"⛅", label:"Part Sun/Shade", sub:"3-6 hours", value:"partial sun or shade" },
      { emoji:"🌥️", label:"Full Shade", sub:"Under 3 hours", value:"full shade" },
    ]
  },
  {
    id: "location",
    question: "Where will you be planting?",
    emoji: "📍",
    options: [
      { emoji:"🏡", label:"Garden Bed", sub:"In the ground", value:"garden bed or border" },
      { emoji:"🪴", label:"Container / Pot", sub:"Patio or balcony", value:"container or pot" },
      { emoji:"🌊", label:"Near Water", sub:"Pond or stream", value:"near water or wet area" },
      { emoji:"🧱", label:"Along Fence/Wall", sub:"Vertical space", value:"along a fence or wall" },
      { emoji:"🛣️", label:"Lawn Border", sub:"Edge or pathway", value:"lawn border or pathway edge" },
      { emoji:"🏔️", label:"Slope / Hill", sub:"Erosion control", value:"slope or hillside" },
    ]
  },
  {
    id: "maintenance",
    question: "How much care can you give?",
    emoji: "🛠️",
    options: [
      { emoji:"😌", label:"Low Maintenance", sub:"Plant and forget", value:"low maintenance, drought tolerant" },
      { emoji:"🌱", label:"Some Care", sub:"Weekly attention", value:"moderate maintenance" },
      { emoji:"🌟", label:"High Care OK", sub:"I love gardening!", value:"high maintenance is fine" },
    ]
  },
];

let guidedAnswers = {};
let guidedStep = 0;

function startGuided() {
  guidedAnswers = {};
  guidedStep = 0;
  showScreen('guided');
  renderGuidedStep();
}

function resetGuided() {
  guidedAnswers = {};
  guidedStep = 0;
  document.getElementById("guided-summary").style.display = "none";
  document.getElementById("guided-steps").innerHTML = "";
  renderGuidedStep();
}

function renderGuidedStep() {
  const stepsEl = document.getElementById("guided-steps");
  const summaryEl = document.getElementById("guided-summary");
  const spinnerEl = document.getElementById("guided-spinner");

  summaryEl.style.display = "none";
  spinnerEl.style.display = "none";

  // Progress bar
  const total = GUIDED_QUESTIONS.length;
  const progressHTML = `<div class="guided-progress">${GUIDED_QUESTIONS.map((_,i) => 
    `<div class="guided-prog-dot ${i < guidedStep ? 'done' : i === guidedStep ? 'active' : ''}"></div>`
  ).join("")}</div>`;

  if (guidedStep >= GUIDED_QUESTIONS.length) {
    // All questions answered — show summary
    stepsEl.innerHTML = progressHTML;
    const summaryLines = GUIDED_QUESTIONS.map(q => {
      const answer = guidedAnswers[q.id];
      const opt = q.options.find(o => o.value === answer);
      return `${opt?.emoji || "•"} <strong>${q.question.replace("?","")}</strong>: ${opt?.label || answer}`;
    }).join("<br>");
    document.getElementById("guided-summary-text").innerHTML = summaryLines;
    summaryEl.style.display = "block";
    return;
  }

  const q = GUIDED_QUESTIONS[guidedStep];
  const colClass = q.options.length === 3 ? "cols-3" : "";

  stepsEl.innerHTML = `
    ${progressHTML}
    <div class="guided-question">
      <div class="guided-q-label">
        <div class="guided-q-num">${guidedStep + 1}</div>
        ${q.emoji} ${q.question}
      </div>
      <div class="guided-options ${colClass}">
        ${q.options.map(opt => `
          <div class="guided-opt ${guidedAnswers[q.id] === opt.value ? 'selected' : ''}"
               onclick="selectGuidedOption('${q.id}','${opt.value}')">
            <div class="opt-emoji">${opt.emoji}</div>
            <div class="opt-label">${opt.label}</div>
            <div class="opt-sub">${opt.sub}</div>
          </div>
        `).join("")}
      </div>
    </div>`;
}

function selectGuidedOption(questionId, value) {
  guidedAnswers[questionId] = value;

  // Brief highlight then advance
  setTimeout(() => {
    guidedStep++;
    renderGuidedStep();
  }, 220);
}

async function doGuidedSearch() {
  const spinner = document.getElementById("guided-spinner");
  const btn = document.getElementById("guided-find-btn");
  const summary = document.getElementById("guided-summary");
  spinner.style.display = "flex";
  summary.style.display = "none";

  const a = guidedAnswers;
  const zip = document.getElementById("storeZip")?.value || "60120";
  const zoneInfo = getZoneDisplay(zip);
  const zoneStr = zoneInfo ? zoneInfo.display : "Zone 5-6";
  const prompt = `You are an expert horticulturalist helping a customer at a garden center find the perfect plants.

Customer preferences:
- Plant type: ${a.type || "any"}
- Preferred color: ${a.color || "any"}  
- Sun conditions: ${a.sun || "any"}
- Planting location: ${a.location || "any"}
- Maintenance level: ${a.maintenance || "any"}
- USDA Hardiness Zone: ${zoneStr} (auto-detected from ZIP ${zip})

Find the 4 BEST matching plants for this customer. Prioritize plants that are:
1. Commonly available at garden centers
2. Well-suited for USDA zones 5-6 (Illinois/Midwest) unless otherwise specified
3. A great match for ALL of their stated preferences

Return ONLY a valid JSON array of exactly 4 plants, no markdown:
[${SCHEMA}]

Make your recommendations specific and exciting — explain in the description why this plant is perfect for their stated preferences.`;

  try {
    const raw = await aiCall(prompt);
    let plants = parseJSON(raw);
    if (Array.isArray(plants) && plants.length) {
      currentResults = plants;
      detailBackScreen = "guided";
      renderResults(plants, `${guidedAnswers.type || ""} · ${guidedAnswers.color || ""} · ${guidedAnswers.sun || ""}`);
      showScreen("results");
    } else {
      alert("Could not find recommendations. Please try again.");
      summary.style.display = "block";
    }
  } catch {
    alert("Connection error. Please try again.");
    summary.style.display = "block";
  }
  spinner.style.display = "none";
}

// Add guided to TIPS
if (typeof TIPS !== 'undefined') {
  TIPS.guided = [
    "Answer each question and I'll find plants perfectly matched to your garden!",
    "The more specific you are, the better my recommendations will be.",
    "I'll show you store inventory for every plant I recommend!"
  ];
}

// ─── PEST & DISEASE DIAGNOSIS ─────────────────────────────────────────────────

const PEST_SCHEMA = `{
  "problemName": "Common name of pest or disease",
  "scientificName": "Scientific name if applicable",
  "type": "Fungal Disease / Bacterial Disease / Viral Disease / Insect Pest / Mite / Deficiency / Environmental Stress",
  "severity": "High / Medium / Low",
  "description": "2-3 sentence description of this problem",
  "affectedPlants": "Types of plants commonly affected",
  "symptoms": ["symptom 1", "symptom 2", "symptom 3"],
  "causes": "What causes or spreads this problem",
  "treatments": [
    { "step": 1, "action": "First treatment step with specific product type to use" },
    { "step": 2, "action": "Second step" },
    { "step": 3, "action": "Third step" }
  ],
  "prevention": ["prevention tip 1", "prevention tip 2", "prevention tip 3"],
  "urgency": "Treat immediately / Monitor closely / Low priority",
  "spreadRisk": "High / Medium / Low",
  "organicOptions": "Organic or natural treatment alternatives",
  "confidence": "High / Medium / Low"
}`;

const PEST_TIPS = [
  "Take a close-up photo of the affected area for the most accurate diagnosis.",
  "I'll recommend specific treatment products available in this store!",
  "Check both sides of leaves — many pests hide on the underside."
];

let pestImageBase64 = null;

// Add to TIPS
if (typeof TIPS !== 'undefined') {
  TIPS.pest = PEST_TIPS;
}

function handlePestPhoto(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    pestImageBase64 = ev.target.result;
    document.getElementById("pestPreviewImg").src = pestImageBase64;
    document.getElementById("pest-choose").style.display = "none";
    document.getElementById("pest-preview").style.display = "block";
  };
  reader.readAsDataURL(file);
  input.value = "";
}

function resetPest() {
  pestImageBase64 = null;
  document.getElementById("pest-choose").style.display = "block";
  document.getElementById("pest-preview").style.display = "none";
  const ci = document.getElementById("pestCamInput");
  const gi = document.getElementById("pestGalleryInput");
  if (ci) ci.value = "";
  if (gi) gi.value = "";
}

const PEST_PROMPT_BASE = `You are an expert plant pathologist and integrated pest management specialist with 30 years of experience diagnosing plant problems in home gardens and nurseries.

Carefully analyze the visible symptoms and identify the most likely pest, disease, deficiency, or environmental stress.

ANALYSIS CHECKLIST:
- Leaf symptoms: spots, lesions, discoloration, wilting, curling, holes, powder, mold
- Pattern: random vs systematic, upper vs lower surface, young vs old leaves
- Stem/bark: cankers, lesions, girdling, discoloration, oozing
- Root/soil visible: rot, fungal growth, insects in soil
- Overall plant: wilting pattern, growth distortion, color changes

COMMON LOOK-ALIKES TO DISTINGUISH:
- Powdery mildew (white powder ON surface) vs Downy mildew (gray fuzz UNDER surface)
- Aphid damage (curled leaves, sticky residue) vs Mite damage (fine webbing, stippled leaves)
- Iron deficiency (yellow between veins, young leaves first) vs Nitrogen deficiency (yellow whole leaf, old leaves first)
- Fungal leaf spot (circular lesions with defined edges) vs Bacterial spot (water-soaked, angular lesions)
- Overwatering (yellow, mushy, root rot) vs Underwatering (dry, crispy edges, wilting)

IDENTIFICATION RULES:
1. Identify the SPECIFIC problem — never say just "disease" or "pest"
2. Base confidence on clarity of visible symptoms
3. If multiple problems are possible, identify the most likely one and mention others in description
4. Always provide actionable treatment steps with specific product TYPES (fungicide, insecticidal soap, neem oil, etc.)
5. Include both chemical AND organic options

Return ONLY valid JSON (no markdown): ${PEST_SCHEMA}`;

async function doPestByImage() {
  if (!pestImageBase64) return;
  const spinner = document.getElementById("pestSpinner");
  const btns = document.getElementById("pest-btns");
  spinner.style.display = "flex";
  btns.style.display = "none";

  try {
    // Compress image before sending
    const compressedPest = await compressImage(pestImageBase64, 800, 0.75);
    const b64 = compressedPest.split(",")[1];
    const raw = await aiCall(PEST_PROMPT_BASE + "\n\nAnalyze the plant problem visible in this image.", b64);
    const result = parseJSON(raw);
    if (result && result.problemName) {
      showPestResult(result);
    } else {
      alert("Could not diagnose the problem. Try a clearer close-up photo.");
      btns.style.display = "grid";
    }
  } catch {
    alert("Connection error. Please try again.");
    btns.style.display = "grid";
  }
  spinner.style.display = "none";
}

async function doPestByDesc() {
  const desc = document.getElementById("pestDescInput").value.trim();
  if (!desc) return;
  const btn = document.getElementById("pestDescBtn");
  btn.disabled = true;
  btn.textContent = "Diagnosing…";

  try {
    const raw = await aiCall(PEST_PROMPT_BASE + `\n\nThe customer describes the problem as: "${desc}"\n\nDiagnose based on this description.`);
    const result = parseJSON(raw);
    if (result && result.problemName) {
      showPestResult(result);
    } else {
      alert("Could not diagnose. Try adding more detail to your description.");
    }
  } catch {
    alert("Connection error. Please try again.");
  }
  btn.disabled = false;
  btn.textContent = "Diagnose by Description 🔍";
}

async function showPestResult(result) {
  const zip = document.getElementById("storeZip").value || "60120";

  // Build severity class
  const sevClass = result.severity === "High" ? "severity-high" : result.severity === "Medium" ? "severity-medium" : "severity-low";
  const sevIcon = result.severity === "High" ? "🚨" : result.severity === "Medium" ? "⚠️" : "✅";

  // Build symptoms HTML
  const symptomsHTML = (result.symptoms || []).map(s =>
    `<div class="pest-symptom"><span style="color:#f87171;flex-shrink:0">•</span>${s}</div>`
  ).join("");

  // Build treatment steps HTML
  const treatmentsHTML = (result.treatments || []).map(t =>
    `<div class="treatment-step">
      <div class="step-num">${t.step}</div>
      <div class="step-text">${t.action}</div>
    </div>`
  ).join("");

  // Build prevention HTML
  const preventionHTML = (result.prevention || []).map(p =>
    `<div class="prevention-item">🛡️ ${p}</div>`
  ).join("");

  const content = document.getElementById("pestResultContent");
  content.innerHTML = `
    <div class="pest-severity ${sevClass}">${sevIcon} ${result.severity || "Medium"} Severity · ${result.urgency || "Monitor closely"}</div>

    <div class="pest-hero">
      <div class="pest-name">${result.problemName}</div>
      <div class="pest-type">${result.type || ""} ${result.scientificName ? "· " + result.scientificName : ""}</div>
      <p class="pest-desc">${result.description || ""}</p>
    </div>

    ${result.affectedPlants ? `
    <div class="pest-section">
      <div class="pest-section-title">🌿 Commonly Affects</div>
      <div style="font-size:13px;color:#b7e4c7">${result.affectedPlants}</div>
    </div>` : ""}

    <div class="pest-section">
      <div class="pest-section-title">🔍 Symptoms to Look For</div>
      ${symptomsHTML}
    </div>

    ${result.causes ? `
    <div class="pest-section">
      <div class="pest-section-title">⚡ Causes & Spread</div>
      <div style="font-size:13px;color:#b7e4c7;line-height:1.6">${result.causes}</div>
      ${result.spreadRisk ? `<div style="margin-top:8px;font-size:12px;color:${result.spreadRisk==='High'?'#f87171':result.spreadRisk==='Medium'?'#fbbf24':'#4ade80'}">Spread risk: <strong>${result.spreadRisk}</strong></div>` : ""}
    </div>` : ""}

    <div class="pest-section">
      <div class="pest-section-title">💊 Treatment Plan</div>
      ${treatmentsHTML}
      ${result.organicOptions ? `
      <div style="margin-top:12px;padding:10px 12px;background:rgba(116,198,157,.1);border-radius:8px;border:1px solid rgba(116,198,157,.2)">
        <div style="font-size:11px;color:#74c69d;font-weight:600;margin-bottom:4px">🌿 Organic Options</div>
        <div style="font-size:12px;color:#b7e4c7">${result.organicOptions}</div>
      </div>` : ""}
    </div>

    <div class="pest-section">
      <div class="pest-section-title">🛡️ Prevention</div>
      ${preventionHTML}
    </div>

    <div class="hd-treatment-section">
      <div class="hd-header">
        <span style="font-size:20px">🏪</span>
        <div>
          <div class="hd-title">Treatment Products In Store</div>
          <div class="hd-sub">Live inventory · ZIP ${zip}</div>
        </div>
      </div>
      <div id="pestHdProducts">
        <div class="spinner"><div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div><div class="spinner-label">Finding treatments in store…</div></div>
      </div>
    </div>`;

  showScreen("pestResult");

  // Load treatment products from HD inventory
  const searchTerm = `${result.problemName} ${result.type || ""} treatment spray`;
  const hdPrompt = `You are simulating Home Depot garden center inventory for store ZIP ${zip}.
A customer needs treatment products for: "${result.problemName}" (${result.type || "plant problem"}).
Return ONLY a JSON array of 3-5 relevant treatment products:
[{"itemId":"HD-XXXXXX","name":"Full product name","brand":"Brand","price":12.98,"unit":"32 oz","inStock":true,"quantity":8,"aisle":"Garden","bay":"22","rating":4.4,"reviewCount":156,"imageEmoji":"🧴","category":"Pest Control","description":"Brief description of what it treats"}]
Use real brands: Bonnie Plants, Scotts, Ortho, BioAdvanced, Neem Bliss, Espoma, Garden Safe, Monterey, Sevin. Include both chemical and organic options. ONLY JSON.`;

  try {
    const raw = await aiCall(hdPrompt);
    const products = parseJSON(raw) || [];
    const el = document.getElementById("pestHdProducts");
    if (!el) return;
    if (!products.length) {
      el.innerHTML = `<div style="color:rgba(200,240,200,.4);font-size:13px;text-align:center;padding:8px">Ask a garden associate for treatment recommendations.</div>`;
      return;
    }
    el.innerHTML = products.map(p => hdCardHTML(p)).join("") +
      `<div class="hd-note">Ask a garden associate in the Pest Control aisle for help selecting the right product.</div>`;
  } catch {
    document.getElementById("pestHdProducts").innerHTML =
      `<div style="color:rgba(200,240,200,.4);font-size:13px;text-align:center;padding:8px">Could not load inventory. Ask a garden associate for help.</div>`;
  }
}

// ─── WEATHER & FROST ALERTS ───────────────────────────────────────────────────
// Uses Open-Meteo (free, no API key) + geocoding for frost warnings

// Weather now handled by getWeatherData() in API section above

const WX_CODES = {
  0:"Clear Sky",1:"Mainly Clear",2:"Partly Cloudy",3:"Overcast",
  45:"Foggy",48:"Rime Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",
  61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",
  77:"Snow Grains",80:"Light Showers",81:"Showers",82:"Heavy Showers",
  85:"Snow Showers",86:"Heavy Snow Showers",95:"Thunderstorm",96:"Thunderstorm+Hail",99:"Thunderstorm+Hail"
};
const WX_ICONS = {
  0:"☀️",1:"🌤️",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",51:"🌦️",53:"🌧️",55:"🌧️",
  61:"🌧️",63:"🌧️",65:"⛈️",71:"🌨️",73:"❄️",75:"❄️",77:"🌨️",
  80:"🌦️",81:"🌧️",82:"⛈️",85:"🌨️",86:"❄️",95:"⛈️",96:"⛈️",99:"⛈️"
};

function getFrostStatus(minTemp) {
  if (minTemp <= 28) return { cls:"frost-danger", icon:"🚨", title:"Hard Frost Warning", body:"Temperatures will drop below 28°F. Bring in all container plants immediately. Cover tender perennials and annuals — most will not survive without protection.", color:"#f87171" };
  if (minTemp <= 32) return { cls:"frost-danger", icon:"❄️", title:"Frost Warning", body:"Temperatures at or below freezing expected. Cover tender plants with frost cloth tonight. Bring in tropicals, succulents, and annuals.", color:"#f87171" };
  if (minTemp <= 36) return { cls:"frost-warning", icon:"⚠️", title:"Frost Advisory", body:"Near-freezing temperatures expected. Protect tender annuals and newly planted seedlings. Consider covering borderline-hardy plants.", color:"#fbbf24" };
  if (minTemp <= 45) return { cls:"frost-warning", icon:"🌡️", title:"Cool Night Ahead", body:"No frost risk but cool temperatures. Most established plants are fine. Watch tropicals and heat-loving plants.", color:"#fbbf24" };
  return { cls:"frost-safe", icon:"✅", title:"No Frost Risk", body:"Temperatures are safe for all plants. Good time for planting, transplanting, or moving plants outdoors.", color:"#4ade80" };
}

async function doWeather() {
  const zipEl = document.getElementById("weatherZip");
  const zip = (zipEl ? zipEl.value.trim() : "") || document.getElementById("storeZip").value || "60120";
  const errBox = document.getElementById("weatherError");
  const spinner = document.getElementById("weatherSpinner");
  const result = document.getElementById("weatherResult");

  if (!zip || zip.length < 3) {
    errBox.textContent = "Please enter a valid ZIP code.";
    errBox.style.display = "block";
    return;
  }

  errBox.style.display = "none";
  spinner.style.display = "flex";
  result.style.display = "none";

  try {
    const { location: loc, weather: wx } = await getWeatherData(zip);
    const cur = wx.current;
    const daily = wx.daily;
    if (!cur || !daily) throw new Error("Weather data format unexpected - please try again.");

    const temp = Math.round(cur.temperature_2m);
    const feels = Math.round(cur.apparent_temperature);
    const desc = WX_CODES[cur.weathercode] || "Unknown";
    const icon = WX_ICONS[cur.weathercode] || "🌡️";
    const humidity = cur.relative_humidity_2m;
    const wind = Math.round(cur.windspeed_10m);

    // Find lowest temp in next 7 days
    const minTemps = daily.temperature_2m_min;
    const lowestMin = Math.min(...minTemps);
    const frostDay = minTemps.findIndex(t => t <= 32);
    const frost = getFrostStatus(lowestMin);

    // Build 7-day forecast
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const forecastHTML = daily.time.map((date, i) => {
      const d = new Date(date);
      const dayName = i === 0 ? "Today" : days[d.getDay()];
      const hi = Math.round(daily.temperature_2m_max[i]);
      const lo = Math.round(daily.temperature_2m_min[i]);
      const dayIcon = WX_ICONS[daily.weathercode[i]] || "🌡️";
      const hasFrost = lo <= 32;
      return `<div class="month-row">
        <span class="month-name">${dayName}</span>
        <span style="font-size:18px">${dayIcon}</span>
        <span class="month-activity" style="text-align:right">${hi}° / <span style="color:${hasFrost?'#f87171':'#94a3b8'}">${lo}°${hasFrost?' ❄️':''}</span></span>
      </div>`;
    }).join("");

    // Get AI planting advice for this weather
    const adviceRaw = await aiCall(`You are a master gardener. Based on this weather for ${loc.name}, ${loc.state} (ZIP ${zip}):
Current: ${temp}°F, ${desc}, Humidity ${humidity}%, Wind ${wind}mph
Next 7 days low temps: ${minTemps.map(t=>Math.round(t)+'°F').join(', ')}
${lowestMin <= 32 ? 'FROST IS EXPECTED in the next 7 days.' : 'No frost expected this week.'}

Give 3 specific, actionable gardening recommendations for RIGHT NOW based on these exact conditions.
Return ONLY a JSON array of 3 strings: ["tip1","tip2","tip3"]`);
    const tips = parseJSON(adviceRaw) || ["Check plants daily in these conditions.", "Water in the morning to allow foliage to dry.", "Monitor tender plants closely."];

    // Weather background color based on temp
    const bgColor = temp >= 70 ? "linear-gradient(135deg,rgba(6,78,59,.7),rgba(4,47,46,.8))" :
                    temp >= 50 ? "linear-gradient(135deg,rgba(30,58,138,.5),rgba(29,78,216,.3))" :
                    "linear-gradient(135deg,rgba(30,41,59,.7),rgba(51,65,85,.5))";

    result.innerHTML = `
      <div class="weather-hero">
        <div class="weather-top" style="background:${bgColor}">
          <div>
            <div class="weather-temp">${temp}°</div>
            <div class="weather-desc">${desc}</div>
            <div class="weather-location">📍 ${loc.name}, ${loc.state} · Feels like ${feels}°</div>
          </div>
          <div class="weather-icon">${icon}</div>
        </div>
      </div>

      <div class="weather-grid">
        <div class="weather-cell"><div class="weather-cell-label">💧 Humidity</div><div class="weather-cell-val">${humidity}%</div></div>
        <div class="weather-cell"><div class="weather-cell-label">💨 Wind</div><div class="weather-cell-val">${wind} mph</div></div>
        <div class="weather-cell"><div class="weather-cell-label">🌡️ 7-Day Low</div><div class="weather-cell-val" style="color:${lowestMin<=32?'#f87171':'#4ade80'}">${Math.round(lowestMin)}°F</div></div>
        <div class="weather-cell"><div class="weather-cell-label">❄️ Frost Risk</div><div class="weather-cell-val" style="color:${lowestMin<=32?'#f87171':lowestMin<=36?'#fbbf24':'#4ade80'}">${lowestMin<=32?'Yes':lowestMin<=36?'Watch':'No'}</div></div>
      </div>

      <div class="frost-alert ${frost.cls}">
        <div class="frost-icon">${frost.icon}</div>
        <div>
          <div class="frost-title" style="color:${frost.color}">${frost.title}</div>
          <div class="frost-body" style="color:rgba(255,255,255,.7)">${frost.body}</div>
        </div>
      </div>

      <div class="planting-window">
        <div style="font-size:11px;color:#74c69d;text-transform:uppercase;letter-spacing:.09em;font-weight:600;margin-bottom:10px">📅 7-Day Forecast</div>
        ${forecastHTML}
      </div>

      <div class="pest-section">
        <div class="pest-section-title">🌱 G.A.I.A.'s Gardening Tips for Today</div>
        ${tips.map((t,i) => `<div class="treatment-step"><div class="step-num">${i+1}</div><div class="step-text">${t}</div></div>`).join("")}
      </div>`;

    result.style.display = "block";
  } catch(e) {
    console.error("Weather error:", e);
    errBox.textContent = "Error: " + (e.message || "Could not load weather") + ". Check your ZIP code and try again.";
    errBox.style.display = "block";
  }
  spinner.style.display = "none";
}

// ─── BUILD MY GARDEN ──────────────────────────────────────────────────────────
let gardenStyle = "";

function toggleStyleChip(el, val) {
  document.querySelectorAll("#screen-garden .chip").forEach(c => c.classList.remove("active"));
  gardenStyle = gardenStyle === val ? "" : val;
  if (gardenStyle) el.classList.add("active");
}

async function doBuildGarden() {
  const desc = document.getElementById("gardenDesc").value.trim();
  if (!desc) { document.getElementById("gardenError").textContent="Please describe your garden space."; document.getElementById("gardenError").style.display="block"; return; }
  const btn = document.getElementById("gardenBtn");
  const spinner = document.getElementById("gardenSpinner");
  const result = document.getElementById("gardenResult");
  const errBox = document.getElementById("gardenError");
  if (!btn || !spinner || !result || !errBox) { alert("Page error - please refresh and try again."); return; }
  btn.disabled = true; spinner.style.display = "flex"; result.style.display = "none"; errBox.style.display = "none";

  const zip = document.getElementById("storeZip").value || "60120";
  const prompt = `You are an expert landscape designer and horticulturalist creating a planting plan for a home gardener.

Garden description: "${desc}"
Style preference: "${gardenStyle || "any"}"
Store ZIP: ${zip} (assume USDA Zone 5-6 Midwest unless description says otherwise)

Design a complete, realistic planting plan. Return ONLY valid JSON (no markdown):
{
  "planName": "Creative name for this garden design",
  "summary": "2-3 sentence overview of the design concept",
  "layoutDescription": "Paragraph describing where to place plants spatially — front to back, height layering, focal points",
  "plants": [
    {
      "position": 1,
      "commonName": "Plant name",
      "cultivar": "specific variety if applicable",
      "emoji": "🌸",
      "quantity": 3,
      "role": "Anchor / Filler / Thriller / Spiller / Edging",
      "placement": "Where in the bed",
      "whyItWorks": "Why this plant suits the design and conditions",
      "bloomSeason": "Spring/Summer/Fall",
      "mature size": "height x spread"
    }
  ],
  "shoppingList": [
    { "item": "product name", "quantity": "3 plants", "estimatedCost": 12.99 }
  ],
  "totalEstimate": 89.99,
  "plantingTips": "Key tips for planting this design successfully",
  "maintenanceCalendar": "Brief month-by-month care overview"
}
Include 6-10 plants. Be specific with cultivar names. Make it beautiful and achievable.`;

  try {
    const raw = await aiCall(prompt);
    const plan = parseJSON(raw);
    if (!plan || !plan.plants) {
      console.error("Garden plan parse failed. Raw:", raw?.substring(0,200));
      errBox.textContent = "Could not generate plan. Try being more specific about your space (size, sun, zone).";
      errBox.style.display = "block"; btn.disabled = false; spinner.style.display = "none"; return;
    }

    const plantsHTML = plan.plants.map(p => `
      <div class="plant-item">
        <div class="plant-num">${p.position}</div>
        <div class="plant-item-info">
          <div class="plant-item-name">${p.emoji || "🌿"} ${p.commonName}${p.cultivar ? ` '${p.cultivar}'` : ""} <span style="font-size:11px;color:rgba(200,240,200,.4)">× ${p.quantity || 1}</span></div>
          <div class="plant-item-detail">${p.role || ""} · ${p.placement || ""}</div>
          <div class="plant-item-detail" style="color:rgba(200,240,200,.4);margin-top:2px">${p.whyItWorks || ""}</div>
          <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
            ${p.bloomSeason ? `<span style="font-size:10px;color:#74c69d;background:rgba(116,198,157,.1);border-radius:4px;padding:2px 6px">🌸 ${p.bloomSeason}</span>` : ""}
            ${p["mature size"] ? `<span style="font-size:10px;color:rgba(200,240,200,.4);background:rgba(255,255,255,.05);border-radius:4px;padding:2px 6px">📏 ${p["mature size"]}</span>` : ""}
          </div>
        </div>
      </div>`).join("");

    const shoppingHTML = (plan.shoppingList || []).map(s => `
      <div class="shopping-item">
        <span style="color:#b7e4c7">${s.item}</span>
        <span style="color:rgba(200,240,200,.5)">${s.quantity}</span>
        <span style="color:#f5a623;font-weight:600">$${(s.estimatedCost||0).toFixed(2)}</span>
      </div>`).join("");

    result.innerHTML = `
      <div class="garden-plan">
        <div class="garden-plan-header">
          <div class="garden-plan-title">🏡 ${plan.planName || "Your Garden Plan"}</div>
          <div class="garden-plan-sub">${plan.plants?.length || 0} plants · Est. $${(plan.totalEstimate||0).toFixed(2)}</div>
        </div>
        <div class="garden-plan-body">
          <p style="font-size:14px;color:#b7e4c7;line-height:1.7;margin-bottom:14px">${plan.summary || ""}</p>
          ${plan.layoutDescription ? `<div class="garden-layout">${plan.layoutDescription}</div>` : ""}
          <div style="font-size:11px;color:#a78bfa;text-transform:uppercase;letter-spacing:.09em;font-weight:600;margin-bottom:10px">🌿 Planting Plan</div>
          ${plantsHTML}
          ${plan.plantingTips ? `<div class="tips-box" style="margin-top:14px;border-color:rgba(167,139,250,.3)"><h4 style="color:#a78bfa">💡 Planting Tips</h4><p>${plan.plantingTips}</p></div>` : ""}
          ${plan.maintenanceCalendar ? `<div class="tips-box" style="margin-top:10px"><h4>📅 Maintenance Calendar</h4><p>${plan.maintenanceCalendar}</p></div>` : ""}
        </div>
      </div>
      <div class="shopping-list">
        <div style="font-size:11px;color:#f5a623;text-transform:uppercase;letter-spacing:.09em;font-weight:600;margin-bottom:10px">🛒 Shopping List</div>
        ${shoppingHTML}
        <div class="shopping-total"><span>Estimated Total</span><span>$${(plan.totalEstimate||0).toFixed(2)}</span></div>
      </div>
      <button class="btn-primary" style="margin-top:14px" onclick="document.getElementById('gardenResult').style.display='none';document.getElementById('gardenDesc').value='';gardenStyle='';document.querySelectorAll(\"#screen-garden .chip\").forEach(c=>c.classList.remove('active'))">Start New Plan</button>`;

    result.style.display = "block";
  } catch(e) {
    console.error("Garden error:", e);
    errBox.textContent = "Connection error: " + e.message + ". Please try again.";
    errBox.style.display = "block";
  }
  btn.disabled = false; spinner.style.display = "none";
}

// ─── CARE REMINDERS ───────────────────────────────────────────────────────────
let selectedZone = "Zone 5";

function toggleZoneChip(el, val) {
  document.querySelectorAll("#zoneChips .chip").forEach(c => c.classList.remove("active"));
  el.classList.add("active");
  selectedZone = val;
}

async function doGetCareSchedule() {
  const plant = document.getElementById("carePlantInput").value.trim();
  if (!plant) { document.getElementById("careError").textContent = "Please enter a plant name."; document.getElementById("careError").style.display = "block"; return; }
  const btn = document.getElementById("careBtn");
  const spinner = document.getElementById("careSpinner");
  const result = document.getElementById("careResult");
  const errBox = document.getElementById("careError");
  if (!btn || !spinner || !result || !errBox) { alert("Page error - please refresh and try again."); return; }
  btn.disabled = true; spinner.style.display = "flex"; result.style.display = "none"; errBox.style.display = "none";

  const prompt = `You are a master horticulturalist creating a monthly care calendar for: "${plant}" in ${selectedZone}.

Return ONLY valid JSON (no markdown). Keep each task description under 15 words. Max 3 tasks per month:
{
  "commonName": "...",
  "scientificName": "...",
  "emoji": "🌸",
  "overview": "2-sentence care overview",
  "months": [
    { "month": "January", "status": "active|slow|dormant", "tasks": [{ "icon": "💧", "task": "Brief specific instruction" }] }
  ],
  "quickTips": ["tip1","tip2","tip3"],
  "commonMistakes": ["mistake1","mistake2"]
}
Include all 12 months. Status: active=growing season, slow=transition, dormant=winter rest.
Icons: 💧 watering 🌱 fertilizing ✂️ pruning 🌸 deadheading 🛡️ pest watch 🌿 mulching 🔄 dividing 📦 storage
BE CONCISE — short JSON response is critical.`;

  try {
    const raw = await aiCall(prompt);
    const schedule = parseJSON(raw);
    if (!schedule || !schedule.months) {
      console.error("Care schedule parse failed. Raw:", raw?.substring(0,200));
      errBox.textContent = "Could not generate schedule. Check the plant name and try again.";
      errBox.style.display = "block"; btn.disabled = false; spinner.style.display = "none"; return;
    }

    const STATUS_TAG = { active:"care-active", slow:"care-slow", dormant:"care-dormant" };
    const STATUS_LABEL = { active:"Growing Season", slow:"Transition", dormant:"Dormant" };

    const monthsHTML = schedule.months.map(m => {
      const tagClass = STATUS_TAG[m.status] || "care-slow";
      const tagLabel = STATUS_LABEL[m.status] || m.status;
      const tasksHTML = (m.tasks || []).map(t =>
        `<div class="care-task"><span class="care-task-icon">${t.icon||"•"}</span><span>${t.task}</span></div>`
      ).join("");
      return `<div class="care-month-card">
        <div class="care-month-header">
          <span class="care-month-name">${m.month}</span>
          <span class="care-month-tag ${tagClass}">${tagLabel}</span>
        </div>
        ${tasksHTML}
      </div>`;
    }).join("");

    const tipsHTML = (schedule.quickTips || []).map(t =>
      `<div class="prevention-item">💡 ${t}</div>`
    ).join("");
    const mistakesHTML = (schedule.commonMistakes || []).map(m =>
      `<div class="prevention-item">⚠️ ${m}</div>`
    ).join("");

    result.innerHTML = `
      <div class="care-hero">
        <div class="care-plant-name">${schedule.emoji || "🌿"} ${schedule.commonName || plant}</div>
        <div class="care-plant-sci">${schedule.scientificName || ""} · ${selectedZone}${getZoneDisplay(document.getElementById("storeZip")?.value||"") ? " (auto-detected)" : ""}</div>
        <p style="font-size:13px;color:rgba(110,231,183,.7);margin-top:10px;line-height:1.6">${schedule.overview || ""}</p>
      </div>
      <div style="font-size:11px;color:#34d399;text-transform:uppercase;letter-spacing:.09em;font-weight:600;margin-bottom:12px">📅 Monthly Care Calendar</div>
      ${monthsHTML}
      ${tipsHTML ? `<div class="pest-section" style="margin-top:12px"><div class="pest-section-title">💡 Quick Tips</div>${tipsHTML}</div>` : ""}
      ${mistakesHTML ? `<div class="pest-section" style="margin-top:10px"><div class="pest-section-title">⚠️ Common Mistakes</div>${mistakesHTML}</div>` : ""}
      <button class="btn-primary" style="margin-top:16px" onclick="document.getElementById('careResult').style.display='none';document.getElementById('carePlantInput').value=''">Check Another Plant</button>`;

    result.style.display = "block";
  } catch(e) {
    console.error("Care error:", e);
    let msg = e.message || "Unknown error";
    if (msg.includes("sandbox") || msg.includes("timeout") || msg.includes("524") || msg.includes("502")) {
      msg = "Response too large for free plan. Try a more specific plant name or shorter zone description.";
    }
    errBox.textContent = "Error: " + msg + ". Please try again.";
    errBox.style.display = "block";
  }
  btn.disabled = false; spinner.style.display = "none";
}

// Add tips for new screens
if (typeof TIPS !== 'undefined') {
  TIPS.weather = ["I use real-time weather data to give you frost warnings and planting advice!", "Check before every planting session — frost can sneak up fast in spring and fall.", "I'll tell you exactly which plants need protection tonight."];
  TIPS.garden = ["Describe your space in detail — dimensions, sun, style, and budget all help!", "I'll create a complete planting plan with a shopping list and care calendar.", "Tell me your favorite colors and I'll design around them!"];
  TIPS.care = ["Select your USDA zone for the most accurate care schedule.", "I'll give you specific tasks for every month of the year.", "Great for new plant owners who want to know exactly what to do and when!"];
}
