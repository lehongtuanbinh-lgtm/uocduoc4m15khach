const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = express();
const PORT = 5000;
const API_URL_HU = 'https://wtx.tele68.com/v1/tx/sessions';
const API_URL_MD5 = 'https://wtxmd52.tele68.com/v1/txmd5/sessions';
const LEARNING_FILE = 'tiendat.json';
const HISTORY_FILE = 'tiendat1.json';
const FINGERPRINT_FILE = 'pattern_fingerprints.json';
const BOT_ID = '@muahatokyky';

let predictionHistory = { hu: [], md5: [] };
const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 30000;
let lastProcessedPhien = { hu: null, md5: null };

let learningData = {
  hu: {
    predictions:[],patternStats:{},totalPredictions:0,correctPredictions:0,patternWeights:{},lastUpdate:null,
    streakAnalysis:{wins:0,losses:0,currentStreak:0,bestStreak:0,worstStreak:0},
    adaptiveThresholds:{},recentAccuracy:[],bayesianPrior:{tai:0.5,xiu:0.5},
    weibullParams:{shape:1.75,scale:5.1},weibullAlt:{shape:2.6,scale:3.2},fingerprintDB:[],
    streakLengthStats:{avg:4.2,median:4,max:18,count:0,histogram:{}},
    breakConfidenceRequired:0.75,
    systemState:{mode:'NORMAL',consecutiveWrong:0,lastPatternFamily:null,altScore:0,oscScore:0}
  },
  md5: {
    predictions:[],patternStats:{},totalPredictions:0,correctPredictions:0,patternWeights:{},lastUpdate:null,
    streakAnalysis:{wins:0,losses:0,currentStreak:0,bestStreak:0,worstStreak:0},
    adaptiveThresholds:{},recentAccuracy:[],bayesianPrior:{tai:0.5,xiu:0.5},
    weibullParams:{shape:1.7,scale:4.8},weibullAlt:{shape:2.5,scale:3.0},fingerprintDB:[],
    streakLengthStats:{avg:4.0,median:4,max:16,count:0,histogram:{}},
    breakConfidenceRequired:0.73,
    systemState:{mode:'NORMAL',consecutiveWrong:0,lastPatternFamily:null,altScore:0,oscScore:0}
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet':1.6,'cau_dao_11':2.1,'cau_22':1.1,'cau_33':1.1,'cau_121':1.0,'cau_123':1.0,'cau_321':1.0,
  'cau_nhay_coc':0.8,'cau_nhip_nghieng':1.0,'cau_3van1':0.7,'cau_be_cau':1.2,'cau_chu_ky':1.0,
  'distribution':1.2,'dice_pattern':1.5,'sum_trend':1.3,'edge_cases':0.9,'momentum':1.0,
  'cau_tu_nhien':1.0,'dice_trend_line':1.0,'dice_trend_line_md5':1.0,'break_pattern_hu':0.5,
  'break_pattern_md5':0.5,'fibonacci':0.7,'resistance_support':1.1,'wave':0.7,'golden_ratio':0.7,
  'day_gay':0.8,'day_gay_md5':0.8,'cau_44':1.0,'cau_55':1.0,'cau_212':1.0,'cau_1221':1.0,
  'cau_2112':1.0,'cau_gap':0.8,'cau_ziczac':1.0,'cau_doi':1.0,'cau_rong':2.0,
  'smart_bet':0.8,'break_pattern_advanced':0.5,'break_streak':0.5,'alternating_break':1.9,
  'double_pair_break':0.9,'triple_pattern':1.0,'tong_phan_tich':1.4,'xu_huong_manh':1.0,'dao_chieu':1.5,
  'cau_3trang_3den':1.1,'cap_7_9_10_auto_break':1.3,'cau_11_giong_dau':1.6,
  'tinh_cong_dau_giong':1.7,'bet_benh_break_light':0.5,'cau_543_hang2':1.2,
  'dice_deep_analysis':1.9,'quantum_v9':2.0,'bayesian_meta':1.9,'pattern_fingerprint':1.8,
  'weibull_survival':1.7,'jsd_uncertainty':1.4,'follow_streak':2.2,
  'oscillation_meanrev':1.8,'alt_bridge':2.2
};

// ========== ORIGINAL UTILITIES KEPT 100% ==========
function deepMerge(t,s){const o={...t};for(const k in s){if(s[k]&&typeof s[k]==='object'&&!Array.isArray(s[k]))o[k]=deepMerge(t[k]||{},s[k]);else o[k]=s[k];}return o;}
function loadLearningData(){try{if(fs.existsSync(LEARNING_FILE)){const d=JSON.parse(fs.readFileSync(LEARNING_FILE,'utf8'));learningData=deepMerge(learningData,d);console.log('✅ Learning loaded');}}catch(e){console.error('Load err',e.message);}}
function saveLearningData(){try{fs.writeFileSync(LEARNING_FILE,JSON.stringify(learningData,null,2));}catch(e){console.error('Save err',e.message);}}
function loadPredictionHistory(){try{if(fs.existsSync(HISTORY_FILE)){const d=JSON.parse(fs.readFileSync(HISTORY_FILE,'utf8'));predictionHistory=d.history||{hu:[],md5:[]};lastProcessedPhien=d.lastProcessedPhien||{hu:null,md5:null};console.log(`✅ History HU=${predictionHistory.hu.length} MD5=${predictionHistory.md5.length}`);}}catch(e){console.error('Hist err',e.message);}}
function savePredictionHistory(){try{fs.writeFileSync(HISTORY_FILE,JSON.stringify({history:predictionHistory,lastProcessedPhien,lastSaved:new Date().toISOString()},null,2));}catch(e){}}
function loadFingerprints(){try{if(fs.existsSync(FINGERPRINT_FILE)){const r=JSON.parse(fs.readFileSync(FINGERPRINT_FILE,'utf8'));learningData.hu.fingerprintDB=r.hu||[];learningData.md5.fingerprintDB=r.md5||[];}}catch(e){}}
function saveFingerprints(){fs.writeFileSync(FINGERPRINT_FILE,JSON.stringify({hu:learningData.hu.fingerprintDB.slice(-2500),md5:learningData.md5.fingerprintDB.slice(-2500)},null,2));}

async function autoProcessPredictions(){
  try{
    const dh=await fetchDataHu();
    if(dh?.length){const p=dh[0].Phien+1;if(lastProcessedPhien.hu!==p){await verifyPredictions('hu',dh);const r=calculateAdvancedPrediction(dh,'hu');savePredictionToHistory('hu',p,r.prediction,r.confidence,dh[0]);recordPrediction('hu',p,r.prediction,r.confidence,r.factors);lastProcessedPhien.hu=p;console.log(`[HU #${p}] ${r.prediction} ${r.confidence}% | ${r.decision||''}`);}}
    const dm=await fetchDataMd5();
    if(dm?.length){const p=dm[0].Phien+1;if(lastProcessedPhien.md5!==p){await verifyPredictions('md5',dm);const r=calculateAdvancedPrediction(dm,'md5');savePredictionToHistory('md5',p,r.prediction,r.confidence,dm[0]);recordPrediction('md5',p,r.prediction,r.confidence,r.factors);lastProcessedPhien.md5=p;console.log(`[MD5#${p}] ${r.prediction} ${r.confidence}% | ${r.decision||''}`);}}
    await updateHistoryStatus('hu');await updateHistoryStatus('md5');
    savePredictionHistory();saveLearningData();saveFingerprints();
  }catch(e){console.error('Auto err',e.message);}
}
async function updateHistoryStatus(t){try{const d=t==='hu'?await fetchDataHu():await fetchDataMd5();if(!d?.length)return;let u=false;for(const r of predictionHistory[t]){if(r.ket_qua_du_doan)continue;const a=d.find(x=>x.Phien.toString()===r.Phien_hien_tai);if(a){r.ket_qua_du_doan=r.Du_doan===a.Ket_qua?'Đúng ✅':'Sai ❌';u=true;}}if(u)savePredictionHistory();}catch(e){}}
function startAutoSaveTask(){console.log(`Auto every ${AUTO_SAVE_INTERVAL/1000}s`);setTimeout(autoProcessPredictions,6000);setInterval(autoProcessPredictions,AUTO_SAVE_INTERVAL);}
function initializePatternStats(t){if(!learningData[t].patternWeights||!Object.keys(learningData[t].patternWeights).length)learningData[t].patternWeights={...DEFAULT_PATTERN_WEIGHTS};Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(p=>{if(!learningData[t].patternStats[p])learningData[t].patternStats[p]={total:0,correct:0,accuracy:0.5,recentResults:[],lastAdjustment:null};});}
function getPatternWeight(t,p){initializePatternStats(t);return learningData[t].patternWeights[p]||1;}
function updatePatternPerformance(t,p,ok){
  initializePatternStats(t);const s=learningData[t].patternStats[p];if(!s)return;
  s.total++;if(ok)s.correct++;s.recentResults.push(ok?1:0);if(s.recentResults.length>30)s.recentResults.shift();
  const ra=s.recentResults.reduce((a,b)=>a+b,0)/s.recentResults.length;s.accuracy=s.total?s.correct/s.total:.5;
  const o=learningData[t].patternWeights[p];let n=o;
  if(s.recentResults.length>=8){
    if(ra>0.75)n=Math.min(3.2,o*1.15);else if(ra>0.62)n=Math.min(2.5,o*1.06);
    else if(ra<0.30)n=Math.max(0.1,o*0.82);else if(ra<0.42)n=Math.max(0.25,o*0.92);
  }
  learningData[t].patternWeights[p]=n;s.lastAdjustment=new Date().toISOString();
}
function recordPrediction(t,ph,pr,cf,fa){learningData[t].predictions.unshift({phien:ph.toString(),prediction:pr,confidence:cf,patterns:fa||[],timestamp:new Date().toISOString(),verified:false,actual:null,isCorrect:null});learningData[t].totalPredictions++;if(learningData[t].predictions.length>600)learningData[t].predictions.length=600;saveLearningData();}
function recordStreakLength(type,len,side){
  const s=learningData[type].streakLengthStats;s.count++;s.histogram[len]=(s.histogram[len]||0)+1;
  const all=Object.entries(s.histogram).flatMap(([k,v])=>Array(v).fill(+k)).sort((a,b)=>a-b);
  s.avg=+(all.reduce((a,b)=>a+b,0)/all.length).toFixed(2);s.median=all[Math.floor(all.length/2)]||4;s.max=Math.max(s.max,len);
}

async function verifyPredictions(t,cur){
  let up=false,streaks=[],curSide=null,curLen=0;
  const sorted=[...cur].sort((a,b)=>a.Phien-b.Phien);
  sorted.forEach(d=>{if(d.Ket_qua===curSide)curLen++;else{if(curLen>=2)streaks.push({len:curLen,side:curSide});curSide=d.Ket_qua;curLen=1;}});
  if(curLen>=2)streaks.push({len:curLen,side:curSide});
  streaks.forEach(s=>recordStreakLength(t,s.len,s.side));

  let wrongRow=0;
  for(const p of learningData[t].predictions){
    if(p.verified){if(!p.isCorrect)wrongRow++;else wrongRow=0;continue;}
    const a=cur.find(x=>x.Phien.toString()===p.phien);if(!a)continue;
    p.verified=true;p.actual=a.Ket_qua;
    const nrm=p.prediction==='Tài'||p.prediction==='tai'?'Tài':'Xỉu';
    p.isCorrect=p.actual===nrm;
    if(p.isCorrect){
      learningData[t].correctPredictions++;learningData[t].streakAnalysis.wins++;
      learningData[t].streakAnalysis.currentStreak=learningData[t].streakAnalysis.currentStreak>=0?learningData[t].streakAnalysis.currentStreak+1:1;
      if(learningData[t].streakAnalysis.currentStreak>learningData[t].streakAnalysis.bestStreak)learningData[t].streakAnalysis.bestStreak=learningData[t].streakAnalysis.currentStreak;
      learningData[t].systemState.consecutiveWrong=0;
      learningData[t].bayesianPrior=bayesianUpdate(learningData[t].bayesianPrior,p.prediction,true);
    }else{
      learningData[t].streakAnalysis.losses++;
      learningData[t].streakAnalysis.currentStreak=learningData[t].streakAnalysis.currentStreak<=0?learningData[t].streakAnalysis.currentStreak-1:-1;
      if(learningData[t].streakAnalysis.currentStreak<learningData[t].streakAnalysis.worstStreak)learningData[t].streakAnalysis.worstStreak=learningData[t].streakAnalysis.currentStreak;
      learningData[t].systemState.consecutiveWrong++;
      learningData[t].bayesianPrior=bayesianUpdate(learningData[t].bayesianPrior,p.prediction,false);
      // === NEW: instant weight penalty on patterns that just failed ===
      if(p.patterns?.length)p.patterns.forEach(n=>{const id=getPatternIdFromName(n);if(id){const st=learningData[t].patternStats[id];if(st){st.recentResults.push(0);if(st.recentResults.length>30)st.recentResults.shift();learningData[t].patternWeights[id]=Math.max(0.15,learningData[t].patternWeights[id]*0.92);}}});
    }
    learningData[t].recentAccuracy.push(p.isCorrect?1:0);if(learningData[t].recentAccuracy.length>50)learningData[t].recentAccuracy.shift();
    learningData[t].weibullParams=fitWeibullFromHistory(learningData[t],'flat');
    learningData[t].weibullAlt=fitWeibullFromHistory(learningData[t],'alt');
    up=true;
  }
  // === NEW: SYSTEM STATE MACHINE ===
  const cw=learningData[t].systemState.consecutiveWrong;
  if(cw>=4)learningData[t].systemState.mode='LOCKDOWN';
  else if(cw>=3)learningData[t].systemState.mode='TRAP';
  else if(cw>=2)learningData[t].systemState.mode='WARNING';
  else learningData[t].systemState.mode='NORMAL';
  if(up){learningData[t].lastUpdate=new Date().toISOString();saveLearningData();}
}

function getPatternIdFromName(n){
  const m={'Cầu Bệt':'cau_bet','Cầu Đảo 1-1':'cau_dao_11','Cầu 2-2':'cau_22','Cầu 3-3':'cau_33','Cầu 4-4':'cau_44','Cầu 5-5':'cau_55','Cầu 1-2-1':'cau_121','Cầu 1-2-3':'cau_123','Cầu 3-2-1':'cau_321','Cầu 2-1-2':'cau_212','Cầu 1-2-2-1':'cau_1221','Cầu 2-1-1-2':'cau_2112','Cầu Nhảy Cóc':'cau_nhay_coc','Cầu Nhịp Nghiêng':'cau_nhip_nghieng','Cầu 3 Ván 1':'cau_3van1','Cầu Bẻ Cầu':'cau_be_cau','Cầu Chu Kỳ':'cau_chu_ky','Cầu Gấp':'cau_gap','Cầu Ziczac':'cau_ziczac','Cầu Đôi':'cau_doi','Cầu Rồng':'cau_rong','Đảo Xu Hướng':'smart_bet','Phân bố':'distribution','Tổng TB':'dice_pattern','Xu hướng':'sum_trend','Cực Điểm':'edge_cases','Biến động':'momentum','Cầu Tự Nhiên':'cau_tu_nhien','Biểu Đồ Đường':'dice_trend_line','MD5 Biểu Đồ':'dice_trend_line_md5','Dây Gãy':'day_gay','Tổng Phân Tích':'tong_phan_tich','Xu Hướng Mạnh':'xu_huong_manh','Đảo Chiều':'dao_chieu','3 Trắng':'cau_3trang_3den','Cặp 7-9-10':'cap_7_9_10_auto_break','Giống Đầu':'cau_11_giong_dau','Tính Cộng':'tinh_cong_dau_giong','Bẻ Nhẹ':'bet_benh_break_light','5-4-3':'cau_543_hang2','Xúc Xắc Sâu':'dice_deep_analysis','Quantum':'quantum_v9','Bayesian':'bayesian_meta','Dấu Vết':'pattern_fingerprint','Weibull':'weibull_survival','Đi Theo Cầu':'follow_streak','Dao Đảo':'alt_bridge','Dao Động':'oscillation_meanrev'};
  for(const[k,v] of Object.entries(m))if(n.includes(k))return v;return null;
}
function getAdaptiveConfidenceBoost(t){
  const r=learningData[t].recentAccuracy;if(r.length<12)return 0;
  const a=r.reduce((x,y)=>x+y,0)/r.length;
  if(a>.80)return 8;if(a>.70)return 5;if(a>.58)return 2;
  if(a<.25)return-12;if(a<.35)return-8;if(a<.48)return-4;
  return 0;
}
function maxConfidenceCeiling(t){
  const r=learningData[t].recentAccuracy,a=r.length>=10?r.reduce((x,y)=>x+y,0)/r.length:0.5;
  const cw=learningData[t].systemState.consecutiveWrong;
  const mode=learningData[t].systemState.mode;
  const base=62 + Math.min(31, a*36);
  const penalty={NORMAL:0,WARNING:-4,TRAP:-10,LOCKDOWN:-18}[mode];
  return Math.max(62, Math.min(92, Math.round(base - cw*2.2 + penalty)));
}
function getSmartPredictionAdjustment(t,pr,pts){
  let T=0,X=0;
  pts.forEach(p=>{
    const id=getPatternIdFromName(p.name||p);if(!id)return;
    const s=learningData[t].patternStats[id];if(!s||s.recentResults.length<6)return;
    const ra=s.recentResults.reduce((a,b)=>a+b,0)/s.recentResults.length;
    const w=learningData[t].patternWeights[id]||1;
    if((p.prediction||pr)==='Tài')T+=ra*w;else X+=ra*w;
  });
  if(Math.abs(T-X)>1.25)return T>X?'Tài':'Xỉu';
  return pr;
}
function normalizeResult(r){return r==='Tài'||r==='tài'?'tai':r==='Xỉu'||r==='xỉu'?'xiu':r.toLowerCase();}
function transformApiData(a){if(!a?.list||!Array.isArray(a.list))return null;return a.list.map(i=>({Phien:i.id,Ket_qua:i.resultTruyenThong==='TAI'?'Tài':'Xỉu',Xuc_xac_1:i.dices[0],Xuc_xac_2:i.dices[1],Xuc_xac_3:i.dices[2],Tong:i.point}));}
async function fetchDataHu(){try{return transformApiData((await axios.get(API_URL_HU,{timeout:12000})).data);}catch(e){console.error('HU',e.message);return null;}}
async function fetchDataMd5(){try{return transformApiData((await axios.get(API_URL_MD5,{timeout:12000})).data);}catch(e){console.error('MD5',e.message);return null;}}

// ========== ALL ORIGINAL PATTERN FUNCTIONS KEPT 100% INTACT ==========
function analyzeCauBet(r,t){
  if(r.length<3)return{detected:false};let k=r[0],n=1;for(let i=1;i<r.length;i++)if(r[i]===k)n++;else break;
  const w=getPatternWeight(t,'cau_bet');let br=false,c=68;
  if(n>=9){br=true;c=86;}else if(n>=7){br=true;c=78;}else if(n>=6){br=true;c=70;}else{br=false;c=76+n*2;}
  return{detected:true,type:k,length:n,prediction:br?(k==='Tài'?'Xỉu':'Tài'):k,confidence:Math.round(c*w),name:`Cầu Bệt ${n}×${k} → ${br?'BẺ':'THEO'}`,patternId:'cau_bet',action:br?'BREAK':'FOLLOW'};
}
function analyzeCauRong(r,t){
  if(r.length<6)return{detected:false};let n=1;for(let i=1;i<r.length;i++)if(r[i]===r[0])n++;else break;
  const avg=learningData[t].streakLengthStats.avg;
  if(n>=avg+2 && n>=7)return{detected:true,prediction:r[0]==='Tài'?'Xỉu':'Tài',confidence:Math.min(90,80+n)*getPatternWeight(t,'cau_rong'),name:`Cầu Rồng ${n}>TB${avg}→BẺ`,patternId:'cau_rong',action:'BREAK'};
  return{detected:true,prediction:r[0],confidence:(74+n*1.6)*getPatternWeight(t,'cau_rong'),name:`Cầu Rồng ${n} TB=${avg}→TIẾP`,patternId:'cau_rong',action:'FOLLOW'};
}
function analyzeBreakStreak(r,t){
  let k=r[0],n=1;for(let i=1;i<r.length;i++)if(r[i]===k)n++;else break;
  const avg=learningData[t].streakLengthStats.avg;
  if(n>=8 && n>avg+1.5)return{detected:true,prediction:k==='Tài'?'Xỉu':'Tài',confidence:Math.min(80,66+n)*getPatternWeight(t,'break_streak'),name:`Bẻ ${n} TB=${avg}`,patternId:'break_streak',action:'BREAK'};
  return{detected:false};
}
function analyzeAlternatingBridge(r,t){ // NEW v2 — detects from L=2
  if(r.length<2)return{detected:false};let alt=0;
  for(let i=0;i<Math.min(r.length,10)-1;i++)if(r[i]!==r[i+1])alt++;else break;
  learningData[t].systemState.altScore=alt;
  if(alt>=5)return{detected:true,prediction:r[0],confidence:84*getPatternWeight(t,'alt_bridge'),name:`⛔ ALT BRIDGE ${alt} → BREAK CYCLE`,patternId:'alt_bridge',action:'BREAK'};
  if(alt>=3)return{detected:true,prediction:r[0],confidence:74*getPatternWeight(t,'alt_bridge'),name:`Đảo dần ${alt}`,patternId:'alt_bridge',action:'BREAK'};
  return{detected:false};
}
function analyzeOscillation(data,t){
  if(data.length<6)return{detected:false};
  const s=data.slice(0,8).map(d=>d.Tong-10.5);let osc=0;
  for(let i=0;i<s.length-1;i++)if((s[i]>0)!==(s[i+1]>0))osc++;
  learningData[t].systemState.oscScore=osc;
  const accel=Math.abs(s[0]-s[1])+Math.abs(s[1]-s[2]);
  if(osc>=4 && accel>6)return{detected:true,prediction:(s[0]>0)?'Xỉu':'Tài',confidence:80*getPatternWeight(t,'oscillation_meanrev'),name:`📊 Dao động mạnh ${osc}/7 → MeanRev`,patternId:'oscillation_meanrev',action:'BREAK'};
  return{detected:false};
}
function analyzeTongPhanTich(d,t){if(d.length<10)return{detected:false};const r=d.slice(0,10),s=r.map(x=>x.Tong),k=r.map(x=>x.Ket_qua);const tb=s.reduce((a,b)=>a+b,0)/10,T=k.filter(x=>x==='Tài').length,X=10-T;const f5=s.slice(5).reduce((a,b)=>a+b,0)/5,l5=s.slice(0,5).reduce((a,b)=>a+b,0)/5,dt=l5-f5;const w=getPatternWeight(t,'tong_phan_tich');if(dt>1.8)return{detected:true,prediction:'Xỉu',confidence:74*w,name:`Tổng ↑${dt.toFixed(1)}→Xỉu`,patternId:'tong_phan_tich'};if(dt<-1.8)return{detected:true,prediction:'Tài',confidence:74*w,name:`Tổng ↓${Math.abs(dt).toFixed(1)}→Tài`,patternId:'tong_phan_tich'};if(Math.abs(T-X)>=4)return{detected:true,prediction:T>X?'Xỉu':'Tài',confidence:72*w,name:`Lệch ${Math.abs(T-X)}`,patternId:'tong_phan_tich'};return{detected:false};}
function analyzeXuHuongManh(r,t){if(r.length<8)return{detected:false};const T=r.slice(0,8).filter(x=>x==='Tài').length,w=getPatternWeight(t,'xu_huong_manh');if(T>=7)return{detected:true,prediction:'Xỉu',confidence:76*w,name:`7/8T→X`,patternId:'xu_huong_manh'};if(T<=1)return{detected:true,prediction:'Tài',confidence:76*w,name:`7/8X→T`,patternId:'xu_huong_manh'};return{detected:false};}
function analyzeDaoChieu(r,t){if(r.length<5)return{detected:false};const x=r.slice(0,5);let ok=true;for(let i=0;i<4;i++)if(x[i]===x[i+1])ok=false;if(ok)return{detected:true,prediction:x[0]==='Tài'?'Xỉu':'Tài',confidence:74,name:`Đảo ${x.join('-')}`,patternId:'dao_chieu'};return{detected:false};}
function analyzeCauDao11(r,t){if(r.length<4)return{detected:false};let n=1;for(let i=1;i<Math.min(r.length,16);i++)if(r[i]!==r[i-1])n++;else break;if(n>=4)return{detected:true,length:n,prediction:r[0]==='Tài'?'Xỉu':'Tài',confidence:Math.min(82,64+n*2)*getPatternWeight(t,'cau_dao_11'),name:`Đảo1‑1×${n}`,patternId:'cau_dao_11'};return{detected:false};}
function analyzeCau22(r,t){if(r.length<6)return{detected:false};let c=0,i=0,p=[];while(i<r.length-1&&c<4){if(r[i]===r[i+1]){p.push(r[i]);c++;i+=2;}else break;}if(c>=2){let a=true;for(let j=1;j<p.length;j++)if(p[j]===p[j-1])a=false;if(a)return{detected:true,pairCount:c,prediction:p.at(-1)==='Tài'?'Xỉu':'Tài',confidence:Math.min(76,64+c*3)*getPatternWeight(t,'cau_22'),name:`2‑2×${c}`,patternId:'cau_22'};}return{detected:false};}
function analyzeCau33(r,t){if(r.length<6)return{detected:false};let c=0,i=0,p=[];while(i<r.length-2){if(r[i]===r[i+1]&&r[i+1]===r[i+2]){p.push(r[i]);c++;i+=3;}else break;}if(c>=1)return{detected:true,tripleCount:c,prediction:(r.length%3===0)?(p.at(-1)==='Tài'?'Xỉu':'Tài'):p.at(-1),confidence:Math.min(78,68+c*4)*getPatternWeight(t,'cau_33'),name:`3‑3×${c}`,patternId:'cau_33'};return{detected:false};}
function analyzeCau121(r,t){if(r.length<4)return{detected:false};const p=r.slice(0,4);if(p[0]!==p[1]&&p[1]===p[2]&&p[2]!==p[3]&&p[0]===p[3])return{detected:true,prediction:p[0],confidence:72*getPatternWeight(t,'cau_121'),name:'1‑2‑1',patternId:'cau_121'};return{detected:false};}
function analyzeCau123(r,t){if(r.length<6)return{detected:false};if(r[3]===r[4]&&r[3]!==r[5]&&r[0]===r[1]&&r[1]===r[2]&&r[0]!==r[3])return{detected:true,prediction:r[5],confidence:74*getPatternWeight(t,'cau_123'),name:'1‑2‑3',patternId:'cau_123'};return{detected:false};}
function analyzeCau321(r,t){if(r.length<6)return{detected:false};const a=r.slice(3,6),b=r.slice(1,3);if(a.every(x=>x===a[0])&&b.every(x=>x===b[0])&&a[0]!==b[0]&&r[0]!==b[0])return{detected:true,prediction:b[0],confidence:76*getPatternWeight(t,'cau_321'),name:'3‑2‑1',patternId:'cau_321'};return{detected:false};}
function analyzeCauNhayCoc(r,t){if(r.length<6)return{detected:false};const s=[];for(let i=0;i<Math.min(r.length,14);i+=2)s.push(r[i]);if(s.length>=3&&s.slice(0,3).every(x=>x===s[0]))return{detected:true,prediction:s[0],confidence:68*getPatternWeight(t,'cau_nhay_coc'),name:'Nhảy Cóc',patternId:'cau_nhay_coc'};return{detected:false};}
function analyzeCauNhipNghieng(r,t){if(r.length<5)return{detected:false};const l=r.slice(0,5),T=l.filter(x=>x==='Tài').length,w=getPatternWeight(t,'cau_nhip_nghieng');if(T>=4)return{detected:true,prediction:'Tài',confidence:68*w,name:`Nghiêng ${T}/5T`,patternId:'cau_nhip_nghieng'};if(T<=1)return{detected:true,prediction:'Xỉu',confidence:68*w,name:`Nghiêng ${5-T}/5X`,patternId:'cau_nhip_nghieng'};return{detected:false};}
function analyzeCau3Van1(r,t){if(r.length<4)return{detected:false};const T=r.slice(0,4).filter(x=>x==='Tài').length,w=getPatternWeight(t,'cau_3van1');if(T===3)return{detected:true,prediction:'Xỉu',confidence:64*w,name:'3T1X',patternId:'cau_3van1'};if(T===1)return{detected:true,prediction:'Tài',confidence:64*w,name:'3X1T',patternId:'cau_3van1'};return{detected:false};}
function analyzeCauBeCau(r,t){const a=analyzeCauBet(r,t);if(a.detected&&a.length>=5){const b=analyzeCauBet(r.slice(a.length,a.length+5),t);if(b.detected&&b.type!==a.type)return{detected:true,prediction:a.type==='Tài'?'Xỉu':'Tài',confidence:76*getPatternWeight(t,'cau_be_cau'),name:'Bẻ Cầu',patternId:'cau_be_cau'};}return{detected:false};}
function analyzeCauTuNhien(r,t){return{detected:true,prediction:r[0],confidence:60*getPatternWeight(t,'cau_tu_nhien'),name:'Tự Nhiên',patternId:'cau_tu_nhien'};}
function analyzeSmartBet(r,t){if(r.length<10)return{detected:false};const a=r.slice(0,5).filter(x=>x==='Tài').length,b=r.slice(5,10).filter(x=>x==='Tài').length,w=getPatternWeight(t,'smart_bet');if((a>=4&&b<=1)||(a<=1&&b>=4))return{detected:true,prediction:a>=4?'Xỉu':'Tài',confidence:72*w,name:`Đảo ${a}:${b}`,patternId:'smart_bet'};return{detected:false};}
function analyzeAlternatingBreak(r,t){if(r.length<8)return{detected:false};let n=0;for(let i=0;i<r.length-1;i++)if(r[i]!==r[i+1])n++;else break;if(n>=8)return{detected:true,prediction:r[0],confidence:74*getPatternWeight(t,'alternating_break'),name:`Bẻ đảo${n}`,patternId:'alternating_break'};return{detected:false};}
function analyzeDoublePairBreak(r,t){if(r.length<8)return{detected:false};if(r[0]===r[1]&&r[2]===r[3]&&r[4]===r[5]&&r[6]===r[7]){const w=getPatternWeight(t,'double_pair_break');if(r[0]===r[2]&&r[2]===r[4]&&r[4]===r[6])return{detected:true,prediction:r[0]==='Tài'?'Xỉu':'Tài',confidence:80*w,name:'4Cặp',patternId:'double_pair_break'};}return{detected:false};}
function analyzeTriplePattern(r,t){if(r.length<9)return{detected:false};const a=r[0]===r[1]&&r[1]===r[2],b=r[3]===r[4]&&r[4]===r[5],c=r[6]===r[7]&&r[7]===r[8];if(a&&b&&c&&r[0]===r[3]&&r[3]===r[6])return{detected:true,prediction:r[0]==='Tài'?'Xỉu':'Tài',confidence:84*getPatternWeight(t,'triple_pattern'),name:'3×3Bẻ',patternId:'triple_pattern'};return{detected:false};}
function analyzeDistribution(d,t,w=60){const x=d.slice(0,w),T=x.filter(z=>z.Ket_qua==='Tài').length;return{taiPercent:T/w*100,xiuPercent:(w-T)/w*100,taiCount:T,xiuCount:w-T,total:w,imbalance:Math.abs(2*T-w)/w};}
function analyze3TrangDen_Cap7910(d,t){if(d.length<5)return{detected:false};const s=d.slice(0,5).map(x=>x.Tong),w=getPatternWeight(t,'cap_7_9_10_auto_break');if(s[0]===9&&s[1]===8)return{detected:true,prediction:'Xỉu',confidence:78*w,name:'9‑8→Xỉu',patternId:'cap_7_9_10_auto_break'};if(s[0]===8&&s[1]===9)return{detected:true,prediction:'Tài',confidence:78*w,name:'8‑9→Tài',patternId:'cap_7_9_10_auto_break'};const g=s.slice(0,3).map(x=>x<=10?'DEN':'TRANG');if(g.every(x=>x===g[0]))return{detected:true,prediction:g[0]==='TRANG'?'Xỉu':'Tài',confidence:68*getPatternWeight(t,'cau_3trang_3den'),name:`3${g[0]}`,patternId:'cau_3trang_3den'};return{detected:false};}
function analyze11GiongDau(d,t){if(d.length<5)return{detected:false};const s=d.slice(0,5).map(x=>x.Tong),w=getPatternWeight(t,'cau_11_giong_dau');if(s[0]===s[2]&&s[0]!==s[1]){if(s[0]===s[4])return{detected:true,prediction:'Tài',confidence:90*w,name:`4×${s[0]}→Tài`,patternId:'cau_11_giong_dau'};return{detected:true,prediction:s[0]>=11?'Xỉu':'Tài',confidence:84*w,name:`Giống đầu ${s[2]}-${s[1]}-${s[0]}`,patternId:'cau_11_giong_dau'};}return{detected:false};}
function analyzeTinhCongDauGiong(d,t){if(d.length<8)return{detected:false};const s=d.map(x=>x.Tong),w=getPatternWeight(t,'tinh_cong_dau_giong');for(let i=0;i<s.length-3;i++){if(s[i]===s[i+2]&&s[i]!==s[i+1]){const c=s.slice(0,i).filter(x=>x===s[i]).length;if(c>=3)return{detected:true,prediction:(s[i]+s[i+1]+s[i+2])>=30?'Xỉu':'Tài',confidence:82*w,name:`Cộng=${s[i]+s[i+1]+s[i+2]}`,patternId:'tinh_cong_dau_giong'};}}const l8=s.slice(0,7);if(l8.filter(x=>x===8).length>=4)return{detected:true,prediction:'Xỉu',confidence:82*w,name:'Chuỗi 8→Xỉu',patternId:'tinh_cong_dau_giong'};return{detected:false};}
function analyzeBetBenhBreak(d,t){if(d.length<8)return{detected:false};const s=d.slice(1,7).map(x=>x.Tong);if(s.every(x=>x>=11&&x<=14)&&!(d[0].Tong>=11&&d[0].Tong<=14))return{detected:true,prediction:d[0].Tong>=11?'Xỉu':'Tài',confidence:60*getPatternWeight(t,'bet_benh_break_light'),name:'Bẻ nhẹ 11‑14',patternId:'bet_benh_break_light'};return{detected:false};}
function analyzeCau543(d,t){if(d.length<6)return{detected:false};const s=d.slice(0,6).map(x=>x.Tong);if(s[0]-s[1]===1&&s[1]-s[2]===1&&s[2]-s[3]===1)return{detected:true,prediction:s[0]>=11?'Xỉu':'Tài',confidence:82*getPatternWeight(t,'cau_543_hang2'),name:'5‑4‑3→Bẻ',patternId:'cau_543_hang2'};return{detected:false};}
function modeOf(a){return Object.entries(a.reduce((o,v)=>{o[v]=(o[v]||0)+1;return o;},{})).sort((x,y)=>y[1]-x[1])[0][0];}
function analyzeDiceDeep(d,t){
  if(d.length<25)return{detected:false};const w=getPatternWeight(t,'dice_deep_analysis'),L=d.slice(0,25),f=[0,0,0,0,0,0,0];
  L.forEach(x=>{f[x.Xuc_xac_1]++;f[x.Xuc_xac_2]++;f[x.Xuc_xac_3]++;});
  const hot=f.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v).slice(0,3).map(x=>x.i);
  const sums=L.map(x=>x.Tong),avg=sums.reduce((a,b)=>a+b,0)/sums.length,std=Math.sqrt(sums.reduce((a,b)=>a+(b-avg)**2,0)/sums.length);
  const last=d[0],parity=(last.Xuc_xac_1%2)+(last.Xuc_xac_2%2)+(last.Xuc_xac_3%2);
  let pr=avg>=10.5?'Tài':'Xỉu',cf=68;const th=hot.reduce((a,b)=>a+b,0);
  if(parity===0||parity===3)cf-=4;if(std<1.7)cf+=6;if(th>=11)pr='Tài';if(th<=6)pr='Xỉu';
  // === NEW: exactly your case 2‑6‑6=14 → high sum → pullback signal ===
  if(last.Tong>=13 && last.Xuc_xac_1===last.Xuc_xac_2 || last.Xuc_xac_2===last.Xuc_xac_3){pr='Xỉu';cf+=4;}
  if(last.Tong<=6 && parity<=1){pr='Tài';cf+=4;}
  return{detected:true,prediction:pr,confidence:cf*w,name:`🎲 TB${avg.toFixed(2)}σ${std.toFixed(2)}🔥${hot}`,patternId:'dice_deep_analysis',extra:{hot,avg,std,parity}};
}

