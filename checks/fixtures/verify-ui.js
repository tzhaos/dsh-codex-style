async (page) => {
  const assert=(value,message)=>{if(!value)throw new Error(message)}
  const checks=[],errors=[]
  assert(new URL(page.url()).hostname==='127.0.0.1','private loopback fixture required')
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000)
  const check=async(name,run)=>{await run();checks.push(name)}
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.setViewportSize({width:1440,height:900});await page.reload();await page.waitForFunction(()=>!!window.review)
  assert(await page.evaluate(()=>window.__CODEX_WORKBENCH_UI_FIXTURE__===true),'owned UI fixture required')
  await check('native permission optical alignment, warning paint, and menu',async()=>{
    const button=page.locator('.dlU_AG_trigger')
    const values=await button.evaluate(node=>{
      const r=node.getBoundingClientRect(),center=r.y+r.height/2
      return {height:r.height,children:[...node.children].map(child=>{const b=child.getBoundingClientRect();return {class:child.className,dy:b.y+b.height/2-center,color:getComputedStyle(child).color}})}
    })
    assert(values.height===28&&values.children[0].dy===1&&values.children[1].dy===0&&values.children[2].dy===1,'permission geometry '+JSON.stringify(values))
    assert(values.children[0].color===values.children[1].color,'permission glyph and text colors differ')
    await button.screenshot({path:'output/playwright/audit-permission-aligned.png'})
    await button.click();await page.getByRole('menuitem',{name:'只读',exact:true}).click()
    assert(await button.textContent()==='只读','permission choice did not update')
    await page.evaluate(()=>review.permissionSelection.set({currentValue:'danger-full-access'}))
  })
  await check('nested session buttons and menu items retain keyboard behavior',async()=>{
    const row=page.locator('.dshss-row[data-session="s2"]').first()
    const menu=row.getByRole('button',{name:'会话“检查附件和输入框布局”的操作',exact:true})
    const before=await page.evaluate(()=>review.openedChats.length)
    await row.focus()
    await menu.focus();await menu.press('Enter')
    await page.getByRole('menu').waitFor()
    assert(await page.evaluate(()=>review.openedChats.length)===before,'menu key opened its parent chat')
    const rename=page.getByRole('menuitem',{name:'重命名会话',exact:true})
    await rename.focus();await rename.press('Enter');await page.getByRole('dialog').waitFor()
    await page.keyboard.press('Escape')
    assert(await page.getByRole('dialog').count()===0,'rename did not dismiss')
  })
  await check('Git keeps retry UI after temporary failure and hides only confirmed non-repositories',async()=>{
    await page.evaluate(()=>{review.control.gitList=async()=>{throw new Error('offline')}})
    const button=page.getByRole('button',{name:'Git 分支',exact:true})
    await button.click();await page.locator('.dshgit-menu [role="alert"]').waitFor()
    assert(await button.count()===1,'Git entry vanished on transient failure')
    assert(await page.locator('.dshgit-menu button[role="menuitem"]:not(:disabled)').count()===1,'stale branches still actionable')
    await page.evaluate(()=>{delete review.control.gitList})
    await page.getByRole('menuitem',{name:'刷新分支',exact:true}).click()
    await page.waitForFunction(()=>!document.querySelector('.dshgit-menu [role="alert"]'))
    await page.keyboard.press('Escape')
    await page.evaluate(()=>{review.control.gitList=async()=>({ok:true,value:{ok:false,reason:'not-repository'}});window.dispatchEvent(new Event('focus'))})
    await button.waitFor({state:'detached'})
    await page.evaluate(()=>{delete review.control.gitList;window.dispatchEvent(new Event('focus'))})
    await button.waitFor()
  })
  await check('new and existing composer, rail and permissions fit narrow/light/dark layouts',async()=>{
    for(const width of [1440,1024,720,390]){
      await page.setViewportSize({width,height:640})
      await page.evaluate(()=>review.mode.set({...review.mode.getSnapshot(),collapsed:true}))
      for(const screen of ['hero','active']){
        await page.evaluate(screen=>review.show(screen),screen)
        const fit=await page.evaluate(()=>{
          const card=document.querySelector('[data-composer-card]').getBoundingClientRect()
          const controls=[...document.querySelectorAll('[data-composer-card] button')].filter(n=>n.getClientRects().length)
          return {card:{left:card.left,right:card.right},width:innerWidth,scroll:document.documentElement.scrollWidth,
            outside:controls.filter(n=>{const r=n.getBoundingClientRect();return r.left<card.left-1||r.right>card.right+1}).map(n=>n.className)}
        })
        assert(fit.card.left>=52&&fit.card.right<=fit.width&&fit.scroll<=fit.width&&!fit.outside.length,'overflow '+JSON.stringify({width,screen,fit}))
      }
    }
    await page.evaluate(()=>document.body.setAttribute('data-ds-dark-theme',''))
    await page.screenshot({path:'output/playwright/audit-narrow-dark.png'})
    await page.evaluate(()=>document.body.removeAttribute('data-ds-dark-theme'))
  })
  await check('long quote preview stays within a short viewport without covering its remove button',async()=>{
    await page.setViewportSize({width:390,height:300})
    await page.locator('.fixture-transcript').evaluate(node=>{
      node.textContent='长引用内容 '.repeat(250)
      node.style.maxHeight='240px';node.style.overflow='hidden'
    })
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    await page.locator('.fixture-transcript').evaluate(node=>{
      const range=document.createRange();range.selectNodeContents(node)
      const selected=getSelection();selected.removeAllRanges();selected.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    })
    await page.getByRole('button',{name:'把选中内容作为引用加入当前消息',exact:true}).click()
    const chip=page.locator('.dshqf-annotation').first()
    await chip.evaluate(node=>Object.assign(node.style,{position:'fixed',top:'54px',left:'70px',zIndex:'131'}))
    await chip.hover();await page.locator('.dshqf-annotationPanel').waitFor()
    for(const size of [{width:390,height:300},{width:360,height:250}]){
      await page.setViewportSize(size)
      await page.waitForFunction(()=>{const n=document.querySelector('.dshqf-annotationPanel');if(!n)return false;const r=n.getBoundingClientRect();return r.top>=48&&r.bottom<=innerHeight-8&&r.right<=innerWidth-8})
      const box=await page.locator('.dshqf-annotationPanel').boundingBox(),anchor=await chip.boundingBox()
      assert(box.y>=anchor.y+anchor.height+8||box.y+box.height<=anchor.y-8,'preview covers its anchor')
    }
    await chip.getByRole('button').click();assert(await page.locator('.dshqf-annotation').count()===0,'quote remove failed')
  })
  await check('side chat abandons failed echoes, follows streaming only while pinned, and persists cleanup',async()=>{
    await page.setViewportSize({width:900,height:700})
    await page.evaluate(()=>{
      review.abandoned=0
      review.bindingFor('child-1').session.beginSubmission=()=>({requestId:'echo',abandon(){review.abandoned++}})
      review.control.prompt=async()=>{throw new Error('transport failed')}
      review.fork('audit-side-chat')
    })
    const input=page.locator('.dshqf-input');await input.waitFor();await input.fill('保留这条草稿');await page.locator('.dshqf-send').click()
    await page.locator('.dshqf-errorText').waitFor()
    assert(await input.inputValue()==='保留这条草稿'&&await page.evaluate(()=>review.abandoned)===1,'failed echo/draft cleanup')
    await page.evaluate(()=>{
      review.sent=0
      review.control.prompt=()=>{review.sent++;return new Promise(resolve=>{review.finishPrompt=resolve})}
    })
    await input.dispatchEvent('keydown',{key:'Enter',isComposing:true})
    assert(await page.evaluate(()=>review.sent)===0,'IME confirmation sent a message')
    await page.evaluate(()=>{const button=document.querySelector('.dshqf-send');button.click();button.click()})
    assert(await page.evaluate(()=>review.sent)===1,'same-tick duplicate prompt')
    await input.fill('下一条草稿')
    await page.evaluate(()=>review.finishPrompt({ok:true}))
    await page.waitForFunction(()=>!document.querySelector('.dshqf-send').disabled)
    assert(await input.inputValue()==='下一条草稿','late acknowledgement erased the next draft')
    await page.evaluate(()=>{
      review.sessionState.set({...review.sessionState.getSnapshot(),nodes:Array.from({length:30},(_,i)=>({kind:'assistant',seq:i+1,blocks:[{kind:'text',text:'Streaming line '+i+'\n'.repeat(3)}]}))})
    })
    await page.waitForFunction(()=>{const n=document.querySelector('.dshqf-log');return n&&n.scrollHeight-n.scrollTop-n.clientHeight<2})
    await page.locator('.dshqf-log').evaluate(node=>{node.scrollTop=0;node.dispatchEvent(new Event('scroll',{bubbles:true}))})
    await page.evaluate(()=>{const s=review.sessionState.getSnapshot(),nodes=structuredClone(s.nodes);nodes.at(-1).blocks[0].text+='\nmore'.repeat(30);review.sessionState.set({...s,nodes})})
    assert(await page.locator('.dshqf-log').evaluate(n=>n.scrollTop)===0,'streaming stole manual scroll position')
    await page.locator('.dshqf-log').evaluate(node=>{node.scrollTop=node.scrollHeight;node.dispatchEvent(new Event('scroll',{bubbles:true}))})
    await page.evaluate(()=>{const s=review.sessionState.getSnapshot(),nodes=structuredClone(s.nodes);nodes.at(-1).blocks[0].text+='\nnew'.repeat(10);review.sessionState.set({...s,nodes})})
    await page.waitForFunction(()=>{const n=document.querySelector('.dshqf-log');return n.scrollHeight-n.scrollTop-n.clientHeight<2})
    await page.evaluate(()=>{review.control.archiveSession=async()=>{throw new Error('offline')};review.closeFork()})
    assert(await page.evaluate(()=>JSON.parse(localStorage.getItem('dsh.quickFork.tab.audit-side-chat'))?.closing)===true,'close lost durable cleanup task')
    await page.evaluate(()=>{delete review.control.archiveSession;window.dispatchEvent(new Event('focus'))})
    await page.waitForFunction(()=>!localStorage.getItem('dsh.quickFork.tab.audit-side-chat'))
  })
  await check('native image removal releases draft resources',async()=>{
    await page.evaluate(()=>{review.show('hero');review.image()})
    await page.getByRole('button',{name:'image.remove',exact:true}).click()
    assert(await page.evaluate(()=>review.drafts.size)===0,'image deletion left its file resource')
    assert(await page.evaluate(()=>review.shell.snapshot.attachmentIds.length)===0,'image deletion left its attachment id')
  })
  await check('exit snapshots show the current textarea once',async()=>{
    await page.emulateMedia({reducedMotion:'no-preference'})
    await page.evaluate(()=>{review.sessionState.set({...review.sessionState.getSnapshot(),nodes:[]});review.fork('audit-snapshot')})
    await page.locator('.dshqf-input').waitFor()
    await page.waitForFunction(()=>document.querySelector('.dshqf-panel[data-dsh-motion-managed]')?.getAnimations().length===0)
    await page.locator('.dshqf-input').evaluate(node=>{node.defaultValue='obsolete text';node.value='current visible draft'})
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
    const exit=await page.evaluate(()=>new Promise(resolve=>{
      const observer=new MutationObserver(()=>{
        const ghost=document.querySelector('[data-dsh-motion-ghost]');if(!ghost)return
        observer.disconnect();resolve({text:ghost.textContent,inert:ghost.inert})
      });observer.observe(document.body,{childList:true,subtree:true});review.closeFork()
    }))
    assert(exit.inert&&(exit.text.match(/current visible draft/g)||[]).length===1&&!exit.text.includes('obsolete text'),'textarea snapshot '+JSON.stringify(exit))
    await page.waitForFunction(()=>!document.querySelector('[data-dsh-motion-ghost]'))
  })
  await check('unload restores hover attributes and native tooltip placement',async()=>{
    await page.evaluate(()=>{
      const modules=window.__reviewModules,h=modules.react.createElement,p=modules['@deepseek-ai/dsh-client-ui-primitives']
      const mount=document.createElement('div');document.body.append(mount)
      const root=modules['react-dom/client'].createRoot(mount)
      root.render(h(p.Tooltip,{label:'生命周期提示',side:'bottom',portal:true,delayMs:0},h('button',{id:'audit-hover',
        'aria-label':'生命周期提示',style:{position:'fixed',left:100,top:120,width:28,height:28,zIndex:20000}},h(p.IconSettingsOutlineRegular,{size:16}))))
      review.foreignHoverRoot=root;review.foreignHoverMount=mount
    })
    await page.locator('#audit-hover').hover()
    await page.waitForFunction(()=>document.querySelector('[role="tooltip"][data-dshhp-ready]'))
    await page.evaluate(()=>review.dispose())
    const leftovers=await page.evaluate(()=>({root:document.documentElement.hasAttribute('data-dshhp-hover'),
      button:document.querySelector('#audit-hover').hasAttribute('data-dshhp-hover'),ready:document.querySelectorAll('[data-dshhp-ready]').length,
      coordinates:[...document.querySelectorAll('[role="tooltip"]')].some(n=>!!n.style.getPropertyValue('--dshhp-left')),
      ghosts:document.querySelectorAll('[data-dsh-motion-ghost]').length}))
    assert(!Object.values(leftovers).some(Boolean),'hover unload leftovers '+JSON.stringify(leftovers))
    await page.evaluate(()=>{review.foreignHoverRoot.unmount();review.foreignHoverMount.remove()})
  })
  assert(errors.length===0,errors.join('; '))
  return {checks,errors}
}
