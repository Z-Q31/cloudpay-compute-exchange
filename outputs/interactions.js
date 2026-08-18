(()=>{
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealSelector='.offer,.stat,.panel,.quote-form,.result-card,.sell-result,.swap-card,.quote-breakdown,.pricing-method,.recommend-hero,.recommend-card';
  const installReveal=()=>{
    const items=[...document.querySelectorAll(revealSelector)].filter(el=>!el.dataset.motionReady);
    if(reduce||!('IntersectionObserver' in window)){items.forEach(el=>el.dataset.motionReady='1');return}
    const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}}),{threshold:.09,rootMargin:'0px 0px -24px'});
    items.forEach(el=>{el.dataset.motionReady='1';el.classList.add('reveal-pending');observer.observe(el)});
  };
  const installGlow=()=>{
    if(reduce||window.matchMedia('(hover: none)').matches)return;
    document.querySelectorAll('.offer,.stat,.panel,.quote-form,.swap-card,.pricing-method,.recommend-card').forEach(el=>{
      if(el.querySelector(':scope > .interactive-glow'))return;
      el.classList.add('interactive-surface');
      const glow=document.createElement('span');glow.className='interactive-glow';glow.setAttribute('aria-hidden','true');el.prepend(glow);
      el.addEventListener('pointermove',event=>{const box=el.getBoundingClientRect();el.style.setProperty('--glow-x',`${event.clientX-box.left}px`);el.style.setProperty('--glow-y',`${event.clientY-box.top}px`)},{passive:true});
    });
  };
  const refreshMotion=()=>{installReveal();installGlow()};
  const pulse=target=>{if(reduce||!target)return;target.classList.remove('data-updating');requestAnimationFrame(()=>{target.classList.add('data-updating');setTimeout(()=>target.classList.remove('data-updating'),430)})};
  document.addEventListener('pointerdown',event=>{
    const button=event.target.closest('button');if(!button||reduce)return;
    button.classList.add('clickable-motion');const box=button.getBoundingClientRect(),ripple=document.createElement('span');ripple.className='click-ripple';ripple.style.left=`${event.clientX-box.left}px`;ripple.style.top=`${event.clientY-box.top}px`;ripple.setAttribute('aria-hidden','true');button.appendChild(ripple);setTimeout(()=>ripple.remove(),560);
  });
  const quote=document.querySelector('#quoteForm');if(quote){quote.addEventListener('change',()=>pulse(document.querySelector('.result-card')));quote.addEventListener('input',event=>{if(event.target.matches('input[type=number],input[type=datetime-local]'))pulse(document.querySelector('.result-card'))})}
  const sell=document.querySelector('#sellForm');if(sell){sell.addEventListener('change',()=>pulse(document.querySelector('.sell-result')));sell.addEventListener('input',()=>pulse(document.querySelector('.sell-result')))}
  const swap=document.querySelector('#swapView');if(swap){swap.addEventListener('change',()=>pulse(swap.querySelector('.quote-breakdown')));swap.addEventListener('input',()=>pulse(swap.querySelector('.quote-breakdown')));let queued;new MutationObserver(()=>{clearTimeout(queued);queued=setTimeout(refreshMotion,20)}).observe(swap,{childList:true,subtree:true})}
  document.addEventListener('click',event=>{if(event.target.closest('.nav-item'))setTimeout(refreshMotion,60)});
  document.body.classList.add('interaction-ready');refreshMotion();
})();