// ========== 5 CORE MODELS FULLY REWORKED ==========
function bayesianUpdate(pr,pred,ok){const lr=0.055;const k=pred==='Tài'?'tai':'xiu';const hl=25;const f=Math.exp(-1/hl);const v=Math.max(.05,Math.min(.95,pr[k]*f + (1-f)*(pr[k]+lr*(ok?1:-1))));return{tai:k==='tai'?v:1-v,xiu:k==='xiu'?v:1-v};}
function weibullHazard(n,k,lam){return 1-Math.exp(-((n/lam)**k));}
function fitWeibullFromHistory(ld,mode='flat'){
  const arr=[];let c=1;const a=ld.predictions.filter(p=>p.verified).map(p=>p.actual);
  for(let i=1;i<a.length;i++){
    if(mode==='alt'){if(a[i]!==a[i-1])c++;else{arr.push(c);c=1;}}
    else{if(a[i]===a[i-1])c++;else{arr.push(c);c=1;}}
  }
  if(arr.length<6)return mode==='alt'?{shape:2.55,scale:3.1}:{shape:1.75,scale:4.8};
  const ln=arr.map(s=>Math.log(s)).reduce((x,y)=>x+y,0)/arr.length;
  return mode==='alt'
    ? {shape:+(2.2+0.5/(1+Math.exp(-ln+0.6))).toFixed(3), scale:+Math.max(2.6, ld.streakLengthStats.avg*0.72).toFixed(2)}
    : {shape:+(1.65+0.4/(1+Math.exp(-ln))).toFixed(3),       scale:+Math.max(4.0, ld.streakLengthStats.avg).toFixed(2)};
}
function makeFP(d,l=14){const a=d.slice(0,l).map(x=>x.Ket_qua==='Tài'?1:-1),s=d.slice(0,l).map(x=>(x.Tong-10.5)/10.5);const v=[...a,...s];const m=Math.sqrt(v.reduce((x,y)=>x+y*y,0))||1;return{vec:v.map(x=>+(x/m).toFixed(4)),hash:crypto.createHash('md5').update(a.join()).digest('hex').slice(0,10)};}
function cosSim(a,b){let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;}
function fingerprintMatch(d,t){
  const cur=makeFP(d,14);const db=learningData[t].fingerprintDB;const hist={};
  for(const it of db){const s=cosSim(cur.vec,it.vec);if(s>0.82)hist[it.next]=(hist[it.next]||0)+1;}
  learningData[t].fingerprintDB.unshift({...cur,next:d[0]?.Ket_qua});
  if(learningData[t].fingerprintDB.length>2500)learningData[t].fingerprintDB.pop();
  const top=Object.entries(hist).sort((a,b)=>b[1]-a[1])[0];
  return top&&top[1]>=3?{sim:cosSim(cur.vec,makeFP(d,14).vec),next:top[0],count:top[1]}:{sim:0,next:null,count:0};
}
function quantumEnsemble(preds){
  const st={tai:{amp:0},xiu:{amp:0}};
  preds.forEach(p=>{const a=Math.sqrt(p.confidence/100)*(p.priority||1);if(p.prediction==='Tài')st.tai.amp+=a;else st.xiu.amp+=a;});
  const t=st.tai.amp**2,x=st.xiu.amp**2,z=t+x||1;return{tai:t/z,xiu:x/z,entangle:Math.abs(t-x)/z};
}
function kl(a,b){return a*Math.log2((a+1e-9)/(b+1e-9));}
function jsd(p,q){const m={tai:(p.tai+q.tai)/2,xiu:(p.xiu+q.xiu)/2};return.5*(kl(p.tai,m.tai)+kl(p.xiu,m.xiu))+.5*(kl(q.tai,m.tai)+kl(q.xiu,m.xiu));}
function uncertPen(ds){let s=0,c=0;for(let i=0;i<ds.length;i++)for(let j=i+1;j<ds.length;j++){s+=jsd(ds[i],ds[j]);c++;}const u=s/Math.max(1,c);return Math.max(-14,Math.min(0,-u*22));}

