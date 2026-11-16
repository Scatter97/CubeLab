const { chromium, expect } = require('/home/joshua/cube-lab/node_modules/@playwright/test');
const fs = require('node:fs');
const out = '/tmp/cubelab-training-ui-evidence';
const url = 'http://127.0.0.1:5179/';
const captures = {};
const checks = {};
const errors = [];
const rects = {
  shell:'.app-shell',header:'.app-header',workspace:'.workspace',left:'.side-column',right:'.primary-column',
  topSide:'.side-column > .session-panel',panelHeading:'.session-panel .panel-heading',scramble:'.scramble-panel',scrambleHeader:'.scramble-header',scrambleBody:'.scramble-body',scrambleText:'.scramble-text',scrambleFooter:'.scramble-footer',preview:'.training-current-case',precursor:'.training-precursor',
  stage:'.timer-stage',surface:'.timer-surface',readout:'.readout-zone',digits:'.timer-display',footer:'.session-caption',
  split:'.sidebar-split',stats:'.stats-panel',statsHeading:'.stats-panel .panel-heading',statsControls:'.training-stat-controls',statsGrid:'.stats-scroll > .stats-grid',statsScroll:'.stats-scroll',stat1:'.stats-scroll .stat-entry:nth-child(1)',stat2:'.stats-scroll .stat-entry:nth-child(2)',statValue:'.stats-scroll .stat-entry .stat-value',
  divider:'.sidebar-divider,[data-testid$="-divider"]',history:'.history-panel',historyHeading:'.history-panel .panel-heading',historyCount:'.heading-count',historyScroll:'.history-scroll',historyRow:'.history-scroll .history-item,.history-scroll .history-row',historyMain:'.history-scroll .history-main',historyTime:'.history-scroll .history-time',historyMeta:'.history-scroll .history-meta',
  floating:'.timer-stage .scramble-draw-panel',floatingHead:'.scramble-draw-header',floatingBody:'.scramble-draw-stage',lastContent:'.training-last-content',dialog:'dialog[open]',modalBody:'dialog[open] .modal-body'
};
async function settle(page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
}
async function capture(page, key, shot = true) {
  await settle(page);
  captures[key] = await page.evaluate(map => {
    const round = v => +v.toFixed(2);
    const m = {};
    for (const [key,s] of Object.entries(map)) {
      const el = document.querySelector(s);
      if (!el) continue;
      const b = el.getBoundingClientRect(), css = getComputedStyle(el);
      m[key] = {tag:el.tagName,x:round(b.x+scrollX),y:round(b.y+scrollY),w:round(b.width),h:round(b.height),cx:round(b.x+scrollX+b.width/2),cy:round(b.y+scrollY+b.height/2),client:[el.clientWidth,el.clientHeight],scroll:[el.scrollWidth,el.scrollHeight],css:Object.fromEntries('backgroundColor color fontFamily fontSize fontWeight lineHeight padding gap borderTopWidth borderBottomWidth borderTopColor borderRadius boxShadow display gridTemplateColumns gridTemplateRows position overflowX overflowY outlineWidth outlineStyle outlineOffset flex minHeight maxHeight'.split(' ').map(k => [k,css[k]]))};
      if (['topSide','scramble','stats','historyHeading','footer','floating','dialog','historyMain','stat1','stat2'].includes(key)) m[key].text = el.innerText?.slice(0,1200);
    }
    return {scrollOffsets:[...document.querySelectorAll('.workspace,.primary-column,.side-column,.stats-scroll,.history-scroll')].map(el=>[el.className,el.scrollTop,el.clientHeight,el.scrollHeight]),view:[innerWidth,innerHeight,devicePixelRatio],zoom:document.querySelector('.app-shell').dataset.uiZoom,page:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],theme:document.documentElement.dataset.theme,active:document.activeElement?.outerHTML.slice(0,200),statsRows:document.querySelectorAll('.stats-scroll .stat-entry').length,historyRows:document.querySelectorAll('.history-main').length,divider:['aria-valuemin','aria-valuenow','aria-valuemax'].map(x=>document.querySelector('[data-testid$="-divider"]')?.getAttribute(x)), rect:m};
  }, rects);
  if (shot) await page.screenshot({path:out+'/'+key+'.png',animations:'disabled',fullPage:true});
  fs.writeFileSync(out+'/supplemental-measurements.json',JSON.stringify({browser:browser.version(),captures,checks,errors},null,2));
  console.log(key, captures[key].rect.digits?.cy, captures[key].rect.scramble?.h);
}
let browser;
const training = p => p.getByTestId('training-nav');
const combo = p => p.getByRole('combobox',{name:'Algorithm set',exact:true});
const mode = p => p.getByLabel('Include Setup Moves',{exact:true});
const surface = p => p.getByTestId('timer-surface');
const scramble = p => p.getByTestId('training-scramble');
const button = (p,name) => p.getByRole('button',{name,exact:true});
async function ready(p) {await expect(scramble(p)).toBeVisible({timeout:15000}); await expect(surface(p)).toBeEnabled({timeout:15000});}
async function attempt(p){
  await p.evaluate(()=>document.activeElement?.blur());
  await p.keyboard.down('Space');
  await expect(surface(p)).toHaveAttribute('data-phase','ready',{timeout:5000});
  await p.keyboard.up('Space');
  await expect(surface(p)).toHaveAttribute('data-phase','running');
  await p.waitForTimeout(180);
  await p.keyboard.press('Space');
  await expect(surface(p)).toHaveAttribute('data-phase','idle');
}
async function create({width=1440,height=900,theme='light',data=true,calibrated=true,long=false,zoom=100,rawTraining=null}={}){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,colorScheme:theme,serviceWorkers:'block'});
  const p=await context.newPage();
  p.setDefaultTimeout(7000);
  p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(({theme,data,long,zoom,rawTraining}) => {
    if(sessionStorage.getItem('audit-seeded')) return;
    sessionStorage.setItem('audit-seeded','yes');
    localStorage.setItem('cubelab:onboarding:v1',JSON.stringify({version:1,decision:{status:'completed',at:1}}));
    localStorage.setItem('cubelab:settings:v1',JSON.stringify({version:11,settings:{theme,inspectionEnabled:false,holdDurationMs:0,uiZoomPercent:zoom}}));
    if(rawTraining) localStorage.setItem('cubelab:training:v1',rawTraining);
    if (!data) return;
    const now=Date.now();
    const solves=Array.from({length:long?251:12},(_,i)=>({id:'audit-solve-'+i,event:'333',rawMs:2500+240*i,penalty:i===1?'dnf':'none',scramble:"R U R' U' F2 L D B2",comment:i===2?'Synthetic note':'',createdAt:now-i*60000}));
    localStorage.setItem('cubelab:sessions:v1',JSON.stringify({version:6,activeSessionId:'audit',sessions:[{id:'audit',name:'Audit session',event:'333',createdAt:now-86400000,updatedAt:now,solves}]}));
  },{theme,data,long,zoom,rawTraining});
  await p.goto(url);
  await expect(p.locator('.scramble-text')).toBeVisible({timeout:20000});
  if(data){
    const value = await p.evaluate(async ({calibrated,long})=>{
      const { createEmptyTrainingData } = await import('/src/lib/training/storage.ts');
      const { createTrainingAttempt } = await import('/src/lib/training/records.ts');
      const { setup, calibration } = await import('/src/lib/training/persistenceFixtures.test-support.ts');
      const empty=createEmptyTrainingData();
      const now=Date.now()-100000000;
      const attempts=[],visits=[];
      for(const setId of ['oll','pll']) for(const mode of ['execution','recognition']){
        const id=setId+':'+mode, visitId='audit-'+id;
        const items=Array.from({length:long?251:12},(_,i)=>{
          const raw=createTrainingAttempt({id:id+'-'+i,visitId,setup:setup(setId,mode),calibration:mode==='recognition'?{...calibration(setId),measuredAt:now-1000}:null,createdAt:now+i*60000,rawMs:2500+(11-i)*240+(long?60000:0),result:{status:'valid',penalty:i===10?'dnf':'none'}});
          return raw;
        });
        attempts.push(...items);
        visits.push({version:1,id:visitId,startedCategoryId:id,categoryIds:[id],startedAt:now,endedAt:now+((long?250:11)*60000),attemptIds:items.map(a=>a.id),summaryId:null});
      }
      return {...empty,attempts,visits,recognitionCounts:{oll:long?251:12,pll:long?251:12},calibrations:calibrated?['oll','pll'].map(set=>({...calibration(set),measuredAt:now-1000})):[]};
    },{calibrated,long});
    await p.evaluate(value=>localStorage.setItem('cubelab:training:v1',JSON.stringify(value)),value);
    await p.reload();
    await expect(p.locator('.scramble-text')).toBeVisible({timeout:15000});
  }
  return [context,p];
}
(async()=>{
  browser=await chromium.launch({args:['--no-sandbox']});
  try{
    const top = p => p.evaluate(()=>{window.scrollTo(0,0); for(const el of document.querySelectorAll('.workspace,.primary-column,.side-column')) el.scrollTop=0; });
    const [c,p]=await create({data:false});
    await capture(p,'fresh-empty-timer-top');
    await p.getByTestId('current-tool-button').click();
    await capture(p,'timer-floating-tool');
    await training(p).click(); await expect(p.getByRole('heading',{name:'Training Setup',exact:true})).toBeVisible();
    await capture(p,'fresh-empty-training-top');
    await mode(p).check(); await ready(p);
    await capture(p,'oll-calibration-initial-top');
    await attempt(p);
    await expect(button(p,'Keep sample')).toBeVisible();
    checks.calibrationAnnouncement=await p.locator('.sr-only[aria-live][aria-atomic]').innerText();
    await capture(p,'oll-calibration-review-top');
    for(let i=0;i<7;i++){
      await button(p,'Keep sample').click();
      if(i!==6) await attempt(p);
    }
    await ready(p);
    await capture(p,'oll-after-seven-calibration-top');
    await attempt(p);
    await expect(p.getByTestId('training-last-result')).toBeVisible();
    checks.previousResultName=await p.locator('.training-last-content strong').first().innerText();
    checks.recognitionPreparation=await p.locator('.training-scramble').ariaSnapshot();
    await c.close();

    for(const [width,height,theme,zoom] of [[900,760,'light',100],[901,760,'light',100],[390,844,'light',100],[320,740,'dark',100],[844,390,'light',100],[1440,900,'light',150]]){
      const [ctx,page]=await create({width,height,theme,zoom});
      const prefix=width+'x'+height+'-'+theme+'-'+zoom;
      await top(page); await capture(page,prefix+'-timer-top');
      await training(page).click(); await button(page,'Begin practice').click(); await ready(page);
      await top(page); await capture(page,prefix+'-execution-top');
      await mode(page).check(); await ready(page);
      await capture(page,prefix+'-recognition-user-position',false);
      await top(page); await capture(page,prefix+'-recognition-top');
      await ctx.close();
    }

    const [moves,pMoves]=await create();
    await training(pMoves).click(); await button(pMoves,'Begin practice').click(); await ready(pMoves);
    const panel=pMoves.getByTestId('training-last-result');
    const handle=panel.getByTestId('tool-panel-drag-handle');
    const box=await handle.boundingBox();
    await pMoves.mouse.move(box.x+10,box.y+8); await pMoves.mouse.down(); await pMoves.mouse.move(box.x-110,box.y-52,{steps:4});
    await handle.dispatchEvent('pointercancel',{pointerType:'mouse',pointerId:1,isPrimary:true});
    await pMoves.mouse.up();
    checks.dragCancelledSaved=await pMoves.evaluate(()=>localStorage.getItem('cubelab:training-last-result:layout:v1'));
    await capture(pMoves,'last-result-moved-desktop');
    await pMoves.setViewportSize({width:390,height:844}); await top(pMoves);
    await capture(pMoves,'last-result-docked');
    await pMoves.setViewportSize({width:1440,height:900}); await top(pMoves);
    await capture(pMoves,'last-result-return-desktop');
    await moves.close();

    const [corrupt,pCorrupt]=await create({data:false,rawTraining:'{audit-malformed'});
    await training(pCorrupt).click(); await expect(pCorrupt.getByRole('heading',{name:'Training unavailable'})).toBeVisible();
    await capture(pCorrupt,'training-recovery-blocked');
    await corrupt.close();
  } catch(err){console.error(err); process.exitCode=1;} finally{await browser.close();}
})();
