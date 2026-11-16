const { chromium, expect } = require('/home/joshua/cube-lab/node_modules/@playwright/test');
const fs = require('node:fs');
const AxeBuilder = require('/home/joshua/cube-lab/node_modules/@axe-core/playwright').default;
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
  fs.writeFileSync(out+'/settled-accessibility.json',JSON.stringify({browser:browser.version(),captures,checks,errors},null,2));
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
    async function axe(page,name){
      await settle(page); await page.waitForTimeout(250);
      const results=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
      checks[name]=results.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(node=>({target:node.target,failureSummary:node.failureSummary}))}));
    }
    const [dark,q]=await create({width:390,height:844,theme:'dark'});
    await training(q).click(); await button(q,'Begin practice').click(); await ready(q);
    await axe(q,'axeTrainingExecutionMobile');
    await button(q,'Training settings').click();
    await axe(q,'axeTrainingSettingsMobile');
    checks.dialogAnimations = await q.getByRole('dialog').evaluate(el=>el.getAnimations().map(a=>a.playState));
    await capture(q,'390-dark-training-settings-audit');
    await q.keyboard.press('Escape');
    await button(q,'Detailed statistics').click();
    await axe(q,'axeTrainingDetailsMobile');
    await capture(q,'390-dark-training-details-audit');
    await q.keyboard.press('Escape');
    await button(q,'Edit cases').click();
    const firstAlgorithm=q.getByRole('dialog').getByRole('button',{name:'Algorithms',exact:true}).first();
    await firstAlgorithm.focus(); await firstAlgorithm.press('Enter');
    const editor=q.getByRole('dialog').getByRole('region',{name:'Case algorithms'});
    checks.caseEditor=await editor.evaluate(el=>({top:el.getBoundingClientRect().top,dialogBottom:el.closest('dialog').getBoundingClientRect().bottom,focused:document.activeElement.textContent}));
    await capture(q,'390-dark-open-algorithm-editor');
    await q.keyboard.press('Escape');
    const history=q.getByRole('button',{name:/^Practice history/});
    await history.click();
    await capture(q,'training-history-empty-report-dialog');
    await dark.close();
  } catch(err){console.error(err); process.exitCode=1;} finally{await browser.close();}
})();
