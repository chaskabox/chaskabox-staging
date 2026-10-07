#!/usr/bin/env python3
"""Generate one static product page per product: product/<id>/index.html

Each page has:
  - clean URL: https://chaskabox.online/product/<id>  (no hash)
  - product-specific OG/Twitter meta tags -> WhatsApp/FB link previews
  - Product JSON-LD for SEO
  - same look/feel as the SPA product view (reuses styles.css classes)
  - working cart (shared localStorage key), wishlist, recommendations, back button

Run from repo root:  python3 tools/gen-product-pages.py
"""
import json, html, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://chaskabox.online"
DEFAULT_OG = SITE + "/images/logo-navy.png"

def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)

def brand_of(name):
    return str(name or "").split("|")[0].strip() or "ChaskaBox"


CATEGORY_SLUGS = {
    "Biscuits & Wafers": "biscuits-and-wafers",
    "Bunties & Cakes": "bunties-and-cakes",
    "Chocolates & Candies": "chocolates-and-candies",
    "Snacks & Nimco": "snacks-and-nimco",
    "Jellies & Marshmallow": "jellies-and-marshmallow",
    "Imli & Ice Lollies": "imli-and-ice-lollies",
    "Chews & Gums": "chews-and-gums",
    "Betel Nuts & Pan Masala": "betel-nuts-and-pan-masala",
    "Bundles": "bundles",
}

def category_url(cat):
    if cat == "Bundles": return "/bundles/"
    slug = CATEGORY_SLUGS.get(cat)
    return f"/category/{slug}/" if slug else "/shop/"

