const $ = (id) => document.getElementById(id);
const state = { faq: [], knowledge: [], commands: [], history: [], lastUser: '', saveHistory: true };
const dangerWords = ['steal','phishing page','ddos','ransomware','обойти авторизацию','украсть','фишинговую страницу','взломать аккаунт','бекдор'];
const quick = ['Проверить безопасность сервера','Объяснить Linux-команду','Проанализировать логи','Что такое OWASP?','Как защитить SSH?','Как настроить firewall?','Признаки взлома','План реагирования на инцидент','Создать чек-лист безопасности'];
const modes = { mentor:'Наставник: объясняй пошагово и простым языком.', expert:'Эксперт: кратко, технически, по делу.', soc:'SOC: фокус на событиях, логах, гипотезах и доказательствах.', pentester:'Пентестер: только легальная методология и безопасные проверки.', admin:'Администратор: Linux, сети, серверы, эксплуатация.', ctf:'CTF: давай подсказки, не готовое решение.', paranoid:'Параноик: строго оценивай риски и hardening.' };

document.addEventListener('DOMContentLoaded', async () => {
  bindUi(); restorePrefs(); renderQuick(); restoreHistory(); await loadData();
  if (!state.history.length) addBot('Привет! Я CyberSec AI. Работаю локально по FAQ, базе знаний и справочнику команд; AI backend можно включить переключателем.', 'SYSTEM');
});
function bindUi(){
  $('chatForm').addEventListener('submit', onSubmit);
  $('messageInput').addEventListener('input', () => $('charCounter').textContent = `${$('messageInput').value.length} / 5000`);
  $('themeToggle').addEventListener('click', toggleTheme);
  $('historyToggle').addEventListener('change', e => { state.saveHistory = e.target.checked; localStorage.setItem('csaSaveHistory', state.saveHistory); });
  $('clearHistoryBtn').addEventListener('click', clearHistory);
  $('exportJsonBtn').addEventListener('click', () => download('cybersec-ai-history.json', JSON.stringify(state.history, null, 2)));
  $('exportTxtBtn').addEventListener('click', () => download('cybersec-ai-history.txt', state.history.map(m => `[${m.role}] ${m.text}`).join('\n\n')));
}
async function loadData(){
  try { [state.faq,state.knowledge,state.commands] = await Promise.all(['faq.json','knowledge.json','commands.json'].map(fetchJson)); setStatus('Локальная база готова','online'); }
  catch(e){ setStatus(`Ошибка базы: ${e.message}`,'error'); addBot('Не удалось загрузить один из JSON-файлов. Проверьте наличие и корректность faq.json, knowledge.json, commands.json.', 'ERROR'); }
}
async function fetchJson(url){ const r = await fetch(url); if(!r.ok) throw new Error(`${url}: ${r.status}`); try { return await r.json(); } catch { throw new Error(`${url}: повреждён JSON`); } }
function renderQuick(){ quick.forEach(text => { const b=document.createElement('button'); b.type='button'; b.textContent=text; b.onclick=()=>{$('messageInput').value=text; $('messageInput').focus();}; $('quickActions').append(b); }); }
async function onSubmit(e){
  e.preventDefault(); const text = $('messageInput').value.trim(); if(!text) return addBot('Пустое сообщение: опишите задачу, команду или логи.', 'VALIDATION');
  $('messageInput').value=''; $('charCounter').textContent='0 / 5000'; state.lastUser=text; addUser(text);
  if (dangerWords.some(w => text.toLowerCase().includes(w))) return addBot(safeRefusal(text), 'SAFETY');
  const mode = $('modeSelect').value;
  if ($('aiToggle').checked) { const ok = await askBackend(text, mode); if(ok) return; }
  const local = localAnswer(text, mode); addBot(local.answer, local.source);
}
async function askBackend(message, mode){
  setStatus('Запрос к AI backend...','online');
  try { const r = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,mode,context:state.history.slice(-6)})});
    const data = await r.json(); if(!r.ok) throw new Error(data.error || 'server error'); addBot(data.answer, data.source || 'AI'); setStatus('AI ответ получен','online'); return true;
  } catch(e){ setStatus('AI недоступен, fallback локально','error'); addBot(`AI backend недоступен (${e.message}). Использую локальный fallback.`, 'FALLBACK'); return false; }
}
function localAnswer(q, mode){
  const exact = state.faq.find(f => norm(f.question) === norm(q) || norm(q).includes(norm(f.question))); if(exact) return {source:'FAQ', answer:format(exact.answer, mode, 'FAQ')};
  const cmd = findCommand(q); if(cmd) return {source:'COMMANDS', answer:explainCommand(q, cmd)};
  if(looksLikeLog(q)) return {source:'LOG_ANALYZER', answer:analyzeLogs(q)};
  if(q.toLowerCase().includes('чек-лист') || q.toLowerCase().includes('checklist')) return {source:'CHECKLIST', answer:checklist(q)};
  const rag = bestDoc(q); if(rag) return {source:`База знаний: ${rag.doc.title} (${Math.round(rag.score*100)}%)`, answer:format(rag.doc.content, mode, rag.doc.title)};
  return {source:'LOCAL', answer:format('Я не нашёл точного совпадения. Уточните ОС, сервис, цель защиты, симптомы и что уже проверено. Для опасных операций используйте только лаборатории или системы с разрешением.', mode, 'локальный fallback')};
}
function words(s){ return norm(s).split(/[^a-zа-я0-9_.-]+/).filter(w=>w.length>2); } function norm(s){ return String(s).toLowerCase().replace(/ё/g,'е'); }
function bestDoc(q){ const qw = new Set(words(q)); let best=null; for(const d of state.knowledge){ const dw = words([d.title,d.category,d.content,(d.keywords||[]).join(' ')].join(' ')); const hit = dw.filter(w=>qw.has(w)).length; const score = hit / Math.max(4, qw.size); if(!best || score>best.score) best={doc:d,score}; } return best && best.score>0 ? best : null; }
function findCommand(q){ const first = q.trim().split(/\s+/)[0].toLowerCase(); return state.commands.find(c => c.name.toLowerCase()===first || q.toLowerCase().startsWith(c.syntax.split(' ')[0].toLowerCase())); }
function explainCommand(input, c){ const risky=/\b(rm|mkfs|dd|shutdown|reboot|chmod\s+777|curl.+\|\s*sh|Invoke-Expression|iex)\b/i.test(input); return `Команда: ${c.name}\nОС: ${c.os}\nНазначение: ${c.purpose}\nСинтаксис: ${c.syntax}\nПример: ${c.example}\nRoot/Admin: ${c.requiresRoot?'может потребоваться':'обычно не требуется'}\nРиск: ${risky?'повышенный: найдены потенциально опасные части':'обычно '+c.riskLevel}\nПредупреждение: ${c.warning}\nРазбор: команда не выполняется автоматически. Проверьте аргументы, цель и права. Безопасный вариант: начните с read-only команды или добавьте --help/просмотр статуса.`; }
function looksLikeLog(t){ return /(error|warn|failed|denied|sshd|nginx|apache|\b\d{1,3}(\.\d{1,3}){3}\b|\[\d{2}\/.+\])/i.test(t) && t.length>40; }
function analyzeLogs(t){ const ips=[...new Set(t.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)||[])]; const ports=[...new Set(t.match(/port\s+\d+|:\d{2,5}\b/gi)||[])]; const errs=(t.match(/error|failed|denied|warning|critical/gi)||[]).length; return `Тип логов: вероятно системные/web/auth логи.\nОшибки/предупреждения: ${errs}.\nIP: ${ips.slice(0,10).join(', ') || 'не найдены'}.\nПорты: ${ports.slice(0,10).join(', ') || 'не найдены'}.\nГипотезы: возможны ошибки конфигурации, перебор паролей, недоступность сервиса или штатные отказы. Без дополнительных доказательств атаку утверждать нельзя.\nПлан: сохраните исходные логи, уточните время, проверьте успешные входы, коррелируйте firewall/web/app логи, обновите правила и секреты при подтверждении компрометации.`; }
function checklist(q){ const items=['Инвентаризация активов и владельцев','Обновления ОС и приложений','MFA и уникальные пароли','Firewall: разрешены только нужные порты','SSH без root-login и по ключам','Журналирование и ротация логов','Резервные копии и тест восстановления','Мониторинг подозрительных входов','План реагирования и контакты','Проверка секретов вне репозитория']; return `Защитный чек-лист (${q}):\n`+items.map((x,i)=>`${i+1}. [ ] ${x}`).join('\n'); }
function format(text, mode, source){ return `${modes[mode]}\n\n${text}\n\nИсточник: ${source}.`; }
function safeRefusal(){ return 'Я не могу помогать с взломом, кражей, фишингом, DDoS, malware или обходом доступа. Могу помочь безопасно: разобрать риск, построить лабораторный CTF-сценарий, укрепить защиту, написать план реагирования или проверить конфигурацию своей системы.'; }
function addUser(text){ addMessage('user', text, 'USER'); }
function addBot(text, source){ addMessage('bot','',source,text); }
function addMessage(role, text, source, animateText, persist = true){ const wrap=document.createElement('article'); wrap.className=`message ${role}`; const meta=document.createElement('div'); meta.className='meta'; meta.textContent=`${role==='bot'?'CyberSec AI':'Вы'} • источник: ${source}`; const bubble=document.createElement('div'); bubble.className='bubble'; bubble.textContent=text; wrap.append(meta,bubble); if(role==='bot') addActions(wrap, bubble); $('chatMessages').append(wrap); $('chatMessages').scrollTop=$('chatMessages').scrollHeight; if(animateText) type(bubble, animateText); if (persist) { state.history.push({role,text:text||animateText,source,time:new Date().toISOString()}); saveHistory(); } }
function addActions(w,b){ const a=document.createElement('div'); a.className='message-actions'; ['👍','👎','Копировать','Повторить'].forEach(x=>{const btn=document.createElement('button'); btn.type='button'; btn.textContent=x; btn.onclick=()=> x==='Копировать'?navigator.clipboard.writeText(b.textContent): x==='Повторить'&&state.lastUser?($('messageInput').value=state.lastUser,onSubmit(new Event('submit'))):null; a.append(btn);}); w.append(a); }
function type(el, text){ el.textContent=''; el.classList.add('typing'); let i=0; const tick=()=>{ el.textContent=text.slice(0,i++); if(i<=text.length) setTimeout(tick, 8); else el.classList.remove('typing'); }; tick(); }
function saveHistory(){ if(!state.saveHistory) return; try{ localStorage.setItem('csaHistory', JSON.stringify(state.history.filter(m=>!/api[_-]?key|token|password|парол/i.test(m.text)))); }catch{ setStatus('Ошибка localStorage','error'); } }
function restoreHistory(){ state.saveHistory = localStorage.getItem('csaSaveHistory') !== 'false'; $('historyToggle').checked=state.saveHistory; try{ state.history=JSON.parse(localStorage.getItem('csaHistory')||'[]'); state.history.forEach(m=>addMessage(m.role,m.text,m.source, undefined, false)); }catch{ state.history=[]; } }
function clearHistory(){ state.history=[]; localStorage.removeItem('csaHistory'); $('chatMessages').textContent=''; }
function restorePrefs(){ const th=localStorage.getItem('csaTheme')||'dark'; document.documentElement.dataset.theme=th; $('themeToggle').textContent=th==='dark'?'🌙 Тёмная':'☀️ Светлая'; }
function toggleTheme(){ const n=document.documentElement.dataset.theme==='dark'?'light':'dark'; document.documentElement.dataset.theme=n; localStorage.setItem('csaTheme',n); restorePrefs(); }
function download(name, content){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:'text/plain'})); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
function setStatus(t, cls){ $('statusText').textContent=t; $('botStatus').className=`status-dot ${cls}`; }