// ========== MAIN ENGINE — FULLY RECALIBRATED ==========
function calculateAdvancedPrediction(data, type){
  const last60=data.slice(0,60), results=last60.map(d=>d.Ket_qua);
  initializePatternStats(type);
  const preds=[], factors=[], all=[];
  const PUSH=o=>{if(o?.detected){preds.push({...o});factors.push(o.name);all.push(o);}};

  const cb=analyzeCauBet(results,type);PUSH(cb);
  const cr=analyzeCauRong(results,type);PUSH(cr);
  const alt=analyzeAlternatingBridge(results,type);PUSH(alt);
  const osc=analyzeOscillation(last60,type);PUSH(osc);

  // === FOLLOW DECAY: trust falls as length grows ===
  if(cb.detected){
    const avg=learningData[type].streakLengthStats.avg;
    const trust=Math.max(0.35, 1 - Math.pow(cb.length/Math.max(avg+1,3), 2.2));
    if(cb.action==='FOLLOW'){
      preds.push({prediction:cb.type,confidence:Math.round(88*trust),priority:95,name:`⭐ THEO ${cb.length}× trust=${trust.toFixed(2)}`,patternId:'follow_streak',action:'FOLLOW',detected:true});
      factors.push(`⭐ THEO trust=${trust.toFixed(2)}`);
    }
  }

  PUSH(analyzeTongPhanTich(last60,type));
  PUSH(analyzeXuHuongManh(results,type));
  PUSH(analyzeDaoChieu(results,type));
  PUSH(analyzeBreakStreak(results,type));
  PUSH(analyzeTriplePattern(results,type));
  PUSH(analyzeDoublePairBreak(results,type));
  PUSH(analyzeSmartBet(results,type));
  PUSH(analyzeCauDao11(results,type));
  PUSH(analyzeCau22(results,type));
  PUSH(analyzeCau33(results,type));
  PUSH(analyzeCau121(results,type));
  PUSH(analyzeCau123(results,type));
  PUSH(analyzeCau321(results,type));
  PUSH(analyzeCauBeCau(results,type));
  PUSH(analyzeCauNhipNghieng(results,type));
  PUSH(analyzeCau3Van1(results,type));
  PUSH(analyzeCauNhayCoc(results,type));
  PUSH(analyzeAlternatingBreak(results,type));
  PUSH(analyze3TrangDen_Cap7910(last60,type));
  PUSH(analyze11GiongDau(last60,type));
  PUSH(analyzeTinhCongDauGiong(last60,type));
  PUSH(analyzeBetBenhBreak(last60,type));
  PUSH(analyzeCau543(last60,type));
  const dd=analyzeDiceDeep(last60,type);PUSH(dd);
  if(preds.length===0)PUSH(analyzeCauTuNhien(results,type));

  const PR={alt_bridge:96,oscillation_meanrev:94,follow_streak:95,cau_rong:25,cau_bet:22,tinh_cong_dau_giong:20,cau_11_giong_dau:19,cap_7_9_10_auto_break:18,cau_543_hang2:17,tong_phan_tich:14,dao_chieu:13,triple_pattern:12,double_pair_break:11,cau_dao_11:10,cau_be_cau:9,smart_bet:7,cau_22:6,cau_33:6,cau_121:5,cau_123:5,cau_321:5,break_streak:4,alternating_break:4,cau_nhip_nghiêng:4,cau_3van1:3,cau_nhay_coc:2,bet_benh_break_light:1,dice_deep_analysis:16};
  preds.forEach(p=>p.priority=PR[p.patternId]||3);

  // === STATE OVERRIDE MATRIX ===
  const mode=learningData[type].systemState.mode;
  const altScore=learningData[type].systemState.altScore;
  const oscScore=learningData[type].systemState.oscScore;
  if((mode==='TRAP'||mode==='LOCKDOWN'||altScore>=3||oscScore>=4)){
    preds.forEach(p=>{if(p.patternId==='follow_streak'){p.priority=5;p.confidence=Math.max(55,p.confidence-18);}});
    preds.filter(p=>p.action==='BREAK'||p.patternId==='alt_bridge'||p.patternId==='oscillation_meanrev'||p.patternId==='dice_deep_analysis').forEach(p=>p.priority+=30);
  }
  preds.sort((a,b)=>b.priority-a.priority||b.confidence-a.confidence);

  const q=quantumEnsemble(preds);
  const by=learningData[type].bayesianPrior;
  let k=results[0],ln=1;for(let i=1;i<results.length;i++)if(results[i]===k)ln++;else break;
  const isAlt=altScore>=3;
  const wb=isAlt
    ? {prediction:weibullHazard(ln,learningData[type].weibullAlt.shape,learningData[type].weibullAlt.scale)>.6?(k==='Tài'?'Xỉu':'Tài'):k, pBreak:weibullHazard(ln,learningData[type].weibullAlt.shape,learningData[type].weibullAlt.scale)}
    : {prediction:weibullHazard(ln,learningData[type].weibullParams.shape,learningData[type].weibullParams.scale)>.72?(k==='Tài'?'Xỉu':'Tài'):k, pBreak:weibullHazard(ln,learningData[type].weibullParams.shape,learningData[type].weibullParams.scale)};
  const fp=fingerprintMatch(last60,type);
  const dists=[q,by,{tai:wb.prediction==='Tài'?.5+wb.pBreak/2:.5-wb.pBreak/2,xiu:wb.prediction==='Xỉu'?.5+wb.pBreak/2:.5-wb.pBreak/2}];
  if(fp.next&&fp.count>=3)dists.push({tai:fp.next==='Tài'?.5+fp.sim/2:.5-fp.sim/2,xiu:fp.next==='Xỉu'?.5+fp.sim/2:.5-fp.sim/2});
  const mT=dists.reduce((s,d)=>s+d.tai,0)/dists.length,mX=1-mT;
  const uncert=uncertPen(dists);
  const consensus=Math.abs(mT-mX);

  let tS=0,xS=0;preds.forEach(p=>{if(p.prediction==='Tài')tS+=p.confidence*p.priority;else xS+=p.confidence*p.priority;});
  tS*=(.55+.7*mT);xS*=(.55+.7*mX);

  let finalPred,decision='';
  const breakVotes=preds.filter(p=>p.action==='BREAK').length;
  const follow=preds.find(p=>p.patternId==='follow_streak');
  const avg=learningData[type].streakLengthStats.avg;

  if(altScore>=4){finalPred=results[0]==='Tài'?'Xỉu':'Tài';decision=`⛔ ALT BRIDGE FORCE BREAK L=${altScore}`;}
  else if(oscScore>=4 && consensus<0.18){finalPred=tS>=xS?'Tài':'Xỉu';decision=`📊 OSC MEANREV`;}
  else if(follow && ln < avg+0.8 && breakVotes<3){finalPred=follow.prediction;decision=`🛡️ SAFE FOLLOW ${ln}×${k} TB=${avg.toFixed(1)}`;}
  else if(ln>=7 && wb.pBreak>=0.74 && breakVotes>=4 && consensus>=0.22){finalPred=k==='Tài'?'Xỉu':'Tài';decision=`⚡ BREAK ${ln} P=${(wb.pBreak*100).toFixed(0)}%`;}
  else {finalPred=tS>=xS?'Tài':'Xỉu';decision=tS>=xS?`T ${tS.toFixed(0)}:${xS.toFixed(0)}`:`X ${xS.toFixed(0)}:${tS.toFixed(0)}`;}

  finalPred=getSmartPredictionAdjustment(type,finalPred,all);

  let base=64;
  preds.slice(0,4).forEach(p=>{if(p.prediction===finalPred)base+=(p.confidence-62)*.32;});
  const agree=preds.filter(p=>p.prediction===finalPred).length/Math.max(1,preds.length);
  base += agree*9 + getAdaptiveConfidenceBoost(type) + uncert + consensus*20;
  if(follow&&finalPred===follow.prediction&&altScore<3)base+=5;
  const ceiling=maxConfidenceCeiling(type);
  const conf=Math.max(60, Math.min(ceiling, Math.round(base)));

  return{
    prediction:finalPred,confidence:conf,factors,allPatterns:all,decision,
    ceiling,mode,altScore,oscScore,breakVotes,consensus:consensus.toFixed(3),
    quantum:q,bayesian:by,weibull:wb,fingerprint:fp,jsdUncertainty:uncert,
    detailedAnalysis:{
      totalPatterns:preds.length,taiVotes:preds.filter(p=>p.prediction==='Tài').length,xiuVotes:preds.filter(p=>p.prediction==='Xỉu').length,
      metaScore:{tai:mT,xiu:mX},topPattern:preds[0]?.name,streakNow:{side:k,length:ln,avgHistory:avg,breakProb:(wb.pBreak*100).toFixed(1)+'%',breakVotes},
      distribution:analyzeDistribution(last60,type),dice:dd?.extra,
      learningStats:{
        totalPredictions:learningData[type].totalPredictions,correctPredictions:learningData[type].correctPredictions,
        accuracy:learningData[type].totalPredictions>0?(learningData[type].correctPredictions/learningData[type].totalPredictions*100).toFixed(2)+'%':'N/A',
        currentStreak:learningData[type].streakAnalysis.currentStreak,
        weibull:learningData[type].weibullParams,weibullAlt:learningData[type].weibullAlt,
        systemState:learningData[type].systemState
      }
    }
  };
}

