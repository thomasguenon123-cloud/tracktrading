'use strict';

// ════════════════════════════════════════════════════════════════════
// TrackTrading v2 — Sécurisé avec Supabase Auth + Whitelist
// ════════════════════════════════════════════════════════════════════

const SB_URL='https://luduuungdwybkntsnafw.supabase.co';
const SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1ZHV1dW5nZHd5YmtudHNuYWZ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MjkwNTIsImV4cCI6MjA5MTUwNTA1Mn0.xcEQTiOSQDHlT6siO9Ab2C6EAPG4rXup1e5aCtwFjlU';
const BUCKET='trade-files';
const sb=supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});

// V9.4 — Client ID unique pour cette session (anti-ping-pong realtime).
// Chaque écriture porte ce tag ; un event remote avec notre tag est ignoré.
const CLIENT_ID='c_'+Math.random().toString(36).slice(2,10)+Date.now().toString(36);

const USER_COLORS=['#f5a623','#00d68f','#ff4d6a','#4da6ff','#9b8cff','#e17055','#00cec9','#fd79a8'];
const CURRENCIES=[
  {code:'USD',name:'US Dollar',flag:'🇺🇸',cc:'us'},
  {code:'EUR',name:'Euro',flag:'🇪🇺',cc:'eu'},
  {code:'GBP',name:'British Pound',flag:'🇬🇧',cc:'gb'},
  {code:'CHF',name:'Swiss Franc',flag:'🇨🇭',cc:'ch'},
  {code:'CAD',name:'Canadian Dollar',flag:'🇨🇦',cc:'ca'},
  {code:'AUD',name:'Australian Dollar',flag:'🇦🇺',cc:'au'},
  {code:'NZD',name:'New Zealand Dollar',flag:'🇳🇿',cc:'nz'},
  {code:'JPY',name:'Japanese Yen',flag:'🇯🇵',cc:'jp'},
];
function flagImg(cc,sz=24){return `<img src="https://flagcdn.com/${sz}x${Math.round(sz*0.75)}/${cc}.png" alt="${cc}" style="border-radius:2px;vertical-align:middle;display:inline-block">`;}
const BIAS_CFG={
  bullish:      {label:'Haussier ▲',       color:'#00d68f'},
  sl_bullish:   {label:'Légèrement Haussier ▲', color:'#00a86b'},
  neutral:      {label:'Neutre —',          color:'#8892aa'},
  sl_bearish:   {label:'Légèrement Baissier ▼', color:'#cc2a42'},
  bearish:      {label:'Baissier ▼',        color:'#ff4d6a'},
};

// ─── Calendrier économique V8 : zones et périodes (depuis V7) ───
const CAL_ZONES = [
  {code:'ALL',  label:'All',  inv:''},
  {code:'USD',  label:'USD',  cc:'us', inv:'5'},
  {code:'EUR',  label:'EUR',  cc:'eu', inv:'72,17,10,4,55,8,11,42,71,32,12,22,9,89,49,7,53,5,43,38'},
  {code:'GBP',  label:'GBP',  cc:'gb', inv:'4'},
  {code:'JPY',  label:'JPY',  cc:'jp', inv:'35'},
  {code:'CAD',  label:'CAD',  cc:'ca', inv:'6'},
  {code:'CHF',  label:'CHF',  cc:'ch', inv:'12'},
  {code:'AUD',  label:'AUD',  cc:'au', inv:'25'},
  {code:'NZD',  label:'NZD',  cc:'nz', inv:'43'},
  {code:'XAU',  label:'XAU',  inv:''},
];
const CAL_PERIODS = [
  // V9.5 — descripteur exploité par buildCalIframeSrc :
  //  - kind 'today'      → timeFilter=timeRemain (aujourd'hui)
  //  - kind 'thisWeek'   → timeFilter=customDate&dateFrom=lundi&dateTo=dimanche (semaine courante)
  //  - kind 'nextWeek'   → idem, semaine suivante
  {key:'today',    label:'Aujourd\'hui',       kind:'today'},
  {key:'week',     label:'Cette semaine',      kind:'thisWeek'},
  {key:'nextWeek', label:'Semaine prochaine',  kind:'nextWeek'},
];
let S_calZone   = 'ALL';
let S_calPeriod = 'week';
let S_calBuilt  = false;


const S = {
  authUser: null,          // {id, email} depuis Supabase Auth
  appUser: null,           // profil interne public.users
  workspaceId: null,       // V8 : workspace d'APPARTENANCE (immuable)
  workspace: null,         // V8 : objet workspace d'appartenance {id, name, is_shared}
  currentWorkspaceId: null, // V9b : workspace ACTIF (vue courante, volatil)
  currentWorkspace: null,   // V9b : objet workspace actif
  availableWorkspaces: [],  // V9b : liste pour le sélecteur admin
  lastWorkspaceError: null, // V9 : message de la dernière erreur de chargement workspace
  isSuperAdmin: false,
  accId: 'all',
  accounts: [], users: [], trades: [], filtered: [],
  pendingUps: [], existingImgs: [], editId: null,
  chartBal: null, chartRR: null,
  balTF: 'Y', customFrom: null, customTo: null,
  confirmCb: null,
  appReady: false,
  pasteTargetCode: null, pasteTargetType: null,  // V7 paste handler
};

// ════════════════════════════════════════════════════════════════════
// v=5 — DÉMARRAGE RAPIDE : bibliothèques à la demande, liens groupés, écran d'attente
// ════════════════════════════════════════════════════════════════════

// Chart.js ne sert qu'au tableau de bord et à la section Macro : index.html ne le
// charge plus (l'écran de connexion s'affiche sans lui). Il se télécharge à la
// première utilisation, une seule fois, avec son empreinte SRI (vendor/empreintes.json).
const BIBLIOS={
  chart:{src:'vendor/chartjs-4.4.1/chart.umd.js',integrity:'sha384-dug+JxfBvklEQdJ4AYuBBAIScUz0bVN73xpy273gcAwHjb3qI0fXmuYNaNfdyYJG',pret:()=>typeof Chart!=='undefined'},
};
const _biblioEnCours={};
function chargerBiblio(nom){
  const b=BIBLIOS[nom];
  if(!b)return Promise.reject(new Error('Bibliothèque inconnue : '+nom));
  if(b.pret())return Promise.resolve();
  if(!_biblioEnCours[nom])_biblioEnCours[nom]=new Promise((ok,ko)=>{
    const s=document.createElement('script');
    s.src=b.src;s.integrity=b.integrity;s.async=true; // fichier modifié = refusé
    s.onload=()=>ok();
    s.onerror=()=>{delete _biblioEnCours[nom];ko(new Error('Échec de chargement : '+b.src));};
    document.head.appendChild(s);
  });
  return _biblioEnCours[nom];
}
// Un graphique attend Chart.js : s'il n'est pas encore là, on le charge puis on
// relance le dessin (une seule fois par fonction, même si on l'a demandé
// plusieurs fois entre-temps). Un échec se dit en phrase, pas en chemin de fichier.
const _relancesGraphes=new Set();
function grapheDisponible(relancer){
  if(typeof Chart!=='undefined')return true;
  const premier=!_relancesGraphes.size;
  _relancesGraphes.add(relancer);
  if(premier)chargerBiblio('chart').then(()=>{
    const r=[..._relancesGraphes];_relancesGraphes.clear();r.forEach(f=>f());
  },()=>{
    _relancesGraphes.clear();
    toast('Graphiques indisponibles — vérifie ta connexion puis recharge la page','err');
  });
  return false;
}

// Liens signés de plusieurs fichiers en UNE requête (avant : un aller-retour par
// image). Rend { chemin: url } ; un chemin en échec est simplement absent.
async function signerChemins(chemins,duree=3600){
  const uniques=[...new Set((chemins||[]).filter(Boolean))];
  if(!uniques.length)return {};
  try{
    const{data,error}=await sb.storage.from(BUCKET).createSignedUrls(uniques,duree);
    if(error||!Array.isArray(data))return {};
    const liens={};
    data.forEach(d=>{if(d&&d.path&&d.signedUrl&&!d.error)liens[d.path]=d.signedUrl;});
    return liens;
  }catch(_){return {};}
}

// Écran « Chargement de ton espace… » affiché à la place du formulaire tant
// qu'une session se charge : plus de formulaire de connexion qui clignote pour
// quelqu'un de déjà connecté. index.html pose html.demarrage AVANT le premier
// affichage si une session est mémorisée ; le démarrage le retire toujours
// (app prête, pas de session, ou échec → retour au formulaire).
function afficherChargement(oui){document.documentElement.classList.toggle('demarrage',!!oui);}

// ════════════════════════════════════════════════════════════════════
// AUTH MODULE
// ════════════════════════════════════════════════════════════════════

function showAuthForm(name){
  document.querySelectorAll('.auth-form').forEach(f=>f.classList.remove('active'));
  document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
  const form=document.getElementById('auth-'+name);
  if(form)form.classList.add('active');
  const tab=document.querySelector(`.auth-tab[data-tab="${name}"]`);
  if(tab)tab.classList.add('active');
  // clear messages
  document.querySelectorAll('.auth-msg').forEach(m=>m.classList.remove('visible'));
}

function showAuthMsg(formId,type,text){
  const el=document.getElementById(formId+'-msg');
  if(!el)return;
  el.className='auth-msg visible '+type;
  el.textContent=text;
}

function translateAuthError(err){
  const msg=(err?.message||err||'').toString();
  if(msg.includes('Invalid login credentials'))return 'Email ou mot de passe incorrect.';
  if(msg.includes('Email not confirmed'))return 'Email non confirmé.';
  if(msg.includes('User already registered'))return 'Cet email est déjà inscrit. Connecte-toi.';
  if(msg.includes('Password should be at least'))return 'Mot de passe trop court (8 caractères minimum).';
  if(msg.includes('not allowed to sign up'))return 'Cet email n\'est pas autorisé. Contacte l\'administrateur.';
  if(msg.includes('Database error saving new user'))return 'Cet email n\'est pas autorisé. Contacte l\'administrateur.';
  if(msg.includes('rate limit'))return 'Trop de tentatives, réessaie dans quelques minutes.';
  if(msg.includes('Network'))return 'Problème de connexion réseau.';
  return msg||'Erreur inconnue.';
}

function passwordStrength(pwd){
  if(!pwd||pwd.length<8)return 0;
  let s=0;
  if(pwd.length>=8)s++;
  if(pwd.length>=12)s++;
  if(/[A-Z]/.test(pwd)&&/[a-z]/.test(pwd))s++;
  if(/[0-9]/.test(pwd))s++;
  if(/[^A-Za-z0-9]/.test(pwd))s++;
  return Math.min(s,4);
}

function setStrengthBar(barId,strength){
  const bar=document.getElementById(barId);if(!bar)return;
  bar.className='auth-strength-bar';
  if(strength===1)bar.classList.add('weak');
  else if(strength===2)bar.classList.add('medium');
  else if(strength===3)bar.classList.add('strong');
  else if(strength>=4)bar.classList.add('excellent');
}

async function doLogin(){
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  const password=document.getElementById('login-password').value;
  if(!email||!password){showAuthMsg('login','error','Renseigne email et mot de passe.');return;}
  const btn=document.getElementById('btn-login');btn.disabled=true;
  document.getElementById('login-label').innerHTML='<span class="auth-spin"></span> Connexion…';
  try{
    const{data,error}=await sb.auth.signInWithPassword({email,password});
    if(error)throw error;
    showAuthMsg('login','success','Connexion réussie !');
    afficherChargement(true);
    await postLogin();
  }catch(e){
    afficherChargement(false);
    showAuthMsg('login','error',translateAuthError(e));
  }finally{
    btn.disabled=false;
    document.getElementById('login-label').textContent='Connexion';
  }
}

async function doSignup(){
  const email=document.getElementById('signup-email').value.trim().toLowerCase();
  const password=document.getElementById('signup-password').value;
  const passwordC=document.getElementById('signup-password-c').value;
  if(!email||!password){showAuthMsg('signup','error','Email et mot de passe requis.');return;}
  if(password.length<8){showAuthMsg('signup','error','Mot de passe trop court (8 min).');return;}
  if(password!==passwordC){showAuthMsg('signup','error','Les mots de passe ne correspondent pas.');return;}
  const btn=document.getElementById('btn-signup');btn.disabled=true;
  document.getElementById('signup-label').innerHTML='<span class="auth-spin"></span> Création…';
  try{
    const{data,error}=await sb.auth.signUp({email,password});
    if(error)throw error;
    if(data.user&&data.session){
      showAuthMsg('signup','success','Compte créé ! Bienvenue.');
      afficherChargement(true);
      await postLogin();
    }else{
      // Some configs send a confirmation email, but our trigger auto-confirms
      // If session is null but no error, retry sign-in
      const{data:sd,error:se}=await sb.auth.signInWithPassword({email,password});
      if(se)throw se;
      showAuthMsg('signup','success','Compte créé ! Connexion…');
      afficherChargement(true);
      await postLogin();
    }
  }catch(e){
    afficherChargement(false);
    showAuthMsg('signup','error',translateAuthError(e));
  }finally{
    btn.disabled=false;
    document.getElementById('signup-label').textContent='Créer mon compte';
  }
}

async function doForgot(){
  const email=document.getElementById('forgot-email').value.trim().toLowerCase();
  if(!email){showAuthMsg('forgot','error','Email requis.');return;}
  const btn=document.getElementById('btn-forgot');btn.disabled=true;
  document.getElementById('forgot-label').innerHTML='<span class="auth-spin"></span> Envoi…';
  try{
    const{error}=await sb.auth.resetPasswordForEmail(email,{
      redirectTo:window.location.origin+window.location.pathname,
    });
    if(error)throw error;
    showAuthMsg('forgot','success','Si cet email est autorisé, un lien va t\'être envoyé.');
  }catch(e){
    showAuthMsg('forgot','error',translateAuthError(e));
  }finally{
    btn.disabled=false;
    document.getElementById('forgot-label').textContent='Envoyer le lien';
  }
}

async function doRecovery(){
  const password=document.getElementById('recovery-password').value;
  const passwordC=document.getElementById('recovery-password-c').value;
  if(password.length<8){showAuthMsg('recovery','error','Mot de passe trop court (8 min).');return;}
  if(password!==passwordC){showAuthMsg('recovery','error','Les mots de passe ne correspondent pas.');return;}
  const btn=document.getElementById('btn-recovery');btn.disabled=true;
  document.getElementById('recovery-label').innerHTML='<span class="auth-spin"></span> Mise à jour…';
  try{
    const{error}=await sb.auth.updateUser({password});
    if(error)throw error;
    showAuthMsg('recovery','success','Mot de passe mis à jour ! Connexion…');
    afficherChargement(true);
    await postLogin();
  }catch(e){
    afficherChargement(false);
    showAuthMsg('recovery','error',translateAuthError(e));
  }finally{
    btn.disabled=false;
    document.getElementById('recovery-label').textContent='Mettre à jour';
  }
}

async function logout(){
  closeUserMenu();
  await sb.auth.signOut();
  location.reload();
}

async function postLogin() {
  // v=5 : Chart.js (tableau de bord) se télécharge pendant que les données
  // arrivent, sans rien bloquer ; les graphiques l'attendent s'il le faut.
  chargerBiblio('chart').catch(() => {});
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { afficherChargement(false); return; }
  S.authUser = { id: user.id, email: user.email };
  S.isSuperAdmin = (user.app_metadata?.role === 'super_admin');

  // V8 : affichage section Admin uniquement pour super_admin
  if (S.isSuperAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('visible'));
    document.querySelectorAll('.admin-only-action').forEach(el => el.style.display = 'inline-flex');
  }

  // Email affiché dans le menu utilisateur
  const um = document.getElementById('um-email');
  if (um) um.textContent = S.authUser.email;

  // v=5 — UNE vague au lieu de quatre allers-retours en file : workspace courant
  // (essentiel pour le filtrage RLS), thème, migration V8 et, pour l'admin, la
  // liste des workspaces. Aucune de ces lectures n'attend le résultat d'une autre.
  await Promise.all([
    loadCurrentWorkspace(),
    applyUserTheme(),
    migrateLocalStorageToSupabase(),
    loadAvailableWorkspaces(),
  ]);
  if (!S.workspaceId) {
    afficherChargement(false);
    const reason = S.lastWorkspaceError
      ? ' (détail : ' + S.lastWorkspaceError + ')'
      : '';
    showAuthMsg('login', 'err', 'Aucun workspace assigné à votre compte. Contacte l\'administrateur' + reason + '.');
    await sb.auth.signOut();
    return;
  }
  // Le workspace d'appartenance n'est connu qu'après la vague : le non-admin (ou
  // l'admin dont la liste a échoué) y retrouve son seul workspace, comme avant.
  if (!S.availableWorkspaces.length && S.workspace) S.availableWorkspaces = [S.workspace];

  // V9b : afficher le badge workspace dans le header
  updateWorkspaceBadge();
  // Le clic sur le badge ramène au workspace d'appartenance (super-admin uniquement)
  const wsBadgeEl = document.getElementById('workspace-badge');
  if (wsBadgeEl && S.isSuperAdmin) {
    wsBadgeEl.style.cursor = 'pointer';
    wsBadgeEl.addEventListener('click', onWorkspaceBadgeClick);
  }

  // Bascule de l'écran auth vers l'app (thème V8 et migration déjà faits dans la vague)
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-wrap').classList.add('ready');
  afficherChargement(false);

  await initApp();
}

function bindAuthUI(){
  document.querySelectorAll('.auth-tab').forEach(t=>{
    t.addEventListener('click',()=>showAuthForm(t.dataset.tab));
  });
  document.getElementById('link-forgot').addEventListener('click',()=>showAuthForm('forgot'));
  document.getElementById('link-back-login').addEventListener('click',()=>showAuthForm('login'));
  document.getElementById('btn-login').addEventListener('click',doLogin);
  document.getElementById('btn-signup').addEventListener('click',doSignup);
  document.getElementById('btn-forgot').addEventListener('click',doForgot);
  document.getElementById('btn-recovery').addEventListener('click',doRecovery);
  document.getElementById('signup-password').addEventListener('input',function(){
    const s=passwordStrength(this.value);
    document.getElementById('signup-strength').classList.toggle('visible',this.value.length>0);
    setStrengthBar('signup-strength-bar',s);
  });
  document.getElementById('recovery-password').addEventListener('input',function(){
    setStrengthBar('recovery-strength-bar',passwordStrength(this.value));
  });
  // Enter key submits the active form
  ['login-password','signup-password-c','forgot-email','recovery-password-c'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.addEventListener('keydown',e=>{
      if(e.key==='Enter'){
        e.preventDefault();
        const formActive=document.querySelector('.auth-form.active');
        if(!formActive)return;
        const fid=formActive.id.replace('auth-','');
        if(fid==='login')doLogin();
        else if(fid==='signup')doSignup();
        else if(fid==='forgot')doForgot();
        else if(fid==='recovery')doRecovery();
      }
    });
  });
}

// Detect recovery flow via URL hash
function detectRecoveryFlow(){
  const hash=window.location.hash||'';
  if(hash.includes('type=recovery')||hash.includes('access_token')){
    showAuthForm('recovery');
  }
}

// ════════════════════════════════════════════════════════════════════
// AUTH BOOT — runs immediately
// ════════════════════════════════════════════════════════════════════
(async function bootAuth(){
  bindAuthUI();
  detectRecoveryFlow();
  // Check existing session
  const{data:{session}}=await sb.auth.getSession();
  if(session&&!window.location.hash.includes('type=recovery')){
    // v=5 : « Chargement de ton espace… » reste affiché pendant le chargement ;
    // un échec ramène au formulaire (jamais d'écran d'attente figé).
    try{await postLogin();}
    catch(e){console.error('Démarrage interrompu :',e);}
    finally{if(!document.getElementById('app-wrap').classList.contains('ready'))afficherChargement(false);}
  }else{
    afficherChargement(false);
  }
  // Listen for auth events
  sb.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){
      document.getElementById('auth-screen').classList.remove('hidden');
      document.getElementById('app-wrap').classList.remove('ready');
      showAuthForm('recovery');
    }
    if(event==='SIGNED_OUT'){
      location.reload();
    }
  });
})();


// ════════════════════════════════════════════════════════════════════
// APP MODULE — runs after successful auth
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// V9 — WORKSPACE : chargement robuste sans join PostgREST circulaire
// ════════════════════════════════════════════════════════════════════
// Note V9 :
//  - Le join `.select('workspace_id, workspaces(...)')` de V8 causait un
//    échec silencieux à cause de l'évaluation RLS circulaire entre
//    allowed_emails et workspaces (is_in_my_workspace → current_workspace_id
//    → allowed_emails). On split en 2 requêtes indépendantes.
//  - On garde la dernière erreur dans S.lastWorkspaceError pour debug UI.
//  - Un retry léger (1 fois après 500ms) couvre les cas de latence ou de
//    session JWT pas encore propagée juste après le signup.
// ════════════════════════════════════════════════════════════════════

async function loadCurrentWorkspace() {
  S.lastWorkspaceError = null;

  async function attempt() {
    // Étape 1 : récupérer uniquement workspace_id depuis allowed_emails
    const { data: ae, error: aeErr } = await sb
      .from('allowed_emails')
      .select('workspace_id')
      .eq('email', S.authUser.email.toLowerCase())
      .maybeSingle();
    if (aeErr) throw new Error('allowed_emails: ' + (aeErr.message || aeErr.code || 'unknown'));
    if (!ae) throw new Error('Aucune entrée dans la whitelist pour ' + S.authUser.email);
    if (!ae.workspace_id) throw new Error('Whitelist trouvée mais workspace_id NULL');

    // Étape 2 : charger les détails du workspace séparément
    // (la RLS de workspaces inclut is_super_admin() OR membership → fiable)
    const { data: ws, error: wsErr } = await sb
      .from('workspaces')
      .select('id, name, is_shared')
      .eq('id', ae.workspace_id)
      .maybeSingle();
    if (wsErr) throw new Error('workspaces: ' + (wsErr.message || wsErr.code || 'unknown'));
    if (!ws) throw new Error('Workspace ' + ae.workspace_id + ' introuvable (RLS bloquante ?)');

    return { workspaceId: ae.workspace_id, workspace: ws };
  }

  // Essai 1
  try {
    const r = await attempt();
    S.workspaceId = r.workspaceId;
    S.workspace = r.workspace;
    // V9b : la vue active démarre par défaut sur le workspace d'appartenance
    S.currentWorkspaceId = r.workspaceId;
    S.currentWorkspace = r.workspace;
    return;
  } catch (e1) {
    console.warn('loadCurrentWorkspace attempt 1 failed:', e1.message);
    S.lastWorkspaceError = e1.message;
  }

  // Essai 2 après 500ms (couvre la propagation JWT post-signup)
  await new Promise(r => setTimeout(r, 500));
  try {
    const r = await attempt();
    S.workspaceId = r.workspaceId;
    S.workspace = r.workspace;
    S.currentWorkspaceId = r.workspaceId;
    S.currentWorkspace = r.workspace;
    S.lastWorkspaceError = null;
    return;
  } catch (e2) {
    console.error('loadCurrentWorkspace attempt 2 failed:', e2.message);
    S.lastWorkspaceError = e2.message;
  }
}

// ════════════════════════════════════════════════════════════════════
// V8 — THEME : gestion via Supabase user_preferences (migration localStorage)
// ════════════════════════════════════════════════════════════════════

async function applyUserTheme() {
  let theme = 'dark';
  try {
    const { data } = await sb.from('user_preferences')
      .select('theme')
      .eq('auth_user_id', S.authUser.id)
      .maybeSingle();
    if (data?.theme) {
      theme = data.theme;
    } else {
      // Migration : on lit le localStorage et on l'écrit en DB (one-shot)
      const local = localStorage.getItem('tt_theme');
      if (local === 'light' || local === 'dark') {
        theme = local;
        await sb.from('user_preferences')
          .upsert({ auth_user_id: S.authUser.id, theme }, { onConflict: 'auth_user_id' });
      }
    }
  } catch (e) {
    console.warn('applyUserTheme failed, fallback dark:', e);
  }
  document.documentElement.setAttribute('data-theme', theme);
  const tBtn = document.getElementById('theme-btn');
  if (tBtn) tBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  // Nettoyage : on supprime la clé localStorage maintenant qu'on est en DB
  localStorage.removeItem('tt_theme');
}

async function toggleUserTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  const tBtn = document.getElementById('theme-btn');
  if (tBtn) tBtn.textContent = next === 'dark' ? '☀️' : '🌙';
  if (typeof updateChartColors === 'function') updateChartColors();
  try {
    await sb.from('user_preferences')
      .upsert({ auth_user_id: S.authUser.id, theme: next }, { onConflict: 'auth_user_id' });
  } catch (e) {
    console.warn('saveUserTheme failed:', e);
  }
}

