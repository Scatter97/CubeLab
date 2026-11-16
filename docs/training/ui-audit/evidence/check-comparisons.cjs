const { chromium } = require('/home/joshua/cube-lab/node_modules/@playwright/test')
;(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] })
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', e=>errors.push(e.message))
    page.on('requestfailed', r=>errors.push(r.url()))
    await page.goto('file:///tmp/cubelab-training-ui-evidence/comparisons-and-mockups.html')
    await page.evaluate(() => document.fonts.ready)
    const result = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('.art')].map(el => {
        const art = el.getBoundingClientRect()
        const digits = el.querySelector('.timer-value').getBoundingClientRect()
        const cross = el.querySelector('.cross').getBoundingClientRect()
        const scale = art.width/(el.classList.contains('mobile-art')?390:1440)
        return [((digits.x+digits.width/2-art.x)/scale).toFixed(2),((digits.y+digits.height/2-art.y)/scale).toFixed(2),
          ((cross.y+cross.height/2-digits.y-digits.height/2)/scale).toFixed(2)]
      })
      return {
        bodyWidth:document.body.scrollWidth,
        anchors,
        broken:[...document.images].filter(img=>!img.complete||!img.naturalWidth).map(img=>img.src),
        count:document.querySelectorAll('.art').length,
        nav:[...document.querySelectorAll('nav a')].every(link=>document.querySelector(link.getAttribute('href'))),
        mobileScrollable:document.querySelector('.mobile-frame').scrollHeight>document.querySelector('.mobile-frame').clientHeight
      }
    })
    if (viewport.width===1440) {
      await page.screenshot({ path:'/tmp/cubelab-comparison-desktop-review.png' })
      await page.locator('#oll-recognition').screenshot({ path:'/tmp/cubelab-mockup-desktop-review.png' })
      await page.locator('#mobile').screenshot({ path:'/tmp/cubelab-mockup-mobile-review.png' })
    }
    console.log(viewport.width, JSON.stringify({...result,errors}))
    if (result.bodyWidth>viewport.width||result.broken.length||!result.nav||!result.mobileScrollable||result.count!==6||errors.length) process.exitCode=1
    await page.close()
  }
  await browser.close()
})().catch(error=>{console.error(error); process.exitCode=1})
