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
  const prompt = `You are an expert horticulturalist helping a customer at a garden center find the perfect plants.

Customer preferences:
- Plant type: ${a.type || "any"}
- Preferred color: ${a.color || "any"}  
- Sun conditions: ${a.sun || "any"}
- Planting location: ${a.location || "any"}
- Maintenance level: ${a.maintenance || "any"}

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
    const b64 = pestImageBase64.split(",")[1];
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

async function getCoords(zip) {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${zip}&count=1&language=en&format=json`);
  const data = await res.json();
  const r = data?.results?.[0];
  if (!r) throw new Error("ZIP not found");
  return { lat: r.latitude, lon: r.longitude, name: r.name, state: r.admin1 };
}

async function getWeather(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,precipitation,weathercode,windspeed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  return await res.json();
}

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
  const zip = document.getElementById("weatherZip").value.trim() || document.getElementById("storeZip").value || "60120";
  const errBox = document.getElementById("weatherError");
  const spinner = document.getElementById("weatherSpinner");
  const result = document.getElementById("weatherResult");
  errBox.style.display = "none";
  spinner.style.display = "flex";
  result.style.display = "none";

  try {
    const loc = await getCoords(zip);
    const wx = await getWeather(loc.lat, loc.lon);
    const cur = wx.current;
    const daily = wx.daily;

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
    errBox.textContent = "Could not load weather. Check your ZIP code and try again.";
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
    if (!plan || !plan.plants) { errBox.textContent = "Could not generate plan. Please try again."; errBox.style.display = "block"; btn.disabled = false; spinner.style.display = "none"; return; }

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
  } catch { errBox.textContent = "Connection error. Please try again."; errBox.style.display = "block"; }
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
  btn.disabled = true; spinner.style.display = "flex"; result.style.display = "none"; errBox.style.display = "none";

  const prompt = `You are a master horticulturalist creating a complete monthly care calendar for: "${plant}" in ${selectedZone}.

Return ONLY valid JSON (no markdown):
{
  "commonName": "...",
  "scientificName": "...",
  "emoji": "🌸",
  "overview": "2-sentence care overview",
  "months": [
    {
      "month": "January",
      "status": "active|slow|dormant",
      "tasks": [
        { "icon": "💧", "task": "Specific care instruction" }
      ]
    }
  ],
  "quickTips": ["tip1","tip2","tip3"],
  "commonMistakes": ["mistake1","mistake2"]
}
Include all 12 months. Status: active=growing season, slow=transition, dormant=winter rest.
Tasks should be SPECIFIC and actionable — include frequency, amounts, and timing where relevant.
Use these task icons: 💧 watering, 🌱 fertilizing, ✂️ pruning, 🌸 deadheading, 🪴 repotting, 🌡️ temperature, 🛡️ pest watch, 🌿 mulching, 🔄 dividing, 📦 storage`;

  try {
    const raw = await aiCall(prompt);
    const schedule = parseJSON(raw);
    if (!schedule || !schedule.months) { errBox.textContent = "Could not generate schedule. Try again."; errBox.style.display = "block"; btn.disabled = false; spinner.style.display = "none"; return; }

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
        <div class="care-plant-sci">${schedule.scientificName || ""} · ${selectedZone}</div>
        <p style="font-size:13px;color:rgba(110,231,183,.7);margin-top:10px;line-height:1.6">${schedule.overview || ""}</p>
      </div>
      <div style="font-size:11px;color:#34d399;text-transform:uppercase;letter-spacing:.09em;font-weight:600;margin-bottom:12px">📅 Monthly Care Calendar</div>
      ${monthsHTML}
      ${tipsHTML ? `<div class="pest-section" style="margin-top:12px"><div class="pest-section-title">💡 Quick Tips</div>${tipsHTML}</div>` : ""}
      ${mistakesHTML ? `<div class="pest-section" style="margin-top:10px"><div class="pest-section-title">⚠️ Common Mistakes</div>${mistakesHTML}</div>` : ""}
      <button class="btn-primary" style="margin-top:16px" onclick="document.getElementById('careResult').style.display='none';document.getElementById('carePlantInput').value=''">Check Another Plant</button>`;

    result.style.display = "block";
  } catch { errBox.textContent = "Connection error. Please try again."; errBox.style.display = "block"; }
  btn.disabled = false; spinner.style.display = "none";
}

// Add tips for new screens
if (typeof TIPS !== 'undefined') {
  TIPS.weather = ["I use real-time weather data to give you frost warnings and planting advice!", "Check before every planting session — frost can sneak up fast in spring and fall.", "I'll tell you exactly which plants need protection tonight."];
  TIPS.garden = ["Describe your space in detail — dimensions, sun, style, and budget all help!", "I'll create a complete planting plan with a shopping list and care calendar.", "Tell me your favorite colors and I'll design around them!"];
  TIPS.care = ["Select your USDA zone for the most accurate care schedule.", "I'll give you specific tasks for every month of the year.", "Great for new plant owners who want to know exactly what to do and when!"];
}