// ─── PLEIN ÉCRAN (V9.1) ───
function toggleFullscreen(){
  const btn=document.getElementById('fullscreen-btn');
  if(!document.fullscreenElement){
    (document.documentElement.requestFullscreen?.()||Promise.reject())
      .then(()=>{if(btn)btn.title='Quitter le plein écran (Échap)';})
      .catch(()=>toast('Plein écran indisponible','err'));
  }else{
    document.exitFullscreen?.().then(()=>{
      if(btn)btn.title='Plein écran (F11)';
    });
  }
}
document.addEventListener('fullscreenchange',()=>{
  const btn=document.getElementById('fullscreen-btn');
  if(!btn)return;
  if(document.fullscreenElement){btn.style.color='var(--amber)';btn.title='Quitter le plein écran (Échap)';}
  else{btn.style.color='';btn.title='Plein écran (F11)';}
});

// ════════════════════════════════════════════════════════════════════
// V8 — MIGRATION ONE-SHOT : nettoyage localStorage legacy
// ════════════════════════════════════════════════════════════════════

async function migrateLocalStorageToSupabase() {
  try {
    const { data: prefs } = await sb.from('user_preferences')
      .select('extra')
      .eq('auth_user_id', S.authUser.id)
      .maybeSingle();
    if (prefs?.extra?.migrated_v8 === true) {
      localStorage.removeItem('tt_uid');
      localStorage.removeItem('tt_symbols');
      return;
    }
    await sb.from('user_preferences')
      .upsert({
        auth_user_id: S.authUser.id,
        extra: { ...(prefs?.extra || {}), migrated_v8: true, migrated_at: new Date().toISOString() }
      }, { onConflict: 'auth_user_id' });
    localStorage.removeItem('tt_uid');
    localStorage.removeItem('tt_symbols');
    console.info('[migration V8] OK');
  } catch (e) {
    console.warn('[migration V8] échec (non bloquant) :', e);
  }
}

// ════════════════════════════════════════════════════════════════════
// V8 — ADMIN : gestion du workspace picker (radio + select)
// ════════════════════════════════════════════════════════════════════

async function loadAdminWorkspaces() {
  if (!S.isSuperAdmin) return;
  try {
    const { data, error } = await sb.rpc('admin_list_workspaces');
    if (error) throw error;
    const sel = document.getElementById('admin-workspace-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— sélectionner —</option>';
    (data || []).forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      const tag = w.is_shared ? '👥 partagé' : '🔒 perso';
      opt.textContent = `${w.name} · ${tag} · ${w.member_count} membre(s) · ${w.trade_count} trade(s)`;
      sel.appendChild(opt);
    });
  } catch (e) {
    toast('Erreur chargement workspaces : ' + (e.message || ''), 'err');
  }
}

function onWorkspaceChoiceChange() {
  const isExisting = document.getElementById('ws-existing').checked;
  const sel = document.getElementById('admin-workspace-select');
  if (sel) sel.disabled = !isExisting;
}


async function initApp() {
  if (S.appReady) return;

  // V8 : binding du bouton de bascule de thème (utilise user_preferences DB)
  const tBtn = document.getElementById('theme-btn');
  if (tBtn) tBtn.addEventListener('click', toggleUserTheme);

  // Binding de la navigation : Dashboard / Rapports / Journal / Calendrier / Admin
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      // v=5 : sur téléphone, la barre d'onglets défile ; l'onglet choisi reste visible
      tab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
      document.getElementById('sec-' + tab.dataset.s).classList.add('active');
      if (tab.dataset.s === 'currency') loadCurrencyReport();
      if (tab.dataset.s === 'calendar') loadCalendar();
      if (tab.dataset.s === 'macro') loadMacro();
      if (tab.dataset.s === 'admin' && S.isSuperAdmin) { loadAdminUsers(); loadAdminWorkspaces(); }
    });
  });

  // Gestionnaire global de paste (capture clipboard pour le modal Trade)
  document.addEventListener('paste', handleGlobalPaste);

  // Fermeture du menu utilisateur au clic à l'extérieur
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('user-menu');
    const btn = document.getElementById('user-btn');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.classList.remove('open');
    }
  });

  // v=5 — Le squelette (barres de mois, sélecteurs, séparateurs) se construit tout
  // de suite : il ne dépend d'aucune donnée.
  buildRptMonthBar();
  buildDashYearPick();
  const now = new Date();
  S_dashMonths.add(now.getFullYear() + '-' + now.getMonth());
  buildDashMonthBtns();

  // V9.7 — Init des splitters draggables du dashboard
  initDashSplitters();
  initChartResize();

  // v=5 — UNE vague (filtrage automatique via RLS workspace) : traders, comptes,
  // profil interne (via auth_user_id) et trades partent ensemble. Avant : trois
  // vagues, les trades attendaient le profil, qui attendait traders et comptes.
  const [, , pu] = await Promise.all([loadUsers(), loadAccounts(), lireProfil(), loadTrades()]);
  if (pu) {
    S.appUser = pu;
    const dot = document.getElementById('udot');
    if (dot) { dot.style.background = pu.color; dot.textContent = (pu.name || '?')[0].toUpperCase(); }
    const un = document.getElementById('uname');
    if (un) un.textContent = (pu.name || 'PROFIL').toUpperCase();
  } else {
    // Fallback : email
    const initial = (S.authUser.email || '?')[0].toUpperCase();
    const dot = document.getElementById('udot');
    if (dot) { dot.textContent = initial; dot.style.background = '#5aadff'; }
    const un = document.getElementById('uname');
    if (un) un.textContent = S.authUser.email.split('@')[0].toUpperCase();
  }

  // Premier rendu : filtre par mois courant
  if (S_dashMonths.size > 0) {
    applyDashFilter();
  } else {
    renderStats();
    await renderCharts();
  }
  renderMonthly();
  renderJournal();
  S.appReady = true;
}

function getCSSVar(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}

function updateChartColors(){
  if(S.chartBal){
    S.chartBal.data.datasets[0].borderColor=getCSSVar('--chart-line');
    S.chartBal.data.datasets[0].backgroundColor=getCSSVar('--chart-fill');
    ['x','y'].forEach(a=>{S.chartBal.options.scales[a].grid.color=getCSSVar('--chart-grid');S.chartBal.options.scales[a].ticks.color=getCSSVar('--chart-tick');});
    S.chartBal.update();
  }
  if(S.chartRR){
    const m=buildMonthlyRR();
    S.chartRR.data.datasets[0].backgroundColor=m.map(x=>x.rr>=0?getCSSVar('--chart-bar-p'):getCSSVar('--chart-bar-n'));
    ['x','y'].forEach(a=>{S.chartRR.options.scales[a].grid.color=getCSSVar('--chart-grid');S.chartRR.options.scales[a].ticks.color=getCSSVar('--chart-tick');});
    S.chartRR.update();
  }
}

function toggleUserMenu(e){
  if(e)e.stopPropagation();
  document.getElementById('user-menu').classList.toggle('open');
}
function closeUserMenu(){document.getElementById('user-menu').classList.remove('open');}

// ─── DATA LOADERS (V9b : filtrés par S.currentWorkspaceId pour la vue active) ───
async function loadUsers(){
  let q = sb.from('users').select('*').order('name');
  if (S.currentWorkspaceId) q = q.eq('workspace_id', S.currentWorkspaceId);
  const{data}=await q;
  S.users=data||[];
  const sel=document.getElementById('f-usr');
  if(sel)sel.innerHTML='<option value="">Tous traders</option>'+S.users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
}
async function loadAccounts(){
  let q = sb.from('accounts').select('*').eq('is_active',true).order('name');
  if (S.currentWorkspaceId) q = q.eq('workspace_id', S.currentWorkspaceId);
  const{data}=await q;
  S.accounts=data||[];
}
async function loadTrades(){
  let q=sb.from('trades').select('*,users(name,color),accounts(name,type,currency,balance,risk_percent)').order('trade_date',{ascending:false}).order('created_at',{ascending:false});
  if (S.currentWorkspaceId) q = q.eq('workspace_id', S.currentWorkspaceId);
  if(S.accId!=='all')q=q.eq('account_id',S.accId);
  const{data}=await q;S.trades=data||[];S.filtered=[...S.trades];
}
// Profil interne de la personne connectée (public.users, via auth_user_id).
async function lireProfil(){
  const{data}=await sb.from('users').select('*').eq('auth_user_id',S.authUser.id).maybeSingle();
  return data;
}
async function loadTradeImages(id){const{data}=await sb.from('trade_images').select('*').eq('trade_id',id);return data||[];}

// ═══════════════════════════════════════════════════════════════════
// V9b — Sélecteur de workspace (admin uniquement)
// ═══════════════════════════════════════════════════════════════════
// Permet à l'admin de basculer la vue entre différents workspaces.
// Volatil (Option 1b) : à chaque login, on repart sur le workspace 
// d'appartenance. Filtre les lectures (Option 2a), pas les écritures
// (les nouveaux trades vont toujours dans le workspace d'appartenance 
// grâce au trigger DB set_workspace_id_default).
// ═══════════════════════════════════════════════════════════════════

async function loadAvailableWorkspaces() {
  if (!S.isSuperAdmin) {
    S.availableWorkspaces = S.workspace ? [S.workspace] : [];
    return;
  }
  try {
    const { data, error } = await sb.from('workspaces').select('id, name, is_shared').order('name');
    if (error) throw error;
    S.availableWorkspaces = data || [];
  } catch (e) {
    console.error('loadAvailableWorkspaces failed:', e);
    S.availableWorkspaces = S.workspace ? [S.workspace] : [];
  }
}

async function switchCurrentWorkspace(newWorkspaceId) {
  if (!newWorkspaceId || newWorkspaceId === S.currentWorkspaceId) return;
  // Le non-admin n'a pas le droit de switcher
  if (!S.isSuperAdmin && newWorkspaceId !== S.workspaceId) {
    toast('Action réservée à l\'administrateur', 'err');
    return;
  }
  const target = S.availableWorkspaces.find(w => w.id === newWorkspaceId);
  if (!target) { toast('Workspace introuvable', 'err'); return; }

  // MAJ état
  S.currentWorkspaceId = newWorkspaceId;
  S.currentWorkspace = target;
  S.accId = 'all'; // reset filter compte (les comptes vont changer)

  // Recharger les données filtrées
  toast('Chargement de ' + target.name + '…', 'ok');
  try {
    await Promise.all([loadUsers(), loadAccounts()]);
    await loadTrades();
    // Re-render (réutilise applyDashFilter qui couvre stats + charts + monthly + journal)
    applyDashFilter();
    updateWorkspaceBadge();
    updateWorkspaceBanner();
    // Refresh sélecteur dans admin
    const sel = document.getElementById('admin-ws-selector');
    if (sel) sel.value = newWorkspaceId;
    toast('Vue : ' + target.name + ' ✅', 'ok');
  } catch (e) {
    console.error('switchCurrentWorkspace failed:', e);
    toast('Erreur lors du changement de workspace', 'err');
  }
}

function updateWorkspaceBadge() {
  const wsBadge = document.getElementById('workspace-badge');
  const wsIcon  = document.getElementById('ws-icon');
  const wsName  = document.getElementById('ws-name');
  if (!wsBadge || !S.currentWorkspace) return;

  wsBadge.style.display = 'inline-flex';
  const isViewing = S.currentWorkspaceId !== S.workspaceId;
  wsBadge.classList.toggle('shared', !!S.currentWorkspace.is_shared);
  wsBadge.classList.toggle('perso',  !S.currentWorkspace.is_shared);
  wsBadge.classList.toggle('viewing', isViewing); // visuel "consultation"
  if (wsIcon) wsIcon.textContent = isViewing ? '👁' : (S.currentWorkspace.is_shared ? '👥' : '🔒');
  if (wsName) wsName.textContent = S.currentWorkspace.name + (isViewing ? ' (vue)' : '');

  // Tooltip explicatif
  if (isViewing) {
    wsBadge.title = 'Tu consultes : ' + S.currentWorkspace.name +
      '\nTon workspace d\'appartenance : ' + (S.workspace ? S.workspace.name : '?') +
      '\nLes nouveaux trades que tu crées iront dans ton workspace d\'appartenance.' +
      (S.isSuperAdmin ? '\n\nClique pour revenir à ton workspace.' : '');
  } else {
    wsBadge.title = S.isSuperAdmin
      ? 'Workspace courant : ' + S.currentWorkspace.name + ' (en tant qu\'admin, tu peux changer de vue via l\'onglet Admin)'
      : 'Workspace courant : ' + S.currentWorkspace.name;
  }
}

// Permet au super-admin de revenir rapidement à son workspace d'appartenance via clic sur le badge
function onWorkspaceBadgeClick() {
  if (!S.isSuperAdmin) return;
  if (S.currentWorkspaceId === S.workspaceId) return;
  switchCurrentWorkspace(S.workspaceId);
}

// V9b : Bannière contextuelle pour suggérer un changement de vue
let _wsBannerDismissed = false;

function updateWorkspaceBanner() {
  const banner = document.getElementById('ws-context-banner');
  const msg = document.getElementById('ws-context-msg');
  const actions = document.getElementById('ws-context-actions');
  if (!banner || !msg || !actions) return;
  if (_wsBannerDismissed) { banner.style.display = 'none'; return; }

  // Cas 1 : on est en mode "vue" différente du workspace d'appartenance
  if (S.currentWorkspaceId !== S.workspaceId) {
    banner.style.display = 'block';
    msg.innerHTML = '<b>Mode consultation</b> — Tu visualises ' +
      '<b style="color:var(--blue)">' + esc(S.currentWorkspace?.name || '?') + '</b>' +
      '. Tes nouveaux trades iront dans ton workspace d\'appartenance (' +
      esc(S.workspace?.name || '?') + ').';
    actions.innerHTML = '<button type="button" class="btn btn-amber btn-sm" onclick="switchCurrentWorkspace(\'' +
      esc(S.workspaceId) + '\')">⟲ Revenir à mon workspace</button>';
    return;
  }

  // Cas 2 : workspace d'appartenance vide ET on a d'autres workspaces disponibles (admin)
  const isEmpty = S.trades.length === 0 && S.accounts.length === 0;
  const otherWs = (S.availableWorkspaces || []).filter(w => w.id !== S.workspaceId);
  if (isEmpty && otherWs.length > 0 && S.isSuperAdmin) {
    banner.style.display = 'block';
    msg.innerHTML = 'Ton workspace <b>' + esc(S.workspace?.name || '?') +
      '</b> est vide. Tu peux consulter un autre workspace pour voir ses données :';
    actions.innerHTML = otherWs.map(w =>
      '<button type="button" class="btn btn-ghost btn-sm" onclick="switchCurrentWorkspace(\'' +
      esc(w.id) + '\')">' + (w.is_shared ? '👥' : '🔒') + ' ' + esc(w.name) + '</button>'
    ).join('');
    return;
  }

  // Sinon, on cache
  banner.style.display = 'none';
}

function dismissWorkspaceBanner() {
  _wsBannerDismissed = true;
  document.getElementById('ws-context-banner').style.display = 'none';
}