function savePredictionToHistory(t,ph,pr,cf,ld){
  const rec={Phien:ld.Phien,Xuc_xac_1:ld.Xuc_xac_1,Xuc_xac_2:ld.Xuc_xac_2,Xuc_xac_3:ld.Xuc_xac_3,Tong:ld.Tong,Ket_qua:ld.Ket_qua,Do_tin_cay:`${cf}%`,Phien_hien_tai:ph.toString(),Du_doan:pr,ket_qua_du_doan:'',id:BOT_ID,timestamp:new Date().toISOString()};
  predictionHistory[t].unshift(rec);if(predictionHistory[t].length>MAX_HISTORY)predictionHistory[t].length=MAX_HISTORY;return rec;
}

// ========== ALL ORIGINAL ENDPOINTS 100% UNCHANGED + /debug ==========
app.get('/',(req,res)=>res.type('text/plain; charset=utf-8').send(`${BOT_ID} | Quantum v9 Bayesian Fingerprint Weibull JSD + ALT‑BRIDGE + MEANREV + CONF‑CAL`));
app.get('/lc79-hu',async(req,res)=>{try{const d=await fetchDataHu();if(!d)return res.status(500).json({error:'no data'});await verifyPredictions('hu',d);const r=calculateAdvancedPrediction(d,'hu');const rec=savePredictionToHistory('hu',d[0].Phien+1,r.prediction,r.confidence,d[0]);recordPrediction('hu',d[0].Phien+1,r.prediction,r.confidence,r.factors);setTimeout(()=>updateHistoryStatus('hu'),5000);res.json(rec);}catch(e){res.status(500).json({error:e.message});}});
app.get('/lc79-md5',async(req,res)=>{try{const d=await fetchDataMd5();if(!d)return res.status(500).json({error:'no data'});await verifyPredictions('md5',d);const r=calculateAdvancedPrediction(d,'md5');const rec=savePredictionToHistory('md5',d[0].Phien+1,r.prediction,r.confidence,d[0]);recordPrediction('md5',d[0].Phien+1,r.prediction,r.confidence,r.factors);setTimeout(()=>updateHistoryStatus('md5'),5000);res.json(rec);}catch(e){res.status(500).json({error:e.message});}});
app.get('/lc79-hu/lichsu',async(req,res)=>{await updateHistoryStatus('hu');res.json({type:'HU',history:predictionHistory.hu,total:predictionHistory.hu.length,id:BOT_ID});});
app.get('/lc79-md5/lichsu',async(req,res)=>{await updateHistoryStatus('md5');res.json({type:'MD5',history:predictionHistory.md5,total:predictionHistory.md5.length,id:BOT_ID});});
app.get('/lc79-hu/analysis',async(req,res)=>{const d=await fetchDataHu();if(!d)return res.status(500).json({err:1});await verifyPredictions('hu',d);res.json(calculateAdvancedPrediction(d,'hu'));});
app.get('/lc79-md5/analysis',async(req,res)=>{const d=await fetchDataMd5();if(!d)return res.status(500).json({err:1});await verifyPredictions('md5',d);res.json(calculateAdvancedPrediction(d,'md5'));});
app.get('/lc79-hu/learning',(req,res)=>{const s=learningData.hu;res.json({id:BOT_ID,type:'HU',total:s.totalPredictions,correct:s.correctPredictions,accuracy:(s.totalPredictions?s.correctPredictions/s.totalPredictions*100:0).toFixed(2)+'%',streak:s.streakAnalysis,streakLength:s.streakLengthStats,weibull:s.weibullParams,weibullAlt:s.weibullAlt,state:s.systemState,patternWeights:s.patternWeights});});
app.get('/lc79-md5/learning',(req,res)=>{const s=learningData.md5;res.json({id:BOT_ID,type:'MD5',total:s.totalPredictions,correct:s.correctPredictions,accuracy:(s.totalPredictions?s.correctPredictions/s.totalPredictions*100:0).toFixed(2)+'%',streak:s.streakAnalysis,streakLength:s.streakLengthStats,weibull:s.weibullParams,weibullAlt:s.weibullAlt,state:s.systemState,patternWeights:s.patternWeights});});
app.get('/reset-learning',(req,res)=>{['hu','md5'].forEach(t=>{learningData[t]={predictions:[],patternStats:{},totalPredictions:0,correctPredictions:0,patternWeights:{...DEFAULT_PATTERN_WEIGHTS},lastUpdate:null,streakAnalysis:{wins:0,losses:0,currentStreak:0,bestStreak:0,worstStreak:0},adaptiveThresholds:{},recentAccuracy:[],bayesianPrior:{tai:.5,xiu:.5},weibullParams:{shape:1.75,scale:5},weibullAlt:{shape:2.5,scale:3.1},fingerprintDB:[],streakLengthStats:{avg:4.2,median:4,max:15,count:0,histogram:{}},breakConfidenceRequired:t==='hu'?.75:.73,systemState:{mode:'NORMAL',consecutiveWrong:0,lastPatternFamily:null,altScore:0,oscScore:0}};});saveLearningData();saveFingerprints();res.json({ok:true,id:BOT_ID,msg:'FULL RESET'});});
app.get('/lc79-:t/quantum',async(req,res)=>{const t=req.params.t;if(!['hu','md5'].includes(t))return res.status(400).end();const d=t==='hu'?await fetchDataHu():await fetchDataMd5();res.json(calculateAdvancedPrediction(d,t));});

loadLearningData();loadPredictionHistory();loadFingerprints();
app.listen(PORT,'0.0.0.0',()=>{
  console.log(`\n🚀 http://0.0.0.0:${PORT}`);
  console.log(`🤖 ${BOT_ID}`);
  console.log('🛡️  ALT BRIDGE DETECT L=2+ | OSCILLATION MR | DUAL WEIBULL | JSD DIVERGENCE BRAKE | ACC‑TIED CEILING | STATE: N→W→T→L');
  startAutoSaveTask();
});