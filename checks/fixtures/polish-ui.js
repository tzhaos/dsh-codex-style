async (page) => {
  const assert=(value,message)=>{if(!value)throw new Error(message)}
  assert(new URL(page.url()).hostname==='127.0.0.1','private loopback fixture required')
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  page.setDefaultTimeout(5000)
  await page.emulateMedia({reducedMotion:'no-preference'})
  await page.setViewportSize({width:1200,height:800});await page.reload();await page.waitForFunction(()=>!!window.review)
  assert(await page.evaluate(()=>window.__CODEX_WORKBENCH_UI_FIXTURE__===true),'owned UI fixture required')
  const axes=await page.evaluate(()=>{
    const rail=document.querySelector('.dshlr-rail').getBoundingClientRect()
    return{width:rail.width,pane:document.querySelector('.BynINW_sidebarCol').getBoundingClientRect().left,
      buttons:[...document.querySelectorAll('[data-dshlr-button]')].map(node=>{
        const a=node.getBoundingClientRect(),b=node.querySelector('.dsh-navigation-icon').getBoundingClientRect()
        return{button:a.x+a.width/2,icon:b.x+b.width/2,expected:rail.x+rail.width/2}
      })}
  })
  assert(axes.width===52&&axes.pane===52&&axes.buttons.length===4&&axes.buttons.every(row=>row.button===row.icon&&row.icon===row.expected),'rail axes '+JSON.stringify(axes))
  const newChat=page.getByRole('button',{name:'新聊天',exact:true}).first()
  await newChat.hover()
  const hover=await newChat.evaluate(node=>({background:getComputedStyle(node).backgroundColor,height:node.offsetHeight,
    shortcut:[...node.children].some(n=>getComputedStyle(n).opacity==='1'&&n.className.includes('Shortcut'))}))
  assert(hover.background!=='rgba(0, 0, 0, 0)'&&hover.height===36,'new chat hover '+JSON.stringify(hover))
  await page.screenshot({path:'output/playwright/polish-rail-hover.png',clip:{x:0,y:40,width:340,height:160}})
  const shadow=await page.locator('.BynINW_frame').evaluate(node=>({shadow:getComputedStyle(node,'::after').boxShadow,clip:getComputedStyle(node,'::after').clipPath}))
  assert(shadow.shadow.includes('5px')&&!shadow.shadow.includes('20px')&&shadow.clip.startsWith('inset(-4px'),'perimeter '+JSON.stringify(shadow))
  await page.locator('[data-dshlr-button="settings"]').click()
  await page.getByRole('menuitem',{name:'设置',exact:true}).click()
  const tab=page.getByRole('tab',{name:'内容操作',exact:true})
  await tab.hover()
  // Deliberately exceed the configured 650ms tooltip delay.
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,800)))
  const tabs=await tab.evaluate(node=>({outline:getComputedStyle(node).outlineStyle,shadow:getComputedStyle(node).boxShadow,
    customTips:document.querySelectorAll('[data-dshhp-tooltip]').length,background:getComputedStyle(node).backgroundColor}))
  assert(tabs.outline==='none'&&tabs.shadow==='none'&&tabs.customTips===0,'text tab hover '+JSON.stringify(tabs))
  await tab.click();await tab.hover()
  assert(await tab.evaluate(node=>getComputedStyle(node).boxShadow)==='none','selected tab gained a hover frame')
  await page.locator('[data-dshlr-button="chat"]').click()
  await page.evaluate(()=>review.show('hero'))
  await page.evaluate(()=>{
    review.modelDirectory.select=async(selection)=>{
      review.modelDirectory.generation++
      review.modelState.set({...review.modelState.getSnapshot(),status:'selecting',pending:selection})
      await new Promise(resolve=>{review.releaseEffort=resolve})
      review.modelState.set({...review.modelState.getSnapshot(),status:'ready',pending:null})
      setTimeout(()=>review.modelState.set({...review.modelState.getSnapshot(),current:selection}),250)
      return{ok:true}
    }
  })
  await page.locator('.wq12jW_trigger').click()
  await page.locator('.dshe-panel').waitFor()
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await page.waitForFunction(()=>document.querySelector('.dshe-panel[data-dsh-motion-managed]')?.getAnimations().length===0)
  await page.evaluate(()=>{
    review.effortPanel=document.querySelector('.dshe-panel');review.samples=[];review.recording=true
    const sample=()=>{
      if(!review.recording)return
      const p=document.querySelector('.dshe-panel'),r=p.getBoundingClientRect()
      const button=document.querySelector('.wq12jW_trigger'),own=button.querySelector('.dshe-native-chevron')
      const native=[...button.children].find(n=>!n.matches('.wq12jW_triggerLabel,.wq12jW_triggerEffort,.wq12jW_triggerIcon,.dshe-native-chevron'))
      const arrow=getComputedStyle(own).display==='none'?native:own,a=arrow.getBoundingClientRect()
      const spinnerVisible=!!review.modelState.getSnapshot().pending&&!native.classList.contains('wq12jW_chevron')&&getComputedStyle(native).visibility!=='hidden'
      review.samples.push({label:p.querySelector('.dshe-level').textContent,heading:+getComputedStyle(p.querySelector('.dshe-model')).opacity,
        track:+getComputedStyle(p.querySelector('.dshe-track')).opacity,y:r.y,h:r.height,same:p===review.effortPanel,animations:p.getAnimations().length,
        arrowX:a.x+a.width/2,spinnerVisible})
      requestAnimationFrame(sample)
    };sample()
  })
  await page.getByRole('slider',{name:'推理强度'}).press('End')
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,2000)))
  const pending=await page.locator('.dshe-level').textContent()
  assert(pending==='极高','slow host lost immediate target')
  await page.evaluate(()=>review.releaseEffort())
  await page.waitForFunction(()=>document.querySelector('.dshe-panel').getAttribute('aria-busy')==='false')
  const stability=await page.evaluate(()=>{
    review.recording=false
    const first=review.samples.findIndex(row=>row.label==='极高'),rows=review.samples.slice(first)
    return{oldValueFrames:rows.filter(row=>row.label!=='极高').length,opacity:Math.min(...rows.map(row=>Math.min(row.heading,row.track))),
      mounts:rows.every(row=>row.same),newAnimations:rows.some(row=>row.animations>0),
      y:Math.max(...rows.map(row=>row.y))-Math.min(...rows.map(row=>row.y)),height:Math.max(...rows.map(row=>row.h))-Math.min(...rows.map(row=>row.h)),
      spinnerFrames:rows.filter(row=>row.spinnerVisible).length,arrowMovement:Math.max(...rows.map(row=>row.arrowX))-Math.min(...rows.map(row=>row.arrowX))}
  })
  assert(stability.oldValueFrames===0&&stability.opacity===1&&stability.mounts&&!stability.newAnimations&&stability.y===0&&stability.height===0,'effort flash '+JSON.stringify(stability))
  assert(stability.spinnerFrames===0&&stability.arrowMovement===0,'native spinner/arrow flash '+JSON.stringify(stability))
  await page.getByRole('slider',{name:'推理强度'}).press('Escape')
  await page.evaluate(()=>review.dispose())
  assert(errors.length===0,errors.join(';'))
  return{axes,hover,tabs,shadow,stability,errors}
}
