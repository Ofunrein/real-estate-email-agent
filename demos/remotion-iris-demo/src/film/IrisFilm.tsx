import React from 'react';
import {Audio} from '@remotion/media';
import {AbsoluteFill, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const ease = Easing.bezier(0.22, 0.76, 0.25, 1);
const map = (frame: number, input: number[], output: number[]) => interpolate(frame, input, output, {...clamp, easing: ease});

const Scene: React.FC<React.PropsWithChildren<{start:number; end:number; className?:string}>> = ({start,end,className='',children}) => {
  const frame = useCurrentFrame();
  const opacity = map(frame,[start,start+12,end-12,end],[0,1,1,0]);
  return <div className={`scene ${className}`} style={{opacity}}>{children}</div>;
};

const Chrome: React.FC<{mode:string}> = ({mode}) => <>
  <div className="topline">
    <div className="brand"><span className="brand-mark">I</span><span>IRIS / {mode}</span></div>
    <div className="live"><i/>GMAIL CONNECTED · OPERATIONS LIVE</div>
  </div>
</>;

const DataRain: React.FC<{frame:number}> = ({frame}) => (
  <div style={{position:'absolute',inset:0,overflow:'hidden',opacity:.36}}>
    {Array.from({length:36},(_,i)=>{
      const y=((frame*(1.3+(i%5)*.18)+i*77)%1280)-160;
      return <div key={i} className="mono" style={{position:'absolute',left:i*57-25,top:y,color:i%7===0?'var(--color-accent)':'var(--color-border)',fontSize:12,writingMode:'vertical-rl',letterSpacing:6}}>
        {i%3===0?'LEAD·INTENT·ROUTE·':i%3===1?'01001101·IRIS·':'THREAD·CONTEXT·'}
      </div>;
    })}
  </div>
);

const InboxScene: React.FC = () => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig();
  const titleOut=map(frame,[0,45,65,90],[0,1,1,0]);
  const titleScale=map(frame,[0,90],[1.18,.88]);
  const ui=spring({frame:frame-65,fps,config:{damping:24,stiffness:130}});
  const rows=[
    ['Jamie Chen','Re: 6814 Old Quarry Lane','Can we see it Saturday?','$850K · SHOWING'],
    ['Maya Rivera','Round Rock search','3 beds, yard, under $500k','$500K · SEARCH'],
    ['Daniel Lee','Thinking about selling','What is my Cedar Park home worth?','SELLER · VALUE'],
    ['Nora Brooks','Tour time confirmation','Does 2:00 PM still work?','CALENDAR · READY']
  ];
  return <Scene start={0} end={240} className="frame-corners">
    <DataRain frame={frame}/><div className="noise"/><div className="vignette"/>
    <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',opacity:titleOut,transform:`scale(${titleScale})`}}>
      <div style={{width:1420}}><div className="eyebrow">01 / EMAIL IS THE FRONT DOOR</div><h1 className="display display-xl">YOUR INBOX<br/><span style={{color:'var(--color-accent)'}}>IS ALREADY A LEAD.</span></h1></div>
    </div>
    <div style={{position:'absolute',left:105,top:115,width:1710,height:850,opacity:ui,transform:`perspective(1600px) rotateX(${(1-ui)*8}deg) translateY(${(1-ui)*150}px) scale(${.92+ui*.08})`}}>
      <Chrome mode="TRIAGE"/>
      <div className="terminal" style={{position:'absolute',left:0,right:0,top:75,bottom:0}}>
        <div className="terminal-bar"><span className="dots"><i/><i/><i/></span>INBOX / NEW LEADS <span style={{marginLeft:'auto'}}>4 NEED ACTION</span></div>
        <div style={{display:'grid',gridTemplateColumns:'300px 1fr',height:720}}>
          <aside style={{borderRight:'1px solid var(--color-border-subtle)',padding:'40px 30px'}}>
            <div className="eyebrow">WORK QUEUE</div>
            {['Needs review  04','Drafts ready  12','Sent today  28','Human flags  02'].map((x,i)=><div key={x} style={{marginTop:25,padding:'15px 10px',fontSize:18,color:i===0?'var(--color-text-primary)':'var(--color-text-muted)',borderLeft:i===0?'3px solid var(--color-accent)':'3px solid transparent'}}>{x}</div>)}
          </aside>
          <main style={{padding:'40px 50px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'end',marginBottom:30}}><div><div className="eyebrow">SORTED BY NEXT ACTION</div><div className="section-title">Every email, operational.</div></div><span className="pill success">● 4 CLASSIFIED</span></div>
            {rows.map((r,i)=>{const p=spring({frame:frame-82-i*7,fps,config:{damping:22,stiffness:180}});return <div key={r[0]} style={{height:120,display:'grid',gridTemplateColumns:'250px 1fr 260px',alignItems:'center',borderTop:'1px solid var(--color-border-subtle)',opacity:p,transform:`translateX(${(1-p)*90}px)`}}><div style={{fontSize:20,fontWeight:600}}>{r[0]}</div><div><b style={{fontSize:21}}>{r[1]}</b><div className="muted" style={{marginTop:8,fontSize:16}}>{r[2]}</div></div><span className="pill accent" style={{justifySelf:'end'}}>{r[3]}</span></div>})}
          </main>
        </div>
      </div>
    </div>
  </Scene>;
};

const ProductStage: React.FC<{frame:number; image:string; kicker:string; title:string; facts:string[]; accent?:string}> = ({frame,image,kicker,title,facts,accent='var(--color-accent)'}) => {
  const {fps}=useVideoConfig(); const enter=spring({frame,fps,config:{damping:28,stiffness:110}});
  const zoom=map(frame,[0,270],[1.08,1.22]);
  return <>
    <div className="noise"/><Chrome mode="DRAFT ENGINE"/>
    <div style={{position:'absolute',left:90,top:160,width:560}}>
      <div className="eyebrow">{kicker}</div><h2 className="display" style={{fontSize:82,marginTop:18,whiteSpace:'pre-line'}}>{title.replace('\\n','\n')}</h2>
      <div style={{marginTop:45}}>{facts.map((f,i)=>{const p=spring({frame:frame-24-i*12,fps,config:{damping:24,stiffness:160}});return <div key={f} style={{display:'flex',gap:18,alignItems:'center',padding:'17px 0',borderTop:'1px solid var(--color-border-subtle)',opacity:p,transform:`translateX(${(1-p)*45}px)`}}><span className="mono" style={{fontSize:13,color:accent}}>0{i+1}</span><span style={{fontSize:19}}>{f}</span></div>})}</div>
    </div>
    <div className="terminal" style={{position:'absolute',left:720,top:145,width:1110,height:810,opacity:enter,transform:`perspective(1800px) rotateY(${(1-enter)*-13}deg) translateX(${(1-enter)*190}px)`}}>
      <div className="terminal-bar"><span className="dots"><i/><i/><i/></span>REAL PRODUCT / LIVE LISTING CONTEXT</div>
      <div style={{position:'absolute',inset:'54px 0 0',overflow:'hidden',background:'var(--color-text-primary)'}}><Img src={staticFile(image)} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${zoom})`,transformOrigin:'50% 42%'}}/></div>
      <div style={{position:'absolute',right:25,bottom:25,display:'flex',gap:10}}><span className="pill" style={{background:'var(--color-bg)'}}>THREAD MATCHED</span><span className="pill success" style={{background:'var(--color-bg)'}}>DRAFT READY</span></div>
    </div>
  </>;
};

const PropertyScene: React.FC = () => {const frame=useCurrentFrame(); return <Scene start={228} end={510}><ProductStage frame={frame-228} image="property-detail.png" kicker="02 / PROPERTY ANSWER" title="Actual listing.\nUseful next step." facts={['Exact address matched to thread','Price, photos, and property facts','Showing path included','Draft stays reviewable']}/></Scene>};

const SearchScene: React.FC = () => {const frame=useCurrentFrame(); const local=frame-498; return <Scene start={498} end={785}>
  <ProductStage frame={local} image="search-results.png" kicker="03 / BROADER SEARCH" title="Criteria become options." facts={['Round Rock location understood','3 bedrooms and yard retained','Budget ceiling: $500,000','Relevant inventory, not filler']} accent="var(--color-success)"/>
  <div style={{position:'absolute',left:630,top:465,width:165,height:2,background:'var(--color-success)',transform:`scaleX(${map(local,[40,90],[0,1])})`,transformOrigin:'right'}}/>
  </Scene>};

const SellerScene: React.FC = () => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const local=frame-773;
  const panel=spring({frame:local-12,fps,config:{damping:24,stiffness:120}});
  return <Scene start={773} end={1030}><div className="noise"/><Chrome mode="SELLER ROUTE"/>
    <div style={{position:'absolute',left:105,top:180,width:760}}><div className="eyebrow">04 / SELLER INQUIRY</div><h2 className="display" style={{fontSize:100,marginTop:18}}>ONE QUESTION.<br/><span style={{color:'var(--color-accent)'}}>CLEAR PATH.</span></h2><p className="caption" style={{width:600,marginTop:35}}>Iris does not turn first contact into an intake form. It advances conversation with focused question.</p></div>
    <div className="terminal" style={{position:'absolute',left:950,top:165,width:820,height:720,transform:`translateY(${(1-panel)*150}px) rotate(${(1-panel)*4}deg)`,opacity:panel}}><div className="terminal-bar">SELLER THREAD / 804 BARTON SPRINGS RD</div><Img src={staticFile('seller-lead.png')} style={{width:'100%',height:490,objectFit:'cover',objectPosition:'top'}}/><div style={{padding:'22px 30px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><div className="eyebrow">NEXT ACTION</div><div style={{fontSize:22,marginTop:8}}>Free valuation consultation</div></div><span className="pill success">MEMORY UPDATED</span></div></div>
    {[0,1,2].map(i=>{const p=spring({frame:local-55-i*18,fps,config:{damping:18,stiffness:180}}); return <div key={i} style={{position:'absolute',left:760+i*90,top:775-i*105,width:18,height:18,borderRadius:'50%',background:i===2?'var(--color-success)':'var(--color-accent)',opacity:p,transform:`scale(${p})`}}/>})}
  </Scene>;
};

const PolicyScene: React.FC = () => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const local=frame-1018;
  const safe=['Listing facts','Approved inventory','Connected calendar','Cadence follow-up'];
  const human=['Contracts & legal','Financing-sensitive','Complaints','Low confidence'];
  return <Scene start={1018} end={1275}><DataRain frame={frame}/><Chrome mode="SEND POLICY"/>
    <div style={{position:'absolute',left:105,top:170}}><div className="eyebrow">05 / CONTROL PLANE</div><h2 className="display" style={{fontSize:88,marginTop:18}}>AUTOMATE THE SAFE.<br/>ESCALATE THE REST.</h2></div>
    <div style={{position:'absolute',left:105,top:455,right:105,display:'grid',gridTemplateColumns:'1fr 1fr',gap:40}}>
      {[['SAFE TO AUTOMATE',safe,'var(--color-success)'],['NEEDS A PERSON',human,'var(--color-destructive)']].map((col,c)=>{const p=spring({frame:local-25-c*12,fps,config:{damping:24,stiffness:140}}); return <div key={String(col[0])} className="terminal" style={{height:450,opacity:p,transform:`translateY(${(1-p)*90}px)`}}><div className="terminal-bar" style={{color:String(col[2])}}>{String(col[0])}</div><div style={{padding:'20px 38px'}}>{(col[1] as string[]).map((x,i)=>{const on=local>70+i*18; return <div key={x} style={{height:78,display:'flex',alignItems:'center',gap:18,borderBottom:'1px solid var(--color-border-subtle)',fontSize:20}}><span style={{width:26,height:26,display:'grid',placeItems:'center',border:`1px solid ${String(col[2])}`,color:String(col[2]),fontFamily:'var(--font-mono)',fontSize:13}}>{on?'✓':'·'}</span>{x}</div>})}</div></div>})}
    </div>
  </Scene>;
};

const MemoryScene: React.FC = () => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const local=frame-1263;
  const nodes=[['BUDGET','$800K–$875K',-420,-180],['AREA','SOUTH AUSTIN',360,-195],['TIMELINE','30 DAYS',-390,205],['SHOWING','SAT · 2:00 PM',375,190],['CHANNEL','EMAIL → SMS',0,300]] as const;
  const orbit=local*.15;
  return <Scene start={1263} end={1520}><div className="noise"/><Chrome mode="THREAD MEMORY"/>
    <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center',transform:`scale(${map(local,[0,250],[.82,1.08])})`}}>
      <div style={{position:'relative',width:1500,height:800}}>
        <div style={{position:'absolute',left:590,top:270,width:320,height:260,border:'1px solid var(--color-accent)',display:'grid',placeItems:'center',background:'var(--color-surface)',boxShadow:'0 0 90px var(--color-accent-muted)',transform:`rotate(${Math.sin(orbit*.01)*1.5}deg)`}}><div style={{textAlign:'center'}}><div className="eyebrow">ACTIVE LEAD</div><div className="section-title" style={{marginTop:12}}>Jamie<br/>Chen</div><span className="pill success" style={{marginTop:22}}>CONTEXT CURRENT</span></div></div>
        <svg width="1500" height="800" style={{position:'absolute',inset:0}}>{nodes.map((n,i)=>{const p=spring({frame:local-22-i*8,fps,config:{damping:24,stiffness:130}});return <line key={n[0]} x1="750" y1="400" x2={750+n[2]} y2={400+n[3]} stroke="var(--color-border)" strokeWidth="2" strokeDasharray="8 10" opacity={p}/>})}</svg>
        {nodes.map((n,i)=>{const p=spring({frame:local-22-i*8,fps,config:{damping:22,stiffness:140}});return <div key={n[0]} className="terminal" style={{position:'absolute',left:750+n[2]-115,top:400+n[3]-50,width:230,height:100,padding:'20px 22px',opacity:p,transform:`scale(${.7+p*.3}) translateY(${Math.sin((orbit+i*50)*.03)*8}px)`}}><div className="eyebrow">{n[0]}</div><div style={{fontSize:17,marginTop:10}}>{n[1]}</div></div>})}
      </div>
    </div>
    <div style={{position:'absolute',left:105,bottom:75}}><div className="eyebrow">06 / ONE THREAD RECORD</div><div className="caption" style={{marginTop:12}}>Known details carry forward. Follow-up never loses conversation.</div></div>
  </Scene>;
};

const FinalScene: React.FC = () => {
  const frame=useCurrentFrame(); const {fps}=useVideoConfig(); const local=frame-1508;
  const mark=spring({frame:local-18,fps,config:{damping:16,stiffness:120}});
  const labels=['TRIAGE','PROPERTY DRAFTS','HUMAN FLAGS','FOLLOW-UP'];
  return <Scene start={1508} end={1786} className="frame-corners"><DataRain frame={frame}/><div className="vignette"/>
    <div style={{position:'absolute',inset:0,display:'grid',placeItems:'center'}}><div style={{textAlign:'center'}}>
      <div className="brand-mark" style={{width:110,height:110,fontSize:82,margin:'0 auto 35px',transform:`scale(${mark}) rotate(${(1-mark)*-25}deg)`}}>I</div>
      <div className="eyebrow">EMAIL OPERATIONS / CONTROLLED BY YOUR TEAM</div>
      <h2 className="display display-xl" style={{marginTop:25}}>REVIEW WHAT <span style={{color:'var(--color-accent)'}}>MATTERS.</span></h2>
      <p className="caption" style={{margin:'35px auto 0',width:900}}>Open Gmail. Send better replies. Keep rest inbox organized.</p>
      <div style={{display:'flex',justifyContent:'center',gap:12,marginTop:60}}>{labels.map((x,i)=>{const p=spring({frame:local-90-i*7,fps,config:{damping:22,stiffness:180}});return <span key={x} className="pill" style={{opacity:p,transform:`translateY(${(1-p)*25}px)`}}>{x}</span>})}</div>
    </div></div>
    <div className="mono" style={{position:'absolute',right:65,bottom:55,fontSize:13,color:'var(--color-text-muted)'}}>LUMENOSIS / IRIS / 24·7</div>
  </Scene>;
};

export const IrisFilm: React.FC = () => {
  const frame=useCurrentFrame(); const {durationInFrames}=useVideoConfig();
  return <AbsoluteFill className="film">
    <InboxScene/><PropertyScene/><SearchScene/><SellerScene/><PolicyScene/><MemoryScene/><FinalScene/>
    <Sequence premountFor={30}><Audio src={staticFile('narration.mp3')} volume={1}/></Sequence>
    <div className="progress-track"><div className="progress-fill" style={{transform:`scaleX(${frame/(durationInFrames-1)})`}}/></div>
  </AbsoluteFill>;
};
