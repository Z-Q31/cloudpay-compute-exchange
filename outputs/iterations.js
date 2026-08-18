(()=>{
  const stamp=()=>new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
  const result=document.querySelector('.result-card');
  if(result&&!result.querySelector('.trade-state')){
    result.querySelector('.result-top')?.insertAdjacentHTML('afterend',`<div class="trade-state"><span><i>LOCKED</i>参考报价锁定 15 分钟</span><time id="quoteUpdated">${stamp()} 更新</time></div>`);
  }
  const updateQuoteStamp=()=>{const el=document.querySelector('#quoteUpdated');if(el)el.textContent=`${stamp()} 更新`};
  document.querySelector('#quoteForm')?.addEventListener('change',updateQuoteStamp);
  document.querySelector('#quoteForm')?.addEventListener('input',updateQuoteStamp);
  const sell=document.querySelector('.sell-result');
  if(sell&&!sell.querySelector('.trade-state'))sell.querySelector('h2')?.insertAdjacentHTML('afterend',`<div class="trade-state"><span><i>REFERENCE</i>出售建议区间</span><time id="sellUpdated">${stamp()} 更新</time></div>`);
  const updateSellStamp=()=>{const el=document.querySelector('#sellUpdated');if(el)el.textContent=`${stamp()} 更新`};
  document.querySelector('#sellForm')?.addEventListener('change',updateSellStamp);
  document.querySelector('#sellForm')?.addEventListener('input',updateSellStamp);
  const enhanceSwap=()=>{
    const box=document.querySelector('#swapView .quote-breakdown');if(!box||box.querySelector('.swap-trade-state'))return;
    box.classList.add('has-state');box.insertAdjacentHTML('beforeend',`<div class="trade-state swap-trade-state"><span><i>VALIDATION</i>等待资产验收后交割</span><time>${stamp()} 估值</time></div>`);
  };
  enhanceSwap();
  const swap=document.querySelector('#swapView');if(swap)new MutationObserver(enhanceSwap).observe(swap,{childList:true,subtree:true});
  const toast=document.querySelector('#toast');if(toast){toast.setAttribute('role','status');toast.setAttribute('aria-live','polite')}
  ['#totalPrice','#unitPrice','#swapReceive','#sellLow','#sellHigh'].forEach(selector=>{const el=document.querySelector(selector);if(el){el.setAttribute('aria-live','polite');el.setAttribute('aria-atomic','true')}});
  const search=document.querySelector('#modelSearch'),cloud=document.querySelector('#modelCloud');
  if(search&&cloud){
    search.parentElement.insertAdjacentHTML('beforeend','<kbd aria-hidden="true">/</kbd>');
    cloud.insertAdjacentHTML('afterend','<div class="model-empty" id="modelEmpty">没有匹配的模型或厂商，请更换关键词</div><div class="sr-status" id="modelSearchStatus" role="status" aria-live="polite"></div>');
    const updateSearchState=()=>{const visible=[...cloud.querySelectorAll('.model-pill')].filter(item=>!item.hidden).length;document.querySelector('#modelEmpty')?.classList.toggle('show',visible===0);const status=document.querySelector('#modelSearchStatus');if(status)status.textContent=`找到 ${visible} 个模型`};
    search.addEventListener('input',updateSearchState);updateSearchState();
    document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!event.target.matches('input,textarea,select')){const quote=document.querySelector('#quoteView');if(quote?.classList.contains('active')){event.preventDefault();search.focus()}}});
  }
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animateNumber=el=>{
    if(!el)return;el.dataset.lastNumber=(el.textContent.match(/[\d,.]+/)||['0'])[0].replaceAll(',','');
    new MutationObserver(()=>{if(el.dataset.animating==='1')return;const match=el.textContent.match(/[\d,.]+/);if(!match)return;const next=+match[0].replaceAll(',',''),prev=+(el.dataset.lastNumber||next);if(reduce||!Number.isFinite(next)||Math.abs(next-prev)<.01){el.dataset.lastNumber=String(next);return}const prefix=el.textContent.slice(0,match.index),suffix=el.textContent.slice(match.index+match[0].length),start=performance.now(),duration=360;el.dataset.animating='1';el.classList.add('numeric-animating');const tick=now=>{const t=Math.min(1,(now-start)/duration),ease=1-Math.pow(1-t,3),value=prev+(next-prev)*ease;el.textContent=prefix+Math.round(value).toLocaleString('zh-CN')+suffix;if(t<1)requestAnimationFrame(tick);else{el.textContent=prefix+next.toLocaleString('zh-CN')+suffix;el.dataset.lastNumber=String(next);el.dataset.animating='0';el.classList.remove('numeric-animating')}};requestAnimationFrame(tick)}).observe(el,{childList:true,characterData:true,subtree:true});
  };
  ['#totalPrice','#sellLow','#sellHigh'].forEach(selector=>animateNumber(document.querySelector(selector)));
  const syncCurrentNav=()=>document.querySelectorAll('.nav-item').forEach(item=>item.setAttribute('aria-current',item.classList.contains('active')?'page':'false'));
  syncCurrentNav();
  document.querySelectorAll('.nav-item').forEach(item=>item.addEventListener('click',event=>{setTimeout(()=>{syncCurrentNav();if(event.detail===0){const heading=document.querySelector('.view.active h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true})}}},30)}));
  document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelector('#accountMenu')?.classList.remove('show')});
  document.addEventListener('pointerdown',event=>{const menu=document.querySelector('#accountMenu'),account=document.querySelector('.account');if(menu?.classList.contains('show')&&!menu.contains(event.target)&&!account?.contains(event.target))menu.classList.remove('show')});
})();
