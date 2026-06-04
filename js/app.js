// ─── STATE ───────────────────────────────────────────────────────────────────
let capturedImageBase64 = null;
let currentResults = [];
let locationQuery = "";
let detailBackScreen = "results";

// ─── API ─────────────────────────────────────────────────────────────────────
// ─── API CONFIGURATION ───────────────────────────────────────────────────────
// Netlify proxy (production): keeps API key server-side
const API_ENDPOINT = "/.netlify/functions/ai";

// GitHub Pages / direct mode: stores key in localStorage
// Set API_ENDPOINT to "DIRECT" in this file to enable direct mode
function getDirectKey() {
  let key = localStorage.getItem("gaia_api_key");
  if (!key) {
    key = prompt("Enter your Anthropic API key to use G.A.I.A.:\n(This is stored only in your browser's local storage)");
    if (key) localStorage.setItem("gaia_api_key", key.trim());
  }
  return key;
}

async function aiCall(prompt, imageBase64=null) {
  const content = imageBase64
    ? [{type:"image",source:{type:"base64",media_type:"image/jpeg",data:imageBase64}},{type:"text",text:prompt}]
    : prompt;

  if (API_ENDPOINT === "DIRECT") {
    // Direct mode: call Anthropic API from browser (for GitHub Pages / local file use)
    const key = getDirectKey();
    if (!key) throw new Error("No API key provided");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":key,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:1200,messages:[{role:"user",content}]})
    });
    if (!res.ok) throw new Error("API error: " + res.status);
    const data = await res.json();
    return data.content?.[0]?.text || "";
  } else {
    // Proxy mode: send to Netlify function (production)
    const res = await fetch(API_ENDPOINT, {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ prompt: content })
    });
    if (!res.ok) throw new Error("API error: " + res.status);
    const data = await res.json();
    return data.text || "";
  }
}
function parseJSON(text) {
  try { return JSON.parse(text.replace(/```json|```/g,"").trim()); }
  catch { return null; }
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
  document.getElementById("screen-"+name).classList.add("active");
  document.getElementById("bottomNav").style.display = name==="home"?"none":"flex";
  window.scrollTo(0,0);
  if(name!=="home") renderBubble(name);
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
  const b64=capturedImageBase64.split(",")[1];
  try{
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