// Peuple le sélecteur de vue active dans la section Admin
function populateAdminWorkspaceSelector() {
  const sel = document.getElementById('admin-ws-selector');
  if (!sel) return;
  if (!S.availableWorkspaces || S.availableWorkspaces.length === 0) {
    sel.innerHTML = '<option value="">Aucun workspace disponible</option>';
    return;
  }
  // Trier : workspace d'appartenance en premier, puis le reste par ordre alphabétique
  const sorted = [...S.availableWorkspaces].sort((a, b) => {
    if (a.id === S.workspaceId) return -1;
    if (b.id === S.workspaceId) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  sel.innerHTML = sorted.map(w => {
    const isHome = w.id === S.workspaceId;
    const icon = w.is_shared ? '👥' : '🔒';
    const homeTag = isHome ? ' · ⭐ mon workspace' : '';
    return `<option value="${esc(w.id)}"${w.id === S.currentWorkspaceId ? ' selected' : ''}>${icon} ${esc(w.name)}${homeTag}</option>`;
  }).join('');
  // Afficher le nom du workspace d'appartenance dans la note
  const homeName = document.getElementById('admin-ws-home-name');
  if (homeName && S.workspace) homeName.textContent = S.workspace.name;
}


// ─── PASTE HANDLER ───
function handleGlobalPaste(e){
  const items=e.clipboardData?.items;
  if(!items)return;
  let imgFile=null;
  for(const item of items){if(item.type.startsWith('image/')){imgFile=item.getAsFile();break;}}
  if(!imgFile)return;
  // Currency reports section ?
  const secCur=document.getElementById('sec-currency');
  if(secCur&&secCur.classList.contains('active')){
    const code=S_curCode;
    // V9.12 — On détermine la liste des zones selon l'onglet courant :
    //   BILAN → var/vix/idx/fng (4 zones)  ·  devise → pm/gh (2 zones)
    const zones = (code==='BILAN') ? BILAN_ZONES.map(z=>z.key) : ['pm','gh'];
    // 1) Zone réellement survolée par la souris (priorité absolue)
    let target = zones.find(zk=>{
      const el=document.getElementById('cpz-'+zk+'-'+code);
      return el && el.matches(':hover');
    });
    // 2) Sinon, dernière zone cliquée/focalisée mémorisée
    if(!target && window._lastFocusedCurZone && window._lastFocusedCurZone.code===code){
      target = window._lastFocusedCurZone.zone;
    }
    // 3) Sinon, première zone par défaut
    if(!target) target = zones[0];
    setCurImg(code, target, imgFile);
    e.preventDefault();
    return;
  }
  // Trade modal ?
  const modal=document.getElementById('trade-modal');
  if(modal&&!modal.classList.contains('hidden')){
    const activeTab=document.querySelector('.modal-tab.active');
    const tabIdx=Array.from(document.querySelectorAll('.modal-tab')).indexOf(activeTab);
    const type=tabIdx===1?'entry':tabIdx===2?'close':'file';
    S.pendingUps.push({file:imgFile,type});
    const c=document.getElementById('prev-'+type)||document.getElementById('prev-file');
    if(c){const r=new FileReader();r.onload=ev=>{const img=document.createElement('img');img.src=ev.target.result;img.className='img-thumb';img.onclick=()=>bigImg(ev.target.result);c.appendChild(img);};r.readAsDataURL(imgFile);}
    toast('Image collée ✅','ok');
    e.preventDefault();
  }
}

function initChartResize(){
  document.querySelectorAll('.chart-wrap').forEach(wrap=>{
    new ResizeObserver(()=>{
      if(S.chartBal)S.chartBal.resize();
      if(S.chartRR)S.chartRR.resize();
    }).observe(wrap);
  });
}

// ─── UTILS ───
function bigImg(url){document.getElementById('img-big').src=url;document.getElementById('img-ov').classList.remove('hidden');}
function fDate(d){if(!d)return'—';return new Date(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});}
function fDateShort(d){if(!d)return'';return new Date(d).toLocaleDateString('fr-FR',{month:'short',year:'2-digit'});}
// V9.2 FIX FUSEAU : helpers qui formatent une Date en LOCAL (pas UTC).
// Avant : on utilisait d.toISOString().slice(0,7) → bug de fuseau qui décalait
// le mois pour Paris (UTC+2 en été) → "MAI 26" renvoyait "2026-04" en interne.
function fmtYM(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function fmtYMD(d){return fmtYM(d)+'-'+String(d.getDate()).padStart(2,'0');}
// FND-11 : on echappe aussi " et ' — un texte utilisateur place dans un attribut
// (title="...", value="...") ne doit pas pouvoir en sortir.
function esc(s){return(s==null?'':s).toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// Argument JS passe dans un onclick="f(...)" : JSON d'abord (litteral JS valide),
// puis HTML. S'ecrit SANS guillemets autour : onclick="f(${escJs(x)})".
// (esc() seul ne suffit pas : &#39; serait redecode avant l'execution du JS.)
function escJs(s){return esc(JSON.stringify(s==null?'':String(s)));}
// URL d'un href : http/https uniquement (esc seul laisse passer javascript:).
function safeUrl(u){const s=(u==null?'':String(u)).trim();return /^https?:\/\//i.test(s)?esc(s):'#';}
function toast(msg,type='ok'){const t=document.getElementById('toast');t.textContent=msg;t.className='show '+type;clearTimeout(t._t);t._t=setTimeout(()=>t.className='',3400);}

// ─── CONFIRM ───
function showConfirm(title,msg,cb,okLabel='Confirmer'){S.confirmCb=cb;document.getElementById('confirm-title').textContent=title;document.getElementById('confirm-msg').textContent=msg;document.getElementById('confirm-ok').textContent=okLabel;document.getElementById('confirm-overlay').classList.remove('hidden');}
function closeConfirm(){document.getElementById('confirm-overlay').classList.add('hidden');S.confirmCb=null;}
function execConfirm(){const cb=S.confirmCb;closeConfirm();if(cb)cb();}


// ════════════════════════════════════════════════════════════════════
// DASHBOARD MODULE
// ════════════════════════════════════════════════════════════════════

// ─── SPEEDOMETER ───
function speedometerHTML(pct,label){
  const r=34,cx=40,cy=40,startAngle=-200,endAngle=20;
  const toRad=d=>d*Math.PI/180;
  const arcPath=(cx,cy,r,startDeg,endDeg)=>{const s=toRad(startDeg),e=toRad(endDeg);const x1=cx+r*Math.cos(s),y1=cy+r*Math.sin(s),x2=cx+r*Math.cos(e),y2=cy+r*Math.sin(e);const lg=endDeg-startDeg>180?1:0;return `M${x1},${y1} A${r},${r},0,${lg},1,${x2},${y2}`;};
  const totalArc=endAngle-startAngle;
  const zones=[{pct:0.33,color:'#cc2a42'},{pct:0.33,color:'#d48c00'},{pct:0.34,color:'#00a86b'}];
  let zoneStart=startAngle;
  const zoneArcs=zones.map(z=>{const zEnd=zoneStart+z.pct*totalArc;const path=arcPath(cx,cy,r,zoneStart,zEnd);zoneStart=zEnd;return `<path d="${path}" fill="none" stroke="${z.color}" stroke-width="5" stroke-linecap="round" opacity="0.7"/>`;}).join('');
  const needleAngle=startAngle+(pct/100)*totalArc;const nr=toRad(needleAngle);
  const nx=cx+28*Math.cos(nr),ny=cy+28*Math.sin(nr);
  const backNx=cx-8*Math.cos(nr),backNy=cy-8*Math.sin(nr);
  return `<div class="speedometer">
    <svg viewBox="0 0 80 48" overflow="visible">
      <path d="${arcPath(cx,cy,r,startAngle,endAngle)}" fill="none" stroke="var(--bg4)" stroke-width="5"/>
      ${zoneArcs}
      <line x1="${backNx}" y1="${backNy}" x2="${nx}" y2="${ny}" stroke="var(--amber2)" stroke-width="2" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="3" fill="var(--amber)" stroke="var(--bg2)" stroke-width="1"/>
    </svg>
    <div class="spd-val">${label}</div>
  </div>`;
}

// ─── STATS ───
function calcStats(trades){
  const closed=trades.filter(t=>t.status==='closed');
  const winsArr=closed.filter(t=>(+t.actual_rr||0)>0);
  const lossesArr=closed.filter(t=>(+t.actual_rr||0)<0);
  const wins=winsArr.length;
  const losses=lossesArr.length;
  const be=closed.filter(t=>(+t.actual_rr||0)===0).length;
  const totalRR=closed.reduce((s,t)=>s+(+t.actual_rr||0),0);
  const totalPnL=closed.reduce((s,t)=>s+(+t.pnl_amount||0),0);
  const winRate=closed.length>0?(wins/closed.length)*100:0;
  // V9.6 — RR moyens par catégorie (gagnants / perdants)
  //   avgWinRR  : moyenne des actual_rr sur les trades gagnants
  //   avgLossRR : moyenne des actual_rr sur les trades perdants (valeur négative)
  const avgWinRR =wins>0  ? winsArr  .reduce((s,t)=>s+(+t.actual_rr||0),0)/wins   : 0;
  const avgLossRR=losses>0? lossesArr.reduce((s,t)=>s+(+t.actual_rr||0),0)/losses : 0;
  const acc=S.accId!=='all'?S.accounts.find(a=>a.id===S.accId):S.accounts[0];
  const bal=acc?+acc.balance:15000;
  return{total:trades.length,closed:closed.length,wins,losses,be,totalRR,totalPnL,pnlPct:bal>0?(totalPnL/bal)*100:0,winRate,avgWinRR,avgLossRR};
}

function renderStats() {
  const trades = S.trades.filter(t => t.status !== 'cancelled');
  const st = calcStats(trades);
  renderStatsPanel(st, 'ALL TIME');
  calcAvgDuration(trades.filter(t => t.status === 'closed'));
}


// ─── CHARTS ───



// ════════════════════════════════════════════════════════════════════
// V8 — Fonctions importées de V7 (stats panel, charts segmentés, rich editor, calendrier, TJP)
// ════════════════════════════════════════════════════════════════════

function renderStatsPanel(st, label){
  const rc=st.totalRR>=0?'pos':'neg';const sign=st.totalRR>=0?'+':'';
  const total=st.wins+st.be+st.losses;
  const wPct=total>0?Math.round(st.wins/total*100):0;
  const bePct=total>0?Math.round(st.be/total*100):0;
  const lPct=total>0?Math.round(st.losses/total*100):0;
  const html=`
    <div style="font-family:Arial,monospace;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin-bottom:14px;display:flex;align-items:center;gap:6px;">
      <span style="width:2px;height:10px;background:var(--amber);display:inline-block;border-radius:1px"></span>
      ${label}
    </div>

    <div style="margin-bottom:16px;">
      <div class="stat-rr ${rc}" style="font-size:2.6rem;line-height:1">${sign}${st.totalRR.toFixed(2)}<span style="font-size:13px;font-weight:400;color:var(--text3);margin-left:4px">R</span></div>
      <div class="stat-sub ${rc}" style="font-size:11px;margin-top:4px">${sign}${st.pnlPct.toFixed(2)}% &nbsp;·&nbsp; ${st.totalPnL>=0?'$':'-$'}${Math.abs(st.totalPnL).toLocaleString('fr-FR',{minimumFractionDigits:0,maximumFractionDigits:0})}</div>
    </div>

    <div class="stats-tiles-3">
      <div style="background:rgba(0,168,107,.08);border:1px solid var(--green2);border-radius:var(--radius);padding:10px 6px;text-align:center;">
        <div style="font-family:Arial,monospace;font-size:22px;font-weight:700;color:var(--green)">${st.wins}</div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--green);letter-spacing:.1em;margin-top:2px">WIN</div>
      </div>
      <div style="background:rgba(240,192,64,.06);border:1px solid rgba(240,192,64,.2);border-radius:var(--radius);padding:10px 6px;text-align:center;">
        <div style="font-family:Arial,monospace;font-size:22px;font-weight:700;color:var(--yellow)">${st.be}</div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--yellow);letter-spacing:.1em;margin-top:2px">B/E</div>
      </div>
      <div style="background:rgba(204,42,66,.08);border:1px solid var(--red2);border-radius:var(--radius);padding:10px 6px;text-align:center;">
        <div style="font-family:Arial,monospace;font-size:22px;font-weight:700;color:var(--red)">${st.losses}</div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--red);letter-spacing:.1em;margin-top:2px">LOSS</div>
      </div>
    </div>

    <div class="stats-rr-row" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-family:Arial,monospace;font-size:8px;letter-spacing:.1em;color:var(--text3);margin-bottom:3px">TRADE WIN %</div>
        <div style="font-family:Arial,monospace;font-size:26px;font-weight:700;color:var(--text)">${Math.round(st.winRate)}<span style="font-size:14px;font-weight:400">%</span></div>
        <div style="font-family:Arial,monospace;font-size:9px;color:var(--text3);margin-top:2px">${total} trade${total>1?'s':''} fermé${total>1?'s':''}</div>
      </div>
      <div class="stats-speedo">${speedometerHTML(st.winRate,'')}</div>
    </div>

    <!-- V9.6 — RR moyens par catégorie -->
    <div class="stats-tiles-2">
      <div style="background:rgba(0,168,107,.08);border:1px solid var(--green2);border-radius:var(--radius);padding:10px 12px;text-align:center;">
        <div style="font-family:Arial,monospace;font-size:8px;letter-spacing:.1em;color:var(--green);margin-bottom:3px">RR MOY. GAGNÉ</div>
        <div style="font-family:Arial,monospace;font-size:20px;font-weight:700;color:var(--green)">${st.wins>0?'+'+st.avgWinRR.toFixed(2):'—'}<span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:3px">${st.wins>0?'R':''}</span></div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--text3);margin-top:2px">sur ${st.wins} trade${st.wins>1?'s':''}</div>
      </div>
      <div style="background:rgba(204,42,66,.08);border:1px solid var(--red2);border-radius:var(--radius);padding:10px 12px;text-align:center;">
        <div style="font-family:Arial,monospace;font-size:8px;letter-spacing:.1em;color:var(--red);margin-bottom:3px">RR MOY. PERDU</div>
        <div style="font-family:Arial,monospace;font-size:20px;font-weight:700;color:var(--red)">${st.losses>0?st.avgLossRR.toFixed(2):'—'}<span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:3px">${st.losses>0?'R':''}</span></div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--text3);margin-top:2px">sur ${st.losses} trade${st.losses>1?'s':''}</div>
      </div>
    </div>

    <div style="margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;font-family:Arial,monospace;font-size:8px;color:var(--text3);margin-bottom:5px;letter-spacing:.06em;">
        <span style="color:var(--green)">▪ WIN ${wPct}%</span>
        <span style="color:var(--yellow)">▪ BE ${bePct}%</span>
        <span style="color:var(--red)">▪ LOSS ${lPct}%</span>
      </div>
      <div style="height:7px;border-radius:4px;overflow:hidden;display:flex;background:var(--bg4)">
        ${wPct>0?`<div style="flex:${wPct};background:var(--green);transition:flex .4s ease"></div>`:''}
        ${bePct>0?`<div style="flex:${bePct};background:var(--yellow);transition:flex .4s ease"></div>`:''}
        ${lPct>0?`<div style="flex:${lPct};background:var(--red);transition:flex .4s ease"></div>`:''}
      </div>
    </div>

    <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;">
      <div style="font-family:Arial,monospace;font-size:8px;letter-spacing:.1em;color:var(--text3)">DURÉE MOY. / TRADE</div>
      <div id="avg-duration-lbl" style="font-family:Arial,monospace;font-size:13px;font-weight:700;color:var(--amber)">—</div>
    </div>
  `;
  document.getElementById('stats-row').innerHTML=html;
}

function calcAvgDuration(trades){
  const el=document.getElementById('avg-duration-lbl');if(!el)return;
  if(!trades||!trades.length){el.textContent='—';return;}
  // Pas de durée réelle en base - on affiche total trades
  el.textContent=trades.length+' trades';
}

function buildCumRRData(trades){
  // V9.1 FIX : on inclut les trades BE (0R) — ils apparaissent comme palier plat sur la courbe.
  // Avant : .filter(...&&(+t.actual_rr||0)!==0) → trades BE invisibles.
  const sorted=trades.filter(t=>t.status==='closed')
    .sort((a,b)=>new Date(a.trade_date||a.created_at)-new Date(b.trade_date||b.created_at));
  const labels=['Début'];const data=[0];
  let cum=0;
  sorted.forEach(t=>{
    cum+=+(+t.actual_rr||0).toFixed(2);
    labels.push(fDateShort(t.trade_date||t.created_at));
    data.push(+cum.toFixed(2));
  });
  return{labels,data};
}

function buildSegmentColors(data){
  // Couleur de la ligne par segment (Chart.js segment plugin)
  return{
    borderColor:(ctx)=>{
      const idx=ctx.p0DataIndex;
      const val=ctx.p1?.parsed?.y??0;
      const prevVal=ctx.p0?.parsed?.y??0;
      // Si la valeur courante est positive → vert, sinon rouge
      return val>=0?'rgb(0,214,143)':'rgb(255,77,106)';
    },
    backgroundColor:(ctx)=>{
      const val=ctx.p1?.parsed?.y??0;
      return val>=0?'rgba(0,214,143,0.12)':'rgba(255,77,106,0.12)';
    }
  };
}

function closeTradeJournalPanel(){
  const panel=document.getElementById('trade-journal-panel');
  const overlay=document.getElementById('tjp-overlay');
  if(panel)panel.style.right='-520px';
  if(overlay)overlay.style.display='none';
}

function syncAnalysisEditor(){
  const editor = document.getElementById('m-analysis-editor');
  const hidden = document.getElementById('m-analysis');
  if(editor && hidden) hidden.value = editor.innerHTML;
}

function initRichEditor(){
  const editor = document.getElementById('m-analysis-editor');
  if(!editor || editor._richInited) return;
  editor._richInited = true;
  // Synchronise le contenu de l'editeur vers l'input cache #m-analysis
  editor.addEventListener('keyup', syncAnalysisEditor);
  editor.addEventListener('input', syncAnalysisEditor);
}

function loadRichEditor(htmlContent){
  const editor = document.getElementById('m-analysis-editor');
  if(!editor) return;
  editor.innerHTML = htmlContent || '';
  initRichEditor();
}

// V9.6 — Fuseau choisi par l'utilisateur (persisté en localStorage si possible).
// Les codes correspondent à la nomenclature interne d'Investing.com :
//   55  = London GMT (auto bascule heure d'été en mars)
//   113 = Paris/Berlin (CET/CEST)
//   8   = Argentine GMT-3 (ancien défaut, à éviter)
//   12  = London (variante)
//   4   = Pacifique (US West Coast)
// Si le mapping change côté Investing.com, l'utilisateur change visuellement dans le sélecteur.
let S_calTz = (function(){
  try { return localStorage.getItem('S_calTz') || '55'; } catch(_) { return '55'; }
})();
function onCalTzChange(val){
  S_calTz = val || '55';
  try { localStorage.setItem('S_calTz', S_calTz); } catch(_) {}
  updateCalIframe();
}

// V9.5/9.6 — URL du widget calendrier Investing.com
//  - timeFilter au lieu de calType (calType était ignoré → bugs période)
//  - timeFilter=customDate avec dateFrom/dateTo pour les plages semaine
//  - timeZone provient de S_calTz (sélecteur UI, défaut Londres)
function buildCalIframeSrc() {
  const zone   = CAL_ZONES.find(z => z.code === S_calZone)   || CAL_ZONES[0];
  const period = CAL_PERIODS.find(p => p.key === S_calPeriod) || CAL_PERIODS[1];
  const countries = zone.inv;

  const pad = n => String(n).padStart(2,'0');
  const ymd = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  const now = new Date();
  const dow = now.getDay();
  const mondayOffset = (dow === 0 ? -6 : 1 - dow);
  const thisMonday = new Date(now); thisMonday.setDate(now.getDate() + mondayOffset);
  const thisSunday = new Date(thisMonday); thisSunday.setDate(thisMonday.getDate() + 6);
  const nextMonday = new Date(thisMonday); nextMonday.setDate(thisMonday.getDate() + 7);
  const nextSunday = new Date(nextMonday); nextSunday.setDate(nextMonday.getDate() + 6);

  const params = [
    'columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous',
    'importance=2,3',
    `countries=${countries}`,
    `timeZone=${S_calTz}`,
    'lang=5',
  ];

  if (period.kind === 'today') {
    params.push('timeFilter=timeRemain');
  } else if (period.kind === 'thisWeek') {
    params.push('timeFilter=customDate');
    params.push('dateFrom=' + ymd(thisMonday));
    params.push('dateTo='   + ymd(thisSunday));
  } else if (period.kind === 'nextWeek') {
    params.push('timeFilter=customDate');
    params.push('dateFrom=' + ymd(nextMonday));
    params.push('dateTo='   + ymd(nextSunday));
  }
  return `https://sslecal2.investing.com?${params.join('&')}`;
}

function buildCalBars() {
  if (S_calBuilt) return;
  S_calBuilt = true;

  // Zone buttons
  const zoneEl = document.getElementById('cal-zone-btns');
  if (zoneEl) {
    zoneEl.innerHTML = '';
    CAL_ZONES.forEach(z => {
      const btn = document.createElement('button');
      btn.className = 'acc-tab' + (z.code === S_calZone ? ' active' : '');
      btn.dataset.zone = z.code;

      if (z.code === 'ALL') {
        btn.innerHTML = `<span style="font-size:11px;font-weight:700;letter-spacing:.04em">ALL</span>`;
      } else if (z.code === 'XAU') {
        btn.innerHTML = `<span style="font-size:12px;margin-right:3px">🥇</span><span style="font-size:11px;font-weight:700">XAU</span>`;
      } else {
        btn.innerHTML = `<img src="https://flagcdn.com/20x15/${z.cc}.png" style="border-radius:1px;vertical-align:middle;margin-right:4px;width:18px;height:14px" alt="${z.code}"><span style="font-size:11px;font-weight:700">${z.label}</span>`;
      }
      btn.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 11px;cursor:pointer;';
      btn.addEventListener('click', () => {
        S_calZone = z.code;
        document.querySelectorAll('#cal-zone-btns .acc-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateCalIframe();
      });
      zoneEl.appendChild(btn);
    });
  }

  // Period buttons
  const periodEl = document.getElementById('cal-period-btns');
  if (periodEl) {
    periodEl.innerHTML = '';
    CAL_PERIODS.forEach(p => {
      const btn = document.createElement('button');
      btn.className = 'acc-tab' + (p.key === S_calPeriod ? ' active' : '');
      btn.textContent = p.label;
      btn.dataset.period = p.key;
      btn.style.cssText = 'font-size:10px;padding:4px 12px;cursor:pointer;';
      btn.addEventListener('click', () => {
        S_calPeriod = p.key;
        document.querySelectorAll('#cal-period-btns .acc-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updateCalIframe();
      });
      periodEl.appendChild(btn);
    });
  }
}

function updateCalIframe() {
  const oldIframe = document.getElementById('cal-iframe');
  if (!oldIframe) return;
  // V9.7 FIX — Le widget Investing.com mémorise son état interne (timeFilter) via
  //            son JS de bootstrap. Réassigner iframe.src ne réinitialise PAS toujours
  //            ce JS → "Aujourd'hui" affiche encore "Cette semaine".
  //            Solution radicale : on REMPLACE l'élément iframe dans le DOM.
  const newSrc = buildCalIframeSrc();
  const newIframe = document.createElement('iframe');
  newIframe.id = 'cal-iframe';
  newIframe.width = '100%';
  newIframe.height = '100%';
  newIframe.frameBorder = '0';
  newIframe.setAttribute('allowtransparency','true');
  newIframe.style.cssText = 'display:block;border:none;';
  newIframe.src = newSrc;
  oldIframe.parentNode.replaceChild(newIframe, oldIframe);
}

function loadCalendar(forceRefresh = false) {
  buildCalBars();
  // V9.6 — synchroniser visuellement le sélecteur de fuseau avec S_calTz
  const tzSel = document.getElementById('cal-tz-pick');
  if (tzSel) tzSel.value = S_calTz;
  // V9.8 — démarrer l'horloge live + remplir le convertisseur
  startCalClock();
  updateCalIframe();
}

// V9.8 — Horloge live "Mon heure" + guide de conversion
let _calClockTimer = null;
function startCalClock(){
  if (_calClockTimer) return; // déjà démarré
  const renderClock = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const clk = document.getElementById('cal-myclock');
    const tz  = document.getElementById('cal-mytz');
    if (clk) clk.textContent = `${hh}:${mm}`;
    if (tz) {
      const offsetMin = -now.getTimezoneOffset(); // ex: Paris été = +120
      const sign = offsetMin>=0?'+':'-';
      const oh = Math.floor(Math.abs(offsetMin)/60);
      const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      tz.textContent = `GMT${sign}${oh} · ${tzName.split('/').pop()||''}`;
    }
    // Maj du guide de conversion : on suppose que l'iframe est en NY (GMT-4 ou -5 hiver).
    // Si Sylas/Killian ont trouvé un autre code qui marche, on l'affichera.
    const conv = computeConversionHint(now);
    const refEl = document.getElementById('cal-conv-ref');
    const zoneEl = document.getElementById('cal-conv-zone');
    const ruleEl = document.getElementById('cal-conv-rule');
    if (refEl)  refEl.textContent = conv.refTime;
    if (zoneEl) zoneEl.textContent = conv.zoneLabel;
    if (ruleEl) ruleEl.textContent = conv.rule;
  };
  renderClock();
  _calClockTimer = setInterval(renderClock, 30000); // refresh toutes les 30s
}

function computeConversionHint(now){
  // Heure NY = heure locale - offset Paris + offset NY
  // Calcul simplifié via toLocaleString avec timezone explicite.
  const fmtNY = new Intl.DateTimeFormat('fr-FR',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hour12:false});
  const fmtLondon = new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hour12:false});
  const fmtUTC = new Intl.DateTimeFormat('fr-FR',{timeZone:'Etc/UTC',hour:'2-digit',minute:'2-digit',hour12:false});
  // On affiche : « Si iframe = [heure NY] → c'est NY, ajoute X h pour ton fuseau »
  // Calcul du delta NY → utilisateur
  const localMin = now.getHours()*60 + now.getMinutes();
  const nyParts = fmtNY.format(now).match(/(\d+):(\d+)/);
  const nyMin = (+nyParts[1])*60 + (+nyParts[2]);
  let deltaH = Math.round((localMin - nyMin)/60);
  if (deltaH < -12) deltaH += 24;
  if (deltaH > 12)  deltaH -= 24;
  return {
    refTime: fmtNY.format(now),
    zoneLabel: 'New York (heure par défaut Investing.com)',
    rule: `ajoute ${deltaH>=0?'+':''}${deltaH}h pour avoir ton heure locale`
  };
}


// V8 : helpers de construction de charts V7 (segments colorés par profit/perte)
function makeBalChart(canvas,labels,data){
  if(S.chartBal)S.chartBal.destroy();
  const gc=getCSSVar('--chart-grid');const tc=getCSSVar('--chart-tick');
  const amber=getCSSVar('--amber');
  const ctx=canvas.getContext('2d');

  // Gradient de fond basé sur la valeur finale
  const finalVal=data.length>0?data[data.length-1]:0;
  const grad=ctx.createLinearGradient(0,0,0,canvas.offsetHeight||280);
  if(finalVal>=0){
    grad.addColorStop(0,'rgba(0,214,143,0.3)');
    grad.addColorStop(0.6,'rgba(0,214,143,0.06)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
  } else {
    grad.addColorStop(0,'rgba(255,77,106,0.3)');
    grad.addColorStop(0.6,'rgba(255,77,106,0.06)');
    grad.addColorStop(1,'rgba(0,0,0,0)');
  }

  S.chartBal=new Chart(canvas,{type:'line',data:{
    labels,
    datasets:[{
      label:'R:R cumulé',data,
      segment:buildSegmentColors(data),
      fill:true,backgroundColor:grad,
      tension:.4,pointRadius:0,pointHoverRadius:5,
      pointHoverBackgroundColor:amber,borderWidth:2
    }]
  },options:{
    responsive:true,maintainAspectRatio:false,
    interaction:{mode:'index',intersect:false},
    plugins:{
      legend:{display:false},
      tooltip:{
        backgroundColor:getCSSVar('--chart-tt'),borderColor:amber,borderWidth:1,
        titleColor:amber,bodyColor:getCSSVar('--text'),
        callbacks:{label:ctx=>(ctx.parsed.y>=0?'+':'')+ctx.parsed.y.toFixed(2)+' R'}
      }
    },
    scales:{
      x:{grid:{color:gc,drawBorder:false},ticks:{color:tc,font:{size:9,family:'Arial'},maxTicksLimit:10}},
      y:{
        grid:{color:gc,drawBorder:false},
        ticks:{color:tc,font:{size:9,family:'Arial'},callback:v=>(v>=0?'+':'')+v.toFixed(1)+'R'},
        // Ligne zéro bien visible
        afterDataLimits(axis){axis.min=Math.min(axis.min,-0.1);}
      }
    }
  }});
}

// V9.1 : 1 barre par trade fermé, filtrée par la période (mois sélectionnés ou tout)
function buildTradesForRRChart(keys){
  // keys = liste de "YYYY-M" ; si vide/null → tous les trades
  return S.trades
    .filter(t=>t.status==='closed')
    .filter(t=>{
      if(!keys||!keys.length)return true;
      const d=new Date(t.trade_date||t.created_at);
      return keys.includes(d.getFullYear()+'-'+d.getMonth());
    })
    .sort((a,b)=>new Date(a.trade_date||a.created_at)-new Date(b.trade_date||b.created_at));
}

function makeRRChart(keys){
  if(S.chartRR)S.chartRR.destroy();
  const gc=getCSSVar('--chart-grid');const tc=getCSSVar('--chart-tick');const amber=getCSSVar('--amber');
  const trades=buildTradesForRRChart(keys);
  // Stocker pour le clic (mapping index → trade id)
  S._rrChartTrades=trades;
  const labels=trades.map(t=>{
    const d=new Date(t.trade_date||t.created_at);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${t.instrument||''}`;
  });
  const data=trades.map(t=>+(+t.actual_rr||0).toFixed(2));
  S.chartRR=new Chart(document.getElementById('rrChart'),{type:'bar',data:{
    labels,
    datasets:[{label:'R:R',data,
      backgroundColor:data.map(v=>v>0?'rgba(0,214,143,.8)':(v<0?'rgba(255,77,106,.8)':'rgba(240,192,64,.7)')),
      borderRadius:2,hoverBackgroundColor:amber}]
  },options:{
    responsive:true,maintainAspectRatio:false,
    plugins:{
      legend:{display:false},
      tooltip:{
        backgroundColor:getCSSVar('--chart-tt'),borderColor:amber,borderWidth:1,
        titleColor:amber,bodyColor:getCSSVar('--text'),
        callbacks:{
          title:items=>{
            const t=S._rrChartTrades?.[items[0].dataIndex];
            if(!t)return items[0].label;
            return `${t.instrument||'?'} · ${fDate(t.trade_date||t.created_at)}`;
          },
          label:c=>(c.parsed.y>=0?'+':'')+c.parsed.y.toFixed(2)+' R'
        }
      }
    },
    onClick:(e,els)=>{
      if(!els.length)return;
      const trade=S._rrChartTrades?.[els[0].index];
      if(trade)showTradeDetailById(trade.id);
    },
    scales:{
      x:{grid:{color:gc,drawBorder:false},ticks:{color:tc,font:{size:9,family:'Arial'},maxRotation:60,minRotation:45,autoSkip:true,maxTicksLimit:30}},
      y:{grid:{color:gc,drawBorder:false},ticks:{color:tc,font:{size:9,family:'Arial'},callback:v=>v+'R'}}
    }
  }});
}

// v=5 : redessine les deux graphiques du tableau de bord selon le filtre COURANT
// (relance unique quand Chart.js arrive, même si le filtre a changé entre-temps).
function redessinerGraphiques(){
  if(S_dashMonths.size>0)renderChartsByMonths([...S_dashMonths]);else renderCharts();
}

async function renderCharts(){
  if(!grapheDisponible(redessinerGraphiques))return;
  // Vue ALL TIME (aucun mois sélectionné)
  const trades=S.trades.filter(t=>t.status!=='cancelled');
  const{labels,data}=buildCumRRData(trades);
  const canvas=document.getElementById('balChart');
  makeBalChart(canvas,labels,data);
  makeRRChart(null); // null = tous les trades
}

function buildMonthlyRR(){
  // Conservé pour compatibilité éventuelle (renderMonthly utilise sa propre logique)
  const map={};
  S.trades.filter(t=>t.status==='closed').forEach(t=>{const d=new Date(t.trade_date||t.created_at);const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;map[k]=(map[k]||0)+(+t.actual_rr||0);});
  return Object.entries(map).sort().slice(-12).map(([k,rr])=>({lbl:k.replace('-','/').replace(/^20/,''),rr:+rr.toFixed(2)}));
}

function renderMonthly(){
  const tb=document.getElementById('m-tbody');
  if(!tb)return; // FND-004 : garde — l'element cible n'existe pas dans le DOM actuel
  const years={};
  S.trades.filter(t=>t.status==='closed').forEach(t=>{const d=new Date(t.trade_date||t.created_at);const y=d.getFullYear(),m=d.getMonth();if(!years[y])years[y]=Array(12).fill(null).map(()=>({rr:0,pnl:0,tot:0,wins:0}));years[y][m].rr+=(+t.actual_rr||0);years[y][m].pnl+=(+t.pnl_amount||0);years[y][m].tot++;if((+t.actual_rr||0)>0)years[y][m].wins++;});
  let html='';
  Object.entries(years).sort((a,b)=>b[0]-a[0]).forEach(([yr,months])=>{
    const tRR=months.reduce((s,m)=>s+(m?m.rr:0),0),tPnL=months.reduce((s,m)=>s+(m?m.pnl:0),0),tTot=months.reduce((s,m)=>s+(m?m.tot:0),0),tWins=months.reduce((s,m)=>s+(m?m.wins:0),0);
    html+=`<tr><td rowspan="3" style="vertical-align:top;padding-top:6px">${yr}</td>${months.map(m=>m&&m.tot>0?`<td><span class="${m.rr>=0?'pos':'neg'}">${m.rr>=0?'+':''}${m.rr.toFixed(2)}</span></td>`:'<td><span style="color:var(--text3)">—</span></td>').join('')}<td style="color:var(--amber2);font-family:Arial,monospace">${tRR>=0?'+':''}${tRR.toFixed(2)}</td></tr>
    <tr>${months.map(m=>m&&m.pnl!==0?`<td><span style="color:${m.pnl>=0?'var(--green)':'var(--red)'};font-size:9px;font-family:Arial,monospace">${m.pnl>=0?'$':'-$'}${Math.abs(m.pnl).toFixed(0)}</span></td>`:'<td></td>').join('')}<td style="color:var(--amber2);font-size:9px;font-family:Arial,monospace">${tPnL>=0?'$':'-$'}${Math.abs(tPnL).toFixed(0)}</td></tr>
    <tr style="border-bottom:2px solid var(--border)">${months.map(m=>m&&m.tot>0?`<td><span style="color:var(--text3);font-size:9px;font-family:Arial,monospace">${Math.round(m.wins/m.tot*100)}%</span></td>`:'<td></td>').join('')}<td style="color:var(--text3);font-size:9px;font-family:Arial,monospace">${tTot>0?Math.round(tWins/tTot*100)+'%':'—'}</td></tr>`;
  });
  tb.innerHTML=html||'<tr><td colspan="14" style="text-align:center;color:var(--text3);padding:20px;font-family:Arial,monospace;font-size:9px">Aucun trade fermé.</td></tr>';
}

// ─── DÉTAIL D'UN TRADE UNIQUE (clic sur barre) ───
// V9.1 : remplace l'ancien showTradeDetailForMonth qui affichait tout le mois.
// Clic sur une barre du diagramme R:R → affiche le rapport condensé du SEUL trade
// correspondant à la barre, avec captures agrandies, dans le panneau slide-in à droite.
async function showTradeDetailById(tradeId){
  const t=S.trades.find(x=>x.id===tradeId);
  if(!t)return;
  const panel=document.getElementById('trade-journal-panel');
  const content=document.getElementById('tjp-content');
  const title=document.getElementById('tjp-title');
  const overlay=document.getElementById('tjp-overlay');
  if(!panel||!content||!title)return;

  const rr=+t.actual_rr||0;
  const pnl=+t.pnl_amount||0;
  const col=rr>0?'var(--green)':(rr<0?'var(--red)':'var(--yellow)');
  const dirClass=t.direction==='LONG'?'long':'short';
  const planLabel={respected:'✅ Plan respecté',partial:'⚠ Plan partiel',not_respected:'❌ Plan non respecté'}[t.plan_respected]||'';
  const statusLabel=t.status==='closed'?'✓ FERMÉ':(t.status==='open'?'● EN COURS':'⏸ ANNULÉ');

  title.innerHTML=`<span style="display:inline-flex;align-items:center;gap:8px">
    <span style="font-weight:700;font-size:11px;color:var(--text)">${esc(t.instrument||'?')}</span>
    <span class="badge badge-${dirClass}">${t.direction||''}</span>
    <span style="font-size:9px;color:var(--text3)">${fDate(t.trade_date||t.created_at)}</span>
  </span>`;

  content.innerHTML=`
    <!-- Bandeau résultat -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid ${col};border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.1em;margin-bottom:3px">RÉSULTAT</div>
        <div style="font-family:Arial,monospace;font-size:22px;font-weight:700;color:${col}">${rr>=0?'+':''}${rr.toFixed(2)}R</div>
        ${pnl!==0?`<div style="font-family:Arial,monospace;font-size:11px;color:${pnl>=0?'var(--green)':'var(--red)'};margin-top:2px">${pnl>=0?'$':'-$'}${Math.abs(pnl).toFixed(2)}</div>`:''}
      </div>
      <div style="text-align:right">
        <div style="font-family:Arial,monospace;font-size:9px;color:var(--text3);letter-spacing:.06em">${statusLabel}</div>
        ${t.strategy?`<div style="font-family:Arial,monospace;font-size:10px;color:var(--text2);margin-top:4px">${esc(t.strategy)}</div>`:''}
      </div>
    </div>

    <!-- ANALYSE -->
    ${t.analysis_notes?`<div style="margin-bottom:14px">
      <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ ANALYSE</div>
      <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.7">${sanitizeNotesHtml(t.analysis_notes)}</div>
    </div>`:''}

    <!-- EXÉCUTION (paramètres) -->
    <div style="margin-bottom:14px">
      <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ EXÉCUTION</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
        ${t.entry_price?`<div class="chip"><span class="lbl">Entrée: </span><span class="val">${esc(t.entry_price)}</span></div>`:''}
        ${t.stop_loss?`<div class="chip"><span class="lbl">SL: </span><span class="val">${esc(t.stop_loss)}</span></div>`:''}
        ${t.take_profit?`<div class="chip"><span class="lbl">TP: </span><span class="val">${esc(t.take_profit)}</span></div>`:''}
        ${t.exit_price?`<div class="chip"><span class="lbl">Sortie: </span><span class="val">${esc(t.exit_price)}</span></div>`:''}
        ${t.lot_size?`<div class="chip"><span class="lbl">Lot: </span><span class="val">${esc(t.lot_size)}</span></div>`:''}
        ${t.planned_rr?`<div class="chip"><span class="lbl">R:R prévu: </span><span class="val">${(+t.planned_rr).toFixed(2)}</span></div>`:''}
      </div>
    </div>

    <!-- CAPTURES (chargées async, AGRANDIES) -->
    <div id="tjp-imgs-single" style="margin-bottom:14px">
      <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ CAPTURES</div>
      <div class="spin" style="margin:14px auto"></div>
    </div>

    <!-- GESTION & CLÔTURE -->
    ${(t.plan_respected||t.execution_quality||t.management_notes||t.lessons_learned)?`<div style="margin-bottom:14px">
      <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ GESTION &amp; CLÔTURE</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        ${t.execution_quality?`<div class="chip"><span class="lbl">Qualité: </span><span class="val">${t.execution_quality}/10</span></div>`:''}
        ${planLabel?`<div class="chip"><span class="val">${planLabel}</span></div>`:''}
      </div>
      ${t.management_notes?`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:6px">${esc(t.management_notes)}</div>`:''}
      ${t.lessons_learned?`<div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--amber);border-radius:var(--radius);padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.7"><span style="color:var(--amber);font-family:Arial,monospace;font-size:8px;letter-spacing:.1em">LEÇON · </span>${esc(t.lessons_learned)}</div>`:''}
    </div>`:''}

    <button class="btn btn-amber btn-sm" type="button" style="width:100%;margin-top:6px" onclick="openTrade('${t.id}')">✏ Modifier ce trade</button>
  `;
  panel.style.right='0px';
  if(overlay)overlay.style.display='block';

  // Charger les images en GRAND
  try{
    const images=await loadTradeImages(t.id);
    const container=document.getElementById('tjp-imgs-single');
    if(!container)return;
    if(!images.length){
      container.innerHTML='<div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ CAPTURES</div><div style="color:var(--text3);font-size:10px;text-align:center;padding:8px">Aucune capture</div>';
      return;
    }
    const liens=await signerChemins(images.map(img=>img.storage_path));
    const validImgs=images.filter(img=>liens[img.storage_path])
      .map(img=>({url:liens[img.storage_path],type:img.image_type,name:img.filename}));
    if(!validImgs.length){container.innerHTML='';return;}
    // Regroupement par type (entry / close / file)
    const groups={};
    validImgs.forEach(r=>{(groups[r.type||'autre']=groups[r.type||'autre']||[]).push(r);});
    container.innerHTML=`<div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ CAPTURES</div>`+
      Object.entries(groups).map(([type,imgs])=>`
        <div style="margin-bottom:10px">
          <div style="font-family:Arial,monospace;font-size:8px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">${esc(type)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${imgs.map(r=>`<img src="${r.url}" onclick="bigImg('${r.url}')" style="width:100%;max-height:280px;object-fit:contain;border-radius:3px;cursor:zoom-in;border:1px solid var(--border);background:var(--bg4)">`).join('')}
          </div>
        </div>`).join('');
  }catch(e){
    const container=document.getElementById('tjp-imgs-single');
    if(container)container.innerHTML='<div style="color:var(--text3);font-size:10px">Erreur de chargement des captures</div>';
  }
}

// Garde-fou : l'ancienne fonction reste disponible si appelée ailleurs
function showTradeDetailForMonth(lbl){
  // Plus utilisée par le chart (le clic appelle showTradeDetailById), fallback no-op
  if(!lbl)return;
  closeTradePanel();
}
function closeTradePanel(){document.getElementById('trade-detail-panel').classList.remove('open');}

// ─── DASHBOARD MONTH PIANO ───
const MONTHS_FR=['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
let S_dashYear=new Date().getFullYear();
let S_dashMonths=new Set();
let S_pianoStart=null;

function buildDashYearPick(){
  const pick=document.getElementById('dash-year-pick');if(!pick)return;
  const now=new Date().getFullYear();
  pick.innerHTML='';
  for(let y=now;y>=now-5;y--){
    const opt=document.createElement('option');opt.value=y;opt.textContent=y;
    if(y===S_dashYear)opt.selected=true;
    pick.appendChild(opt);
  }
}

function buildDashMonthBtns(){
  const el=document.getElementById('dash-month-btns');if(!el)return;
  el.innerHTML='';
  for(let m=0;m<12;m++){
    const key=S_dashYear+'-'+m;
    const btn=document.createElement('button');
    btn.className='acc-tab'+(S_dashMonths.has(key)?' active':'');
    btn.textContent=MONTHS_FR[m];
    btn.dataset.key=key;btn.dataset.m=m;
    btn.style.cssText='min-width:42px;padding:4px 8px;';
    btn.addEventListener('mousedown',(e)=>{
      S_pianoStart=m;
      toggleDashMonth(key,btn,e.shiftKey);
      e.preventDefault();
    });
    btn.addEventListener('mouseover',(e)=>{
      if(S_pianoStart!==null&&e.buttons===1){
        const start=Math.min(S_pianoStart,m);const end=Math.max(S_pianoStart,m);
        for(let i=0;i<=11;i++){
          const k=S_dashYear+'-'+i;
          const b=el.children[i];if(!b)continue;
          if(i>=start&&i<=end){S_dashMonths.add(k);b.classList.add('active');}
        }
      }
    });
    el.appendChild(btn);
  }
  if(!window._pianoMouseupAttached){
    window._pianoMouseupAttached=true;
    document.addEventListener('mouseup',()=>{
      if(S_pianoStart!==null){S_pianoStart=null;applyDashFilter();}
    });
  }
}

function toggleDashMonth(key,btn,shiftKey){
  if(S_dashMonths.has(key)&&S_dashMonths.size===1){
    S_dashMonths.delete(key);btn.classList.remove('active');
  } else if(S_dashMonths.has(key)){
    S_dashMonths.delete(key);btn.classList.remove('active');
  } else {
    if(!shiftKey)S_dashMonths.clear();
    S_dashMonths.add(key);btn.classList.add('active');
    document.querySelectorAll('#dash-month-btns .acc-tab').forEach(b=>{
      b.classList.toggle('active',S_dashMonths.has(b.dataset.key));
    });
  }
}

function onDashYearChange(yr){
  S_dashYear=parseInt(yr);S_dashMonths.clear();
  buildDashMonthBtns();applyDashFilter();
}

function applyDashFilter(){
  // V9 FIX FND-008 : chaque étape de rendu est isolée dans son try/catch
  // pour qu'une exception dans une fonction n'empêche pas les autres de tourner.
  try {
    if(S_dashMonths.size>0){
      renderStatsByMonths([...S_dashMonths]);
      renderChartsByMonths([...S_dashMonths]);
    } else {
      renderStats();
      renderCharts();
    }
  } catch (e) {
    console.error('applyDashFilter render block failed:', e);
  }
  try { renderMonthly(); } catch (e) { console.error('renderMonthly failed:', e); }
  try { renderJournal(); } catch (e) { console.error('renderJournal failed:', e); }
  try { updateWorkspaceBanner(); } catch (e) { console.error('updateWorkspaceBanner failed:', e); }
  document.querySelectorAll('#dash-month-btns .acc-tab').forEach(btn=>{
    btn.classList.toggle('active', S_dashMonths.has(btn.dataset.key));
  });
}

function getTradesForMonths(keys){
  return S.trades.filter(t=>{
    const d=new Date(t.trade_date||t.created_at);
    const k=d.getFullYear()+'-'+d.getMonth();
    return keys.includes(k)&&t.status!=='cancelled';
  });
}

// V9 FIX FND-007 : renderStatsByMonths n'acceptait pas son paramètre keys
// et appelait getTradesForMonths() sans argument → keys=undefined → TypeError
// silencieux qui bloquait TOUT le rendu (stats, charts, monthly, journal).
function renderStatsByMonths(keys) {
  // Fallback robuste si appelé sans paramètre
  const k = (Array.isArray(keys) && keys.length > 0) ? keys : [...S_dashMonths];
  const trades = getTradesForMonths(k).filter(t => t.status !== 'cancelled');
  const st = calcStats(trades);
  let label = 'ALL TIME';
  if (k.length === 0) {
    label = 'AUCUN MOIS';
  } else if (k.length === 1) {
    const [y, m] = k[0].split('-').map(Number);
    const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    label = (monthNames[m] || '?').toUpperCase() + ' ' + y;
  } else {
    label = k.length + ' MOIS SÉLECTIONNÉS';
  }
  renderStatsPanel(st, label);
  calcAvgDuration(trades.filter(t => t.status === 'closed'));
}

async function renderChartsByMonths(keys){
  if(!grapheDisponible(redessinerGraphiques))return;
  if(S.chartRR)S.chartRR.destroy();
  // Courbe PnL avec uniquement les trades des mois sélectionnés
  const trades=getTradesForMonths(keys);
  const{labels,data}=buildCumRRData(trades);
  const canvas=document.getElementById('balChart');
  makeBalChart(canvas,labels,data);
  makeRRChart(keys); // 1 barre par trade dans la sélection
}



// ════════════════════════════════════════════════════════════════════
// JOURNAL MODULE
// ════════════════════════════════════════════════════════════════════

function renderJournal(){
  const list=document.getElementById('j-list');
  if(!S.filtered.length){list.innerHTML='<div class="empty"><h3>Aucun trade</h3><p>+ Nouveau Trade pour commencer</p></div>';return;}
  list.innerHTML=S.filtered.map(tradeHTML).join('');
}

function tradeHTML(t){
  const rr=+t.actual_rr||0,pnl=+t.pnl_amount||0;
  const uColor=t.users?.color||'var(--text3)',uName=t.users?.name||'';
  const isOpen=t.status==='open';const statusColor=isOpen?'var(--blue)':t.status==='closed'?'var(--green2)':'var(--text3)';
  return `<div class="tj-item ${t.is_test?'is-test':''} status-${t.status}" id="tj-${t.id}">
    <div class="tj-hdr" onclick="toggleTJ('${t.id}')">
      <div class="tj-status-bar" style="background:${statusColor}"></div>
      <div class="tj-left">
        <span style="font-family:Arial,monospace;font-weight:600;font-size:12px;color:var(--text)">${esc(t.instrument)}</span>
        <span class="badge badge-${t.direction==='LONG'?'long':'short'}">${t.direction}</span>
        ${t.is_test?'<span class="badge badge-test">🧪TEST</span>':''}
        ${t.strategy?`<span style="color:var(--text3);font-size:10px;font-family:Arial,monospace">${esc(t.strategy)}</span>`:''}
        <span style="color:var(--text3);font-size:9px;font-family:Arial,monospace">· ${fDate(t.trade_date||t.created_at)}</span>
        ${uName?`<span style="font-size:9px;font-family:Arial,monospace;padding:1px 6px;border-radius:2px;background:${uColor}22;color:${uColor};border:1px solid ${uColor}44">${esc(uName)}</span>`:''}
        <span class="badge badge-${t.status}">${isOpen?'⬤ EN COURS':t.status==='closed'?'✓ FERMÉ':'✗ ANNULÉ'}</span>
      </div>
      <div class="tj-right">
        ${rr!==0?`<span class="${rr>=0?'pos':'neg'}" style="font-family:Arial,monospace;font-size:11px;font-weight:600">${rr>=0?'+':''}${rr.toFixed(2)}R</span>`:''}
        ${pnl!==0?`<span class="${pnl>=0?'pos':'neg'}" style="font-family:Arial,monospace;font-size:10px">${pnl>=0?'$':'-$'}${Math.abs(pnl).toFixed(2)}</span>`:''}
        <button class="btn btn-ghost btn-sm" type="button" onclick="event.stopPropagation();openTrade('${t.id}')">✏</button>
        <span style="color:var(--text3);font-size:10px" id="arr-${t.id}">▼</span>
      </div>
    </div>
    <div class="tj-body" id="body-${t.id}">
      ${tradeBlockContent(t)}
      ${isOpen?`<div class="quick-close-btn" onclick="toggleQuickClose('${t.id}')">⚡ Clôturer ce trade rapidement</div>
      <div class="quick-close-form" id="qcf-${t.id}">
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px">CLÔTURE RAPIDE</div>
        <div class="g4">
          <div class="fg"><label class="fl">Prix sortie</label><input type="number" class="f-inp" id="qc-exit-${t.id}" step="any" placeholder="0.00000" oninput="calcQuickRR('${t.id}','${t.direction}',${t.entry_price||0},${t.sl_price||0})"></div>
          <div class="fg"><label class="fl">R:R réalisé</label><input type="number" class="f-inp" id="qc-rr-${t.id}" step="any" placeholder="Auto"></div>
          <div class="fg"><label class="fl">P&L ($)</label><input type="number" class="f-inp" id="qc-pnl-${t.id}" step="any" placeholder="0.00"></div>
          <div class="fg" style="justify-content:flex-end;padding-top:16px"><button class="btn btn-green btn-sm" type="button" onclick="submitQuickClose('${t.id}')">💾 Valider</button></div>
        </div>
      </div>`:''}
    </div>
  </div>`;
}

function tradeBlockContent(t){
  return `
  <div class="tj-section">
    <div class="tj-section-lbl">Analyse</div>
    <div class="chip-row">
      ${t.session?chip('Session',t.session):''}${t.timeframe?chip('TF',t.timeframe):''}${t.setup_type?chip('Setup',t.setup_type):''}${t.strategy?chip('Stratégie',t.strategy):''}
    </div>
    ${t.analysis_notes?`<p style="font-size:11px;color:var(--text2);line-height:1.7">${sanitizeNotesHtml(t.analysis_notes)}</p>`:'<p style="font-size:10px;color:var(--text3);font-family:Arial,monospace">— Aucune note —</p>'}
  </div>
  <div class="tj-section">
    <div class="tj-section-lbl">Exécution</div>
    <div class="chip-row">
      ${t.entry_price?chip('Entrée',t.entry_price):''}${t.sl_price?chipC('SL',t.sl_price,'var(--red)'):''}${t.tp_price?chipC('TP',t.tp_price,'var(--green)'):''}${t.lot_size?chip('Lot',t.lot_size):''}${t.risk_rr?chipC('R:R théo','+'+parseFloat(t.risk_rr).toFixed(2),'var(--blue)'):''}</div>
    ${t.entry_notes?`<p style="font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:6px">${esc(t.entry_notes).replace(/\n/g,'<br>')}</p>`:''}
    <div class="img-grid" id="ig-entry-${t.id}"><div class="spin"></div></div>
  </div>
  <div class="tj-section">
    <div class="tj-section-lbl">Gestion & Clôture</div>
    <div class="chip-row">
      ${t.exit_price?chip('Sortie',t.exit_price):''}${t.actual_rr?chipC('R:R réalisé',(t.actual_rr>=0?'+':'')+parseFloat(t.actual_rr).toFixed(2),t.actual_rr>=0?'var(--green)':'var(--red)'):''}${t.pnl_amount?chipC('P&L',(t.pnl_amount>=0?'$':'-$')+Math.abs(t.pnl_amount).toFixed(2),t.pnl_amount>=0?'var(--green)':'var(--red)'):''}${t.execution_quality?chip('Qualité',t.execution_quality+'/10'):''}${t.plan_respected?chip('Plan',{respected:'✅ Respecté',partial:'⚠ Partiel',not_respected:'❌ Non respecté'}[t.plan_respected]||t.plan_respected):''}</div>
    ${t.management_notes?`<p style="font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:5px"><span style="color:var(--amber);font-size:9px;font-family:Arial,monospace">GESTION · </span>${esc(t.management_notes).replace(/\n/g,'<br>')}</p>`:''}
    ${t.lessons?`<p style="font-size:11px;color:var(--text2);line-height:1.7"><span style="color:var(--amber);font-size:9px;font-family:Arial,monospace">LEÇONS · </span>${esc(t.lessons).replace(/\n/g,'<br>')}</p>`:''}
    <div class="img-grid" id="ig-close-${t.id}" style="margin-top:6px"></div>
  </div>
  <div class="tj-section">
    <div class="tj-section-lbl">Fichiers</div>
    <div class="img-grid" id="ig-file-${t.id}"></div>
    <div id="fl-${t.id}"></div>
  </div>`;
}

function chip(l,v){return `<div class="chip"><span class="lbl">${esc(l)}: </span><span class="val">${esc(v)}</span></div>`;}
function chipC(l,v,col){return `<div class="chip"><span class="lbl">${esc(l)}: </span><span style="color:${col};font-family:Arial,monospace">${esc(v)}</span></div>`;}

function toggleTJ(id){
  const body=document.getElementById('body-'+id);const arr=document.getElementById('arr-'+id);
  const open=body.classList.contains('open');
  body.classList.toggle('open',!open);if(arr)arr.textContent=open?'▼':'▲';
  if(!open)loadImagesInView(id);
}

async function loadImagesInView(tradeId){
  const images=await loadTradeImages(tradeId);
  const grilles=['entry','close','file'].map(type=>({
    el:document.getElementById(`ig-${type}-${tradeId}`),
    imgs:images.filter(i=>i.image_type===type&&(i.mime_type?.startsWith('image/')||type!=='file')),
  })).filter(g=>g.el);
  grilles.forEach(g=>{g.el.innerHTML=g.imgs.length?'<div class="spin"></div>':'';});
  // v=5 : toutes les vignettes du trade signées en UNE requête (avant : une par image)
  const liens=await signerChemins(grilles.flatMap(g=>g.imgs.map(i=>i.storage_path)));
  grilles.forEach(g=>{if(g.imgs.length)fillImgGrid(g.el,g.imgs,liens);});
  const fl=document.getElementById(`fl-${tradeId}`);
  if(fl){const nI=images.filter(i=>i.image_type==='file'&&!i.mime_type?.startsWith('image/'));if(nI.length)fl.innerHTML=nI.map(f=>`<div style="padding:2px 0;font-size:10px;color:var(--text2);font-family:Arial,monospace">📄 ${esc(f.filename)}</div>`).join('');}
}

// liens : { chemin: url } déjà signés (signerChemins) ; sinon signés ici en une requête.
async function fillImgGrid(container,imgs,liens){
  if(!liens){
    container.innerHTML='<div class="spin"></div>';
    liens=await signerChemins(imgs.map(img=>img.storage_path));
  }
  container.innerHTML=imgs.filter(img=>liens[img.storage_path]).map(img=>{
    const url=liens[img.storage_path];
    return `<img src="${url}" class="img-thumb" onclick="bigImg('${url}')">`;
  }).join('');
}

function filterJournal(){
  const search=document.getElementById('j-search').value.toLowerCase();
  const dir=document.getElementById('f-dir').value;
  const stat=document.getElementById('f-stat').value;
  const usr=document.getElementById('f-usr').value;
  const testF=document.getElementById('f-test')?.value||'';
  S.filtered=S.trades.filter(t=>(!search||t.instrument.toLowerCase().includes(search))&&(!dir||t.direction===dir)&&(!stat||t.status===stat)&&(!usr||t.user_id===usr)&&(!testF||(testF==='real'?!t.is_test:t.is_test)));
  renderJournal();
}

// ─── QUICK CLOSE ───
function toggleQuickClose(id){const el=document.getElementById('qcf-'+id);if(el)el.classList.toggle('open');}
function calcQuickRR(id,dir,entry,sl){
  const exit=+document.getElementById('qc-exit-'+id)?.value||0;
  if(!exit||!entry||!sl)return;
  const risk=dir==='LONG'?entry-sl:sl-entry;if(risk<=0)return;
  const realized=dir==='LONG'?exit-entry:entry-exit;const rr=(realized/risk).toFixed(2);
  const rrField=document.getElementById('qc-rr-'+id);if(rrField&&!rrField.value)rrField.value=rr;
}
async function submitQuickClose(id){
  const exit=+document.getElementById('qc-exit-'+id)?.value||null;
  const rr=+document.getElementById('qc-rr-'+id)?.value||null;
  const pnl=+document.getElementById('qc-pnl-'+id)?.value||null;
  if(!rr&&!exit){toast('Entrez au moins le R:R réalisé','err');return;}
  const{error}=await sb.from('trades').update({exit_price:exit,actual_rr:rr,pnl_amount:pnl,status:'closed'}).eq('id',id);
  if(error){toast('Erreur : '+error.message,'err');return;}
  toast('Trade clôturé ✅','ok');await loadTrades();renderStats();await renderCharts();renderMonthly();renderJournal();
}

// ─── TRADE MODAL ───
async function openTrade(id=null){
  resetModal();
  document.getElementById('m-acc').innerHTML=S.accounts.map(a=>`<option value="${a.id}">${a.name}</option>`).join('');
  document.getElementById('m-user').innerHTML='<option value="">—</option>'+S.users.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
  // V9.2 FIX FUSEAU : fmtYMD (local) au lieu de toISOString (UTC)
  document.getElementById('m-date').value=fmtYMD(new Date());
  if(S.accId!=='all')document.getElementById('m-acc').value=S.accId;
  if(S.user)document.getElementById('m-user').value=S.user.id;
  if(id){
    S.editId=id;document.getElementById('m-title').textContent='Modifier Trade';document.getElementById('del-btn').style.display='inline-flex';
    const t=S.trades.find(x=>x.id===id);if(t)fillModal(t);
    S.existingImgs=await loadTradeImages(id);await renderExistingImgs();
  }else{S.editId=null;document.getElementById('m-title').textContent='Nouveau Trade';document.getElementById('del-btn').style.display='none';}
  document.getElementById('trade-modal').classList.remove('hidden');
  initRichEditor();
}

function fillModal(t){
  const fv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v||'';};
  fv('m-instr',t.instrument);fv('m-dir',t.direction);fv('m-acc',t.account_id);fv('m-user',t.user_id);fv('m-date',t.trade_date);
  fv('m-sess',t.session);fv('m-tf',t.timeframe);fv('m-setup',t.setup_type);fv('m-strat',t.strategy);fv('m-analysis',t.analysis_notes);loadRichEditor(t.analysis_notes||'');
  fv('m-entry',t.entry_price);fv('m-sl',t.sl_price);fv('m-tp',t.tp_price);fv('m-lot',t.lot_size);fv('m-enotes',t.entry_notes);
  fv('m-exit',t.exit_price);fv('m-arr',t.actual_rr);fv('m-pnl',t.pnl_amount);fv('m-status',t.status);fv('m-plan',t.plan_respected);
  fv('m-mgmt',t.management_notes);fv('m-lessons',t.lessons);
  const q=document.getElementById('m-quality');q.value=t.execution_quality||7;document.getElementById('q-val').textContent=(t.execution_quality||7)+'/10';
  calcRR();calcActualRR();
}

async function renderExistingImgs(){
  // v=5 : les captures des trois onglets signées en UNE requête (avant : une par image)
  const images=S.existingImgs.filter(i=>i.mime_type?.startsWith('image/'));
  const liens=await signerChemins(images.map(i=>i.storage_path));
  for(const type of['entry','close','file']){
    const imgs=images.filter(i=>i.image_type===type);
    const c=document.getElementById('prev-'+type);if(!c||!imgs.length)continue;
    c.innerHTML=imgs.map(i=>{
      const url=liens[i.storage_path];
      return url?`<img src="${url}" class="img-thumb" onclick="bigImg('${url}')">`:'';
    }).join('');
  }
}

function resetModal(){
  S.pendingUps=[];S.existingImgs=[];S.editId=null;
  ['m-instr','m-strat','m-analysis','m-entry','m-sl','m-tp','m-lot','m-enotes','m-exit','m-arr','m-pnl','m-mgmt','m-lessons'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const _ed=document.getElementById('m-analysis-editor');if(_ed)_ed.innerHTML='';
  document.getElementById('rr-display').textContent='Entrez entrée, SL et TP pour calculer le R:R.';
  document.getElementById('arr-display').textContent='Entrez le prix de sortie pour calculer le R:R réalisé.';
  document.getElementById('q-val').textContent='7/10';document.getElementById('m-quality').value=7;
  ['entry','close','file'].forEach(t=>{const el=document.getElementById('prev-'+t);if(el)el.innerHTML='';});
  document.getElementById('flist-modal').innerHTML='';mTab(0,document.querySelector('.modal-tab'));
}

function closeTrade(){document.getElementById('trade-modal').classList.add('hidden');}
function mTab(idx,el){document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.modal-tc').forEach(t=>t.classList.remove('active'));if(el)el.classList.add('active');document.getElementById('mt-'+idx).classList.add('active');}

function calcRR(){
  const entry=+document.getElementById('m-entry').value,sl=+document.getElementById('m-sl').value,tp=+document.getElementById('m-tp').value;
  const dir=document.getElementById('m-dir').value,el=document.getElementById('rr-display');
  if(!entry||!sl||!tp)return null;
  const risk=dir==='LONG'?entry-sl:sl-entry,reward=dir==='LONG'?tp-entry:entry-tp;
  if(risk<=0||reward<=0){el.innerHTML='<span style="color:var(--red)">⚠ Prix incohérents</span>';return null;}
  const rr=(reward/risk).toFixed(2);
  el.innerHTML=`R:R théorique : <span style="color:var(--amber2);font-weight:700">+${rr}</span> · Risk ${risk.toFixed(5)} · Reward ${reward.toFixed(5)}`;
  return+rr;
}

function calcActualRR(){
  const entry=+document.getElementById('m-entry').value,sl=+document.getElementById('m-sl').value,exit=+document.getElementById('m-exit').value;
  const dir=document.getElementById('m-dir').value,el=document.getElementById('arr-display');
  if(!entry||!sl||!exit)return;const risk=dir==='LONG'?entry-sl:sl-entry;if(risk<=0)return;
  const realized=dir==='LONG'?exit-entry:entry-exit,arr=(realized/risk).toFixed(2);
  const af=document.getElementById('m-arr');if(!af.value)af.value=arr;
  el.innerHTML=`R:R réalisé : <span style="color:${+arr>=0?'var(--green)':'var(--red)'};font-weight:700">${+arr>=0?'+':''}${arr}</span>`;
}

function addUpload(input,type){
  Array.from(input.files).forEach(file=>{
    S.pendingUps.push({file,type});const c=document.getElementById('prev-'+type)||document.getElementById('prev-file');if(!c)return;
    if(file.type.startsWith('image/')){const r=new FileReader();r.onload=e=>{const img=document.createElement('img');img.src=e.target.result;img.className='img-thumb';img.onclick=()=>bigImg(e.target.result);c.appendChild(img);};r.readAsDataURL(file);}
    else{const fl=document.getElementById('flist-modal');if(fl){const d=document.createElement('div');d.style.cssText='padding:2px 0;font-size:10px;color:var(--text2);font-family:Arial,monospace';d.textContent='📄 '+file.name;fl.appendChild(d);}}
  });
}

async function saveTrade(){
  const btn=document.getElementById('save-btn');btn.disabled=true;btn.innerHTML='<div class="spin"></div>';
  try{
    const instr=document.getElementById('m-instr').value.trim().toUpperCase();if(!instr){toast('Instrument requis','err');return;}
    const rr=calcRR();
    const status=document.getElementById('m-status').value;
    const payload={instrument:instr,direction:document.getElementById('m-dir').value,account_id:document.getElementById('m-acc').value||null,user_id:document.getElementById('m-user').value||null,trade_date:document.getElementById('m-date').value||null,session:document.getElementById('m-sess').value||null,timeframe:document.getElementById('m-tf').value||null,setup_type:document.getElementById('m-setup').value||null,strategy:document.getElementById('m-strat').value||null,analysis_notes:document.getElementById('m-analysis').value||null,entry_price:+document.getElementById('m-entry').value||null,sl_price:+document.getElementById('m-sl').value||null,tp_price:+document.getElementById('m-tp').value||null,lot_size:+document.getElementById('m-lot').value||null,entry_notes:document.getElementById('m-enotes').value||null,exit_price:+document.getElementById('m-exit').value||null,risk_rr:rr,actual_rr:+document.getElementById('m-arr').value||null,pnl_amount:+document.getElementById('m-pnl').value||null,status,execution_quality:+document.getElementById('m-quality').value||null,plan_respected:document.getElementById('m-plan').value||null,management_notes:document.getElementById('m-mgmt').value||null,lessons:document.getElementById('m-lessons').value||null};
    let tid=S.editId;
    if(tid){const{error}=await sb.from('trades').update(payload).eq('id',tid);if(error)throw error;}
    else{const{data,error}=await sb.from('trades').insert(payload).select().single();if(error)throw error;tid=data.id;}
    await Promise.all(S.pendingUps.map(({file,type})=>uploadFile(file,tid,type)));
    toast('Trade sauvegardé ✅','ok');closeTrade();await loadTrades();renderStats();await renderCharts();renderMonthly();renderJournal();
  }catch(e){console.error(e);toast('Erreur : '+e.message,'err');}
  finally{btn.disabled=false;btn.innerHTML='💾 Sauvegarder';}
}

async function uploadFile(file,tradeId,imageType){
  const ext=file.name.split('.').pop();const path=`trades/${tradeId}/${imageType}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const{error}=await sb.storage.from(BUCKET).upload(path,file);if(error){console.error(error);return;}
  await sb.from('trade_images').insert({trade_id:tradeId,image_type:imageType,storage_path:path,filename:file.name,file_size:file.size,mime_type:file.type});
}

async function deleteTrade(){
  showConfirm('Supprimer ce trade ?','Action irréversible.',async()=>{
    const{error}=await sb.from('trades').delete().eq('id',S.editId);if(error){toast('Erreur','err');return;}
    toast('Trade supprimé','ok');closeTrade();await loadTrades();renderStats();await renderCharts();renderMonthly();renderJournal();
  });
}

// ─── TEST DATA ───
const TEST_TRADES=[
  {instrument:'EURUSD',direction:'LONG',status:'closed',trade_date:'2025-01-15',strategy:'Order Block',session:'London',timeframe:'H4',setup_type:'Order Block',entry_price:1.08420,sl_price:1.07980,tp_price:1.09300,exit_price:1.09100,actual_rr:1.55,pnl_amount:198.20,execution_quality:8,plan_respected:'respected',analysis_notes:'Confluences fortes sur H4 OB. Structure haussière sur D1.',management_notes:'SL déplacé au BE après +1R.',lessons:'Patience payante.',is_test:true},
  {instrument:'GBPUSD',direction:'SHORT',status:'closed',trade_date:'2025-01-22',strategy:'FVG',session:'London/NY',timeframe:'H1',setup_type:'FVG',entry_price:1.27150,sl_price:1.27520,tp_price:1.26050,exit_price:1.26200,actual_rr:2.57,pnl_amount:482.50,execution_quality:9,plan_respected:'respected',analysis_notes:'FVG H1 comblé.',management_notes:'Partiel à +2R.',lessons:'Setup parfait.',is_test:true},
  {instrument:'USDJPY',direction:'LONG',status:'closed',trade_date:'2025-02-03',strategy:'Support',session:'Asia',timeframe:'H4',setup_type:'Support/Résistance',entry_price:148.200,sl_price:147.600,tp_price:149.800,exit_price:148.900,actual_rr:1.17,pnl_amount:145.00,execution_quality:6,plan_respected:'partial',is_test:true},
  {instrument:'XAUUSD',direction:'LONG',status:'closed',trade_date:'2025-02-14',strategy:'Breakout',session:'New York',timeframe:'H1',setup_type:'Breakout',entry_price:2028.50,sl_price:2018.00,tp_price:2060.00,exit_price:2018.50,actual_rr:-0.95,pnl_amount:-175.80,execution_quality:5,plan_respected:'not_respected',analysis_notes:'Fausse cassure.',lessons:'Attendre confirmation volume.',is_test:true},
  {instrument:'AAPL',direction:'LONG',status:'closed',trade_date:'2025-03-05',strategy:'Tendance',session:'New York',timeframe:'D1',setup_type:'Tendance',entry_price:175.20,sl_price:170.50,tp_price:188.00,exit_price:186.40,actual_rr:2.38,pnl_amount:890.00,execution_quality:8,plan_respected:'respected',is_test:true},
  {instrument:'GBPJPY',direction:'SHORT',status:'closed',trade_date:'2025-03-12',strategy:'Order Block',session:'London',timeframe:'H4',setup_type:'Order Block',entry_price:188.450,sl_price:189.100,tp_price:186.150,exit_price:186.300,actual_rr:3.31,pnl_amount:620.00,execution_quality:9,plan_respected:'respected',is_test:true},
  {instrument:'EURUSD',direction:'SHORT',status:'open',trade_date:'2025-04-01',strategy:'Order Block',session:'London',timeframe:'H4',setup_type:'Order Block',entry_price:1.09450,sl_price:1.09820,tp_price:1.08200,is_test:true},
];

async function insertTestData(){
  const accId=S.accounts[0]?.id,userId=S.appUser?.id;
  if(!accId){toast('Aucun compte disponible','err');return;}
  // V9b : si on est en mode "vue d'un autre workspace", prévenir
  if (S.currentWorkspaceId && S.workspaceId && S.currentWorkspaceId !== S.workspaceId) {
    toast('⚠ Les données test iront dans ton workspace d\'appartenance (' + (S.workspace?.name || '?') + '), pas dans la vue active.', 'err');
  }
  const{error}=await sb.from('trades').insert(TEST_TRADES.map(t=>({...t,account_id:accId,user_id:userId})));
  if(error){toast('Erreur : '+error.message,'err');return;}
  toast(TEST_TRADES.length+' trades test insérés ✅','ok');
  await loadTrades();
  if(S_dashMonths.size>0)applyDashFilter();else{renderStats();renderCharts();}
  renderMonthly();renderJournal();
}

async function deleteTestData(){
  showConfirm('Supprimer les données test ?','Tous les trades TEST seront supprimés.',async()=>{
    const{error}=await sb.from('trades').delete().eq('is_test',true);
    if(error){toast('Erreur : '+error.message,'err');return;}
    toast('Données test supprimées','ok');await loadTrades();renderStats();await renderCharts();renderMonthly();renderJournal();
  });
}

function confirmReset(){
  if(!S.isSuperAdmin){toast('Action réservée à l\'administrateur','err');return;}
  showConfirm('⚠ Réinitialiser TOUTES les données ?','Tous les trades (réels et test) seront supprimés. IRRÉVERSIBLE.',async()=>{
    const{error}=await sb.from('trades').delete().neq('id','00000000-0000-0000-0000-000000000000');
    if(error){toast('Erreur : '+error.message,'err');return;}
    toast('Toutes les données supprimées','ok');await loadTrades();renderStats();await renderCharts();renderMonthly();renderJournal();
  },'TOUT SUPPRIMER');
}


// ════════════════════════════════════════════════════════════════════
// CURRENCY REPORT MODULE
// ════════════════════════════════════════════════════════════════════

let S_curCode = 'USD';
// V9.2 FIX FUSEAU : fmtYM au lieu de toISOString.slice(0,7) pour éviter le décalage de mois
let S_rptMonth = fmtYM(new Date());

function initCurrencyWeek(){
  const now=new Date();
  S_rptMonth=fmtYM(now);
  const day=now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()-(day===0?6:day-1));
  const wd=document.getElementById('rpt-week');if(wd)wd.value=fmtYMD(mon);
}

function handleCurFile(input,code,zone){
  const file=input.files[0];if(file)setCurImg(code,zone,file);input.value='';
}
function handleCurDrop(e,code,zone){
  e.preventDefault();
  const file=e.dataTransfer.files[0];if(file&&file.type.startsWith('image/'))setCurImg(code,zone,file);
}
// ════════════════════════════════════════════════════════════════════
// V9.4 — Gestion images currency reports : persistance IMMÉDIATE
// ════════════════════════════════════════════════════════════════════
// Bug fix : avant, setCurImg ne déclenchait pas la sauvegarde DB. L'image
// restait en mémoire jusqu'à une autre action. Maintenant : upload direct
// dès le dépôt, DELETE-then-INSERT propre, signed URL cachée localement.

// V9.12 — Mémorise la dernière zone de capture cliquée (pour le paste Ctrl+V ciblé)
function focusCurZone(code, zone){
  window._lastFocusedCurZone = {code, zone};
}

async function setCurImg(code,zone,file){
  if(!window._curImgCache)window._curImgCache={};
  const key=zone+'-'+code;
  // 1) Affichage immédiat via dataURL pour feedback instantané
  const dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(file);});
  window._curImgCache[key]={url:dataUrl,isRemote:false,uploading:true};
  const img=document.getElementById('cpimg-'+zone+'-'+code);
  const hint=document.getElementById('cphint-'+zone+'-'+code);
  const zoneEl=document.getElementById('cpz-'+zone+'-'+code);
  if(img){img.src=dataUrl;img.style.display='block';}
  if(hint)hint.style.display='none';
  if(zoneEl){zoneEl.classList.add('has-img');zoneEl.classList.add('uploading');}
  // 2) Persister en DB immédiatement
  try{
    await persistCurImg(code,zone,file);
    if(zoneEl)zoneEl.classList.remove('uploading');
    if(window._curImgCache[key])window._curImgCache[key].uploading=false;
    toast(code+' · '+(zone==='pm'?'Politique Monétaire':'Graphique Hebdo')+' sauvegardé ✅','ok');
  }catch(e){
    console.error('Image upload failed:',e);
    if(zoneEl)zoneEl.classList.remove('uploading');
    toast('Erreur upload image : '+(e.message||e),'err');
  }
}

// Upload + INSERT idempotent (supprime l'image existante avant)
async function persistCurImg(code,zone,file){
  const week=document.getElementById('rpt-week')?.value;
  const wsId=S.currentWorkspaceId||S.workspaceId;
  if(!week||!wsId)throw new Error('Semaine ou workspace manquant');
  // a) Récupérer ou créer le report
  let rptId=null;
  const{data:ex}=await sb.from('currency_reports').select('id').eq('week_start',week).eq('workspace_id',wsId).maybeSingle();
  if(ex)rptId=ex.id;
  else{
    const{data:nr,error}=await sb.from('currency_reports').insert({week_start:week,workspace_id:wsId}).select().single();
    if(error)throw error;
    rptId=nr.id;
  }
  S._currentRptId=rptId;
  // b) Récupérer ou créer l'entry
  let entryId=null;
  const{data:ex2}=await sb.from('currency_report_entries').select('id').eq('report_id',rptId).eq('currency',code).maybeSingle();
  if(ex2)entryId=ex2.id;
  else{
    const{data:ne,error}=await sb.from('currency_report_entries').insert({report_id:rptId,currency:code,last_edited_by_client:CLIENT_ID}).select().single();
    if(error)throw error;
    entryId=ne.id;
    if(S._entryIdToCurrency)S._entryIdToCurrency[entryId]=code;
  }
  // c) Supprimer les anciennes images de cette zone
  const{data:olds}=await sb.from('currency_report_images').select('id,storage_path').eq('entry_id',entryId).eq('image_type',zone);
  if(olds&&olds.length){
    for(const o of olds){try{await sb.storage.from(BUCKET).remove([o.storage_path]);}catch(_){}}
    await sb.from('currency_report_images').delete().eq('entry_id',entryId).eq('image_type',zone);
  }
  // d) Upload Storage
  const ext=((file.name||'img').split('.').pop()||'png').toLowerCase().replace(/[^a-z0-9]/g,'')||'png';
  const path=`currency/${rptId}/${code}/${zone}_${Date.now()}.${ext}`;
  const{error:ue}=await sb.storage.from(BUCKET).upload(path,file,{upsert:false});
  if(ue)throw ue;
  // e) INSERT en DB — image_type est OBLIGATOIRE (V9.4 colonne ajoutée + check pm/gh)
  const{error:ie}=await sb.from('currency_report_images').insert({
    entry_id:entryId,storage_path:path,filename:zone+'.'+ext,
    file_size:file.size,image_type:zone,uploaded_by_client:CLIENT_ID
  });
  if(ie)throw ie;
  // f) Cache local avec signed URL
  try{
    const{data:u}=await sb.storage.from(BUCKET).createSignedUrl(path,3600);
    if(u){window._curImgCache[zone+'-'+code]={url:u.signedUrl,isRemote:true,path};}
  }catch(_){}
}

// Suppression : DB + Storage + cache local
async function clearCurImg(code,zone){
  const key=zone+'-'+code;
  const img=document.getElementById('cpimg-'+zone+'-'+code);
  const hint=document.getElementById('cphint-'+zone+'-'+code);
  const zoneEl=document.getElementById('cpz-'+zone+'-'+code);
  if(img){img.src='';img.style.display='none';}
  if(hint)hint.style.display='';
  if(zoneEl)zoneEl.classList.remove('has-img');
  if(window._curImgCache)window._curImgCache[key]=null;
  try{
    const week=document.getElementById('rpt-week')?.value;
    const wsId=S.currentWorkspaceId||S.workspaceId;
    if(!week||!wsId)return;
    const{data:rpt}=await sb.from('currency_reports').select('id').eq('week_start',week).eq('workspace_id',wsId).maybeSingle();
    if(!rpt)return;
    const{data:entry}=await sb.from('currency_report_entries').select('id').eq('report_id',rpt.id).eq('currency',code).maybeSingle();
    if(!entry)return;
    const{data:imgs}=await sb.from('currency_report_images').select('id,storage_path').eq('entry_id',entry.id).eq('image_type',zone);
    if(imgs&&imgs.length){
      for(const i of imgs){try{await sb.storage.from(BUCKET).remove([i.storage_path]);}catch(_){}}
      await sb.from('currency_report_images').delete().eq('entry_id',entry.id).eq('image_type',zone);
    }
  }catch(e){console.error('clearCurImg DB:',e);}
}

async function loadCurrencyReport(){
  flushCurrentViewToCache();
  const week=document.getElementById('rpt-week')?.value;
  if(!week)return;
  // V9.3 FIX FND-001 : filtre par workspace_id (rapports partagés)
  const wsId=S.currentWorkspaceId||S.workspaceId;
  let q=sb.from('currency_reports').select('*,currency_report_entries(*,currency_report_images(*))').eq('week_start',week);
  if(wsId)q=q.eq('workspace_id',wsId);
  const{data}=await q.maybeSingle();
  window._curBiasCache={};window._curNotesCache={};window._curImgCache={};
  window._curLastSaved={}; // V9.4 — reset signatures pour le merge save
  // V9.4 : track le report id courant pour la synchro realtime
  S._currentRptId=data?.id||null;
  // V9.4 : map entry_id → currency pour les updates realtime
  S._entryIdToCurrency={};
  if(data){
    const aSigner=[]; // v=5 : [zone, devise, chemin] signés ensuite en UNE requête
    for(const entry of(data.currency_report_entries||[])){
      window._curBiasCache[entry.currency]=entry.bias||'';
      window._curNotesCache[entry.currency]=entry.notes||'';
      // Signature initiale = état distant : skip save tant qu'aucune modif locale
      window._curLastSaved[entry.currency]=JSON.stringify([entry.bias||null,entry.notes||null]);
      S._entryIdToCurrency[entry.id]=entry.currency;
      if(entry.currency_report_images?.length){
        // V9.4 : dédup par zone — garde la plus récente si plusieurs en doublon
        const byZone={};
        for(const img of entry.currency_report_images){
          const zone=img.image_type||'pm';
          if(!byZone[zone]||new Date(img.created_at)>new Date(byZone[zone].created_at)){
            byZone[zone]=img;
          }
        }
        for(const zone in byZone)aSigner.push([zone,entry.currency,byZone[zone].storage_path]);
      }
    }
    const liens=await signerChemins(aSigner.map(a=>a[2]));
    for(const[zone,code,chemin]of aSigner){
      if(liens[chemin])window._curImgCache[zone+'-'+code]={url:liens[chemin],isRemote:true,path:chemin};
    }
  }
  renderCurrencyView();refreshCurrencyBtnColors();
  // V9.4 : (re)connecter le canal realtime pour cette semaine
  subscribeRealtimeForCurrentReport();
}

function flushCurrentViewToCache(){
  if(!window._curBiasCache)window._curBiasCache={};
  if(!window._curNotesCache)window._curNotesCache={};
  const code=S_curCode;
  const biasEl=document.getElementById('bias-'+code);
  const notesEl=document.getElementById('cnotes-'+code);
  if(biasEl)window._curBiasCache[code]=biasEl.value||'';
  // V9.4 : notes est un contenteditable → on lit innerHTML sanitizé
  if(notesEl){
    const raw=notesEl.innerHTML||'';
    window._curNotesCache[code]=sanitizeNotesHtml(raw);
  }
}
// V9.4 : sauve bias + notes avant changement. Les images sont déjà persistées au dépôt.
async function flushAndSaveBeforeSwitch(){
  flushCurrentViewToCache();
  const week=document.getElementById('rpt-week')?.value;
  if(!week)return;
  const hasData=Object.values(window._curBiasCache||{}).some(v=>v)
              ||Object.values(window._curNotesCache||{}).some(v=>v);
  if(!hasData)return;
  try{
    await saveCurrencyReport(true);
  }catch(e){
    console.error('Flush save failed:',e);
    toast('⚠ Sauvegarde échouée avant changement','err');
  }
}

// ════════════════════════════════════════════════════════════════════
// V9.4 — ÉDITEUR RICH-TEXT (Gras, Italique, Souligné, Surlignage 4 couleurs)
// ════════════════════════════════════════════════════════════════════

// Whitelist HTML : on n'accepte que les balises de mise en forme inline.
// V9.5 — On accepte SPAN avec style color (couleur de texte), plus de MARK background.
// On garde MARK dans la whitelist en mode rétro-compat (anciennes sauvegardes
// avec surlignage seront affichées correctement, mais on n'en crée plus de nouveaux).
const ALLOWED_INLINE_TAGS=['B','STRONG','I','EM','U','MARK','BR','SPAN','DIV','P','UL','OL','LI','FONT'];
const ALLOWED_TEXT_COLORS=['#ff4d6a','#5aadff','#00d68f','#f0c040'];
const ALLOWED_MARK_COLORS=['#ff4d6a','#5aadff','#00d68f','#f0c040'];
function sanitizeNotesHtml(html){
  if(!html)return '';
  // FND-012 : parsing inerte via DOMParser (aucun chargement de ressource / onerror pendant le parse)
  const tpl=new DOMParser().parseFromString(html,'text/html').body;
  (function walk(node){
    const children=Array.from(node.childNodes);
    for(const c of children){
      if(c.nodeType===1){ // ELEMENT
        const tag=c.tagName;
        if(!ALLOWED_INLINE_TAGS.includes(tag)){
          while(c.firstChild)c.parentNode.insertBefore(c.firstChild,c);
          c.parentNode.removeChild(c);
          continue;
        }
        // FONT (legacy execCommand foreColor) → on convertit en SPAN style color
        if(tag==='FONT'){
          const fontColor=c.getAttribute('color')||'';
          const hex=normalizeColor(fontColor);
          const span=document.createElement('span');
          if(hex&&ALLOWED_TEXT_COLORS.includes(hex))span.style.color=hex;
          while(c.firstChild)span.appendChild(c.firstChild);
          c.parentNode.replaceChild(span,c);
          walk(span);
          continue;
        }
        // SPAN : on garde uniquement style color si dans la whitelist
        if(tag==='SPAN'){
          const col=c.style.color||'';
          const hex=normalizeColor(col);
          Array.from(c.attributes).forEach(a=>c.removeAttribute(a.name));
          if(hex&&ALLOWED_TEXT_COLORS.includes(hex))c.style.color=hex;
          else{
            // span sans couleur valide → on le déballe
            while(c.firstChild)c.parentNode.insertBefore(c.firstChild,c);
            c.parentNode.removeChild(c);
            continue;
          }
          walk(c);
          continue;
        }
        // MARK (legacy) : retro-compat — on convertit en SPAN color
        if(tag==='MARK'){
          const bg=c.style.backgroundColor||c.style.background||'';
          const hex=normalizeColor(bg);
          const span=document.createElement('span');
          if(hex&&ALLOWED_MARK_COLORS.includes(hex))span.style.color=hex;
          while(c.firstChild)span.appendChild(c.firstChild);
          c.parentNode.replaceChild(span,c);
          walk(span);
          continue;
        }
        // Autres tags autorisés : on nettoie tous les attributs
        Array.from(c.attributes).forEach(a=>c.removeAttribute(a.name));
        walk(c);
      }else if(c.nodeType!==3){ // 3 = TEXT
        c.parentNode.removeChild(c);
      }
    }
  })(tpl);
  return tpl.innerHTML;
}
function normalizeColor(s){
  if(!s)return '';
  s=String(s).trim().toLowerCase();
  if(s.startsWith('#')){
    if(s.length===4){return '#'+s[1]+s[1]+s[2]+s[2]+s[3]+s[3];}
    return s;
  }
  const m=s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if(!m)return '';
  return '#'+[m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join('');
}

// V9.7 — Input handler : 
//   1) flush cache local
//   2) BROADCAST immédiat aux autres pairs (live caractère par caractère)
//   3) schedule auto-save DB (1s debounced)
function onNotesInput(code,el){
  if(!window._curNotesCache)window._curNotesCache={};
  const sanitized=sanitizeNotesHtml(el.innerHTML||'');
  window._curNotesCache[code]=sanitized;
  // Broadcast live (pas de DB) — instantané
  if(_realtimeChan){
    try{
      _realtimeChan.send({
        type:'broadcast',event:'live_notes',
        payload:{client:CLIENT_ID,user:S.appUser?.name||'?',currency:code,html:sanitized}
      });
    }catch(_){}
  }
  scheduleAutoSave();
}
// Paste : on force le texte brut (jamais coller du HTML externe non maîtrisé)
function onNotesPaste(e){
  e.preventDefault();
  const text=(e.clipboardData||window.clipboardData).getData('text/plain');
  document.execCommand('insertText',false,text);
}

// Toolbar — apparaît au-dessus de la sélection si elle est dans un .cur-notes-rich
function showFormatToolbarMaybe(ev,code){
  const tb=document.getElementById('format-toolbar');
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||sel.rangeCount===0){if(tb)tb.classList.remove('visible');return;}
  const range=sel.getRangeAt(0);
  // Vérifie que la sélection est dans le contenteditable notes
  let node=range.commonAncestorContainer;
  if(node.nodeType===3)node=node.parentNode;
  if(!node||!node.closest||!node.closest('.cur-notes-rich')){if(tb)tb.classList.remove('visible');return;}
  const rect=range.getBoundingClientRect();
  if(!rect||(rect.width===0&&rect.height===0)){if(tb)tb.classList.remove('visible');return;}
  tb.classList.add('visible');
  // Positionner au-dessus de la sélection
  const tbW=tb.offsetWidth||280;
  let left=rect.left+rect.width/2-tbW/2;
  left=Math.max(8,Math.min(window.innerWidth-tbW-8,left));
  let top=rect.top-tb.offsetHeight-8;
  if(top<8)top=rect.bottom+8;
  tb.style.left=left+'px';
  tb.style.top=top+'px';
  // Mettre à jour l'état actif des boutons B/I/U
  ['bold','italic','underline'].forEach((cmd,i)=>{
    const btn=tb.children[i];
    if(!btn)return;
    try{
      if(document.queryCommandState(cmd))btn.classList.add('active');
      else btn.classList.remove('active');
    }catch(_){}
  });
}
document.addEventListener('selectionchange',()=>{
  // Cache la toolbar si la sélection sort de l'éditeur
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed){
    const tb=document.getElementById('format-toolbar');
    if(tb)tb.classList.remove('visible');
  }
});

function applyFmt(cmd){
  document.execCommand(cmd,false,null);
  const focusCode=window._curNotesFocus;
  if(focusCode){
    const el=document.getElementById('cnotes-'+focusCode);
    if(el)onNotesInput(focusCode,el);
  }
}
// V9.5 — Couleur de texte (remplace l'ancien applyHighlight surlignage)
function applyTextColor(color){
  const sel=window.getSelection();
  if(!sel||sel.isCollapsed||sel.rangeCount===0)return;
  const range=sel.getRangeAt(0);
  let node=range.commonAncestorContainer;
  if(node.nodeType===3)node=node.parentNode;
  if(!node||!node.closest||!node.closest('.cur-notes-rich'))return;
  if(color===null){
    // Retirer la couleur : déballer les SPAN/FONT colorés dans la sélection
    const frag=range.extractContents();
    const tpl=document.createElement('div');tpl.appendChild(frag);
    tpl.querySelectorAll('span[style*="color"],font[color],mark').forEach(el=>{
      while(el.firstChild)el.parentNode.insertBefore(el.firstChild,el);
      el.parentNode.removeChild(el);
    });
    while(tpl.firstChild)range.insertNode(tpl.firstChild);
  }else{
    if(!ALLOWED_TEXT_COLORS.includes(color))return;
    // On enveloppe la sélection dans un <span style="color:...">
    const span=document.createElement('span');
    span.style.color=color;
    try{
      span.appendChild(range.extractContents());
      // Nettoyer les couleurs imbriquées résiduelles avant insertion
      span.querySelectorAll('span[style*="color"],font[color]').forEach(el=>{
        while(el.firstChild)el.parentNode.insertBefore(el.firstChild,el);
        el.parentNode.removeChild(el);
      });
      range.insertNode(span);
    }catch(_){}
  }
  sel.removeAllRanges();
  const focusCode=window._curNotesFocus;
  if(focusCode){
    const el=document.getElementById('cnotes-'+focusCode);
    if(el)onNotesInput(focusCode,el);
  }
}
// Alias rétro-compat : si du code ailleurs appelle encore applyHighlight, on redirige.
function applyHighlight(color){return applyTextColor(color);}

// ════════════════════════════════════════════════════════════════════
// V9.4 — REALTIME : synchronisation notes + bias + images en direct
// ════════════════════════════════════════════════════════════════════
// Quand Sylas et Killian sont sur la même semaine, les modifs de l'un
// apparaissent chez l'autre en ~200-500ms via le canal Postgres Changes.
// Anti-ping-pong fiable : chaque écriture porte CLIENT_ID, les events qui
// reviennent avec notre propre CLIENT_ID sont ignorés.

let _realtimeChan=null;
let _realtimeRptId=null;
let _presenceTimer=null;

function subscribeRealtimeForCurrentReport(){
  unsubscribeRealtime();
  const rptId=S._currentRptId;
  if(!rptId||!sb)return;
  _realtimeRptId=rptId;
  _realtimeChan=sb.channel('rpt-'+rptId,{config:{broadcast:{self:false,ack:false},presence:{key:CLIENT_ID}}})
    .on('postgres_changes',
        {event:'*',schema:'public',table:'currency_report_entries',filter:'report_id=eq.'+rptId},
        onRemoteEntryChange)
    .on('postgres_changes',
        {event:'*',schema:'public',table:'currency_report_images'},
        onRemoteImageChange)
    // V9.7 — Broadcast LIVE : chaque frappe est envoyée immédiatement à tous les
    // pairs sans passer par la DB. La DB n'est touchée qu'à l'auto-save (1s debounce)
    // pour la persistance. Cela donne une expérience caractère-par-caractère.
    .on('broadcast',{event:'live_notes'},onRemoteLiveNotes)
    .on('broadcast',{event:'live_bias'},onRemoteLiveBias)
    .on('broadcast',{event:'cursor_currency'},onRemoteCursorCurrency)
    // Presence : qui est en train d'éditer cette semaine
    .on('presence',{event:'sync'},onPresenceSync)
    .subscribe(async(status)=>{
      if(status==='SUBSCRIBED'){
        try{
          await _realtimeChan.track({
            client:CLIENT_ID,
            user:S.appUser?.name||S.authUser?.email||'Anonyme',
            color:S.appUser?.color||'#f0c040',
            currency:S_curCode,
            at:Date.now()
          });
        }catch(_){}
      }
    });
}
function unsubscribeRealtime(){
  if(_realtimeChan){
    try{sb.removeChannel(_realtimeChan);}catch(_){}
    _realtimeChan=null;_realtimeRptId=null;
  }
}
// V9.7 — Notifier les pairs qu'on a changé de devise (pour leur présence)
function broadcastCursorCurrency(){
  if(!_realtimeChan)return;
  try{
    _realtimeChan.send({type:'broadcast',event:'cursor_currency',payload:{client:CLIENT_ID,currency:S_curCode,at:Date.now()}});
    _realtimeChan.track({
      client:CLIENT_ID,
      user:S.appUser?.name||S.authUser?.email||'Anonyme',
      color:S.appUser?.color||'#f0c040',
      currency:S_curCode,
      at:Date.now()
    });
  }catch(_){}
}
function showPresence(text){
  const el=document.getElementById('presence-indicator');
  const tx=document.getElementById('presence-text');
  if(!el||!tx)return;
  tx.textContent=text;
  el.classList.add('visible');
  clearTimeout(_presenceTimer);
  _presenceTimer=setTimeout(()=>el.classList.remove('visible'),2200);
}

// V9.7 — État des autres utilisateurs connectés sur le même rapport
const _peers={}; // clientId → { user, color, currency, lastSeen }
function onPresenceSync(){
  if(!_realtimeChan)return;
  const state=_realtimeChan.presenceState();
  // Reconstruit la map _peers à partir du state
  Object.keys(_peers).forEach(k=>{delete _peers[k];});
  for(const key in state){
    for(const meta of state[key]){
      if(meta.client&&meta.client!==CLIENT_ID){
        _peers[meta.client]={user:meta.user||'?',color:meta.color||'#f0c040',currency:meta.currency||'',lastSeen:Date.now()};
      }
    }
  }
  refreshPeersBadge();
}
function refreshPeersBadge(){
  const peersOnCur=Object.values(_peers).filter(p=>p.currency===S_curCode);
  const indicator=document.getElementById('presence-indicator');
  const text=document.getElementById('presence-text');
  if(!indicator||!text)return;
  if(peersOnCur.length>0){
    text.innerHTML=peersOnCur.map(p=>`<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${p.color};margin-right:4px"></span>${esc(p.user)} édite ${S_curCode}`).join(' &nbsp;·&nbsp; ');
    indicator.classList.add('visible');
    clearTimeout(_presenceTimer);
    // Garde l'indicateur visible tant qu'il y a quelqu'un
  }
  // Sinon on laisse showPresence gérer l'affichage transitoire
}
function onRemoteCursorCurrency(payload){
  const data=payload.payload||payload;
  if(!data||data.client===CLIENT_ID)return;
  refreshPeersBadge();
}

// V9.7 — Réception d'une frappe live des notes (broadcast, pas DB)
function onRemoteLiveNotes(payload){
  const data=payload.payload||payload;
  if(!data||data.client===CLIENT_ID)return;
  const code=data.currency;const html=data.html;
  if(!code)return;
  // Met à jour le cache local (pour que saveCurrencyReport reflète le dernier état)
  window._curNotesCache=window._curNotesCache||{};
  window._curNotesCache[code]=sanitizeNotesHtml(html||'');
  // Si on regarde cette devise ET qu'on n'est PAS en train de taper dedans,
  // on patch le DOM en préservant la position du curseur si on est focus ailleurs.
  if(code===S_curCode&&window._curNotesFocus!==code){
    const notesEl=document.getElementById('cnotes-'+code);
    if(notesEl&&notesEl.innerHTML!==window._curNotesCache[code]){
      notesEl.innerHTML=window._curNotesCache[code];
    }
  }
  showPresence('✏ '+(data.user||'Quelqu\'un')+' écrit dans '+code);
}
// V9.7 — Réception live du bias
function onRemoteLiveBias(payload){
  const data=payload.payload||payload;
  if(!data||data.client===CLIENT_ID)return;
  const code=data.currency;
  if(!code)return;
  window._curBiasCache=window._curBiasCache||{};
  window._curBiasCache[code]=data.bias||'';
  if(code===S_curCode){
    const biasEl=document.getElementById('bias-'+code);
    if(biasEl&&biasEl.value!==(data.bias||'')){
      biasEl.value=data.bias||'';
      try{updateBiasCache(code,biasEl);}catch(_){}
    }
  }
  refreshCurrencyBtnColors();
  showPresence('▣ '+(data.user||'Quelqu\'un')+' modifie bias '+code);
}

function onRemoteEntryChange(payload){
  const row=payload.new||payload.old;
  if(!row||row.report_id!==_realtimeRptId)return;
  // V9.4 — anti-ping-pong fiable : on ignore les events qu'on a soi-même émis
  if(row.last_edited_by_client===CLIENT_ID)return;
  const code=row.currency;if(!code)return;
  // Update du cache mémoire
  if(payload.eventType==='DELETE'){
    if(window._curBiasCache)delete window._curBiasCache[code];
    if(window._curNotesCache)delete window._curNotesCache[code];
    if(window._curLastSaved)delete window._curLastSaved[code];
  }else{
    window._curBiasCache=window._curBiasCache||{};
    window._curNotesCache=window._curNotesCache||{};
    window._curBiasCache[code]=row.bias||'';
    window._curNotesCache[code]=sanitizeNotesHtml(row.notes||'');
    if(row.id&&S._entryIdToCurrency)S._entryIdToCurrency[row.id]=code;
    // Mettre à jour _curLastSaved pour éviter de réécrire ce qu'on vient juste de recevoir
    if(window._curLastSaved){
      window._curLastSaved[code]=JSON.stringify([row.bias||null,row.notes||null]);
    }
  }
  // Mise à jour visuelle si on regarde cette devise
  if(code===S_curCode){
    const biasEl=document.getElementById('bias-'+code);
    if(biasEl&&biasEl.value!==(row.bias||'')){
      biasEl.value=row.bias||'';
      try{updateBiasCache(code,biasEl);}catch(_){}
    }
    const notesEl=document.getElementById('cnotes-'+code);
    // Ne PAS écraser si l'utilisateur tape (focus) → on attendra son blur
    if(notesEl&&window._curNotesFocus!==code){
      notesEl.innerHTML=window._curNotesCache[code]||'';
    }
  }
  refreshCurrencyBtnColors();
  showPresence('✏ '+code+' mis à jour');
}

async function onRemoteImageChange(payload){
  const row=payload.new||payload.old;
  if(!row)return;
  // V9.4 — anti-ping-pong via CLIENT_ID
  if((payload.new&&payload.new.uploaded_by_client===CLIENT_ID))return;
  const entryId=row.entry_id;
  let code=S._entryIdToCurrency?.[entryId];
  if(!code){
    try{
      const{data:e}=await sb.from('currency_report_entries').select('id,currency,report_id').eq('id',entryId).maybeSingle();
      if(!e||e.report_id!==_realtimeRptId)return;
      if(S._entryIdToCurrency)S._entryIdToCurrency[entryId]=e.currency;
      code=e.currency;
    }catch(_){return;}
  }
  const zone=row.image_type||'pm';
  const key=zone+'-'+code;
  if(payload.eventType==='DELETE'){
    if(window._curImgCache)window._curImgCache[key]=null;
    if(code===S_curCode){
      const img=document.getElementById('cpimg-'+zone+'-'+code);
      const hint=document.getElementById('cphint-'+zone+'-'+code);
      const zoneEl=document.getElementById('cpz-'+zone+'-'+code);
      if(img){img.src='';img.style.display='none';}
      if(hint)hint.style.display='';
      if(zoneEl)zoneEl.classList.remove('has-img');
    }
    showPresence('🗑 '+code+' '+(zone==='pm'?'PM':'GH')+' retirée');
  }else{
    try{
      const{data:u}=await sb.storage.from(BUCKET).createSignedUrl(row.storage_path,3600);
      if(!u)return;
      window._curImgCache=window._curImgCache||{};
      window._curImgCache[key]={url:u.signedUrl,isRemote:true,path:row.storage_path};
      if(code===S_curCode){
        const img=document.getElementById('cpimg-'+zone+'-'+code);
        const hint=document.getElementById('cphint-'+zone+'-'+code);
        const zoneEl=document.getElementById('cpz-'+zone+'-'+code);
        if(img){img.src=u.signedUrl;img.style.display='block';}
        if(hint)hint.style.display='none';
        if(zoneEl)zoneEl.classList.add('has-img');
      }
      showPresence('📷 '+code+' '+(zone==='pm'?'PM':'GH')+' mise à jour');
    }catch(e){console.error('onRemoteImageChange:',e);}
  }
}

// Désabonnement automatique quand on quitte la section currency
window.addEventListener('beforeunload',()=>{try{unsubscribeRealtime();}catch(_){}});

async function saveCurrencyReport(silent=false){
  flushCurrentViewToCache();
  const week=document.getElementById('rpt-week')?.value;
  const wsId=S.currentWorkspaceId||S.workspaceId;
  if(!week){if(!silent)toast('Sélectionnez une semaine','err');return;}
  if(!wsId){if(!silent)toast('Workspace inconnu, sauvegarde impossible','err');return;}
  try{
    // V9.4 — saveCurrencyReport ne touche QUE bias + notes (images via persistCurImg).
    let rptId=S._currentRptId;
    if(!rptId){
      const{data:ex}=await sb.from('currency_reports').select('id').eq('week_start',week).eq('workspace_id',wsId).maybeSingle();
      if(ex)rptId=ex.id;
      else{
        const{data:nr,error}=await sb.from('currency_reports').insert({week_start:week,workspace_id:wsId}).select().single();
        if(error)throw error;
        rptId=nr.id;
      }
      S._currentRptId=rptId;
    }
    if(!window._curLastSaved)window._curLastSaved={};
    let touchedSomething=false;
    // V9.10 — On itère sur les 8 devises + l'entry spéciale BILAN (notes uniquement)
    const saveCodes=[...CURRENCIES.map(c=>c.code),'BILAN'];
    for(const code of saveCodes){
      // Valeurs CURRENTES en cache local
      const localBias=(window._curBiasCache||{})[code];      // string | undefined | ''
      const localNotes=(window._curNotesCache||{})[code];    // string | undefined
      const localBiasNorm=(localBias===undefined||localBias==='')?null:localBias;
      const localNotesNorm=(localNotes===undefined||localNotes==='')?null:localNotes;
      // Signature pour le shortcut "rien à faire"
      const sig=JSON.stringify([localBiasNorm,localNotesNorm]);
      if(window._curLastSaved[code]===sig)continue;
      // Lire l'entry existante pour merge intelligent
      const{data:ex2}=await sb.from('currency_report_entries').select('id,bias,notes,last_edited_by_client').eq('report_id',rptId).eq('currency',code).maybeSingle();
      // V9.4 FIX BIAS — Merge intelligent :
      // Si on n'a JAMAIS touché à ce champ localement (cache vide pour cette devise),
      // on PRÉSERVE la valeur distante. Cela évite d'écraser les notes/bias d'un autre user
      // quand on enregistre sur une autre devise.
      const everTouchedHere=window._curLastSaved.hasOwnProperty(code+'__touched');
      // Champ par champ : si jamais touché localement → garde la valeur distante
      const biasInCache=(window._curBiasCache||{}).hasOwnProperty(code);
      const notesInCache=(window._curNotesCache||{}).hasOwnProperty(code);
      const mergedBias=biasInCache?localBiasNorm:(ex2?.bias||null);
      const mergedNotes=notesInCache?localNotesNorm:(ex2?.notes||null);
      // Skip si rien à enregistrer
      if(mergedBias===null&&mergedNotes===null&&!ex2){window._curLastSaved[code]=sig;continue;}
      // Skip si l'entry existante a déjà ces valeurs
      if(ex2&&ex2.bias===mergedBias&&ex2.notes===mergedNotes){window._curLastSaved[code]=sig;continue;}
      const payload={bias:mergedBias,notes:mergedNotes,last_edited_by_client:CLIENT_ID,updated_at:new Date().toISOString()};
      if(ex2){
        const{error}=await sb.from('currency_report_entries').update(payload).eq('id',ex2.id);
        if(error)throw error;
      }else{
        const{data:ne,error}=await sb.from('currency_report_entries').insert({report_id:rptId,currency:code,...payload}).select().single();
        if(error)throw error;
        if(ne&&S._entryIdToCurrency)S._entryIdToCurrency[ne.id]=code;
      }
      window._curLastSaved[code]=JSON.stringify([mergedBias,mergedNotes]);
      touchedSomething=true;
    }
    if(touchedSomething){
      await sb.from('currency_reports').update({updated_at:new Date().toISOString()}).eq('id',rptId);
    }
    if(!silent)toast('Rapport sauvegardé ✅','ok');
  }catch(e){console.error(e);if(!silent)toast('Erreur : '+e.message,'err');}
}

// ─── MONTH/WEEK SELECTORS ───
// ════════════════════════════════════════════════════════════════════
// V9.7 — SPLITTERS DASHBOARD (drag horizontal + drag vertical)
// ════════════════════════════════════════════════════════════════════
function initDashSplitters(){
  const main=document.getElementById('dash-main');
  const topRow=document.getElementById('dash-top-row');
  if(!main||!topRow)return;
  // Restaurer positions sauvegardées
  try{
    const savedTop=localStorage.getItem('dash-top-h');
    const savedLeft=localStorage.getItem('dash-left-w');
    if(savedTop)main.style.setProperty('--dash-top-h',savedTop);
    if(savedLeft)topRow.style.setProperty('--dash-left-w',savedLeft);
  }catch(_){}

  // --- Splitter HORIZONTAL (haut/bas) ---
  const splitH=document.getElementById('dash-splitter-h');
  if(splitH){
    splitH.addEventListener('mousedown',e=>{
      e.preventDefault();
      splitH.classList.add('dragging');
      document.body.classList.add('dash-dragging-h');
      const startY=e.clientY;
      const mainRect=main.getBoundingClientRect();
      const startTopH=topRow.getBoundingClientRect().height;
      function onMove(ev){
        const dy=ev.clientY-startY;
        let newTopH=startTopH+dy;
        // Bornes : 120px min en haut, 140px min en bas (pour le chart)
        const min=120, max=mainRect.height-140-5;
        newTopH=Math.max(min,Math.min(max,newTopH));
        const pct=(newTopH/mainRect.height*100).toFixed(2)+'%';
        main.style.setProperty('--dash-top-h',pct);
        // Resize les charts (Chart.js doit recalculer)
        if(S.chartBal)S.chartBal.resize();
        if(S.chartRR)S.chartRR.resize();
      }
      function onUp(){
        splitH.classList.remove('dragging');
        document.body.classList.remove('dash-dragging-h');
        document.removeEventListener('mousemove',onMove);
        document.removeEventListener('mouseup',onUp);
        try{localStorage.setItem('dash-top-h',getComputedStyle(main).getPropertyValue('--dash-top-h')||'45%');}catch(_){}
      }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    });
  }

  // --- Splitter VERTICAL (gauche/droite sur la rangée haut) ---
  const splitV=document.getElementById('dash-splitter-v');
  if(splitV){
    splitV.addEventListener('mousedown',e=>{
      e.preventDefault();
      splitV.classList.add('dragging');
      document.body.classList.add('dash-dragging');
      const startX=e.clientX;
      const rowRect=topRow.getBoundingClientRect();
      const startLeftW=document.getElementById('stats-panel').getBoundingClientRect().width;
      function onMove(ev){
        const dx=ev.clientX-startX;
        let newLeftW=startLeftW+dx;
        const min=180, max=rowRect.width-220-5;
        newLeftW=Math.max(min,Math.min(max,newLeftW));
        const pct=(newLeftW/rowRect.width*100).toFixed(2)+'%';
        topRow.style.setProperty('--dash-left-w',pct);
        if(S.chartRR)S.chartRR.resize();
      }
      function onUp(){
        splitV.classList.remove('dragging');
        document.body.classList.remove('dash-dragging');
        document.removeEventListener('mousemove',onMove);
        document.removeEventListener('mouseup',onUp);
        try{localStorage.setItem('dash-left-w',getComputedStyle(topRow).getPropertyValue('--dash-left-w')||'38%');}catch(_){}
      }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    });
  }
}

// ════════════════════════════════════════════════════════════════════
// V9.9 — SECTION MACRO (données macroéconomiques)
// Sources gratuites sans clé : World Bank (annuel, historique long),
// IMF DataMapper (annuel + prévisions). OCDE en option future (SDMX complexe).
// PMI : alimenté manuellement (pas dispo en API gratuite sans clé).
// ════════════════════════════════════════════════════════════════════

// Mapping de nos 8 zones vers les codes pays des APIs.
//   wb  = code World Bank (ISO-2, sauf zone euro = XC/EMU)
//   imf = code IMF DataMapper (ISO-3)
//   Pour la zone euro on prend la zone agrégée quand dispo, sinon l'Allemagne (DE) en proxy.
const MACRO_ZONES = [
  {code:'USD', label:'USD', name:'États-Unis',       cc:'us', wb:'USA', imf:'USA'},
  {code:'EUR', label:'EUR', name:'Zone euro',         cc:'eu', wb:'EMU', imf:'U2'},
  {code:'GBP', label:'GBP', name:'Royaume-Uni',       cc:'gb', wb:'GBR', imf:'GBR'},
  {code:'CHF', label:'CHF', name:'Suisse',            cc:'ch', wb:'CHE', imf:'CHE'},
  {code:'CAD', label:'CAD', name:'Canada',            cc:'ca', wb:'CAN', imf:'CAN'},
  {code:'AUD', label:'AUD', name:'Australie',         cc:'au', wb:'AUS', imf:'AUS'},
  {code:'NZD', label:'NZD', name:'Nouvelle-Zélande',  cc:'nz', wb:'NZL', imf:'NZL'},
  {code:'JPY', label:'JPY', name:'Japon',             cc:'jp', wb:'JPN', imf:'JPN'},
];

// V9.13 — Configuration des 6 onglets et leurs sous-indicateurs.
//   unit  : suffixe d'affichage
//   desc  : description courte
//   Les données sont stockées EN DUR dans MACRO_DATA (saisie manuelle assistée :
//   Claude récupère les valeurs sur Trading Economics et les met à jour à la demande).
const MACRO_TABS = [
  {
    key:'inflation', label:'Inflation', icon:'📈',
    subs:[
      {key:'cpi',   label:'Inflation (CPI)',        unit:'%', desc:"Variation annuelle de l'indice des prix à la consommation (glissement annuel)."},
      {key:'core',  label:'Inflation sous-jacente', unit:'%', desc:"Inflation hors énergie et alimentation (core, glissement annuel)."},
    ]
  },
  {
    key:'unemployment', label:'Chômage', icon:'👥',
    subs:[
      {key:'rate',  label:'Taux de chômage',  unit:'%', desc:"Part de la population active sans emploi."},
    ]
  },
  {
    key:'gdp', label:'PIB', icon:'🏛️',
    subs:[
      {key:'yoy',   label:'PIB (glissement annuel)', unit:'%', desc:"Croissance du PIB réel sur un an."},
      {key:'qoq',   label:'PIB (trimestriel)',        unit:'%', desc:"Croissance du PIB réel par rapport au trimestre précédent."},
    ]
  },
  {
    key:'rates', label:"Taux d'intérêt", icon:'💰',
    subs:[
      {key:'policy', label:'Taux directeur', unit:'%', desc:"Taux directeur de la banque centrale."},
    ]
  },
  {
    key:'trade', label:'Balance commerciale', icon:'⚖️',
    subs:[
      {key:'balance', label:'Solde commercial', unit:'', desc:"Solde de la balance commerciale (exports − imports). Unité propre à chaque zone (Mds)."},
    ]
  },
  {
    key:'pmi', label:'PMI', icon:'🏭',
    subs:[
      {key:'manuf',     label:'PMI Manufacturier', unit:'', desc:"Indice PMI manufacturier (>50 = expansion)."},
      {key:'services',  label:'PMI Services',       unit:'', desc:"Indice PMI services (>50 = expansion)."},
    ]
  },
];

// ════════════════════════════════════════════════════════════════════
// V9.13 — DONNÉES MACRO EN DUR (mises à jour manuellement par Claude)
// ════════════════════════════════════════════════════════════════════
// Structure : MACRO_DATA[zoneCode][tabKey][subKey] = [ {d:'YYYY-MM', v:valeur}, ... ]
//   d = mois de référence de la donnée (YYYY-MM)
//   v = valeur (nombre) ou null si non disponible
// Les séries sont triées par date croissante. L'historique se complète au fil
// des mises à jour. Quand une valeur est inconnue, on ne l'invente pas (absente).
//
// ⚠️ Pour mettre à jour : demander à Claude « actualise les données macro ».
//    Claude récupère les dernières valeurs publiées et ajoute les nouveaux points.
const MACRO_DATA_UPDATED = '2026-05-24'; // date de dernière mise à jour des données
const MACRO_DATA = {
  USD:{
    inflation:{ cpi:[{d:'2026-01',v:3.8},{d:'2026-02',v:3.7},{d:'2026-03',v:3.8},{d:'2026-04',v:3.8}],
                core:[{d:'2026-03',v:2.7},{d:'2026-04',v:2.6}] },
    unemployment:{ rate:[{d:'2026-01',v:4.1},{d:'2026-02',v:4.2},{d:'2026-03',v:4.2},{d:'2026-04',v:4.3}] },
    gdp:{ yoy:[], qoq:[{d:'2025-12',v:0.5},{d:'2026-03',v:2.0}] },
    rates:{ policy:[{d:'2026-01',v:3.75},{d:'2026-02',v:3.75},{d:'2026-03',v:3.75},{d:'2026-04',v:3.75}] },
    trade:{ balance:[{d:'2026-01',v:-57.8},{d:'2026-02',v:-57.8},{d:'2026-03',v:-60.3}] },
    pmi:{ manuf:[{d:'2026-02',v:52.4},{d:'2026-03',v:52.7},{d:'2026-04',v:52.7}],
          services:[{d:'2026-03',v:54.0},{d:'2026-04',v:53.6}] },
  },
  EUR:{
    inflation:{ cpi:[{d:'2026-01',v:2.4},{d:'2026-02',v:2.3},{d:'2026-03',v:2.6},{d:'2026-04',v:3.0}],
                core:[{d:'2026-03',v:2.4},{d:'2026-04',v:2.3}] },
    unemployment:{ rate:[{d:'2026-01',v:6.1},{d:'2026-02',v:6.3},{d:'2026-03',v:6.2}] },
    gdp:{ yoy:[{d:'2025-12',v:1.4}], qoq:[{d:'2025-12',v:0.3}] },
    rates:{ policy:[{d:'2026-01',v:2.15},{d:'2026-02',v:2.15},{d:'2026-03',v:2.15},{d:'2026-04',v:2.15}] },
    trade:{ balance:[] },
    pmi:{ manuf:[], services:[] },
  },
  GBP:{
    inflation:{ cpi:[{d:'2026-01',v:3.0},{d:'2026-02',v:3.0},{d:'2026-03',v:3.3},{d:'2026-04',v:2.8}],
                core:[{d:'2026-01',v:3.1},{d:'2026-02',v:3.2},{d:'2026-03',v:3.2}] },
    unemployment:{ rate:[{d:'2026-01',v:5.2},{d:'2026-02',v:4.9},{d:'2026-03',v:5.0}] },
    gdp:{ yoy:[], qoq:[] },
    rates:{ policy:[{d:'2026-01',v:3.75},{d:'2026-02',v:3.75},{d:'2026-03',v:3.75},{d:'2026-04',v:3.75}] },
    trade:{ balance:[] },
    pmi:{ manuf:[], services:[] },
  },
  CHF:{
    inflation:{ cpi:[{d:'2026-03',v:0.0},{d:'2026-04',v:0.2}],
                core:[{d:'2026-03',v:0.4}] },
    unemployment:{ rate:[] },
    gdp:{ yoy:[], qoq:[] },
    rates:{ policy:[{d:'2026-01',v:0.0},{d:'2026-02',v:0.0},{d:'2026-03',v:0.0},{d:'2026-04',v:0.0}] },
    trade:{ balance:[] },
    pmi:{ manuf:[], services:[] },
  },
  CAD:{
    inflation:{ cpi:[{d:'2026-02',v:2.4},{d:'2026-03',v:2.4},{d:'2026-04',v:2.8}],
                core:[{d:'2026-03',v:2.3},{d:'2026-04',v:2.0}] },
    unemployment:{ rate:[] },
    gdp:{ yoy:[], qoq:[] },
    rates:{ policy:[] },
    trade:{ balance:[] },
    pmi:{ manuf:[], services:[] },
  },
  AUD:{
    inflation:{ cpi:[], core:[] },
    unemployment:{ rate:[] },
    gdp:{ yoy:[], qoq:[] },
    rates:{ policy:[{d:'2026-02',v:3.85}] },
    trade:{ balance:[] },
    pmi:{ manuf:[], services:[] },
  },
  NZD:{
    inflation:{ cpi:[{d:'2026-03',v:3.1}], core:[] },
    unemployment:{ rate:[{d:'2026-03',v:5.4}] },
    gdp:{ yoy:[{d:'2025-12',v:0.2}], qoq:[] },
    rates:{ policy:[{d:'2026-01',v:2.25},{d:'2026-02',v:2.25},{d:'2026-03',v:2.25},{d:'2026-04',v:2.25}] },
    trade:{ balance:[] },
    pmi:{ manuf:[], services:[] },
  },
  JPY:{
    inflation:{ cpi:[{d:'2026-02',v:1.3},{d:'2026-03',v:1.5},{d:'2026-04',v:1.4}],
                core:[{d:'2026-02',v:1.6},{d:'2026-03',v:1.8},{d:'2026-04',v:1.4}] },
    unemployment:{ rate:[] },
    gdp:{ yoy:[], qoq:[] },
    rates:{ policy:[{d:'2026-03',v:0.75},{d:'2026-04',v:0.75}] },
    trade:{ balance:[] },
    pmi:{ manuf:[], services:[] },
  },
};

// État de la section macro
let S_macroZone = 'USD';
let S_macroTab  = 'inflation';
let S_macroSub  = 'cpi';
let S_macroChartType = 'line';
let S_macroPeriod = 5; // V9.11 — nb d'années affichées (1, 3 ou 5)
let S_macroCompare = false;
let S_macroCompareZones = new Set(['USD']);
let _macroChart = null;

const MACRO_COLORS = ['#f5a623','#00d68f','#4da6ff','#ff4d6a','#9b8cff','#00cec9','#fd79a8','#e17055'];

function loadMacro(force){
  // Garantir que le sous-indicateur courant existe dans l'onglet courant
  const tab=MACRO_TABS.find(t=>t.key===S_macroTab)||MACRO_TABS[0];
  if(!tab.subs.find(s=>s.key===S_macroSub))S_macroSub=tab.subs[0].key;
  const badge=document.getElementById('macro-updated-badge');
  if(badge)badge.textContent='maj : '+fmtDateFr(MACRO_DATA_UPDATED);
  buildMacroZoneBar();
  buildMacroTabBar();
  buildMacroSubBar();
  buildMacroCompareBar();
  renderMacroChart(force);
}

function buildMacroZoneBar(){
  const el=document.getElementById('macro-zone-btns');if(!el)return;
  el.innerHTML='';
  MACRO_ZONES.forEach(z=>{
    const btn=document.createElement('button');
    btn.className='acc-tab'+(z.code===S_macroZone?' active':'');
    btn.innerHTML=flagImg(z.cc,20)+'<span style="font-size:11px;font-weight:700;letter-spacing:.03em">'+z.code+'</span>';
    btn.style.cssText='display:flex;align-items:center;gap:6px;padding:5px 13px;';
    btn.addEventListener('click',()=>{
      S_macroZone=z.code;
      // En mode comparaison, le clic sur zone principale ne change que la zone de réf
      buildMacroZoneBar();
      renderMacroChart();
    });
    el.appendChild(btn);
  });
}

function buildMacroTabBar(){
  const el=document.getElementById('macro-tab-btns');if(!el)return;
  el.innerHTML='';
  MACRO_TABS.forEach(t=>{
    const btn=document.createElement('button');
    btn.className='acc-tab'+(t.key===S_macroTab?' active':'');
    btn.innerHTML=t.icon+' '+t.label;
    btn.style.cssText='font-size:11px;padding:5px 13px;';
    btn.addEventListener('click',()=>{
      S_macroTab=t.key;
      // Reset sous-indicateur sur le 1er de l'onglet
      const tab=MACRO_TABS.find(x=>x.key===t.key);
      S_macroSub=tab.subs[0].key;
      buildMacroTabBar();
      buildMacroSubBar();
      renderMacroChart();
    });
    el.appendChild(btn);
  });
}

function buildMacroSubBar(){
  const el=document.getElementById('macro-sub-btns');if(!el)return;
  el.innerHTML='';
  const tab=MACRO_TABS.find(t=>t.key===S_macroTab);if(!tab)return;
  tab.subs.forEach(s=>{
    const btn=document.createElement('button');
    btn.className='acc-tab'+(s.key===S_macroSub?' active':'');
    btn.textContent=s.label;
    btn.style.cssText='font-size:10px;padding:4px 11px;';
    btn.addEventListener('click',()=>{
      S_macroSub=s.key;
      buildMacroSubBar();
      renderMacroChart();
    });
    el.appendChild(btn);
  });
}

function toggleMacroCompare(){
  S_macroCompare=!S_macroCompare;
  const bar=document.getElementById('macro-compare-bar');
  const btn=document.getElementById('macro-compare-btn');
  if(bar)bar.style.display=S_macroCompare?'flex':'none';
  if(btn){btn.classList.toggle('btn-amber',S_macroCompare);btn.classList.toggle('btn-ghost',!S_macroCompare);}
  if(S_macroCompare){
    // Init avec la zone courante
    S_macroCompareZones=new Set([S_macroZone]);
    buildMacroCompareBar();
  }
  renderMacroChart();
}

function buildMacroCompareBar(){
  const el=document.getElementById('macro-compare-btns');if(!el)return;
  el.innerHTML='';
  MACRO_ZONES.forEach(z=>{
    const btn=document.createElement('button');
    const on=S_macroCompareZones.has(z.code);
    btn.className='acc-tab'+(on?' active':'');
    btn.innerHTML=flagImg(z.cc,18)+'<span style="font-size:10px;font-weight:700">'+z.code+'</span>';
    btn.style.cssText='display:flex;align-items:center;gap:5px;padding:4px 10px;';
    btn.addEventListener('click',()=>{
      if(S_macroCompareZones.has(z.code)){
        if(S_macroCompareZones.size>1)S_macroCompareZones.delete(z.code);
      }else{
        S_macroCompareZones.add(z.code);
      }
      buildMacroCompareBar();
      renderMacroChart();
    });
    el.appendChild(btn);
  });
}

function setMacroChartType(type){
  S_macroChartType=type;
  document.getElementById('macro-view-line')?.classList.toggle('active',type==='line');
  document.getElementById('macro-view-bar')?.classList.toggle('active',type==='bar');
  renderMacroChart();
}

// V9.11 — Sélecteur de période (1, 3, 5 ans)
function setMacroPeriod(years){
  S_macroPeriod=years;
  [1,3,5].forEach(y=>{
    document.getElementById('macro-per-'+y)?.classList.toggle('active',y===years);
  });
  renderMacroChart();
}

function getMacroSubConfig(){
  const tab=MACRO_TABS.find(t=>t.key===S_macroTab);
  if(!tab)return null;
  return tab.subs.find(s=>s.key===S_macroSub)||tab.subs[0];
}

// V9.13 — Lecture des données EN DUR depuis MACRO_DATA (plus d'appel réseau).
// Retourne une série [{ym:'YYYY-MM', value:Number}] triée par date croissante.
function getMacroSeries(zoneCode){
  const z=MACRO_DATA[zoneCode];
  if(!z)return [];
  const tab=z[S_macroTab];
  if(!tab)return [];
  const arr=tab[S_macroSub];
  if(!Array.isArray(arr))return [];
  return arr
    .filter(p=>p&&p.d&&p.v!==null&&p.v!==undefined&&!isNaN(+p.v))
    .map(p=>({ym:p.d, value:+p.v}))
    .sort((a,b)=>a.ym<b.ym?-1:a.ym>b.ym?1:0);
}

// V9.13 — Tronque une série mensuelle aux N dernières années (selon S_macroPeriod)
function limitMonthlyToPeriod(series){
  if(!series||!series.length)return series;
  // Dernier mois disponible (toutes séries confondues, mais ici par série)
  const maxYm=series[series.length-1].ym;
  const maxYear=+maxYm.slice(0,4), maxMonth=+maxYm.slice(5,7);
  // Borne basse = maxDate - period années
  let minYear=maxYear-S_macroPeriod;
  const minYm=String(minYear).padStart(4,'0')+'-'+String(maxMonth).padStart(2,'0');
  return series.filter(d=>d.ym>=minYm);
}

// Formatte un label YYYY-MM en « janv. 26 »
const _MOIS_FR=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function fmtYmLabel(ym){
  const y=ym.slice(2,4), m=+ym.slice(5,7);
  return (_MOIS_FR[m-1]||'')+' '+y;
}

function renderMacroChart(force){
  if(!grapheDisponible(()=>renderMacroChart(force)))return;
  const sub=getMacroSubConfig();if(!sub)return;
  const tab=MACRO_TABS.find(t=>t.key===S_macroTab);
  const titleEl=document.getElementById('macro-indic-title');
  const latestEl=document.getElementById('macro-indic-latest');
  const descEl=document.getElementById('macro-indic-desc');
  const srcEl=document.getElementById('macro-indic-source');
  const errEl=document.getElementById('macro-error');
  const loadEl=document.getElementById('macro-loading');
  const tableWrap=document.getElementById('macro-table-wrap');
  if(errEl){errEl.style.display='none';errEl.textContent='';}
  if(loadEl)loadEl.style.display='none';
  if(titleEl)titleEl.textContent=(tab?tab.label+' — ':'')+sub.label;
  if(descEl)descEl.textContent=sub.desc||'';
  if(srcEl)srcEl.textContent='Source : Trading Economics · maj '+fmtDateFr(MACRO_DATA_UPDATED);

  // Zones à afficher : comparaison ou zone unique
  const zones=S_macroCompare?[...S_macroCompareZones]:[S_macroZone];

  // Récupérer + tronquer à la période choisie
  const allSeries=zones.map(zc=>({
    zone:zc,
    data:limitMonthlyToPeriod(getMacroSeries(zc))
  }));

  const hasData=allSeries.some(s=>s.data.length>0);
  if(!hasData){
    if(_macroChart){_macroChart.destroy();_macroChart=null;}
    if(latestEl)latestEl.textContent='';
    if(tableWrap)tableWrap.innerHTML='';
    if(errEl){
      errEl.style.display='block';
      errEl.style.background='rgba(245,166,35,.08)';
      errEl.style.borderColor='var(--amber3)';
      errEl.style.color='var(--amber)';
      errEl.innerHTML='ℹ Aucune donnée saisie pour <strong>'+esc(sub.label)+'</strong> sur cette zone. '
        +'Ces données se complètent au fil des mises à jour — demande à Claude « actualise les données macro » pour ajouter les derniers chiffres.';
    }
    return;
  }

  // Axe X = union des mois (YYYY-MM) de toutes les séries, trié
  const ymSet=new Set();
  allSeries.forEach(s=>s.data.forEach(d=>ymSet.add(d.ym)));
  const yms=[...ymSet].sort();
  const labels=yms.map(fmtYmLabel);

  // Datasets
  const datasets=allSeries.map((s,i)=>{
    const zoneObj=MACRO_ZONES.find(z=>z.code===s.zone);
    const idx=MACRO_ZONES.findIndex(z=>z.code===s.zone);
    const color=MACRO_COLORS[(idx>=0?idx:i)%MACRO_COLORS.length];
    const map={};s.data.forEach(d=>{map[d.ym]=d.value;});
    return {
      label:zoneObj?zoneObj.label+' · '+zoneObj.name:s.zone,
      data:yms.map(y=>map[y]??null),
      borderColor:color,
      backgroundColor:S_macroChartType==='bar'?color+'cc':color+'22',
      borderWidth:2,
      pointRadius:S_macroChartType==='line'?3:0,
      pointHoverRadius:5,
      tension:.25,
      spanGaps:true,
      fill:S_macroChartType==='line'&&zones.length===1,
    };
  });

  // Dernière valeur (zone de réf = première)
  const refSeries=allSeries[0].data;
  if(latestEl&&refSeries.length){
    const last=refSeries[refSeries.length-1];
    latestEl.textContent='Dernier : '+fmtMacroVal(last.value,sub)+' ('+fmtYmLabel(last.ym)+')';
  }else if(latestEl)latestEl.textContent='';

  // Render Chart.js
  if(_macroChart){_macroChart.destroy();}
  const gc=getCSSVar('--chart-grid');const tc=getCSSVar('--chart-tick');
  _macroChart=new Chart(document.getElementById('macroChart'),{
    type:S_macroChartType,
    data:{labels,datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{
        legend:{display:zones.length>1,labels:{color:tc,font:{size:10,family:'Arial'},boxWidth:12}},
        tooltip:{
          backgroundColor:getCSSVar('--chart-tt'),borderColor:getCSSVar('--amber'),borderWidth:1,
          titleColor:getCSSVar('--amber'),bodyColor:getCSSVar('--text'),
          callbacks:{label:c=>{
            const v=c.parsed.y;
            if(v===null)return c.dataset.label+' : n/d';
            return c.dataset.label+' : '+fmtMacroVal(v,sub);
          }}
        }
      },
      scales:{
        x:{grid:{color:gc,drawBorder:false},ticks:{color:tc,font:{size:9,family:'Arial'},maxRotation:0,autoSkip:true,maxTicksLimit:16}},
        y:{grid:{color:gc,drawBorder:false},ticks:{color:tc,font:{size:9,family:'Arial'},callback:v=>v+(sub.unit||'')}}
      }
    }
  });

  // Tableau des dernières valeurs (zone de réf, vue simple)
  if(tableWrap){
    if(!S_macroCompare&&refSeries.length){
      const last12=refSeries.slice(-12).reverse();
      tableWrap.innerHTML=`
        <div style="font-family:Arial,monospace;font-size:9px;letter-spacing:.1em;color:var(--amber);margin-bottom:8px">HISTORIQUE MENSUEL · ${esc(MACRO_ZONES.find(z=>z.code===S_macroZone)?.name||'')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${last12.map(d=>`
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:7px 11px;text-align:center;min-width:74px">
              <div style="font-family:Arial,monospace;font-size:9px;color:var(--text3)">${fmtYmLabel(d.ym)}</div>
              <div style="font-family:Arial,monospace;font-size:13px;font-weight:700;color:var(--text);margin-top:2px">${fmtMacroVal(d.value,sub)}</div>
            </div>`).join('')}
        </div>`;
    }else{
      tableWrap.innerHTML='';
    }
  }
}

// Formatage d'une valeur macro selon son unité
function fmtMacroVal(v,sub){
  if(v===null||v===undefined||isNaN(v))return 'n/d';
  const u=sub.unit||'';
  if(u==='%')return (v>0&&(S_macroTab==='trade')? '+':'')+v.toFixed(1)+' %';
  if(S_macroTab==='trade')return (v>=0?'+':'')+v.toFixed(1)+' Mds';
  if(S_macroTab==='pmi')return v.toFixed(1);
  return v.toFixed(1)+(u?' '+u:'');
}
function fmtDateFr(ymd){
  if(!ymd)return '';
  const [y,m,d]=ymd.split('-');
  return d+'/'+m+'/'+y;
}

function buildRptMonthBar(){
  const pick=document.getElementById('rpt-month-pick');
  const btnsEl=document.getElementById('rpt-month-btns');
  if(!pick||!btnsEl)return;
  const now=new Date();
  pick.innerHTML='<option value="">Autre mois…</option>';
  for(let i=0;i<18;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    // V9.2 FIX FUSEAU : fmtYM (local) au lieu de toISOString.slice(0,7) (UTC)
    const val=fmtYM(d);
    const lbl=d.toLocaleDateString('fr-FR',{month:'long',year:'numeric'});
    const opt=document.createElement('option');opt.value=val;opt.textContent=lbl;
    pick.appendChild(opt);
  }
  btnsEl.innerHTML='';
  for(let i=0;i<3;i++){
    const d=new Date(now.getFullYear(),now.getMonth()-i,1);
    // V9.2 FIX FUSEAU
    const val=fmtYM(d);
    const lbl=d.toLocaleDateString('fr-FR',{month:'short',year:'2-digit'});
    const btn=document.createElement('button');
    btn.className='acc-tab'+(i===0?' active':'');
    btn.textContent=lbl.toUpperCase();btn.dataset.month=val;
    btn.addEventListener('click',()=>switchRptMonth(val,btn));
    btnsEl.appendChild(btn);
  }
  initCurrencyWeek();
  // V9.10 — Le dropdown affiche le mois courant par défaut (au lieu de "Autre mois…")
  if(pick)pick.value=S_rptMonth;
  buildWeeksForMonth(S_rptMonth);
  buildRptCurrencyBar();
  // v=5 : le rapport de la semaine (et ses captures) ne se charge plus au
  // démarrage mais à l'ouverture de l'onglet Rapports (clic de navigation).
}

function getMondaysInMonth(year,monthIdx){
  const mondays=[];
  const d=new Date(year,monthIdx,1);
  const day=d.getDay();
  if(day!==1)d.setDate(d.getDate()+(day===0?1:8-day));
  while(d.getMonth()===monthIdx){
    mondays.push(new Date(d));
    d.setDate(d.getDate()+7);
  }
  return mondays;
}

const FR_MONTHS_SHORT=['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
function fmtWeekBtn(mon){
  const sun=new Date(mon);sun.setDate(mon.getDate()+6);
  const mLbl=FR_MONTHS_SHORT[mon.getMonth()];
  const sLbl=FR_MONTHS_SHORT[sun.getMonth()];
  if(mon.getMonth()===sun.getMonth())return mon.getDate()+' → '+sun.getDate()+' '+mLbl;
  return mon.getDate()+' '+mLbl+' → '+sun.getDate()+' '+sLbl;
}

function buildWeeksForMonth(monthVal){
  const wBtns=document.getElementById('rpt-week-btns');if(!wBtns)return;
  const[yr,mo]=monthVal.split('-').map(Number);
  const mondays=getMondaysInMonth(yr,mo-1);
  const currentWeek=document.getElementById('rpt-week')?.value;
  const now=new Date();
  const todayDay=now.getDay();
  const thisMonday=new Date(now);thisMonday.setDate(now.getDate()-(todayDay===0?6:todayDay-1));
  // V9.2 FIX FUSEAU : fmtYMD (local) au lieu de toISOString (UTC) qui décalait les lundis
  const thisMondayStr=fmtYMD(thisMonday);
  wBtns.innerHTML='';
  let autoSelect=null;
  mondays.forEach((mon)=>{
    const val=fmtYMD(mon);
    const btn=document.createElement('button');
    const lbl=fmtWeekBtn(mon);
    const isCurrent=val===thisMondayStr;
    const isSelected=currentWeek?val===currentWeek:isCurrent;
    btn.className='acc-tab'+(isSelected?' active':'');
    btn.innerHTML=lbl+(isCurrent?' <span style="color:var(--amber);font-size:9px">◆</span>':'');
    btn.title=val;btn.dataset.week=val;
    btn.style.cssText='font-size:10px;white-space:nowrap;';
    btn.addEventListener('click',()=>selectWeek(val,btn));
    wBtns.appendChild(btn);
    if(isSelected)autoSelect=val;
  });
  if(!autoSelect&&mondays.length){
    const lastBtn=wBtns.lastElementChild;if(lastBtn)lastBtn.classList.add('active');
    autoSelect=fmtYMD(mondays[mondays.length-1]);
  }
  if(autoSelect){
    const wd=document.getElementById('rpt-week');if(wd&&!currentWeek)wd.value=autoSelect;
  }
}

async function selectWeek(val,btn){
  // V9.1 FIX : on persiste en base AVANT de changer de semaine
  await flushAndSaveBeforeSwitch();
  document.querySelectorAll('#rpt-week-btns .acc-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  const wd=document.getElementById('rpt-week');if(wd)wd.value=val;
  await loadCurrencyReport();
}
async function onWeekDateChange(){
  await flushAndSaveBeforeSwitch();
  document.querySelectorAll('#rpt-week-btns .acc-tab').forEach(b=>b.classList.remove('active'));
  await loadCurrencyReport();
}

function buildRptCurrencyBar(){
  const el=document.getElementById('rpt-cur-btns');if(!el)return;
  el.innerHTML='';
  CURRENCIES.forEach((cur)=>{
    const btn=document.createElement('button');
    const bias=(window._curBiasCache||{})[cur.code]||'';
    const biasClass=bias&&BIAS_CFG[bias]&&cur.code!==S_curCode?'bias-'+bias:'';
    btn.className='acc-tab'+(cur.code===S_curCode?' active':'')+(biasClass?' '+biasClass:'');
    btn.innerHTML=flagImg(cur.cc,20)+'<span style="font-size:11px;font-weight:700;letter-spacing:.03em">'+cur.code+'</span>';
    btn.style.cssText='display:flex;align-items:center;gap:6px;padding:5px 13px;';
    btn.dataset.cur=cur.code;
    btn.addEventListener('click',()=>{
      flushCurrentViewToCache();
      S_curCode=cur.code;
      refreshCurrencyBtnColors();
      renderCurrencyView();
      // V9.7 — Annoncer aux pairs qu'on regarde maintenant cette devise
      broadcastCursorCurrency();
    });
    el.appendChild(btn);
  });
  // V9.10 — Onglet spécial BILAN, à droite du JPY, 2× plus large
  const bilanBtn=document.createElement('button');
  bilanBtn.className='acc-tab'+('BILAN'===S_curCode?' active':'');
  bilanBtn.innerHTML='<span style="font-size:11px;font-weight:700;letter-spacing:.06em">📋 BILAN HEBDO</span>';
  bilanBtn.style.cssText='display:flex;align-items:center;justify-content:center;gap:6px;padding:5px 30px;margin-left:8px;border-color:var(--amber3);';
  bilanBtn.dataset.cur='BILAN';
  bilanBtn.addEventListener('click',()=>{
    flushCurrentViewToCache();
    S_curCode='BILAN';
    refreshCurrencyBtnColors();
    renderCurrencyView();
    broadcastCursorCurrency();
  });
  el.appendChild(bilanBtn);
}

function refreshCurrencyBtnColors(){
  document.querySelectorAll('#rpt-cur-btns .acc-tab').forEach(btn=>{
    const code=btn.dataset.cur;if(!code)return;
    const bias=(window._curBiasCache||{})[code]||'';
    btn.classList.remove('active','bias-bullish','bias-sl_bullish','bias-neutral','bias-bearish','bias-sl_bearish');
    if(code===S_curCode){btn.classList.add('active');}
    else if(bias&&BIAS_CFG[bias]){btn.classList.add('bias-'+bias);}
  });
}

async function switchRptMonth(val,btn){
  if(!val)return;
  // V9.1 FIX : on persiste en base AVANT de changer de mois
  await flushAndSaveBeforeSwitch();
  S_rptMonth=val;
  document.querySelectorAll('#rpt-month-btns .acc-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  // V9.10 — Le dropdown reste sur le mois choisi (avant : reset à vide)
  const mp=document.getElementById('rpt-month-pick');if(mp)mp.value=val;
  const wd=document.getElementById('rpt-week');if(wd)wd.value='';
  buildWeeksForMonth(val);
  const[yr,mo]=val.split('-').map(Number);
  const mondays=getMondaysInMonth(yr,mo-1);
  const now=new Date();
  const todayDay=now.getDay();
  const thisMonday=new Date(now);thisMonday.setDate(now.getDate()-(todayDay===0?6:todayDay-1));
  // V9.2 FIX FUSEAU : comparaison en local (fmtYMD) au lieu d'UTC (toISOString)
  const thisMondayStr=fmtYMD(thisMonday);
  const found=mondays.find(m=>fmtYMD(m)===thisMondayStr);
  const targetMonday=found||mondays[mondays.length-1]||mondays[0];
  if(targetMonday&&wd)wd.value=fmtYMD(targetMonday);
  const targetVal=targetMonday?fmtYMD(targetMonday):null;
  if(targetVal){
    document.querySelectorAll('#rpt-week-btns .acc-tab').forEach(b=>{
      if(b.dataset.week===targetVal)b.classList.add('active');else b.classList.remove('active');
    });
  }
  await loadCurrencyReport();
}

function renderCurrencyView(){
  // V9.10 — Onglet spécial BILAN : 3 zones de capture + 1 zone texte
  if(S_curCode==='BILAN'){renderBilanView();return;}
  const cur=CURRENCIES.find(c=>c.code===S_curCode)||CURRENCIES[0];
  const code=cur.code;
  const view=document.getElementById('cur-single-view');if(!view)return;
  const biasVal=window._curBiasCache?.[code]||'';
  const notesVal=window._curNotesCache?.[code]||'';
  const biasOpts=Object.entries(BIAS_CFG).map(([k,v])=>`<option value="${k}"${biasVal===k?' selected':''}>${v.label}</option>`).join('');
  const badgeHTML=biasVal&&BIAS_CFG[biasVal]?`<div class="bias-badge bias-badge-live" style="background:${BIAS_CFG[biasVal].color}18;color:${BIAS_CFG[biasVal].color};border-color:${BIAS_CFG[biasVal].color}40;font-size:11px;padding:3px 12px">${BIAS_CFG[biasVal].label}</div>`:'';

  view.innerHTML=`<div class="cur-single-card">
    <div class="cur-single-left">
      <div class="cur-left-header">
        <div style="display:flex;align-items:center;gap:14px">
          <span class="cur-left-flag" style="line-height:1">${flagImg(cur.cc,48)}</span>
          <div>
            <div class="cur-left-name">${code} <span style="font-size:14px;font-weight:400;color:var(--text2)">${esc(cur.name)}</span></div>
            <div class="bias-badge-container" style="margin-top:5px;display:flex;align-items:center;gap:8px">${badgeHTML}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <select id="bias-${code}" onchange="updateBiasCache('${code}',this);scheduleAutoSave()" style="background:var(--bg3);border:1px solid var(--border2);color:var(--text2);padding:6px 10px;border-radius:3px;font-size:11px;font-weight:600;">
            <option value="">Biais…</option>
            ${biasOpts}
          </select>
        </div>
      </div>
      <div class="cur-left-label">Analyse &amp; Commentaires</div>
      <div class="cur-notes-v2 cur-notes-rich" id="cnotes-${code}" contenteditable="true"
        data-placeholder="Notes de veille marché, niveaux clés, catalyseurs, fondamentaux…"
        oninput="onNotesInput('${code}',this)"
        onfocus="window._curNotesFocus='${code}'"
        onblur="window._curNotesFocus=null"
        onmouseup="showFormatToolbarMaybe(event,'${code}')"
        onkeyup="showFormatToolbarMaybe(event,'${code}')"
        onpaste="onNotesPaste(event)">${sanitizeNotesHtml(notesVal||'')}</div>
    </div>
    <div class="cur-divider" id="cur-divider"
      onmouseenter="this.style.background='var(--amber)'"
      onmouseleave="if(!window._draggingCur)this.style.background='var(--border2)'"></div>
    <div class="cur-single-right" id="cur-right-panel">
      <div class="cur-img-block">
        <div class="cur-img-block-title">Politique Monétaire</div>
        <div class="cur-paste-zone-v2" id="cpz-pm-${code}"
          ondragover="event.preventDefault()"
          ondrop="handleCurDrop(event,'${code}','pm')"
          onmouseenter="focusCurZone('${code}','pm')"
          onclick="focusCurZone('${code}','pm');document.getElementById('cup-pm-${code}').click()">
          <input type="file" id="cup-pm-${code}" accept="image/*" style="display:none" onchange="handleCurFile(this,'${code}','pm')">
          <button class="cur-paste-rm" id="cprm-pm-${code}" type="button" onclick="event.stopPropagation();clearCurImg('${code}','pm')">✕ Supprimer</button>
          <img class="cur-paste-img" id="cpimg-pm-${code}" src="" style="display:none" onclick="event.stopPropagation();bigImg(this.src)">
          <div class="cur-paste-hint-v2" id="cphint-pm-${code}">
            <div class="icon">📊</div>
            <div class="txt">📋 Ctrl+V · Cliquer · Glisser<br><span style="font-size:9px;opacity:.7">Taux directeurs, attentes BCE/Fed…</span></div>
          </div>
        </div>
      </div>
      <div class="cur-img-block">
        <div class="cur-img-block-title">Graphique Hebdomadaire</div>
        <div class="cur-paste-zone-v2" id="cpz-gh-${code}"
          ondragover="event.preventDefault()"
          ondrop="handleCurDrop(event,'${code}','gh')"
          onmouseenter="focusCurZone('${code}','gh')"
          onclick="focusCurZone('${code}','gh');document.getElementById('cup-gh-${code}').click()">
          <input type="file" id="cup-gh-${code}" accept="image/*" style="display:none" onchange="handleCurFile(this,'${code}','gh')">
          <button class="cur-paste-rm" id="cprm-gh-${code}" type="button" onclick="event.stopPropagation();clearCurImg('${code}','gh')">✕ Supprimer</button>
          <img class="cur-paste-img" id="cpimg-gh-${code}" src="" style="display:none" onclick="event.stopPropagation();bigImg(this.src)">
          <div class="cur-paste-hint-v2" id="cphint-gh-${code}">
            <div class="icon">📈</div>
            <div class="txt">📋 Ctrl+V · Cliquer · Glisser<br><span style="font-size:9px;opacity:.7">Chart TradingView hebdomadaire…</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  if(window._curImgCache){
    for(const zone of['pm','gh']){
      const cached=window._curImgCache[zone+'-'+code];
      const src=cached?.url||cached;
      if(src){
        const imgEl=document.getElementById('cpimg-'+zone+'-'+code);
        const hintEl=document.getElementById('cphint-'+zone+'-'+code);
        const zoneEl=document.getElementById('cpz-'+zone+'-'+code);
        if(imgEl){imgEl.src=src;imgEl.style.display='block';}
        if(hintEl)hintEl.style.display='none';
        if(zoneEl)zoneEl.classList.add('has-img');
      }
    }
  }
  setTimeout(()=>{initDraggableCurPanel();}, 50);
}

// V9.10 — Vue spéciale BILAN HEBDO : 3 zones de capture + 1 zone texte "Bilan"
// V9.11 — 4 zones de capture (grille 2×2) + zone texte Bilan réduite (~20%)
const BILAN_ZONES=[
  {key:'var', title:'Variation / Classement devise', icon:'📊', hint:'Heatmap, classement de force des devises…'},
  {key:'vix', title:'Sentiment du risque (VIX)',     icon:'😨', hint:'VIX, risk-on / risk-off…'},
  {key:'idx', title:'Indice boursier',                icon:'📈', hint:'S&P 500, Nasdaq, indices majeurs…'},
  {key:'fng', title:'Fear and Greed Index',           icon:'🌡️', hint:'Indice peur/avidité CNN…'},
];
function renderBilanView(){
  const code='BILAN';
  const view=document.getElementById('cur-single-view');if(!view)return;
  const notesVal=window._curNotesCache?.[code]||'';
  view.innerHTML=`<div class="bilan-card">
    <!-- 80% : grille 2×2 de captures -->
    <div class="bilan-grid">
      ${BILAN_ZONES.map(z=>`
      <div class="bilan-img-block">
        <div class="cur-img-block-title">${z.title}</div>
        <div class="cur-paste-zone-v2 bilan-paste-zone" id="cpz-${z.key}-${code}"
          ondragover="event.preventDefault()"
          ondrop="handleCurDrop(event,'${code}','${z.key}')"
          onmouseenter="focusCurZone('${code}','${z.key}')"
          onclick="focusCurZone('${code}','${z.key}');document.getElementById('cup-${z.key}-${code}').click()">
          <input type="file" id="cup-${z.key}-${code}" accept="image/*" style="display:none" onchange="handleCurFile(this,'${code}','${z.key}')">
          <button class="cur-paste-rm" id="cprm-${z.key}-${code}" type="button" onclick="event.stopPropagation();clearCurImg('${code}','${z.key}')">✕ Supprimer</button>
          <img class="cur-paste-img" id="cpimg-${z.key}-${code}" src="" style="display:none" onclick="event.stopPropagation();bigImg(this.src)">
          <div class="cur-paste-hint-v2" id="cphint-${z.key}-${code}">
            <div class="icon">${z.icon}</div>
            <div class="txt">📋 Ctrl+V · Cliquer · Glisser<br><span style="font-size:9px;opacity:.7">${z.hint}</span></div>
          </div>
        </div>
      </div>`).join('')}
    </div>
    <!-- 20% : zone texte Bilan -->
    <div class="bilan-notes-wrap">
      <div class="cur-left-label" style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:18px">📋</span> Bilan de la semaine
        <span style="font-size:9px;font-weight:400;color:var(--text3);text-transform:none;letter-spacing:0">— synthèse transversale</span>
      </div>
      <div class="cur-notes-v2 cur-notes-rich bilan-notes" id="cnotes-${code}" contenteditable="true"
        data-placeholder="Thèmes dominants, corrélations, biais directionnels, plan pour la semaine à venir…"
        oninput="onNotesInput('${code}',this)"
        onfocus="window._curNotesFocus='${code}'"
        onblur="window._curNotesFocus=null"
        onmouseup="showFormatToolbarMaybe(event,'${code}')"
        onkeyup="showFormatToolbarMaybe(event,'${code}')"
        onpaste="onNotesPaste(event)">${sanitizeNotesHtml(notesVal||'')}</div>
    </div>
  </div>`;

  // Restaurer les images en cache
  if(window._curImgCache){
    for(const z of BILAN_ZONES){
      const cached=window._curImgCache[z.key+'-'+code];
      const src=cached?.url||cached;
      if(src){
        const imgEl=document.getElementById('cpimg-'+z.key+'-'+code);
        const hintEl=document.getElementById('cphint-'+z.key+'-'+code);
        const zoneEl=document.getElementById('cpz-'+z.key+'-'+code);
        if(imgEl){imgEl.src=src;imgEl.style.display='block';}
        if(hintEl)hintEl.style.display='none';
        if(zoneEl)zoneEl.classList.add('has-img');
      }
    }
  }
}

function updateBiasCache(code,sel){
  if(!window._curBiasCache)window._curBiasCache={};
  window._curBiasCache[code]=sel.value;
  refreshCurrencyBtnColors();
  const biasVal=sel.value;
  const badge=document.querySelector('.cur-left-header .bias-badge-live');
  const badgeNew=biasVal&&BIAS_CFG[biasVal]?
    `<div class="bias-badge bias-badge-live" style="background:${BIAS_CFG[biasVal].color}18;color:${BIAS_CFG[biasVal].color};border-color:${BIAS_CFG[biasVal].color}40;font-size:11px;padding:3px 12px">${BIAS_CFG[biasVal].label}</div>`:'';
  if(badge)badge.outerHTML=badgeNew;
  else{const hdr=document.querySelector('.cur-left-header .bias-badge-container');if(hdr)hdr.innerHTML=badgeNew;}
  // V9.7 — Broadcast live du bias aux autres utilisateurs
  if(_realtimeChan){
    try{
      _realtimeChan.send({
        type:'broadcast',event:'live_bias',
        payload:{client:CLIENT_ID,user:S.appUser?.name||'?',currency:code,bias:biasVal}
      });
    }catch(_){}
  }
}


function initDraggableCurPanel(){
  const divider=document.getElementById('cur-divider');
  const right=document.getElementById('cur-right-panel');
  const view=document.getElementById('cur-single-view');
  if(!divider||!right||!view)return;
  if(divider._bound)return;divider._bound=true;
  divider.addEventListener('mousedown',(e)=>{
    window._draggingCur=true;divider.style.background='var(--amber)';
    const startX=e.clientX;const startW=right.offsetWidth;
    function onMove(e){
      const dx=startX-e.clientX;
      const newW=Math.max(200,Math.min(view.offsetWidth-200,startW+dx));
      right.style.width=newW+'px';
    }
    function onUp(){window._draggingCur=false;divider.style.background='var(--border2)';document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);}
    document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
    e.preventDefault();
  });
}

// ─── AUTO-SAVE ───
let _autoSaveTimer=null;
function scheduleAutoSave(){
  flushCurrentViewToCache();
  const ind=document.getElementById('autosave-indicator');
  if(ind){ind.textContent='● En cours…';ind.className='saving';}
  clearTimeout(_autoSaveTimer);
  // V9.3 : délai réduit de 2s à 1s pour une sauvegarde plus réactive
  _autoSaveTimer=setTimeout(async()=>{
    await saveCurrencyReportAuto();
  },1000);
}
async function saveCurrencyReportAuto(){
  const ind=document.getElementById('autosave-indicator');
  try{
    await saveCurrencyReport(true);
    if(ind){ind.textContent='✓ Sauvegardé';ind.className='saved';setTimeout(()=>{ind.className='';},3000);}
  }catch(e){
    if(ind){ind.textContent='✗ Erreur';ind.className='saving';setTimeout(()=>{ind.className='';},3000);}
  }
}

// ════════════════════════════════════════════════════════════════════
// ADMIN MODULE
// ════════════════════════════════════════════════════════════════════

async function loadAdminUsers() {
  // V9b : peupler aussi le sélecteur de vue active
  populateAdminWorkspaceSelector();

  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px;font-family:Arial,monospace;font-size:9px">Chargement…</td></tr>';
  try {
    const { data, error } = await sb.rpc('admin_list_users');
    if (error) throw error;
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:16px">Aucun utilisateur dans la whitelist.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    data.forEach(u => {
      const tr = document.createElement('tr');
      const status = !u.auth_user_id
        ? '<span class="admin-status-pill pending">En attente d\'inscription</span>'
        : (u.is_super_admin_user
            ? '<span class="admin-status-pill admin">Super Admin</span>'
            : '<span class="admin-status-pill active">Actif</span>');
      const last = u.last_sign_in_at ? fDate(u.last_sign_in_at) : '—';
      const wsLabel = u.workspace_name
        ? `<span class="workspace-pill ${u.workspace_is_shared ? 'shared' : ''}">${esc(u.workspace_name)}${u.workspace_is_shared ? ' · 👥' : ' · 🔒'}</span>`
        : '<span style="color:var(--text3);font-size:9px">—</span>';
      const canDelete = !u.is_super_admin_user;
      const actions = canDelete
        ? `<button class="btn btn-red btn-sm" onclick="adminRemove(${escJs(u.email)}, ${u.auth_user_id ? `'${u.auth_user_id}'` : 'null'})">🗑 Retirer</button>`
        : '<span style="color:var(--text3);font-size:9px">Protégé</span>';
      tr.innerHTML = `
        <td><span style="font-family:Arial,monospace;font-size:10px">${esc(u.email)}</span>${u.profile_name ? `<div style="font-size:9px;color:var(--text3);margin-top:2px">${esc(u.profile_name)}</div>` : ''}</td>
        <td>${wsLabel}</td>
        <td><span style="font-size:10px;color:var(--text2)">${esc(u.note || '')}</span></td>
        <td>${status}</td>
        <td><span style="font-size:10px;color:var(--text2)">${last}</span></td>
        <td style="text-align:right">${actions}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="6" style="color:var(--red);padding:16px;text-align:center">Erreur : ${esc(e.message || '')}</td></tr>`;
  }
}

async function adminAddEmail() {
  const emailEl = document.getElementById('admin-new-email');
  const noteEl  = document.getElementById('admin-new-note');
  const email = (emailEl.value || '').trim().toLowerCase();
  if (!email) { toast('Email requis', 'err'); return; }
  const note = (noteEl.value || '').trim() || null;

  // V8 : détermination du workspace cible selon la radio
  const choice = document.querySelector('input[name="ws-choice"]:checked')?.value || 'new';
  let workspaceId = null;
  if (choice === 'existing') {
    workspaceId = document.getElementById('admin-workspace-select').value;
    if (!workspaceId) { toast('Sélectionne un workspace ou choisis "espace personnel"', 'err'); return; }
  }

  try {
    const { error } = await sb.rpc('admin_add_email', {
      p_email: email,
      p_note: note,
      p_workspace_id: workspaceId,
      p_display_name: null
    });
    if (error) throw error;
    toast('Email ajouté avec succès', 'ok');
    emailEl.value = ''; noteEl.value = '';
    document.getElementById('ws-new').checked = true;
    onWorkspaceChoiceChange();
    await loadAdminUsers();
    await loadAdminWorkspaces();
  } catch (e) {
    toast('Erreur : ' + (e.message || ''), 'err');
  }
}

function adminRemove(email,deleteAuth){
  if(!S.isSuperAdmin)return;
  const msg=deleteAuth
    ?`Supprimer définitivement le compte de ${email} ? La personne perdra immédiatement l'accès. Cette action est IRRÉVERSIBLE.`
    :`Retirer ${email} de la whitelist ? La personne ne pourra plus se connecter mais son compte reste sauvegardé.`;
  showConfirm(deleteAuth?'⚠ Suppression définitive':'Retirer de la whitelist',msg,async()=>{
    try{
      const{error}=await sb.rpc('admin_remove_email',{p_email:email,p_delete_auth:deleteAuth});
      if(error)throw error;
      toast(deleteAuth?'Compte supprimé':'Email retiré','ok');
      await loadAdminUsers();
    }catch(e){toast('Erreur : '+e.message,'err');}
  },deleteAuth?'SUPPRIMER':'RETIRER');
}