def main():
    with open(os.path.join(ROOT, "products.json"), encoding="utf-8") as f:
        products = json.load(f)

    # validate ids
    ids = [p.get("id") for p in products]
    assert all(isinstance(i, int) for i in ids), "non-int product id found"
    assert len(set(ids)) == len(ids), "duplicate product ids!"

    by_id = {p["id"]: p for p in products}
    # related: same category, prefer ones with images
    by_cat = {}
    for p in products:
        by_cat.setdefault(p.get("category") or "", []).append(p)

    # small lookup for cart drawer + smart recommendations: id -> {name, price, img, cat, brand}
    lookup = {str(p["id"]): {"name": p["name"], "price": p["price"],
                             "img": (p.get("img") if p.get("img") and os.path.exists(os.path.join(ROOT, p.get("img"))) else None), "cat": p.get("category") or "",
                             "brand": brand_of(p.get("name"))} for p in products}
    lookup_json = json.dumps(lookup, ensure_ascii=False)

    count = 0
    for p in products:
        pid = p["id"]
        name = p.get("name", "")
        desc = (p.get("desc") or "").strip()
        cat = p.get("category") or ""
        pack = p.get("pack") or ""
        price = p.get("price", 0)
        old_price = p.get("oldPrice")
        badge = p.get("badge") or ""
        img = p.get("img")  # e.g. "images/p5.webp" or None
        if img and not os.path.exists(os.path.join(ROOT, img)):
            img = None
        brand = brand_of(name)

        title = f"{name} | ChaskaBox"
        meta_desc = (desc[:157] + "...") if len(desc) > 160 else desc
        if not meta_desc:
            meta_desc = f"Buy {name} online in Pakistan. COD and prepaid payment available, 4-7 day nationwide delivery. ChaskaBox."
        og_image = SITE + "/" + img if img else DEFAULT_OG
        canonical = f"{SITE}/product/{pid}/"

        # ---- product detail body (mirrors SPA renderProductDetail classes) ----
        if img:
            img_html = f'<img src="/{esc(img)}" alt="{esc(name)}">'
        else:
            img_html = (f'<div class="noimg"><b>CHASKABOX</b><span>Photo<br>coming soon</span>'
                        f'<small>{esc(cat)}</small></div>')
        badge_html = ""
        if badge:
            bcls = "bestseller" if badge == "Bestseller" else ""
            blabel = "Sale" if badge == "Sale" else esc(badge.upper())
            badge_html = f'<span class="badge {bcls}">{blabel}</span>'
        old_html = ""
        save_html = ""
        if old_price and old_price > price:
            old_html = f'<span class="oldprice">Rs. {old_price:,}</span>'
            save_html = (f'<span class="pdsave">Save '
                         f'{round((1 - price / old_price) * 100)}%</span>')
        catlabel = (f'<div class="pcat">{esc(cat)}'
                    f'{" · BUNDLE" if p.get("bundle") else ""}</div>') if cat else ""
        price_fmt = f"Rs. {price:,}"

        body_html = f"""
<div class="pdetail">
  <div class="pd-grid">
    <div class="pd-imgwrap">{badge_html}<div class="pd-img">{img_html}</div></div>
    <div class="pd-info">
      {catlabel}
      <h1>{esc(name)}</h1>
      <div class="pd-brand">{esc(brand)}</div>
      <div class="pd-price"><span class="price" style="font-size:26px">{price_fmt}</span>{old_html}{save_html}</div>
      <div class="ppack" style="margin-bottom:10px">{esc(pack)}</div>
      <p class="pd-desc">{esc(desc) if desc else 'Product details are being updated. Contact ChaskaBox if you need ingredient or allergen information before ordering.'}</p>
      <div class="pd-buyrow">
        <div class="qty"><button onclick="pdQty(-1)" aria-label="Decrease">−</button><b id="pdqty">1</b><button onclick="pdQty(1)" aria-label="Increase">+</button></div>
        <button class="pdbtn" onclick="addToCart({pid},+document.getElementById('pdqty').textContent,this)">Add to Bag · {price_fmt}</button>
        <button class="pdwish" id="wishBtn" aria-label="Wishlist" onclick="toggleWish({pid})">♥</button>
      </div>
      <div class="dbox"><b>Estimated delivery</b><small>Pakistan-wide delivery window<br><span class="ddates" id="ddates"></span></small></div>
      <div class="pd-meta"><span>🚚 COD: Rs. 300 delivery</span><span>⚡ Prepaid Rs. 5,000+: FREE delivery</span><span>✅ Original sealed packs</span></div>
      <div class="pd-share"><b>Share this snack:</b>
        <a class="sharebtn" href="https://wa.me/?text={esc(canonical)}" target="_blank" rel="noopener">📲 WhatsApp</a>
        <button class="sharebtn" onclick="copyLink()">🔗 Copy Link</button>
      </div>
    </div>
  </div>
  <div class="pd-help">
    <b>Need ingredients, allergen or availability details?</b>
    <p>WhatsApp ChaskaBox at 0332-0005381 before ordering. If an item becomes unavailable after your order, we will contact you before any removal or substitution.</p>
  </div>
</div>"""

        # ---- related products: rendered dynamically by JS (smart recommendations) ----

        # ---- JSON-LD ----
        jd = {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": name,
            "description": meta_desc,
            "url": canonical,
            "category": cat,
            "brand": {"@type": "Brand", "name": brand},
            "offers": {
                "@type": "Offer",
                "url": canonical,
                "priceCurrency": "PKR",
                "price": price,
                "availability": "https://schema.org/InStock",
            },
        }
        if img:
            jd["image"] = og_image
        json_ld = json.dumps(jd, ensure_ascii=False)

        page = TEMPLATE
        page = page.replace("%%TITLE%%", esc(title))
        page = page.replace("%%META_DESC%%", esc(meta_desc))
        page = page.replace("%%OG_IMAGE%%", esc(og_image))
        page = page.replace("%%CANONICAL%%", esc(canonical))
        page = page.replace("%%BODY_HTML%%", body_html)
        page = page.replace("%%JSON_LD%%", json_ld)
        page = page.replace("%%LOOKUP_JSON%%", lookup_json)
        page = page.replace("%%PID%%", str(pid))
        page = page.replace("%%PID_CAT_JS%%", json.dumps(cat))
        page = page.replace("%%PID_BRAND_JS%%", json.dumps(brand))
        page = page.replace("%%PRICE%%", str(price))
        page = page.replace("%%CRUMB_CAT%%", esc(cat or "All Snacks"))
        page = page.replace("%%CRUMB_URL%%", esc(category_url(cat)))
        page = page.replace("%%CRUMB_NAME%%", esc(name))

        outdir = os.path.join(ROOT, "product", str(pid))
        os.makedirs(outdir, exist_ok=True)
        with open(os.path.join(outdir, "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        count += 1

    # Keep the product sitemap synchronized with the same live catalogue used
    # to generate the static product pages. This prevents stale product URLs
    # when the catalogue changes between deployments.
    sitemap_lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for p in products:
        sitemap_lines.append(
            f'  <url><loc>{SITE}/product/{p["id"]}/</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>'
        )
    sitemap_lines.append('</urlset>')
    with open(os.path.join(ROOT, "sitemap-products.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(sitemap_lines) + "\n")

    print(f"Generated {count} product pages and sitemap-products.xml.")

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%%TITLE%%</title>
<meta name="description" content="%%META_DESC%%">
<link rel="canonical" href="%%CANONICAL%%">
<meta property="og:type" content="product">
<meta property="og:site_name" content="ChaskaBox">
<meta property="og:title" content="%%TITLE%%">
<meta property="og:description" content="%%META_DESC%%">
<meta property="og:image" content="%%OG_IMAGE%%">
<meta property="og:url" content="%%CANONICAL%%">
<meta property="og:price:amount" content="%%PRICE%%">
<meta property="og:price:currency" content="PKR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="%%TITLE%%">
<meta name="twitter:description" content="%%META_DESC%%">
<meta name="twitter:image" content="%%OG_IMAGE%%">
<meta name="theme-color" content="#1a2b5c">
<link rel="icon" href="/images/logo-navy.png">
<link rel="stylesheet" href="/styles.css?v=7">
<script type="application/ld+json">%%JSON_LD%%</script>
<style>
.crumb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 4px;font-size:13px;color:var(--muted)}
.crumb a{color:var(--navy);text-decoration:none}
.backbtn{display:inline-flex;align-items:center;gap:6px;margin:10px 0;padding:9px 18px;border-radius:10px;border:1px solid var(--border-soft);background:var(--card);color:var(--ink);font-weight:700;cursor:pointer;font-size:14px}
.backbtn:hover{border-color:var(--navy)}
.pd-share{margin-top:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sharebtn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:10px;background:var(--navy);color:#fff;text-decoration:none;font-weight:700;font-size:13px;border:none;cursor:pointer}
.sharebtn:last-child{background:var(--card);color:var(--ink);border:1px solid var(--border-soft)}
.rel-sec{margin:34px 0 10px}
.rel-sec h2{font-size:20px;margin-bottom:12px;color:var(--navy)}
.rel-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.rel-sub{font-size:13px;color:var(--muted);margin:-6px 0 12px}
.rel-card{text-decoration:none;color:inherit}
.pdhead{max-width:1100px;margin:0 auto;padding:0 14px}
.pd-help{margin:28px 0 8px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:18px}
.pd-help p{margin-top:5px;color:var(--muted);font-size:13px}
</style>
</head>
<body>
<header>
  <div class="hwrap">
    <a class="logo" href="/"><img src="/images/logo-navy.png" alt="ChaskaBox" class="logo-img"></a>
    <nav class="hnav" aria-label="Main navigation">
      <a class="hdrop-btn" href="/" style="text-decoration:none">Home</a>
      <a class="hdrop-btn" href="/shop/" style="text-decoration:none">Shop</a>
      <a class="hdrop-btn" href="/bundles/" style="text-decoration:none">Chaska Boxes</a>
    </nav>
    <form class="header-search" role="search" onsubmit="productSearch(event)"><label class="sr-only" for="productHeaderSearch">Search snacks</label><input id="productHeaderSearch" type="search" placeholder="Search snacks..." autocomplete="off"><button type="submit" aria-label="Search">⌕</button></form>
    <button class="hbtn solid" onclick="openDrawer()" title="Your snack bag" aria-label="Open bag">Bag <b class="cartcount" id="bagCount">0</b></button>
  </div>
</header>
<main class="pdhead">
  <button class="backbtn" onclick="goBack()">← Back</button>
  <nav class="crumb" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="%%CRUMB_URL%%">%%CRUMB_CAT%%</a> / <span>%%CRUMB_NAME%%</span></nav>
  %%BODY_HTML%%
  <section class="rel-sec">
    <h2>You may also like</h2>
    <p class="rel-sub">Picked for you based on what you've been browsing 🍬</p>
    <div class="rel-grid" id="relGrid"></div>
  </section>
</main>
<footer>
  <div class="fwrap">
    <div class="fbrand"><img src="/images/logo-white.png" alt="ChaskaBox"><p>Bachpan ka zaiqa, ab ghar baithe. Pakistani snacks sourced after your order, with a personal touch.</p></div>
    <div><h3>Shop</h3><p><a href="/shop/">All Snacks</a><br><a href="/bundles/">Chaska Boxes</a></p></div>
    <div><h3>Help</h3><p><a href="/about/">About</a><br><a href="/contact/">Contact</a><br><a href="/shipping-policy/">Shipping</a><br><a href="/refund-policy/">Refund & Resolution</a></p></div>
    <div><h3>Legal</h3><p><a href="/privacy-policy/">Privacy</a><br><a href="/terms/">Terms</a></p></div>
  </div>
  <div class="fbottom">© 2026 ChaskaBox · Made with chaska in Pakistan 🇵🇰</div>
</footer>
<div class="overlay" id="overlay" onclick="closeDrawer()"></div>
<aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-label="Your snack bag" aria-hidden="true">
  <div class="dhead"><h3>Your snack bag</h3><button class="mclose" style="position:static" onclick="closeDrawer()">✕</button></div>
  <div class="ditems" id="ditems"></div>
  <div class="dfoot" id="dfoot"></div>
</aside>
<script>
var LOOKUP = %%LOOKUP_JSON%%;
var PID = %%PID%%;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function fmt(n){return 'Rs. '+Number(n).toLocaleString('en-PK');}
function goBack(){ if(history.length>1){ history.back(); } else { location.href='/'; } }
function productSearch(e){ e.preventDefault(); var q=(document.getElementById('productHeaderSearch').value||'').trim(); location.href='/shop/'+(q?'?q='+encodeURIComponent(q):''); }
function copyLink(){ var u='%%CANONICAL%%'; if(navigator.clipboard){ navigator.clipboard.writeText(u).then(function(){alert('Link copied! 🔗');}); } else { prompt('Copy this link:', u); } }
/* delivery estimate */
(function(){ var f=function(d){return d.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});};
var a=new Date(); a.setDate(a.getDate()+4); var b=new Date(); b.setDate(b.getDate()+7);
document.getElementById('ddates').textContent='From '+f(a)+' to '+f(b); })();
/* qty */
function pdQty(d){var e=document.getElementById('pdqty');e.textContent=Math.max(1,+e.textContent+d);}
/* cart (shared with main site via localStorage) */
var CART={};
function loadCart(){ try{ CART=JSON.parse(localStorage.getItem('chaskabox-cart')||'{}'); }catch(e){ CART={}; } }
function saveCart(){ try{ localStorage.setItem('chaskabox-cart',JSON.stringify(CART)); }catch(e){} updateBadge(); }
function cartCount(){ var n=0; for(var k in CART){ n+=+CART[k]||0; } return n; }
function updateBadge(){ var e=document.getElementById('bagCount'); if(e) e.textContent=cartCount(); }
function addToCart(id,qty,btn){ loadCart(); if(btn) flyProductToBag(btn); CART[id]=(+CART[id]||0)+(+qty||1); saveCart(); renderDrawer(); if(btn){const old=btn.textContent;btn.textContent='Added ✓';btn.disabled=true;setTimeout(()=>{btn.textContent=old;btn.disabled=false},800);} else openDrawer(); }
function flyProductToBag(btn){try{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;const img=document.querySelector('.pd-img img'),target=document.querySelector('.hbtn.solid');if(!img||!target)return;const a=img.getBoundingClientRect(),b=target.getBoundingClientRect();const g=img.cloneNode();g.className='fly-ghost';g.alt='';g.style.left=(a.left+a.width/2-27)+'px';g.style.top=(a.top+a.height/2-27)+'px';document.body.appendChild(g);const dx=(b.left+b.width/2)-(a.left+a.width/2),dy=(b.top+b.height/2)-(a.top+a.height/2);requestAnimationFrame(()=>requestAnimationFrame(()=>{g.style.transform=`translate(${dx}px,${dy}px) scale(.12)`;g.style.opacity='.2'}));setTimeout(()=>g.remove(),700);}catch(e){}}
function cartQty(id,d){ loadCart(); id=String(id); CART[id]=Math.max(0,(+CART[id]||0)+d); if(!CART[id]) delete CART[id]; saveCart(); renderDrawer(); }
function renderDrawer(){
  loadCart();
  var items=document.getElementById('ditems'), foot=document.getElementById('dfoot');
  var keys=Object.keys(CART);
  if(!keys.length){
    items.innerHTML='<div class="empty">Your bag is empty.<br>Go grab some chaska! 🍪</div>';
    foot.innerHTML='';
    return;
  }
  var total=0, h='';
  keys.forEach(function(id){
    var p=LOOKUP[id]; if(!p) return;
    var q=+CART[id]||0, sub=p.price*q; total+=sub;
    var img=p.img?'<img src="/'+esc(p.img)+'" alt="">':'<div style="font-size:36px">🍪</div>';
    h+='<div class="ditem">'+img+'<div class="di"><div class="din">'+esc(p.name)+'</div>'
      +'<div class="dip">'+fmt(p.price)+' each</div></div>'
      +'<div class="qty"><button onclick="cartQty('+id+',-1)" aria-label="Decrease">−</button><b>'+q+'</b><button onclick="cartQty('+id+',1)" aria-label="Increase">+</button></div></div>';
  });
  items.innerHTML=h;
  foot.innerHTML='<div class="drow total"><span>Total</span><span>'+fmt(total)+'</span></div>'
    +'<button class="checkoutbtn" onclick="location.href=&quot;/checkout.html&quot;">Continue to checkout</button>';
}
function openDrawer(){ renderDrawer(); var d=document.getElementById('drawer'); d.classList.add('open'); d.setAttribute('aria-hidden','false'); document.getElementById('overlay').classList.add('open'); document.body.style.overflow='hidden'; setTimeout(function(){var c=d.querySelector('.mclose');if(c)c.focus();},0); }
function closeDrawer(){ var d=document.getElementById('drawer'); d.classList.remove('open'); d.setAttribute('aria-hidden','true'); document.getElementById('overlay').classList.remove('open'); document.body.style.overflow=''; }
/* wishlist (shared key with main site) */
var WISH=[];
function loadWish(){ try{ WISH=JSON.parse(localStorage.getItem('chaskabox-wishlist')||'[]'); }catch(e){ WISH=[]; } }
function toggleWish(id){
  loadWish(); id=+id;
  var i=WISH.indexOf(id);
  if(i===-1){ WISH.push(id); } else { WISH.splice(i,1); }
  try{ localStorage.setItem('chaskabox-wishlist',JSON.stringify(WISH)); }catch(e){}
  syncWishBtn();
}
function syncWishBtn(){ var b=document.getElementById('wishBtn'); if(b){ b.classList.toggle('on', WISH.indexOf(PID)!==-1); } }
/* smart recommendations: learns what you browse, shows 7 similar picks */
var CUR_CAT = %%PID_CAT_JS%%, CUR_BRAND = %%PID_BRAND_JS%%;
var VIEWS_KEY = 'chaskabox-views';
function recordView(){
  var v = [];
  try{ v = JSON.parse(localStorage.getItem(VIEWS_KEY)||'[]'); }catch(e){ v = []; }
  v = v.filter(function(x){ return +x.id !== PID; });
  v.unshift({id: PID, cat: CUR_CAT, brand: CUR_BRAND, ts: Date.now()});
  if(v.length > 30) v.length = 30;
  try{ localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); }catch(e){}
}
function getViews(){
  try{ return JSON.parse(localStorage.getItem(VIEWS_KEY)||'[]'); }catch(e){ return []; }
}
function renderRelated(){
  var views = getViews(), catW = {}, brandW = {}, i, x, w;
  for(i = 0; i < views.length; i++){
    x = views[i]; w = 1/(1 + i*0.25);
    catW[x.cat] = (catW[x.cat]||0) + w;
    brandW[x.brand] = (brandW[x.brand]||0) + w;
  }
  var scored = [], id, p, s;
  for(id in LOOKUP){
    if(+id === PID) continue;
    p = LOOKUP[id];
    if(!p.img) continue;
    s = (catW[p.cat]||0)*3 + (brandW[p.brand]||0)*2;
    if(p.cat === CUR_CAT) s += 1.5;
    scored.push({id: id, s: s});
  }
  scored.sort(function(a,b){ return (b.s - a.s) || (+a.id - +b.id); });
  var grid = document.getElementById('relGrid');
  grid.innerHTML = scored.slice(0, 7).map(function(x){
    p = LOOKUP[x.id];
    var img = p.img
      ? '<img src="/'+esc(p.img)+'" alt="'+esc(p.name)+'" loading="lazy">'
      : '<div class="noimg"><b>CHASKABOX</b><span>Photo<br>coming soon</span></div>';
    return '<a class="card rel-card" href="/product/'+x.id+'/">'
      + '<div class="pimg">'+img+'</div>'
      + '<div class="pbody"><div class="pname">'+esc(p.name)+'</div>'
      + '<div class="prow"><div><span class="price">'+fmt(p.price)+'</span></div></div>'
      + '</div></a>';
  }).join('');
}
/* init */
loadCart(); updateBadge(); loadWish(); syncWishBtn();
recordView(); renderRelated();
</script>
<script src="/supabase-config.js?v=4" defer></script>
<script src="/analytics.js?v=1" defer></script>
<script src="/product-runtime.js?v=1" defer></script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
