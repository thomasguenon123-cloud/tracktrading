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
// inv = codes pays Investing.com demandés au widget (paramètre countries).
// v=6 (#37) : EUR ne reprend plus 5, 4, 12 et 43, que cette même table attribue à USD, GBP,
// CHF et NZD. Le reste de la liste EUR n'est pas vérifié : `note` le dit à l'écran.
// v=6 (#38) : plus de bouton XAU : sans liste de pays, il montrait exactement « All ».
const CAL_ZONES = [
  {code:'ALL',  label:'All',  inv:''},
  {code:'USD',  label:'USD',  cc:'us', inv:'5'},
  {code:'EUR',  label:'EUR',  cc:'eu', inv:'72,17,10,55,8,11,42,71,32,22,9,89,49,7,53,38',
   note:'liste non vérifiée, elle peut inclure des pays hors zone euro'},
  {code:'GBP',  label:'GBP',  cc:'gb', inv:'4'},
  {code:'JPY',  label:'JPY',  cc:'jp', inv:'35'},
  {code:'CAD',  label:'CAD',  cc:'ca', inv:'6'},
  {code:'CHF',  label:'CHF',  cc:'ch', inv:'12'},
  {code:'AUD',  label:'AUD',  cc:'au', inv:'25'},
  {code:'NZD',  label:'NZD',  cc:'nz', inv:'43'},
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
// v=6 (#46) : filtre d'importance fixe, demandé au widget ET dit à l'écran (« All » n'est
// pas l'agenda complet : les annonces ★ ne sont pas demandées).
const CAL_IMPORTANCE = [2, 3];
function libelleImportanceCal() {
  const exclues = [1, 2, 3].filter(n => !CAL_IMPORTANCE.includes(n));
  return 'Importance demandée : ' + CAL_IMPORTANCE.map(n => '★'.repeat(n)).join(' et ')
    + (exclues.length ? ' (pas les annonces ' + exclues.map(n => '★'.repeat(n)).join(', ') + ')' : '');
}
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

// v=6 (UX-22) — Message de connexion qui doit survivre au rechargement : la
// déconnexion automatique d'un compte sans espace déclenche SIGNED_OUT, qui
// recharge la page (voir bootAuth). On le garde le temps d'un rechargement.
const CLE_MSG_CONNEXION='tt_msg_connexion';
function memoriserMessageConnexion(texte){try{sessionStorage.setItem(CLE_MSG_CONNEXION,texte);}catch(_){}}
function oublierMessageConnexion(){try{sessionStorage.removeItem(CLE_MSG_CONNEXION);}catch(_){}}
function afficherMessageMemorise(){
  let texte=null;
  try{texte=sessionStorage.getItem(CLE_MSG_CONNEXION);}catch(_){}
  oublierMessageConnexion();
  if(!texte)return false;
  showAuthForm('login');
  showAuthMsg('login','error',texte);
  return true;
}

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

// v=6 (constat 73) : tout en français. Panne réseau = status 0 (fetch rejeté) ou
// message du navigateur (Chrome « Failed to fetch », Safari « Load failed »,
// Firefox « NetworkError… ») ; jamais le nom AuthRetryableFetchError, qui couvre
// aussi les 5xx. Message inconnu : texte brut en console, pas à l'écran.
function translateAuthError(err){
  const msg=(err?.message||(typeof err==='string'?err:'')).toString();
  if(msg.includes('Invalid login credentials'))return 'Email ou mot de passe incorrect.';
  if(msg.includes('Email not confirmed'))return 'Email non confirmé.';
  if(msg.includes('User already registered'))return 'Cet email est déjà inscrit. Connecte-toi.';
  if(msg.includes('Password should be at least'))return 'Mot de passe trop court (8 caractères minimum).';
  if(msg.includes('not allowed to sign up'))return 'Cet email n\'est pas autorisé. Contacte l\'administrateur.';
  // Message générique de GoTrue pour TOUTE erreur à la création du compte : le
  // refus de la liste blanche est la cause probable, pas la seule.
  if(msg.includes('Database error saving new user'))return 'Inscription refusée par le serveur (email non autorisé ou erreur technique). Contacte l\'administrateur.';
  // v=6 (revue) : motifs connus du serveur d'authentification (avant : « Erreur inattendue,
  // réessaie », alors qu'un nouvel essai immédiat échoue encore)
  const code=err?.code||'',attente=/only request this after (\d+) seconds?/i.exec(msg);
  if(attente)return 'Trop de demandes : réessaie dans '+attente[1]+' secondes.';
  if(code==='same_password'||/different from the old password/i.test(msg))return 'Le nouveau mot de passe doit être différent de l\'ancien.';
  if(code==='weak_password'||/password is known to be weak|weak password/i.test(msg))return 'Mot de passe trop faible : choisis-en un plus long ou moins courant.';
  if(code==='email_address_invalid'||/email address .* is invalid|invalid format/i.test(msg))return 'Adresse email invalide.';
  if(msg.includes('rate limit')||/rate_limit/.test(code)||err?.status===429)return 'Trop de tentatives, réessaie dans quelques minutes.';
  if(err?.status===0||/Failed to fetch|Load failed|NetworkError|network/i.test(msg))return 'Problème de connexion réseau. Vérifie ta connexion et réessaie.';
  console.warn('Erreur d\'authentification non traduite :',err);
  return 'Erreur inattendue, réessaie.';
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
    showAuthMsg('login','info','Connexion…'); // v=6 : pas de « réussie » avant d'être entré
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
  // v=6 (constat 66) : getUser en échec (supabase-js rend l'erreur sans lever) est
  // dit, au lieu d'un retour muet au formulaire. Réseau ou serveur (status 0,
  // absent ou ≥ 500) : session gardée. Session refusée : oubliée sur cet appareil
  // (message gardé pour le rechargement que provoque la déconnexion).
  let rep;
  try { rep = await sb.auth.getUser(); } catch (e) { rep = { data: { user: null }, error: e }; }
  const user = rep?.data?.user, uErr = rep?.error;
  if (!user) {
    afficherChargement(false);
    console.error('Session non ouverte :', uErr);
    const reseau = !uErr || !uErr.status || uErr.status >= 500;
    const motif = reseau ? 'Connexion au serveur impossible. Vérifie ta connexion et réessaie.' : 'Ta session n\'est plus valide. Reconnecte-toi.';
    showAuthForm('login');
    showAuthMsg('login', 'error', motif);
    if (!reseau) { memoriserMessageConnexion(motif); await sb.auth.signOut({ scope: 'local' }); }
    return;
  }
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
  // v=6 (constat 65) : panne réseau ou serveur ≠ « aucun espace » : PAS de
  // déconnexion (la session reste ; recharger rejoue l'ouverture), détail en console.
  if (!S.workspaceId && S.workspaceEchec) {
    afficherChargement(false);
    console.error('Espace non chargé :', S.lastWorkspaceError);
    showAuthForm('login');
    showAuthMsg('login', 'error', 'Impossible de charger ton espace (réseau ou serveur). Ta session est gardée : recharge la page pour réessayer.');
    return;
  }
  if (!S.workspaceId) {
    afficherChargement(false);
    const reason = S.lastWorkspaceError
      ? ' (détail : ' + S.lastWorkspaceError + ')'
      : '';
    // v=6 (UX-22) : message d'erreur lisible, dans le formulaire VISIBLE, et
    // conservé au rechargement que provoque la déconnexion qui suit.
    const msg = 'Aucun espace n\'est attribué à ton compte. Contacte l\'administrateur' + reason + '.';
    memoriserMessageConnexion(msg);
    showAuthForm('login');
    showAuthMsg('login', 'error', msg);
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

// v=6 (constat 74) : toute déconnexion demandée par CET onglet (bouton, compte sans
// espace, session refusée) passe par sb.auth.signOut : elle est marquée volontaire.
// Une autre (autre onglet, jeton refusé au rafraîchissement) recharge aussi la
// page, mais le motif est gardé pour le formulaire, avec la fiche trade perdue.
let _sortieVolontaire=false;
const _signOutSb=sb.auth.signOut.bind(sb.auth);
sb.auth.signOut=async(...a)=>{_sortieVolontaire=true;try{return await _signOutSb(...a);}finally{_sortieVolontaire=false;}};
function motifSortieSubie(){
  const fiche=document.getElementById('trade-modal');
  const ouverte=!!fiche&&!fiche.classList.contains('hidden');
  return 'Ta session a été fermée (déconnexion depuis un autre onglet ou session expirée).'+
    (ouverte?' Une fiche trade était ouverte : ce qui n\'était pas enregistré est perdu.':'')+' Reconnecte-toi.';
}

// ════════════════════════════════════════════════════════════════════
// AUTH BOOT — runs immediately
// ════════════════════════════════════════════════════════════════════
(async function bootAuth(){
  bindAuthUI();
  detectRecoveryFlow();
  afficherMessageMemorise(); // v=6 : message laissé par la page précédente (UX-22)
  // Check existing session
  // v=6 : une session mémorisée qu'on ne peut pas vérifier (réseau, serveur) est dite,
  // au lieu d'un formulaire muet qui se lit « déconnecté » ; une exception de
  // getSession ne fige jamais l'écran d'attente.
  let session=null,sErr=null;
  try{const r=await sb.auth.getSession();session=r?.data?.session||null;sErr=r?.error||null;}
  catch(e){sErr=e;}
  if(session&&!window.location.hash.includes('type=recovery')){
    // v=5 : « Chargement de ton espace… » reste affiché pendant le chargement ;
    // un échec ramène au formulaire (jamais d'écran d'attente figé).
    try{await postLogin();}
    catch(e){console.error('Démarrage interrompu :',e);}
    finally{
      if(!document.getElementById('app-wrap').classList.contains('ready'))afficherChargement(false);
      oublierMessageConnexion(); // déjà affiché : pas de rechargement sur ce chemin
    }
  }else{
    afficherChargement(false);
    if(sErr&&!window.location.hash.includes('type=recovery')){
      console.error('Session illisible :',sErr);
      const reseau=!sErr.status||sErr.status>=500;
      showAuthForm('login');
      showAuthMsg('login','error',reseau?'Connexion au serveur impossible : ta session n\'a pas pu être vérifiée. Vérifie ta connexion et recharge la page.':'Ta session n\'est plus valide. Reconnecte-toi.');
    }
  }
  // Listen for auth events
  sb.auth.onAuthStateChange((event,session)=>{
    if(event==='PASSWORD_RECOVERY'){
      document.getElementById('auth-screen').classList.remove('hidden');
      document.getElementById('app-wrap').classList.remove('ready');
      showAuthForm('recovery');
    }
    if(event==='SIGNED_OUT'){
      if(!_sortieVolontaire&&S.authUser)memoriserMessageConnexion(motifSortieSubie());
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
  // v=6 (constat 65) : une ABSENCE (pas d'entrée, espace non attribué ou invisible)
  // n'est pas un ÉCHEC (réseau, serveur, délai) : seule l'absence mène au message
  // « aucun espace » et à la déconnexion (S.workspaceEchec, lu par postLogin).
  S.workspaceEchec = false;
  const absent = (m) => Object.assign(new Error(m), { absence: true });

  async function attempt() {
    // Étape 1 : récupérer uniquement workspace_id depuis allowed_emails
    const { data: ae, error: aeErr } = await sb
      .from('allowed_emails')
      .select('workspace_id')
      .eq('email', S.authUser.email.toLowerCase())
      .maybeSingle();
    if (aeErr) throw new Error('allowed_emails: ' + (aeErr.message || aeErr.code || 'unknown'));
    if (!ae) throw absent('Aucune entrée dans la whitelist pour ' + S.authUser.email);
    if (!ae.workspace_id) throw absent('Whitelist trouvée mais workspace_id NULL');

    // Étape 2 : charger les détails du workspace séparément
    // (la RLS de workspaces inclut is_super_admin() OR membership → fiable)
    const { data: ws, error: wsErr } = await sb
      .from('workspaces')
      .select('id, name, is_shared')
      .eq('id', ae.workspace_id)
      .maybeSingle();
    if (wsErr) throw new Error('workspaces: ' + (wsErr.message || wsErr.code || 'unknown'));
    if (!ws) throw absent('Workspace ' + ae.workspace_id + ' introuvable (RLS bloquante ?)');

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
    S.workspaceEchec = !e1.absence;
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
    S.workspaceEchec = false;
    return;
  } catch (e2) {
    console.error('loadCurrentWorkspace attempt 2 failed:', e2.message);
    S.lastWorkspaceError = e2.message;
    S.workspaceEchec = !e2.absence;
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
    sel._perime = false;
    (data || []).forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id;
      const tag = w.is_shared ? '👥 partagé' : '🔒 perso';
      opt.textContent = `${w.name} · ${tag} · ${w.member_count} membre(s) · ${w.trade_count} trade(s)`;
      sel.appendChild(opt);
    });
  } catch (e) {
    toast('Liste des espaces non chargée : ' + messageErreur(e) + '.', 'err');
    // v=6 (constat 72) : les compteurs déjà affichés restent, mais dits non à jour
    const sel = document.getElementById('admin-workspace-select');
    if (sel && !sel._perime) {
      const o = document.createElement('option');
      o.value = ''; o.disabled = true; o.textContent = '⚠ Compteurs non à jour (réseau ou serveur)';
      sel.appendChild(o); sel._perime = true;
    }
  }
}

// v=6 (constat 72) : « ↻ Rafraîchir », l'onglet Admin et la fin d'un ajout ou d'un
// retrait relisent TOUT l'Admin : liste blanche, compteurs « N membre(s) · N
// trade(s) » et « Vue active » (avant : la liste blanche seule ; compteurs et Vue
// active restaient ceux de la connexion).
async function rafraichirAdmin() {
  await loadAvailableWorkspaces(); // d'abord : loadAdminUsers remplit « Vue active » avec
  await Promise.all([loadAdminUsers(), loadAdminWorkspaces()]);
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
      if (tab.dataset.s === 'admin' && S.isSuperAdmin) rafraichirAdmin(); // v=6 (constat 72) : tout l'Admin relu
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

  // Premier rendu : filtre par mois courant. v=6 (constat 3) : trades non lus →
  // aucun rendu à zéro (message + Réessayer) ; tout échec de lecture est dit.
  if (!_lus.has('trades')) {
    afficherTradesIndisponibles();
  } else {
    if (S_dashMonths.size > 0) {
      applyDashFilter();
    } else {
      renderStats();
      await renderCharts();
    }
    renderMonthly();
    renderJournal();
  }
  updateWorkspaceBanner();
  signalerEchecsLecture();
  S.appReady = true;
}

function getCSSVar(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}

// v=6 (données honnêtes) : au changement de thème, on REDESSINE (même filtre, mêmes
// couleurs par trade, grilles et info-bulles relues dans le nouveau thème). Avant :
// les barres par trade étaient recolorées avec les totaux MENSUELS (une perte en
// vert, un BE en rouge) et le dégradé de la courbe remplacé par un aplat. Sans
// graphique affiché, rien à faire (et Chart.js n'est pas chargé pour rien).
function updateChartColors(){
  if(S.chartBal||S.chartRR)redessinerGraphiques();
}

function toggleUserMenu(e){
  if(e)e.stopPropagation();
  document.getElementById('user-menu').classList.toggle('open');
}
function closeUserMenu(){document.getElementById('user-menu').classList.remove('open');}

// ─── DATA LOADERS (V9b : filtrés par S.currentWorkspaceId pour la vue active) ───
// v=6 (constat 3) : une lecture qui échoue n'est jamais un espace vide. Le chargeur
// GARDE ce qui était affiché, note l'échec et rend false (avant : `error` ignoré,
// « 0 trade », « workspace vide », « Vue : X ✅ »). « Aucun trade » et « espace
// vide » restent réservés à une lecture réussie. Par lecture : null = lue ;
// 'jamais' = échec sans lecture réussie avant ; 'perime' = échec, l'affichage
// garde la dernière lecture réussie.
const echecsLecture={users:null,accounts:null,trades:null,workspaces:null};
const _lus=new Set();
function noterLecture(k,error){
  if(!error){echecsLecture[k]=null;_lus.add(k);return true;}
  console.error('Lecture impossible ('+k+') :',error);
  echecsLecture[k]=_lus.has(k)?'perime':'jamais';
  return false;
}
async function loadUsers(){
  let q = sb.from('users').select('*').order('name');
  if (S.currentWorkspaceId) q = q.eq('workspace_id', S.currentWorkspaceId);
  const{data,error}=await q;
  if(!noterLecture('users',error))return false;
  S.users=data||[];
  remplirFiltreTraders();
  return true;
}
function remplirFiltreTraders(){
  const sel=document.getElementById('f-usr');
  if(sel)sel.innerHTML='<option value="">Tous traders</option>'+S.users.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
}
async function loadAccounts(){
  let q = sb.from('accounts').select('*').eq('is_active',true).order('name');
  if (S.currentWorkspaceId) q = q.eq('workspace_id', S.currentWorkspaceId);
  const{data,error}=await q;
  if(!noterLecture('accounts',error))return false;
  S.accounts=data||[];
  return true;
}
async function loadTrades(){
  let q=sb.from('trades').select('*,users(name,color),accounts(name,type,currency,balance,risk_percent)').order('trade_date',{ascending:false}).order('created_at',{ascending:false});
  if (S.currentWorkspaceId) q = q.eq('workspace_id', S.currentWorkspaceId);
  if(S.accId!=='all')q=q.eq('account_id',S.accId);
  const{data,error}=await q;
  if(!noterLecture('trades',error))return false;
  S.trades=data||[];S.filtered=[...S.trades];
  document.getElementById('dash-main')?.classList.remove('trades-indisponibles');
  return true;
}
// Ce qui n'a pas pu être lu, en clair (bandeau et toast) ; '' si tout est lu.
function resumeEchecsLecture(){
  const T={
    trades:['trades non chargés : rien n\'est affiché à leur place','trades non rafraîchis : l\'affichage date du dernier chargement réussi'],
    accounts:['comptes non chargés','comptes non rafraîchis'],
    users:['liste des traders non chargée','liste des traders non rafraîchie'],
  };
  return Object.keys(T).filter(k=>echecsLecture[k]).map(k=>T[k][echecsLecture[k]==='perime'?1:0]).join(' ; ');
}
function signalerEchecsLecture(){
  const r=resumeEchecsLecture();
  if(r)toast('Lecture impossible (réseau ou serveur) — '+r+'.','err');
  return r;
}
// Trades jamais lus : ni zéros, ni « Aucun trade », ni graphique à la place (CSS).
function afficherTradesIndisponibles(){
  const html='<div class="empty"><h3>⚠ Trades non chargés</h3><p>Problème de réseau ou de serveur : rien n\'est affiché à la place de tes trades.</p>'+
    '<p style="margin-top:10px"><button type="button" class="btn btn-amber btn-sm" onclick="reessayerChargement()">↻ Réessayer</button></p></div>';
  ['stats-row','j-list'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=html;});
  document.getElementById('dash-main')?.classList.add('trades-indisponibles');
}
// Réaffiche journal et tableau de bord selon les filtres en cours, ou l'état « non chargés ».
function afficherTrades(){
  if(!_lus.has('trades')){afficherTradesIndisponibles();updateWorkspaceBanner();return;}
  filterJournal();
  applyDashFilter();
}
// Bouton « Réessayer » (bandeau, cadres « non chargés ») : relit traders, comptes et trades.
async function reessayerChargement(){
  await Promise.all([loadUsers(),loadAccounts(),loadTrades()]);
  afficherTrades();
  if(!signalerEchecsLecture())toast('Données chargées ✅','ok');
}
// Vue active et données affichées : photo prise avant un changement de vue, remise si une lecture échoue.
function photoVue(){
  return {currentWorkspaceId:S.currentWorkspaceId,currentWorkspace:S.currentWorkspace,accId:S.accId,
    users:S.users,accounts:S.accounts,trades:S.trades,echecs:{...echecsLecture}};
}
function restaurerVue(p){
  Object.assign(S,{currentWorkspaceId:p.currentWorkspaceId,currentWorkspace:p.currentWorkspace,accId:p.accId,users:p.users,accounts:p.accounts,trades:p.trades});
  Object.assign(echecsLecture,p.echecs);
  remplirFiltreTraders();
  afficherTrades();
  updateWorkspaceBadge();
  updateWorkspaceBanner();
  const sel=document.getElementById('admin-ws-selector');
  if(sel)sel.value=p.currentWorkspaceId;
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
  // v=6 (constat 3) : en cas d'échec, la liste connue est GARDÉE (au démarrage :
  // l'espace d'appartenance seul, posé par postLogin) et « Vue active » le signale.
  try {
    const { data, error } = await sb.from('workspaces').select('id, name, is_shared').order('name');
    if (error) throw error;
    S.availableWorkspaces = data || [];
    return noterLecture('workspaces', null);
  } catch (e) {
    return noterLecture('workspaces', e);
  }
}

// v=6 (revue) : un seul changement d'espace à la fois. Deux changements rapprochés
// (réseau lent) mêlaient les données de trois espaces sous un « ✅ ».
let _changementVue = false;
function remettreSelecteurVue() {
  const sel = document.getElementById('admin-ws-selector');
  if (sel) sel.value = S.currentWorkspaceId;
}
async function switchCurrentWorkspace(newWorkspaceId, abandonRapport) {
  if (!newWorkspaceId || newWorkspaceId === S.currentWorkspaceId) return;
  if (_changementVue) { toast('Changement d\'espace déjà en cours : attends la fin.', 'err'); remettreSelecteurVue(); return; }
  _changementVue = true;
  try { return await changerEspace(newWorkspaceId, abandonRapport); }
  finally { _changementVue = false; }
}
async function changerEspace(newWorkspaceId, abandonRapport) {
  // Le non-admin n'a pas le droit de switcher
  if (!S.isSuperAdmin && newWorkspaceId !== S.workspaceId) {
    toast('Action réservée à l\'administrateur', 'err');
    return;
  }
  const target = S.availableWorkspaces.find(w => w.id === newWorkspaceId);
  if (!target) { toast('Workspace introuvable', 'err'); return; }
  // v=6 (constat 58) : la saisie du rapport ouvert part d'abord dans SON espace
  if (!abandonRapport && !(await flushAndSaveBeforeSwitch())) {
    remettreSelecteurVue(); // v=6 (revue) : « Annuler » laisse la vue telle quelle, sélecteur compris
    proposerAbandon(() => switchCurrentWorkspace(newWorkspaceId, true)); return;
  }

  const avant = photoVue(); // v=6 (constat 3) : remise en place si une lecture échoue
  // MAJ état
  S.currentWorkspaceId = newWorkspaceId;
  S.currentWorkspace = target;
  S.accId = 'all'; // reset filter compte (les comptes vont changer)
  // v=6 (constat 58) : le rapport affiché était celui de l'ancien espace
  quitterRapport();
  if (document.getElementById('sec-currency')?.classList.contains('active')) chargerRapport();

  // Recharger les données filtrées
  toast('Chargement de ' + target.name + '…', 'ok');
  try {
    const lus = await Promise.all([loadUsers(), loadAccounts()]);
    // Re-render selon les filtres en cours (stats + charts + monthly + journal)
    if (lus.includes(false) || !(await rechargerTrades(false))) throw new Error('lecture impossible : ' + resumeEchecsLecture());
    updateWorkspaceBadge();
    updateWorkspaceBanner();
    // Refresh sélecteur dans admin
    const sel = document.getElementById('admin-ws-selector');
    if (sel) sel.value = newWorkspaceId;
    toast('Vue : ' + target.name + ' ✅', 'ok');
  } catch (e) {
    console.error('switchCurrentWorkspace failed:', e);
    // v=6 (revue) : la saisie tapée dans le rapport affiché pendant le chargement part
    // d'abord dans SON espace ; si c'est impossible, sa perte est dite.
    const rapportEcrit = await flushAndSaveBeforeSwitch();
    // v=6 (constat 3) : retour à la vue d'avant, données comprises (jamais les
    // traders de l'une avec les trades de l'autre), et l'échec est dit, sans ✅.
    restaurerVue(avant);
    // v=6 (constats 3 + 58) : le rapport suit la vue remise en place (sinon il resterait
    // celui de l'espace qu'on n'a pas pu ouvrir, et la saisie partirait dans cet espace)
    quitterRapport();
    if (document.getElementById('sec-currency')?.classList.contains('active')) chargerRapport();
    const lecture = String(e?.message || '').startsWith('lecture impossible');
    toast('Impossible de charger ' + target.name + (lecture ? ' (réseau ou serveur)' : '') + ' : tu restes sur ' + (S.currentWorkspace?.name || '?') + '.' +
      (rapportEcrit ? '' : ' Ta saisie du rapport (' + target.name + ') n\'a pas pu être enregistrée.'), 'err');
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
    // v=6 (constat 68) : même règle que le bandeau, où va chaque écriture
    wsBadge.title = 'Vue d\'un autre espace : ' + S.currentWorkspace.name +
      '\nTon espace : ' + (S.workspace ? S.workspace.name : '?') +
      '\nCe que tu modifies ici (trades existants, rapports) est enregistré dans ' + S.currentWorkspace.name + '.' +
      '\nPour créer un trade ou des données test, reviens à ton espace.' +
      (S.isSuperAdmin ? '\n\nClique pour revenir à ton espace.' : '');
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

  // v=6 (constat 3) : une lecture a échoué → on le dit (même bandeau masqué) ;
  // jamais « vide ». Trades jamais lus : l'état « non chargés » repasse par-dessus
  // un rendu à zéro (ce bandeau est le dernier rendu d'applyDashFilter).
  const echec = resumeEchecsLecture();
  if (echec) {
    banner.style.display = 'block';
    msg.innerHTML = '<b style="color:var(--red)">⚠ Lecture impossible (réseau ou serveur)</b> — ' + esc(echec) + '.';
    actions.innerHTML = '<button type="button" class="btn btn-amber btn-sm" onclick="reessayerChargement()">↻ Réessayer</button>';
    if (echecsLecture.trades === 'jamais') afficherTradesIndisponibles();
    return;
  }
  if (_wsBannerDismissed) { banner.style.display = 'none'; return; }

  // Cas 1 : on est en mode "vue" différente du workspace d'appartenance.
  // v=6 (constat 68) : dire où va chaque écriture (avant : « Mode consultation »,
  // alors que les trades existants et les rapports modifiés ici sont enregistrés
  // dans l'espace affiché ; créer un trade ou des données test y est refusé).
  if (S.currentWorkspaceId !== S.workspaceId) {
    banner.style.display = 'block';
    msg.innerHTML = '<b>Vue d\'un autre espace</b> — Tu visualises ' +
      '<b style="color:var(--blue)">' + esc(S.currentWorkspace?.name || '?') + '</b>' +
      '. Ce que tu modifies ou supprimes ici (trades existants, rapports) est enregistré dans cet espace. ' +
      'Pour créer un trade ou des données test, reviens à ton espace (' + esc(S.workspace?.name || '?') + ').';
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
  // v=6 (constat 3) : liste des espaces illisible → dit, pas une liste réduite muette.
  const indispo = echecsLecture.workspaces ? '<option value="" disabled>⚠ Liste des espaces indisponible (réseau ou serveur) — ↻ Rafraîchir</option>' : '';
  if (!S.availableWorkspaces || S.availableWorkspaces.length === 0) {
    sel.innerHTML = indispo || '<option value="">Aucun workspace disponible</option>';
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
  }).join('') + indispo;
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
    // v=6 (données honnêtes) : la capture va dans la grille VISIBLE de l'onglet ouvert, et le
    // message nomme la destination. Avant : collée depuis « Analyse » (onglet par défaut), elle
    // partait dans une grille cachée, invisible à la saisie comme à la réouverture.
    const onglet=S.ongletFiche||0,type=['file','entry','close'][onglet];
    S.pendingUps.push({file:imgFile,type});apercuCapture(imgFile,type);
    toast(`Capture ajoutée à l'onglet ${['Analyse','Exécution','Clôture'][onglet]} (envoyée à la sauvegarde)`,'ok');
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
// v=6 : une date « AAAA-MM-JJ » (sans heure) se lit en heure LOCALE ; new Date('AAAA-MM-JJ')
// la lit à minuit UTC, donc la veille à l'ouest de Greenwich (mauvais jour, mauvais mois).
function dateLocale(d){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');return m?new Date(+m[1],+m[2]-1,+m[3]):new Date(d);}
function fDate(d){if(!d)return'—';return dateLocale(d).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'});}
function fDateShort(d){if(!d)return'';return dateLocale(d).toLocaleDateString('fr-FR',{month:'short',year:'2-digit'});}

// ════════════════════════════════════════════════════════════════════
// v=6 — DONNÉES HONNÊTES : sources uniques (une absence n'est jamais un 0)
// ════════════════════════════════════════════════════════════════════
// Date d'un trade (jour de trade, sinon jour de saisie), en heure locale.
function dateDuTrade(t){return t&&t.trade_date?dateLocale(t.trade_date):new Date(t&&t.created_at);}
// Ordre chronologique ; à date égale, ordre de saisie (avant : inversé, la courbe
// inventait un parcours qui n'avait pas eu lieu).
function ordreChrono(a,b){return (dateDuTrade(a)-dateDuTrade(b))||(new Date(a.created_at)-new Date(b.created_at));}
// R réalisé SAISI (0 compris = break-even). null / vide = résultat non saisi : ce
// n'est PAS un BE, le trade est mis à part (arbitrage du 20/10/2026).
function aResultat(t){const v=t&&t.actual_rr;return v!==null&&v!==undefined&&v!==''&&!isNaN(+v);}
// P&L saisi (0 compris) ; null / vide = non saisi, jamais « $0 ».
function aPnl(t){const v=t&&t.pnl_amount;return v!==null&&v!==undefined&&v!==''&&!isNaN(+v);}
// Trades qui comptent dans les statistiques et les graphiques : ni annulés, ni de
// test (arbitrage du 20/10/2026 ; les tests restent visibles dans le Journal).
function tradesComptes(trades){return (trades||[]).filter(t=>t.status!=='cancelled'&&!t.is_test);}
// Nombre saisi : « 1,5 » ou « 1.5 » (virgule ou point décimal). '' → null (non
// renseigné) ; tout le reste (espaces, deux séparateurs, lettres) → NaN, à refuser.
// Avant : un Chrome en anglais lisait « 1,5 » comme 15, enregistré sans alerte.
function lireDecimal(v){
  const s=String(v==null?'':v).trim();
  if(s==='')return null;
  if(!/^[-+]?(\d+([.,]\d+)?|[.,]\d+)$/.test(s))return NaN;
  return parseFloat(s.replace(',','.'));
}
// Après toute écriture de trades : recharger puis réafficher selon les filtres EN
// COURS (mois du tableau de bord, filtres du journal). Avant : retour silencieux à
// « ALL TIME » avec le mois toujours surligné, et filtres du journal ignorés.
// v=6 (constat 3) : lecture en échec → l'affichage garde les derniers trades lus
// (ou l'état « non chargés ») et l'échec est dit, sans taire l'écriture réussie
// qui précède (tous les appelants rechargent après une écriture faite) ; rend
// false. `signaler` = false quand l'appelant annonce lui-même l'échec (vue).
async function rechargerTrades(signaler=true){
  await loadTrades();
  filterJournal();
  applyDashFilter(); // trades jamais lus : le bandeau (dernier rendu) remet l'état « non chargés »
  const lu=!echecsLecture.trades;
  if(!lu&&signaler)toast('Modification enregistrée, mais lecture impossible (réseau ou serveur) — '+resumeEchecsLecture()+'.','err');
  return lu;
}
// V9.2 FIX FUSEAU : helpers qui formatent une Date en LOCAL (pas UTC).
// Avant : on utilisait d.toISOString().slice(0,7) → bug de fuseau qui décalait
// le mois pour Paris (UTC+2 en été) → "MAI 26" renvoyait "2026-04" en interne.
function fmtYM(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}
function fmtYMD(d){return fmtYM(d)+'-'+String(d.getDate()).padStart(2,'0');}
// FND-11 : on echappe aussi " et ' — un texte utilisateur place dans un attribut
// (title="...", value="...") ne doit pas pouvoir en sortir.
// v=6 (revue) : une couleur venue de la base ou d'un autre navigateur (trader, présence)
// est un champ libre rendu dans un attribut style : seule une couleur hexadécimale passe.
function couleurSure(c,defaut){return /^#[0-9a-f]{3,8}$/i.test(String(c||''))?String(c):defaut;}
function esc(s){return(s==null?'':s).toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
// Argument JS passe dans un onclick="f(...)" : JSON d'abord (litteral JS valide),
// puis HTML. S'ecrit SANS guillemets autour : onclick="f(${escJs(x)})".
// (esc() seul ne suffit pas : &#39; serait redecode avant l'execution du JS.)
function escJs(s){return esc(JSON.stringify(s==null?'':String(s)));}
// URL d'un href : http/https uniquement (esc seul laisse passer javascript:).
function safeUrl(u){const s=(u==null?'':String(u)).trim();return /^https?:\/\//i.test(s)?esc(s):'#';}
// v=6 (constat 69) : un avertissement ('err') reste lisible : 8 s, fermeture au
// clic, et un message qui arrive AVANT ta prochaine action (clic, toucher, touche)
// attend son tour au lieu de l'écraser (avant : un seul emplacement, « 7 trades
// test insérés ✅ » effaçait l'avertissement aussitôt). Après ton action, le
// message suivant le remplace normalement. En attente, seul le dernier message
// ordinaire est gardé (un « Chargement… » dépassé ne réapparaît pas).
const _toastsEnAttente=[];
function toast(msg,type='ok'){
  const t=document.getElementById('toast');if(!t)return;
  if(t._protege){
    if(type!=='err')for(let i=_toastsEnAttente.length-1;i>=0;i--)if(_toastsEnAttente[i][1]!=='err')_toastsEnAttente.splice(i,1);
    _toastsEnAttente.push([msg,type]);return;
  }
  montrerToast(t,msg,type);
}
function montrerToast(t,msg,type){
  t.textContent=msg;t.className='show '+type;t._protege=type==='err';
  t.title=t._protege?'Clique pour fermer':'';t.onclick=t._protege?()=>fermerToast(t):null;
  clearTimeout(t._t);t._t=setTimeout(()=>fermerToast(t),t._protege?8000:3400);
}
function fermerToast(t){
  clearTimeout(t._t);t.className='';t._protege=false;t.onclick=null;
  const suivant=_toastsEnAttente.shift();
  if(suivant)montrerToast(t,suivant[0],suivant[1]);
}
// Ta prochaine action lève la protection : le message en attente passe (sinon le
// suivant remplacera l'avertissement). Un clic SUR le message le ferme (onclick).
function actionUtilisateur(e){
  const t=document.getElementById('toast');
  if(!t||!t._protege||(e&&e.target&&t.contains(e.target)))return;
  t._protege=false;
  if(_toastsEnAttente.length)fermerToast(t);
}
document.addEventListener('pointerdown',actionUtilisateur,true);
document.addEventListener('keydown',actionUtilisateur,true);
// v=6 (constat 69) : cause d'un échec d'écriture en français ; le détail technique
// reste en console (avant : « Erreur : duplicate key value violates… » à l'écran).
function messageErreur(e){
  console.error(e);
  const code=String(e?.code||''),msg=String(e?.message||'');
  if(code==='23505')return 'cette valeur existe déjà';
  if(code==='22P02')return 'valeur refusée par le serveur (format invalide)';
  if(code==='42501'||/permission denied|row-level security/i.test(msg))return 'action non autorisée pour ton compte';
  if(code==='23503')return 'élément lié à d\'autres données';
  if(code==='PGRST116')return 'élément introuvable';
  if(code==='P0001'&&msg)return 'refusé par le serveur ('+msg+')'; // RAISE d'une fonction SQL du projet : motif voulu
  if(/Failed to fetch|Load failed|NetworkError|network/i.test(msg))return 'problème de connexion réseau';
  return 'erreur inattendue du serveur';
}

// ─── CONFIRM ───
function showConfirm(title,msg,cb,okLabel='Confirmer'){S.confirmCb=cb;document.getElementById('confirm-title').textContent=title;document.getElementById('confirm-msg').textContent=msg;document.getElementById('confirm-ok').textContent=okLabel;document.getElementById('confirm-overlay').classList.remove('hidden');}
function closeConfirm(){document.getElementById('confirm-overlay').classList.add('hidden');S.confirmCb=null;}
function execConfirm(){const cb=S.confirmCb;closeConfirm();if(cb)cb();}


// ════════════════════════════════════════════════════════════════════
// DASHBOARD MODULE
// ════════════════════════════════════════════════════════════════════

// ─── SPEEDOMETER ───
// v=6 (données honnêtes) : pct null = taux inconnu (aucun trade jugé) → arc
// grisé, SANS aiguille. Avant : aiguille au départ du rouge, lue « 0 % ».
function speedometerHTML(pct,label){
  const inconnu=pct==null||isNaN(pct);
  const r=34,cx=40,cy=40,startAngle=-200,endAngle=20;
  const toRad=d=>d*Math.PI/180;
  const arcPath=(cx,cy,r,startDeg,endDeg)=>{const s=toRad(startDeg),e=toRad(endDeg);const x1=cx+r*Math.cos(s),y1=cy+r*Math.sin(s),x2=cx+r*Math.cos(e),y2=cy+r*Math.sin(e);const lg=endDeg-startDeg>180?1:0;return `M${x1},${y1} A${r},${r},0,${lg},1,${x2},${y2}`;};
  const totalArc=endAngle-startAngle;
  const zones=[{pct:0.33,color:'#cc2a42'},{pct:0.33,color:'#d48c00'},{pct:0.34,color:'#00a86b'}];
  let zoneStart=startAngle;
  const zoneArcs=zones.map(z=>{const zEnd=zoneStart+z.pct*totalArc;const path=arcPath(cx,cy,r,zoneStart,zEnd);zoneStart=zEnd;return `<path d="${path}" fill="none" stroke="${z.color}" stroke-width="5" stroke-linecap="round" opacity="${inconnu?'0.2':'0.7'}"/>`;}).join('');
  const needleAngle=startAngle+((inconnu?0:pct)/100)*totalArc;const nr=toRad(needleAngle);
  const nx=cx+28*Math.cos(nr),ny=cy+28*Math.sin(nr);
  const backNx=cx-8*Math.cos(nr),backNy=cy-8*Math.sin(nr);
  const aiguille=inconnu?'':`<line x1="${backNx}" y1="${backNy}" x2="${nx}" y2="${ny}" stroke="var(--amber2)" stroke-width="2" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="3" fill="var(--amber)" stroke="var(--bg2)" stroke-width="1"/>`;
  return `<div class="speedometer">
    <svg viewBox="0 0 80 48" overflow="visible">
      <path d="${arcPath(cx,cy,r,startAngle,endAngle)}" fill="none" stroke="var(--bg4)" stroke-width="5"/>
      ${zoneArcs}
      ${aiguille}
    </svg>
    <div class="spd-val">${label}</div>
  </div>`;
}

// ─── STATS ───
// v=6 (données honnêtes) : un trade clos SANS R réalisé saisi est mis à part
// (arbitrage du 20/10/2026) : hors WIN/BE/LOSS, total R, taux et moyennes ; le
// panneau le compte pour qu'on le complète dans le Journal. Avant : rangé en BE
// (0 R) et compté au dénominateur du taux (1 gagnant + 1 non saisi = « 50 % »).
// v=6 (constat 10) : `trades` = tous les trades de la période ; les annulés et les
// trades de TEST sont écartés ici (arbitrage 3), les tests comptés pour la mention.
function calcStats(trades){
  const nbTest=trades.filter(t=>t.is_test&&t.status!=='cancelled').length;
  const comptes=tradesComptes(trades);
  const closed=comptes.filter(t=>t.status==='closed');
  const juges=closed.filter(aResultat);
  const sansR=closed.length-juges.length;
  const winsArr=juges.filter(t=>+t.actual_rr>0);
  const lossesArr=juges.filter(t=>+t.actual_rr<0);
  const wins=winsArr.length;
  const losses=lossesArr.length;
  const be=juges.filter(t=>+t.actual_rr===0).length;
  // v=6 : arrondi au milliardième (bruit flottant : 0.3-0.1-0.2 donnait « -0.00 R » en rouge).
  const totalRR=Math.round(juges.reduce((s,t)=>s+(+t.actual_rr),0)*1e9)/1e9;
  // Aucun trade jugé : taux INCONNU (null → « — », sans aiguille), jamais « 0 % ».
  const winRate=juges.length>0?(wins/juges.length)*100:null;
  // V9.6 — RR moyens par catégorie (gagnants / perdants)
  //   avgWinRR  : moyenne des actual_rr sur les trades gagnants
  //   avgLossRR : moyenne des actual_rr sur les trades perdants (valeur négative)
  const avgWinRR =wins>0  ? winsArr  .reduce((s,t)=>s+(+t.actual_rr),0)/wins   : 0;
  const avgLossRR=losses>0? lossesArr.reduce((s,t)=>s+(+t.actual_rr),0)/losses : 0;
  // v=6 (constats 2, 11) : P&L = somme des P&L SAISIS (0 compris) des trades clos,
  // par devise du compte, jamais additionnés entre devises (totalPnL null alors).
  // Avant : un P&L non saisi valait 0 (« $0 ») et USD + EUR donnaient des « $ ».
  const avecPnl=closed.filter(aPnl);
  const pnlParDevise={};
  avecPnl.forEach(t=>{const d=(t.accounts&&t.accounts.currency)||'';pnlParDevise[d]=(pnlParDevise[d]||0)+(+t.pnl_amount);});
  const devises=Object.keys(pnlParDevise);
  const devisePnl=devises.length===1?devises[0]:null;
  const totalPnL=devisePnl!==null?pnlParDevise[devisePnl]:null;
  // v=6 (constat 4, arbitrage 2) : % sur la SOMME des soldes des comptes actifs de
  // cette devise ; null (« — ») si la somme est nulle, la devise inconnue ou multiple.
  // Avant : solde du 1er compte par nom, ou 15 000 inventés sans compte chargé.
  const base=devisePnl?S.accounts.filter(a=>a.is_active!==false&&a.currency===devisePnl).reduce((s,a)=>s+(+a.balance||0),0):0;
  const pnlPct=totalPnL!==null&&base>0?(totalPnL/base)*100:null;
  const ouverts=comptes.filter(t=>t.status==='open').length;
  // v=6 (constat 12) : périmètre réel des chiffres (traders et comptes distincts).
  const distincts=cle=>new Set(comptes.map(t=>t[cle]).filter(v=>v!=null&&v!=='')).size;
  return{nbTraders:distincts('user_id'),nbComptes:distincts('account_id'),total:comptes.length,closed:closed.length,juges:juges.length,sansR,ouverts,nbTest,wins,losses,be,totalRR,nbPnl:avecPnl.length,pnlParDevise,devisePnl,totalPnL,pnlPct,winRate,avgWinRR,avgLossRR};
}

// v=6 (constat 11) : montant signé dans la devise de son compte (Intl, fr-FR :
// « +1 250 $US », « -80 € »). Code illisible : nombre suivi du code ; devise
// inconnue (trade sans compte) : dit tel quel. Avant : « $ » écrit en dur.
function fmtMontant(v,devise){
  const n=Math.round(v*100)/100;const signe=n>0?'+':(n<0?'-':'');
  if(devise){try{return signe+new Intl.NumberFormat('fr-FR',{style:'currency',currency:devise,minimumFractionDigits:0,maximumFractionDigits:2}).format(Math.abs(n));}catch(e){/* code ISO invalide */}}
  return signe+Math.abs(n).toLocaleString('fr-FR',{maximumFractionDigits:2})+(devise?' '+devise:' (devise inconnue)');
}

function renderStats() {
  const st = calcStats(S.trades); // v=6 : calcStats écarte annulés et tests
  renderStatsPanel(st, 'ALL TIME', 'tout l\'historique');
}


// ─── CHARTS ───



// ════════════════════════════════════════════════════════════════════
// V8 — Fonctions importées de V7 (stats panel, charts segmentés, rich editor, calendrier, TJP)
// ════════════════════════════════════════════════════════════════════

// v=6 : `periode` = la période en toutes lettres, pour la phrase « Aucun trade clos sur … ».
function renderStatsPanel(st, label, periode){
  // v=6 : un total R nul est neutre (avant : « +0.00 » en vert).
  // v=6 (revue) : signe et couleur pris sur la valeur AFFICHÉE (arrondie à 2 décimales ;
  // -0 devient 0) : jamais « +0.00 » en vert ni « -0.00 » en rouge.
  const r2=(v)=>+(+v).toFixed(2)||0;
  const totAff=r2(st.totalRR);
  const rc=totAff>0?'pos':(totAff<0?'neg':'');const sign=totAff>0?'+':'';
  const total=st.wins+st.be+st.losses;
  const wPct=total>0?Math.round(st.wins/total*100):0;
  const bePct=total>0?Math.round(st.be/total*100):0;
  const lPct=total>0?Math.round(st.losses/total*100):0;
  // v=6 : ce que les chiffres ne comptent pas, dit en clair sous le total.
  const mentions=[];
  if(st.sansR)mentions.push(`${st.sansR} trade${st.sansR>1?'s':''} clos sans R saisi · à compléter dans le Journal`);
  if(st.nbTest)mentions.push(`${st.nbTest} trade${st.nbTest>1?'s':''} de test non compté${st.nbTest>1?'s':''}`);
  // v=6 (constats 2, 4, 5, 11) : ligne P&L. Non saisi → « P&L non saisi » (jamais
  // « $0 ») ; un montant par devise ; « sur X des Y trades clos » s'il en manque ;
  // signe et couleur pris sur CHAQUE valeur affichée (avant : sur le total R, d'où
  // « +-1.50% » en vert).
  let pnl;
  if(!st.nbPnl)pnl=`<span style="color:var(--text3)">P&amp;L non saisi</span>`;
  else{
    const signe=v=>v>0?'+':(v<0?'-':''),classe=v=>v>0?'pos':(v<0?'neg':'');
    const p=st.pnlPct===null?null:+st.pnlPct.toFixed(2);
    const pct=p===null?`<span style="color:var(--text3)" title="% indisponible : solde des comptes nul, devise inconnue ou devises différentes">— %</span>`
      :`<span class="${classe(p)}">${signe(p)}${Math.abs(p).toFixed(2)}%</span>`;
    const devises=Object.keys(st.pnlParDevise);
    const montants=devises.map(d=>{const v=Math.round(st.pnlParDevise[d]*100)/100;return `<span class="${classe(v)}">${esc(fmtMontant(v,d))}</span>`;}).join(' &nbsp;·&nbsp; ');
    const multi=devises.length>1?` <span style="color:var(--text3)">(devises différentes, non additionnées)</span>`:'';
    const partiel=st.nbPnl<st.closed?` <span style="color:var(--text3)">· sur ${st.nbPnl} des ${st.closed} trades clos</span>`:'';
    pnl=`${pct} &nbsp;·&nbsp; ${montants}${multi}${partiel}`;
  }
  const notes=mentions.length?`<div class="stats-notes" style="font-family:Arial,monospace;font-size:9px;color:var(--text3);line-height:1.5;margin:-6px 0 14px">${mentions.map(m=>`<div>▪ ${m}</div>`).join('')}</div>`:'';
  // v=6 (constat 12) : les chiffres couvrent TOUS les traders et comptes de l'espace
  // (aucun filtre au tableau de bord) ; avant, seul le nom de la période était dit.
  const perimetre=[`Tous les traders de l'espace`];
  if(st.nbTraders)perimetre.push(`${st.nbTraders} trader${st.nbTraders>1?'s':''}`);
  if(st.nbComptes)perimetre.push(`${st.nbComptes} compte${st.nbComptes>1?'s':''}`);
  const entete=`
    <div style="font-family:Arial,monospace;font-size:8px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin-bottom:4px;display:flex;align-items:center;gap:6px;">
      <span style="width:2px;height:10px;background:var(--amber);display:inline-block;border-radius:1px"></span>
      ${esc(label)}
    </div>
    <div class="stats-perimetre" style="font-family:Arial,monospace;font-size:9px;color:var(--text3);margin-bottom:14px;padding-left:8px">${perimetre.join(' · ')}</div>`;
  // v=6 (constat 6) : période sans trade clos → une phrase, pas une rangée de zéros
  // (avant : « +0.00 R » en vert, « 0 % » avec l'aiguille dans le rouge, « WIN 0% »).
  if(!st.closed){
    document.getElementById('stats-row').innerHTML=`${entete}
    <div class="stats-vide" style="font-family:Arial,monospace;font-size:12px;color:var(--text2);background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:14px;margin-bottom:14px;line-height:1.5">Aucun trade clos sur ${esc(periode||label)}${st.ouverts?` · ${st.ouverts} trade${st.ouverts>1?'s':''} en cours`:''}</div>
    ${notes}`;
    return;
  }
  const html=`${entete}

    <div style="margin-bottom:16px;">
      ${total?`<div class="stat-rr ${rc}" style="font-size:2.6rem;line-height:1">${sign}${totAff.toFixed(2)}<span style="font-size:13px;font-weight:400;color:var(--text3);margin-left:4px">R</span></div>`
      :`<div class="stat-rr" style="font-size:2.6rem;line-height:1;color:var(--text3)">—<span style="font-size:13px;font-weight:400;color:var(--text3);margin-left:4px">R</span></div>`}
      <div class="stat-sub" style="font-size:11px;margin-top:4px;line-height:1.5">${pnl}</div>
    </div>
    ${notes}

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
        <div style="font-family:Arial,monospace;font-size:26px;font-weight:700;color:var(--text)">${st.winRate===null?'—':`${Math.round(st.winRate)}<span style="font-size:14px;font-weight:400">%</span>`}</div>
        <div style="font-family:Arial,monospace;font-size:9px;color:var(--text3);margin-top:2px">${total} trade${total>1?'s':''} fermé${total>1?'s':''}${st.sansR?' avec R':''}</div>
      </div>
      <div class="stats-speedo">${speedometerHTML(st.winRate,'')}</div>
    </div>

    <!-- V9.6 — RR moyens par catégorie -->
    <div class="stats-tiles-2">
      <div style="background:rgba(0,168,107,.08);border:1px solid var(--green2);border-radius:var(--radius);padding:10px 12px;text-align:center;">
        <div style="font-family:Arial,monospace;font-size:8px;letter-spacing:.1em;color:var(--green);margin-bottom:3px">RR MOY. GAGNÉ</div>
        <div style="font-family:Arial,monospace;font-size:20px;font-weight:700;color:var(--green)">${st.wins>0?(r2(st.avgWinRR)>0?'+':'')+r2(st.avgWinRR).toFixed(2):'—'}<span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:3px">${st.wins>0?'R':''}</span></div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--text3);margin-top:2px">sur ${st.wins} trade${st.wins>1?'s':''}</div>
      </div>
      <div style="background:rgba(204,42,66,.08);border:1px solid var(--red2);border-radius:var(--radius);padding:10px 12px;text-align:center;">
        <div style="font-family:Arial,monospace;font-size:8px;letter-spacing:.1em;color:var(--red);margin-bottom:3px">RR MOY. PERDU</div>
        <div style="font-family:Arial,monospace;font-size:20px;font-weight:700;color:var(--red)">${st.losses>0?r2(st.avgLossRR).toFixed(2):'—'}<span style="font-size:11px;font-weight:400;color:var(--text3);margin-left:3px">${st.losses>0?'R':''}</span></div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--text3);margin-top:2px">sur ${st.losses} trade${st.losses>1?'s':''}</div>
      </div>
    </div>

    ${total?`<div style="margin-bottom:16px;">
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
    </div>`:''}

  `;
  document.getElementById('stats-row').innerHTML=html;
}

// v=6 (FND-10) : la tuile « DURÉE MOY. / TRADE » est retirée — elle affichait un
// NOMBRE de trades. Aucune durée n'existe en base (close_date jamais saisie, et
// sans heure) ; une vraie durée demanderait de saisir l'heure d'entrée et de sortie.

// v=6 (données honnêtes) : un point = un trade, étiqueté par son jour (jj/mm, avec
// /aa si la période couvre plusieurs années). Avant : « oct. 26 » répété, qui se
// lisait comme un total du mois.
function joursDesTrades(trades){
  const ans=new Set(trades.map(t=>dateDuTrade(t).getFullYear())).size>1;
  return trades.map(t=>{const d=dateDuTrade(t);return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+(ans?'/'+String(d.getFullYear()).slice(2):'');});
}

function buildCumRRData(trades){
  // V9.1 FIX : on inclut les trades BE (0R) — ils apparaissent comme palier plat sur la courbe.
  // Avant : .filter(...&&(+t.actual_rr||0)!==0) → trades BE invisibles.
  // v=6 : seulement les trades comptés (ni annulés ni de test), clos AVEC un R saisi :
  // un R non saisi n'est pas un BE, il n'est pas tracé (le panneau le signale). Cumul
  // exact, arrondi seulement pour l'affichage (avant : chaque trade arrondi puis
  // additionné, la fin de courbe s'écartait du total du panneau).
  trades=tradesComptes(trades);
  const sorted=trades.filter(t=>t.status==='closed')
    .filter(aResultat).sort(ordreChrono);
  const labels=['Début',...joursDesTrades(sorted)];const data=[0];
  let cum=0;
  sorted.forEach(t=>{
    cum+=+t.actual_rr;
    data.push(+cum.toFixed(2));
  });
  return{labels,data,trades:sorted};
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

// V9.6 — Code de fuseau demandé au widget Investing.com (paramètre timeZone), persisté
// en localStorage si possible. v=6 (#34) : la correspondance code → fuseau n'est PAS
// vérifiée (notes d'origine, contradictoires : 55 = Londres ? 113 = Paris/Berlin ?
// 8 = Argentine ou « défaut Investing » ?) : l'aide de conversion ne la suppose jamais.
let S_calTz = (function(){
  try { return localStorage.getItem('S_calTz') || '55'; } catch(_) { return '55'; }
})();
function onCalTzChange(val){
  S_calTz = val || '55';
  try { localStorage.setItem('S_calTz', S_calTz); } catch(_) {}
  updateCalIframe();
  renderCalConversion(); // v=6 (#34) : l'aide suit le code tout de suite (pas au tour suivant de l'horloge)
}

// V9.5/9.6 — URL du widget calendrier Investing.com
//  - timeFilter au lieu de calType (calType était ignoré → bugs période)
//  - timeFilter=customDate avec dateFrom/dateTo pour les plages semaine
//  - timeZone provient de S_calTz (sélecteur, défaut 55 ; fuseau réel non vérifié)
// v=6 (#35) : jours (à midi, heure locale) de la période affichée, partagés par l'URL du
// widget et l'aide de conversion : l'écart d'heure doit être celui de CES jours.
function joursPeriodeCal(kind) {
  const now = new Date();
  if (kind === 'today') return [new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)];
  const dow = now.getDay();
  const mondayOffset = (dow === 0 ? -6 : 1 - dow);
  const lundi = now.getDate() + mondayOffset + (kind === 'nextWeek' ? 7 : 0);
  return Array.from({length:7}, (_, i) => new Date(now.getFullYear(), now.getMonth(), lundi + i, 12));
}

function buildCalIframeSrc() {
  const zone   = CAL_ZONES.find(z => z.code === S_calZone)   || CAL_ZONES[0];
  const period = CAL_PERIODS.find(p => p.key === S_calPeriod) || CAL_PERIODS[1];
  const countries = zone.inv;
  const jours = joursPeriodeCal(period.kind);

  const params = [
    'columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous',
    'importance=' + CAL_IMPORTANCE.join(','),
    `countries=${countries}`,
    `timeZone=${S_calTz}`,
    'lang=5',
  ];

  if (period.kind === 'today') {
    params.push('timeFilter=timeRemain');
  } else { // thisWeek / nextWeek : du lundi au dimanche
    params.push('timeFilter=customDate');
    params.push('dateFrom=' + fmtYMD(jours[0]));
    params.push('dateTo='   + fmtYMD(jours[6]));
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
      } else {
        btn.innerHTML = `<img src="https://flagcdn.com/20x15/${z.cc}.png" style="border-radius:1px;vertical-align:middle;margin-right:4px;width:18px;height:14px" alt="${z.code}"><span style="font-size:11px;font-weight:700">${z.label}</span>`;
      }
      btn.style.cssText = 'display:flex;align-items:center;gap:4px;padding:5px 11px;cursor:pointer;';
      btn.addEventListener('click', () => choisirZoneCal(z.code));
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
      btn.addEventListener('click', () => choisirPeriodeCal(p.key));
      periodEl.appendChild(btn);
    });
  }
}

// v=6 (#37) : clic sur une zone, extrait de buildCalBars pour que la note de zone suive (et soit testable).
function choisirZoneCal(code) {
  S_calZone = code;
  document.querySelectorAll('#cal-zone-btns .acc-tab').forEach(b => b.classList.toggle('active', b.dataset.zone === code));
  updateCalIframe();
  renderCalZoneNote();
}
// v=6 (#37) : une zone dont la liste de pays n'est pas vérifiée le dit (ex. EUR).
function renderCalZoneNote() {
  const el = document.getElementById('cal-zone-note');
  if (!el) return;
  const z = CAL_ZONES.find(x => x.code === S_calZone);
  el.textContent = z && z.note ? z.label + ' : ' + z.inv.split(',').length + ' codes pays demandés à Investing.com — ' + z.note + '.' : '';
}

// v=6 (#35) : choisir une période recalcule aussi l'aide (l'écart dépend des jours affichés).
function choisirPeriodeCal(key) {
  S_calPeriod = key;
  document.querySelectorAll('#cal-period-btns .acc-tab').forEach(b => b.classList.toggle('active', b.dataset.period === key));
  updateCalIframe();
  renderCalConversion(); // v=6 (#35) : l'écart dépend des jours affichés
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
  renderCalZoneNote();
  const imp = document.getElementById('cal-importance');
  if (imp) imp.textContent = libelleImportanceCal();
  // V9.6 — synchroniser visuellement le sélecteur de fuseau avec S_calTz
  const tzSel = document.getElementById('cal-tz-pick');
  // v=6 (#34) : un ancien code enregistré absent de la liste y est ajouté (sinon menu vide
  // alors que ce code est bien demandé au widget).
  if (tzSel && ![...(tzSel.options || [])].some(o => o.value === S_calTz)) {
    const o = document.createElement('option'); o.value = S_calTz; o.textContent = S_calTz;
    tzSel.appendChild(o);
  }
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
      const om = Math.abs(offsetMin)%60; // v=6 (#45) : fuseaux à la demi-heure (Inde, Terre-Neuve…)
      const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      tz.textContent = `GMT${sign}${oh}${om?':'+String(om).padStart(2,'0'):''} · ${tzName.split('/').pop()||''}`;
    }
    renderCalConversion();
  };
  renderClock();
  _calClockTimer = setInterval(renderClock, 30000); // refresh toutes les 30s
}

// v=6 (#34) : écart (en minutes) entre l'heure locale et le fuseau IANA `zone` à l'instant d.
function ecartFuseauMin(d, zone){
  const p = {};
  new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'})
    .formatToParts(d).forEach(x => { p[x.type] = +x.value; });
  const decalageZone = (Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute) - Math.floor(d.getTime()/60000)*60000) / 60000;
  return -d.getTimezoneOffset() - decalageZone;
}
// v=6 (#45) : l'écart garde ses minutes (« +9 h 30 »), jamais arrondi à l'heure.
function fmtEcart(min){
  if (!min) return 'même heure';
  const a = Math.abs(min);
  return (min>0?'+':'-') + Math.floor(a/60) + ' h' + (a%60 ? ' ' + String(a%60).padStart(2,'0') : '');
}
// v=6 (#35) : écart calculé jour par jour sur la période affichée ; s'il change (l'Europe et
// les États-Unis changent d'heure à des dates différentes), le dire : « +6 h jusqu'au 24/10, puis +5 h ».
function regleEcart(zone, jours){
  const segs = [];
  jours.forEach(j => {
    const e = ecartFuseauMin(j, zone), s = segs[segs.length-1];
    if (s && s.e === e) s.fin = j; else segs.push({e, debut:j, fin:j});
  });
  const jj = d => String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0');
  return segs.map((s, i) => i === 0
    ? fmtEcart(s.e) + (segs.length > 1 ? ' jusqu\'au ' + jj(s.fin) : '')
    : (i === segs.length-1 ? 'puis ' + fmtEcart(s.e) : fmtEcart(s.e) + ' du ' + jj(s.debut) + ' au ' + jj(s.fin))
  ).join(', ');
}
// v=6 (#34) : le fuseau des heures du widget n'est pas connu (code non vérifié) : l'aide le
// dit et donne l'écart exact entre ton heure et les deux fuseaux possibles d'après les notes
// du code (New York, ou Londres pour le code 55 par défaut). Jamais « c'est New York ».
function computeConversionHint(jours){
  return {
    statut: 'fuseau du code ' + S_calTz + ' non vérifié',
    ny: regleEcart('America/New_York', jours),
    londres: regleEcart('Europe/London', jours),
  };
}
function renderCalConversion(){
  const period = CAL_PERIODS.find(p => p.key === S_calPeriod) || CAL_PERIODS[1];
  const conv = computeConversionHint(joursPeriodeCal(period.kind));
  const st = document.getElementById('cal-conv-statut');
  const ny = document.getElementById('cal-conv-ny');
  const lon = document.getElementById('cal-conv-lon');
  if (st)  st.textContent = conv.statut;
  if (ny)  ny.textContent = conv.ny;
  if (lon) lon.textContent = conv.londres;
}


// v=6 (données honnêtes) : un R affiché arrondi à 2 décimales, sans « -0.00 ».
function texteR(v){const n=+(+v).toFixed(2);return (n>0?'+':'')+n.toFixed(2)+' R';}
// v=6 : graduation d'un axe en R sans arrondi qui la fausse (avant : toFixed(1) →
// « +0.1R » répété, 0.25 posé sur la ligne « +0.3R », « -0.0R »).
function graduationR(v){const n=+(+v).toFixed(4);return (n>0?'+':'')+n+'R';}

// V8 : helpers de construction de charts V7 (segments colorés par profit/perte)
// v=6 : trades = les trades tracés (point i = trades[i-1], le point 0 est « Début »).
function makeBalChart(canvas,labels,data,trades){
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
      label:'R cumulé',data,
      segment:buildSegmentColors(data),
      fill:true,backgroundColor:grad,
      // v=6 : tension 0. Le lissage (0.4) inventait des creux et des pics absents des
      // données (un BE dessiné en creux, la courbe sous 0 sans aucune perte).
      tension:0,pointRadius:0,pointHoverRadius:5,
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
        // v=6 : un point = un trade, et la valeur est un CUMUL (avant : le mois en titre
        // et « +2.00 R », lu comme le résultat du mois).
        callbacks:{
          title:items=>{const t=(trades||[])[items[0].dataIndex-1];return t?`${t.instrument||'?'} · ${dateTradeTexte(t)}`:'Début';},
          label:c=>'Cumulé : '+texteR(c.parsed.y),
          afterLabel:c=>{const t=(trades||[])[c.dataIndex-1];return t?'Ce trade : '+texteR(t.actual_rr):'';}
        }
      }
    },
    scales:{
      x:{grid:{color:gc,drawBorder:false},ticks:{color:tc,font:{size:9,family:'Arial'},maxTicksLimit:10}},
      y:{
        grid:{color:gc,drawBorder:false},
        ticks:{color:tc,font:{size:9,family:'Arial'},callback:graduationR},
        // Ligne zéro bien visible
        afterDataLimits(axis){axis.min=Math.min(axis.min,-0.1);}
      }
    }
  }});
}

// V9.1 : 1 barre par trade fermé, filtrée par la période (mois sélectionnés ou tout)
function buildTradesForRRChart(keys){
  // keys = liste de "YYYY-M" ; si vide/null → tous les trades
  // v=6 : MÊME liste que la courbe (buildCumRRData : comptés, clos, R saisi, ordre
  // chronologique) et même période que le panneau (getTradesForMonths). Avant : les
  // trades de test et les clos sans R y passaient (un « R non saisi » dessiné en BE).
  return buildCumRRData(keys&&keys.length?getTradesForMonths(keys):S.trades).trades;
}

// v=6 : trades = la liste déjà tracée par la courbe (buildCumRRData(...).trades).
function makeRRChart(trades){
  if(S.chartRR)S.chartRR.destroy();
  const gc=getCSSVar('--chart-grid');const tc=getCSSVar('--chart-tick');const amber=getCSSVar('--amber');
  // Stocker pour le clic (mapping index → trade id)
  S._rrChartTrades=trades;
  const jours=joursDesTrades(trades);
  const labels=trades.map((t,i)=>`${jours[i]} ${t.instrument||''}`);
  // v=6 : valeur saisie exacte (aResultat garanti) ; l'arrondi n'est que dans l'info-bulle.
  const data=trades.map(t=>+t.actual_rr);
  S.chartRR=new Chart(document.getElementById('rrChart'),{type:'bar',data:{
    labels,
    datasets:[{label:'R réalisé',data,
      backgroundColor:data.map(v=>v>0?'rgba(0,214,143,.8)':(v<0?'rgba(255,77,106,.8)':'rgba(240,192,64,.7)')),
      // v=6 : un BE (0 R) garde une barre visible et cliquable (avant : 0 px, ni
      // info-bulle ni détail ; son jaune ne se voyait jamais).
      minBarLength:4,
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
            return `${t.instrument||'?'} · ${dateTradeTexte(t)}`;
          },
          label:c=>texteR(c.parsed.y)+(c.parsed.y===0?' (BE)':'')
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
      y:{grid:{color:gc,drawBorder:false},ticks:{color:tc,font:{size:9,family:'Arial'},callback:graduationR}}
    }
  }});
}

// v=6 (données honnêtes) : rien à tracer → une phrase dans le cadre, pas un axe vide
// autour de 0 (qui se lit « résultat nul »). Le canvas est seulement masqué, jamais
// remplacé : le dessin suivant le réutilise.
function grapheVide(idCadre,idCanvas,vide){
  const cadre=document.getElementById(idCadre),canvas=document.getElementById(idCanvas);
  if(!cadre||!canvas)return;
  let msg=cadre.querySelector('.chart-vide');
  if(vide&&!msg){
    msg=document.createElement('div');msg.className='empty chart-vide';
    msg.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;font-size:12px';
    msg.textContent='Aucun trade clos avec un R saisi sur la période';
    cadre.appendChild(msg);
  }
  if(msg)msg.style.display=vide?'flex':'none';
  canvas.style.display=vide?'none':'';
}

// v=5 : redessine les deux graphiques du tableau de bord selon le filtre COURANT
// (relance unique quand Chart.js arrive, même si le filtre a changé entre-temps).
function redessinerGraphiques(){
  if(S_dashMonths.size>0)renderChartsByMonths([...S_dashMonths]);else renderCharts();
}

async function renderCharts(){
  // Vue ALL TIME (aucun mois sélectionné) : même dessin, sans filtre de mois.
  return renderChartsByMonths(null);
}

// v=6 : buildMonthlyRR retirée — son seul appelant (updateChartColors) l'appliquait,
// à tort, à un graphique d'une barre par trade.

function renderMonthly(){
  const tb=document.getElementById('m-tbody');
  if(!tb)return; // FND-004 : garde — l'element cible n'existe pas dans le DOM actuel
  const years={};
  S.trades.filter(t=>t.status==='closed').forEach(t=>{const d=dateDuTrade(t);const y=d.getFullYear(),m=d.getMonth();if(!years[y])years[y]=Array(12).fill(null).map(()=>({rr:0,pnl:0,tot:0,wins:0}));years[y][m].rr+=(+t.actual_rr||0);years[y][m].pnl+=(+t.pnl_amount||0);years[y][m].tot++;if((+t.actual_rr||0)>0)years[y][m].wins++;});
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

  // v=6 (constat 0) : clos sans R saisi → « Résultat non saisi », bordure neutre (le
  // jaune reste au BE saisi) ; un trade en cours n'a pas de résultat chiffré.
  const res=resultatDuTrade(t),enCours=t.status==='open';
  const col=res&&!enCours?res.col:'var(--border2)';
  const resultatHTML=res&&!enCours?`<div style="font-family:Arial,monospace;font-size:22px;font-weight:700;color:${res.col}">${res.texte}</div>`
    :`<div style="font-family:Arial,monospace;font-size:13px;color:var(--text3);margin-top:4px">${enCours?'Trade en cours':(t.status==='closed'?'Résultat non saisi':'Trade annulé')}</div>`;
  // v=6 (constat 2) : P&L dans la devise du compte, « P&L non saisi » s'il manque
  // (avant : masqué, un 0 saisi aussi). Trade en cours : ce qui est saisi est dit tel quel.
  const pnl=pnlDuTrade(t);
  const note=txt=>`<div style="font-family:Arial,monospace;font-size:9px;color:var(--text3);margin-top:2px">${txt}</div>`;
  const pnlHTML=enCours?(res||pnl?note(`Saisi : ${[res&&res.texte,pnl&&esc(pnl.texte)].filter(Boolean).join(' · ')} (trade encore ouvert)`):'')
    :(pnl?`<div style="font-family:Arial,monospace;font-size:11px;color:${pnl.col};margin-top:2px">${esc(pnl.texte)}</div>`:(t.status==='closed'?note('P&amp;L non saisi'):''))
      +(t.status==='closed'&&!res?note('À compléter : ✏ Modifier ce trade'):'');
  const dirClass=t.direction==='LONG'?'long':'short';
  const planLabel={respected:'✅ Plan respecté',partial:'⚠ Plan partiel',not_respected:'❌ Plan non respecté'}[t.plan_respected]||'';
  const statusLabel=t.status==='closed'?'✓ FERMÉ':(t.status==='open'?'● EN COURS':'⏸ ANNULÉ');

  title.innerHTML=`<span style="display:inline-flex;align-items:center;gap:8px">
    <span style="font-weight:700;font-size:11px;color:var(--text)">${esc(t.instrument||'?')}</span>
    <span class="badge badge-${dirClass}">${t.direction||''}</span>
    <span style="font-size:9px;color:var(--text3)">${dateTradeHTML(t)}</span>
  </span>`;

  // v=6 (constat 30) : le panneau lit les VRAIES colonnes, comme le journal
  // (sl_price, tp_price, risk_rr « R:R théo », lessons) et montre aussi notes
  // d'entrée, session, TF et setup. Avant : stop_loss, take_profit, planned_rr et
  // lessons_learned, qui n'existent pas : ces saisies n'apparaissaient jamais.
  content.innerHTML=`
    <!-- Bandeau résultat -->
    <div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid ${col};border-radius:var(--radius);padding:12px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:10px">
      <div>
        <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.1em;margin-bottom:3px">RÉSULTAT</div>
        ${resultatHTML}
        ${pnlHTML}
      </div>
      <div style="text-align:right">
        <div style="font-family:Arial,monospace;font-size:9px;color:var(--text3);letter-spacing:.06em">${statusLabel}</div>
        ${t.strategy?`<div style="font-family:Arial,monospace;font-size:10px;color:var(--text2);margin-top:4px">${esc(t.strategy)}</div>`:''}
      </div>
    </div>

    <!-- ANALYSE -->
    ${(t.analysis_notes||t.session||t.timeframe||t.setup_type)?`<div style="margin-bottom:14px">
      <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ ANALYSE</div>
      ${(t.session||t.timeframe||t.setup_type)?`<div class="chip-row">${t.session?chip('Session',t.session):''}${t.timeframe?chip('TF',t.timeframe):''}${t.setup_type?chip('Setup',t.setup_type):''}</div>`:''}
      ${t.analysis_notes?`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.7">${sanitizeNotesHtml(t.analysis_notes)}</div>`:''}
    </div>`:''}

    <!-- EXÉCUTION (paramètres) -->
    <div style="margin-bottom:14px">
      <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ EXÉCUTION</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
        ${t.entry_price?chip('Entrée',t.entry_price):''}
        ${t.sl_price?chipC('SL',t.sl_price,'var(--red)'):''}
        ${t.tp_price?chipC('TP',t.tp_price,'var(--green)'):''}
        ${t.exit_price?chip('Sortie',t.exit_price):''}
        ${t.lot_size?chip('Lot',t.lot_size):''}
        ${t.risk_rr?chipC('R:R théo','+'+parseFloat(t.risk_rr).toFixed(2),'var(--blue)'):''}
      </div>
      ${t.entry_notes?`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.7;margin-top:6px">${texteLignes(t.entry_notes)}</div>`:''}
    </div>

    <!-- CAPTURES (chargées async, AGRANDIES) -->
    <div id="tjp-imgs-single" style="margin-bottom:14px">
      <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ CAPTURES</div>
      <div class="spin" style="margin:14px auto"></div>
    </div>

    <!-- GESTION & CLÔTURE -->
    ${(t.plan_respected||t.execution_quality||t.management_notes||t.lessons)?`<div style="margin-bottom:14px">
      <div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ GESTION &amp; CLÔTURE</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
        ${t.execution_quality?`<div class="chip"><span class="lbl">Qualité: </span><span class="val">${t.execution_quality}/10</span></div>`:''}
        ${planLabel?`<div class="chip"><span class="val">${planLabel}</span></div>`:''}
      </div>
      ${t.management_notes?`<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:6px">${texteLignes(t.management_notes)}</div>`:''}
      ${t.lessons?`<div style="background:var(--bg3);border:1px solid var(--border);border-left:3px solid var(--amber);border-radius:var(--radius);padding:10px 12px;font-size:11px;color:var(--text2);line-height:1.7"><span style="color:var(--amber);font-family:Arial,monospace;font-size:8px;letter-spacing:.1em">LEÇONS · </span>${texteLignes(t.lessons)}</div>`:''}
    </div>`:''}

    <button class="btn btn-amber btn-sm" type="button" style="width:100%;margin-top:6px" onclick="openTrade('${t.id}')">✏ Modifier ce trade</button>
  `;
  panel.style.right='0px';
  if(overlay)overlay.style.display='block';

  // Charger les images en GRAND
  // v=6 (constat 29) : un échec de lecture ou de signature est DIT (« Captures
  // indisponibles (réseau ?) », Réessayer), distinct de « Aucune capture » (avant : un
  // échec s'affichait « Aucune capture » ou faisait disparaître la section).
  const TITRE_CAPTURES='<div style="font-family:Arial,monospace;font-size:8px;color:var(--amber);letter-spacing:.14em;margin-bottom:6px">▪ CAPTURES</div>';
  const relancer=`showTradeDetailById(${escJs(t.id)})`;
  try{
    const images=await lireCapturesTrade(t.id);
    const container=document.getElementById('tjp-imgs-single');
    if(!container)return;
    if(images===null){container.innerHTML=TITRE_CAPTURES+capturesIndispo(0,relancer);return;}
    if(!images.length){
      container.innerHTML=TITRE_CAPTURES+'<div style="color:var(--text3);font-size:10px;text-align:center;padding:8px">Aucune capture</div>';
      return;
    }
    const liens=await signerChemins(images.map(img=>img.storage_path));
    if(!Object.keys(liens).length){container.innerHTML=TITRE_CAPTURES+capturesIndispo(0,relancer);return;}
    const manquantes=images.filter(f=>estImage(f)&&!liens[f.storage_path]).length;
    // v=6 (constat 31) : groupes aux libellés du journal ; une image en grand, un autre
    // fichier par son NOM avec son lien (avant : un PDF dans une <img> cassée, sans nom).
    const groupes={};
    images.forEach(f=>{const g=LIBELLES_PJ[f.image_type]?f.image_type:'autre';(groupes[g]=groupes[g]||[]).push(f);});
    const rendus=['entry','close','file','autre'].filter(g=>groupes[g]).map(g=>({g,html:groupes[g].map(f=>{
      const url=liens[f.storage_path];
      if(!estImage(f))return fichierHTML(f,url);
      return url?`<img src="${esc(url)}" onclick="bigImg(${escJs(url)})" style="width:100%;max-height:280px;object-fit:contain;border-radius:3px;cursor:zoom-in;border:1px solid var(--border);background:var(--bg4)">`:'';
    }).join('')})).filter(r=>r.html);
    container.innerHTML=TITRE_CAPTURES+
      rendus.map(r=>`
        <div style="margin-bottom:10px">
          <div style="font-family:Arial,monospace;font-size:8px;color:var(--text3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">${LIBELLES_PJ[r.g]||'Autres'}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">${r.html}</div>
        </div>`).join('')+(manquantes?capturesIndispo(manquantes,relancer):'');
  }catch(e){
    const container=document.getElementById('tjp-imgs-single');
    if(container)container.innerHTML=TITRE_CAPTURES+capturesIndispo(0,relancer);
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

// v=6 (revue) : l'année choisie au sélecteur (12 mois cochés) est un point de départ ;
// le 1er clic sans Maj sur un mois l'affiche SEUL (avant : le clic retirait ce mois et
// montrait les 11 autres ; glisser ne faisait plus rien).
let S_dashAnneeEntiere=false;
function toggleDashMonth(key,btn,shiftKey){
  if(S_dashAnneeEntiere&&!shiftKey)S_dashMonths.clear();
  S_dashAnneeEntiere=false;
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

// v=6 (AJOUT 5) : choisir une année sélectionne ses 12 mois (libellé « ANNÉE 2025 »).
// Avant : aucun mois sélectionné → « ALL TIME » sur tout l'historique, alors que le
// sélecteur « Période » affichait l'année choisie.
function onDashYearChange(yr){
  S_dashYear=parseInt(yr);S_dashMonths.clear();
  for(let m=0;m<12;m++)S_dashMonths.add(S_dashYear+'-'+m);
  S_dashAnneeEntiere=true;
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

// v=6 : clé « année-mois » (mois 0-11) du jour du trade, en heure locale.
function cleMoisDuTrade(t){const d=dateDuTrade(t);return d.getFullYear()+'-'+d.getMonth();}
// v=6 (constat 10) : seulement les trades COMPTÉS (ni annulés, ni de test).
function getTradesForMonths(keys){
  return tradesComptes(S.trades).filter(t=>keys.includes(cleMoisDuTrade(t)));
}

// V9 FIX FND-007 : renderStatsByMonths n'acceptait pas son paramètre keys
// et appelait getTradesForMonths() sans argument → keys=undefined → TypeError
// silencieux qui bloquait TOUT le rendu (stats, charts, monthly, journal).
function renderStatsByMonths(keys) {
  // Fallback robuste si appelé sans paramètre
  const k = (Array.isArray(keys) && keys.length > 0) ? keys : [...S_dashMonths];
  // v=6 : tous les trades des mois ; calcStats écarte annulés et tests (et compte ces derniers).
  const st = calcStats(S.trades.filter(t => k.includes(cleMoisDuTrade(t))));
  let label = 'ALL TIME', periode = 'tout l\'historique';
  if (k.length === 0) {
    label = 'AUCUN MOIS'; periode = 'aucun mois';
  } else if (k.length === 1) {
    const [y, m] = k[0].split('-').map(Number);
    const monthNames = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    label = (monthNames[m] || '?').toUpperCase() + ' ' + y;
    periode = (monthNames[m] || '?').toLowerCase() + ' ' + y;
  } else if (new Set(k).size === 12 && k.every(x => x.split('-')[0] === k[0].split('-')[0])) {
    // v=6 (AJOUT 5) : les 12 mois d'une même année.
    const y = k[0].split('-')[0];
    label = 'ANNÉE ' + y; periode = 'l\'année ' + y;
  } else {
    label = k.length + ' MOIS SÉLECTIONNÉS'; periode = 'les ' + k.length + ' mois sélectionnés';
  }
  renderStatsPanel(st, label, periode);
}

async function renderChartsByMonths(keys){
  if(!grapheDisponible(redessinerGraphiques))return;
  // v=6 : courbe et barres tracent la MÊME liste (trades comptés, clos, R saisi) de
  // la période (keys vide/null = tout) ; avant, deux filtres distincts.
  const{labels,data,trades}=buildCumRRData(buildTradesForRRChart(keys));
  const vide=!trades.length;
  if(vide){
    if(S.chartBal)S.chartBal.destroy();
    if(S.chartRR)S.chartRR.destroy();
    S.chartBal=S.chartRR=null;S._rrChartTrades=[];
  }
  // APRÈS destroy() : Chart.js y rend au canvas son style d'origine (display compris).
  grapheVide('bal-wrap','balChart',vide);grapheVide('rr-wrap','rrChart',vide);
  if(vide)return;
  makeBalChart(document.getElementById('balChart'),labels,data,trades);
  makeRRChart(trades); // 1 barre par trade tracé
}



// ════════════════════════════════════════════════════════════════════
// JOURNAL MODULE
// ════════════════════════════════════════════════════════════════════

function renderJournal(){
  const list=document.getElementById('j-list');
  // v=6 (constat 3) : trades jamais lus (lecture en échec) → « non chargés », jamais
  // « Aucun trade » (la recherche et les filtres du Journal rendent aussi la liste)
  if(echecsLecture.trades==='jamais'){afficherTradesIndisponibles();return;}
  if(!S.filtered.length){
    // v=6 (constat 27) : des trades existent mais la recherche ou les filtres les masquent tous
    const n=(S.trades||[]).length;
    list.innerHTML=n
      ?`<div class="empty"><h3>Aucun trade ne correspond aux filtres</h3><p>${n} trade${n>1?'s':''} au journal : change la recherche ou les filtres ci-dessus.</p></div>`
      :'<div class="empty"><h3>Aucun trade</h3><p>+ Nouveau Trade pour commencer</p></div>';
    return;
  }
  list.innerHTML=S.filtered.map(tradeHTML).join('');
}

function tradeHTML(t){
  // v=6 (constat 0) : R saisi affiché (0 = BE compris, avant masqué) ; clos sans R :
  // « Résultat non saisi », à compléter (avant : rien, comme un BE).
  const res=resultatDuTrade(t),pnl=pnlDuTrade(t);
  const uColor=couleurSure(t.users?.color,'var(--text3)'),uName=t.users?.name||'';
  const isOpen=t.status==='open';const statusColor=isOpen?'var(--blue)':t.status==='closed'?'var(--green2)':'var(--text3)';
  return `<div class="tj-item ${t.is_test?'is-test':''} status-${t.status}" id="tj-${t.id}">
    <div class="tj-hdr" onclick="toggleTJ('${t.id}')">
      <div class="tj-status-bar" style="background:${statusColor}"></div>
      <div class="tj-left">
        <span style="font-family:Arial,monospace;font-weight:600;font-size:12px;color:var(--text)">${esc(t.instrument)}</span>
        <span class="badge badge-${t.direction==='LONG'?'long':'short'}">${t.direction}</span>
        ${t.is_test?'<span class="badge badge-test">🧪TEST</span>':''}
        ${t.strategy?`<span style="color:var(--text3);font-size:10px;font-family:Arial,monospace">${esc(t.strategy)}</span>`:''}
        <span style="color:var(--text3);font-size:9px;font-family:Arial,monospace">· ${dateTradeHTML(t)}</span>
        ${uName?`<span style="font-size:9px;font-family:Arial,monospace;padding:1px 6px;border-radius:2px;background:${uColor}22;color:${uColor};border:1px solid ${uColor}44">${esc(uName)}</span>`:''}
        <span class="badge badge-${t.status}">${isOpen?'⬤ EN COURS':t.status==='closed'?'✓ FERMÉ':'✗ ANNULÉ'}</span>
      </div>
      <div class="tj-right">
        ${res?`<span style="font-family:Arial,monospace;font-size:11px;font-weight:600;color:${res.col}">${res.texte}</span>`:(t.status==='closed'?'<span style="font-family:Arial,monospace;font-size:10px;color:var(--text3);white-space:nowrap">Résultat non saisi</span>':'')}
        ${pnl?`<span style="font-family:Arial,monospace;font-size:10px;white-space:nowrap;color:${pnl.col}">${esc(pnl.texte)}</span>`:''}
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
          <div class="fg"><label class="fl">Prix sortie</label><input type="text" inputmode="decimal" class="f-inp" id="qc-exit-${t.id}" value="${esc(t.exit_price==null?'':String(t.exit_price))}" placeholder="prix de sortie" oninput="calcQuickRR('${t.id}','${t.direction}',${t.entry_price||0},${t.sl_price||0})"><div id="qc-exit-${t.id}-msg" style="display:none;font-size:10px;font-family:Arial,monospace;line-height:1.4"></div></div>
          <div class="fg"><label class="fl">R:R réalisé</label><input type="text" inputmode="decimal" class="f-inp" id="qc-rr-${t.id}" value="${esc(t.actual_rr==null?'':String(t.actual_rr))}" placeholder="${rrCalculable(t.direction,t.entry_price,t.sl_price)?'Auto':'non renseigné'}" oninput="delete this.dataset.auto"><div id="qc-rr-${t.id}-msg" style="display:none;font-size:10px;font-family:Arial,monospace;line-height:1.4"></div></div>
          <div class="fg"><label class="fl">${esc(libellePnl(t.account_id,t.accounts&&t.accounts.currency))}</label><input type="text" inputmode="decimal" class="f-inp" id="qc-pnl-${t.id}" value="${esc(t.pnl_amount==null?'':String(t.pnl_amount))}" placeholder="non renseigné"><div id="qc-pnl-${t.id}-msg" style="display:none;font-size:10px;font-family:Arial,monospace;line-height:1.4"></div></div>
          <div class="fg" style="justify-content:flex-end;padding-top:16px"><button class="btn btn-green btn-sm" type="button" onclick="submitQuickClose('${t.id}')">💾 Valider</button></div>
        </div>
      </div>`:''}
    </div>
  </div>`;
}

function tradeBlockContent(t){
  const res=resultatDuTrade(t),pnl=pnlDuTrade(t);
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
      ${t.exit_price?chip('Sortie',t.exit_price):''}${res?chipC('R:R réalisé',res.valeur,res.col):(t.status==='closed'?chipC('R:R réalisé','non saisi','var(--text3)'):'')}${pnl?chipC('P&L',pnl.texte,pnl.col):(t.status==='closed'?chipC('P&L','non saisi','var(--text3)'):'')}${t.execution_quality?chip('Qualité',t.execution_quality+'/10'):''}${t.plan_respected?chip('Plan',{respected:'✅ Respecté',partial:'⚠ Partiel',not_respected:'❌ Non respecté'}[t.plan_respected]||t.plan_respected):''}</div>
    ${t.management_notes?`<p style="font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:5px"><span style="color:var(--amber);font-size:9px;font-family:Arial,monospace">GESTION · </span>${esc(t.management_notes).replace(/\n/g,'<br>')}</p>`:''}
    ${t.lessons?`<p style="font-size:11px;color:var(--text2);line-height:1.7"><span style="color:var(--amber);font-size:9px;font-family:Arial,monospace">LEÇONS · </span>${esc(t.lessons).replace(/\n/g,'<br>')}</p>`:''}
    <div class="img-grid" id="ig-close-${t.id}" style="margin-top:6px"></div>
  </div>
  <div class="tj-section">
    <div class="tj-section-lbl">Analyse et fichiers</div>
    <div class="img-grid" id="ig-file-${t.id}"></div>
    <div id="fl-${t.id}"></div>
  </div>`;
}

function chip(l,v){return `<div class="chip"><span class="lbl">${esc(l)}: </span><span class="val">${esc(v)}</span></div>`;}
function chipC(l,v,col){return `<div class="chip"><span class="lbl">${esc(l)}: </span><span style="color:${col};font-family:Arial,monospace">${esc(v)}</span></div>`;}
// v=6 : texte libre multiligne (échappé, retours à la ligne gardés).
function texteLignes(s){return esc(s).replace(/\n/g,'<br>');}
// v=6 (constat 0) : résultat SAISI d'un trade, lu une seule fois pour le journal et le
// panneau. null = R non saisi : ce n'est PAS un BE (avant : +t.actual_rr||0 en faisait
// un « +0.00R » jaune) ; 0 saisi = BE, en jaune.
function resultatDuTrade(t){
  if(!aResultat(t))return null;
  const rr=+t.actual_rr,valeur=(rr>0?'+':'')+rr.toFixed(2);
  return {rr,valeur,texte:valeur+'R',col:rr>0?'var(--green)':(rr<0?'var(--red)':'var(--yellow)')};
}
// v=6 (constat 2 et 11, journal et panneau) : P&L SAISI d'un trade, dans la devise de
// SON compte (« +150,00 $US », « -80,00 € ») ; null s'il n'est pas saisi, jamais « $0 ».
// Avant : « $ » écrit en dur, et un 0 saisi masqué comme une absence.
// v=6 (constat 11) : le P&L se saisit dans la devise du compte (avant : « P&L ($) » pour
// tout compte, alors qu'il s'affiche dans la devise du compte ; un compte en EUR
// poussait à saisir des dollars). Sans compte choisi, la devise n'est pas devinée.
function libellePnl(compteId,devise){
  const d=devise||((S.accounts||[]).find(a=>a.id===compteId)||{}).currency||'';
  let sym=d;
  if(d){try{sym=new Intl.NumberFormat('fr-FR',{style:'currency',currency:d}).formatToParts(0).find(p=>p.type==='currency').value;}catch(e){/* code ISO invalide : le code tel quel */}}
  return 'P&L ('+(sym||'devise du compte')+')';
}
function majLibellePnl(){
  const l=document.getElementById('m-pnl-lbl');if(!l)return;
  const id=document.getElementById('m-acc')?.value||'';
  const t=S.editId?(S.trades||[]).find(x=>x.id===S.editId):null;
  l.textContent=libellePnl(id,t&&id&&t.account_id===id?t.accounts?.currency:'');
}
function pnlDuTrade(t){
  if(!aPnl(t))return null;
  const n=Math.round(+t.pnl_amount*100)/100,signe=n>0?'+':(n<0?'-':'');
  const d=(t.accounts&&t.accounts.currency)||((S.accounts||[]).find(a=>a.id===t.account_id)||{}).currency||'';
  const f={minimumFractionDigits:2,maximumFractionDigits:2};
  let texte=null;
  if(d){try{texte=signe+new Intl.NumberFormat('fr-FR',{style:'currency',currency:d,...f}).format(Math.abs(n));}catch(e){/* code ISO invalide */}}
  if(texte===null)texte=signe+Math.abs(n).toLocaleString('fr-FR',f)+(d?' '+d:' (devise inconnue)');
  return {n,texte,col:n>0?'var(--green)':(n<0?'var(--red)':'var(--text2)')};
}
// v=6 (constat 32) : date affichée d'un trade. Sans date de trade, on montre la date
// de SAISIE en le disant (avant : created_at présenté comme la date du trade). Le tri
// et les regroupements par mois gardent leur repli (règle ouverte, CLAUDE.md §4).
// v=6 (constat 32) : même règle en texte brut (info-bulles des graphiques).
function dateTradeTexte(t){return t.trade_date?fDate(t.trade_date):'date non saisie'+(t.created_at?' · saisi le '+fDate(t.created_at):'');}
function dateTradeHTML(t){
  if(t.trade_date)return esc(fDate(t.trade_date));
  return `<span style="font-style:italic" title="Date du trade non saisie : c'est la date de saisie">date non saisie${t.created_at?' · saisi le '+esc(fDate(t.created_at)):''}</span>`;
}

// ─── v=6 (constat 31) : pièces jointes d'un trade ───
// v=6 (AJOUT 3) : les captures « file » sont celles de l'onglet Analyse de la fiche (et les
// fichiers joints des versions précédentes) : même libellé partout.
const LIBELLES_PJ={entry:'Entrée',close:'Clôture',file:'Analyse et fichiers'};
// Image ou autre fichier ? Le type MIME d'abord ; ligne ancienne sans type : d'après
// l'extension (inconnue : image, comme avant).
function estImage(f){
  if(f&&f.mime_type)return /^image\//i.test(f.mime_type);
  return !/\.(pdf|csv|xlsx?|xlsm|ods|docx?|odt|txt|zip)$/i.test(String((f&&(f.filename||f.storage_path))||''));
}
// Fichier non image : son NOM, et son lien s'il a pu être signé (sinon : dit).
function fichierHTML(f,url){
  const nom=esc(f.filename||String(f.storage_path||'').split('/').pop()||'fichier');
  return `<div style="padding:2px 0;font-size:10px;color:var(--text2);font-family:Arial,monospace;width:100%">📄 ${url?`<a href="${safeUrl(url)}" target="_blank" rel="noopener" class="lien-fichier" style="color:var(--blue)">${nom}</a>`:`${nom} <span style="color:var(--text3)">— lien indisponible (réseau ?)</span>`}</div>`;
}
// v=6 (constat 29) : captures d'un trade ; null = lecture en échec, à ne pas confondre
// avec [] = aucune capture (loadTradeImages rend [] dans les deux cas).
async function lireCapturesTrade(id){
  try{const{data,error}=await sb.from('trade_images').select('*').eq('trade_id',id);return error?null:(data||[]);}
  catch(_){return null;}
}
// v=6 (constat 29) : message d'échec des captures, distinct de « Aucune capture ».
// n = captures non affichées (0 : toutes, ou nombre inconnu) ; relancer = appel du
// bouton Réessayer ; fiche = captures déjà enregistrées (inutile de les recoller).
function capturesIndispo(n,relancer,fiche){
  const s=n>1?'s':'';
  const txt=n?`${n} capture${s}${fiche?` déjà enregistrée${s}`:''} indisponible${s} (réseau ?)`
    :(fiche?'Captures déjà enregistrées indisponibles (réseau ?)':'Captures indisponibles (réseau ?)');
  return `<div class="captures-indispo" style="width:100%;font-family:Arial,monospace;font-size:10px;color:var(--text3);padding:6px 0">⚠ ${txt}${fiche?` : inutile de ${n===1?'la':'les'} recoller.`:''}${relancer?` <button class="btn btn-ghost btn-sm" type="button" onclick="${relancer}">Réessayer</button>`:''}</div>`;
}
// Vignette (journal, fiche) : une image en miniature, un autre fichier par son nom.
function vignetteHTML(f,url){
  if(!estImage(f))return fichierHTML(f,url);
  return url?`<img src="${esc(url)}" class="img-thumb" onclick="bigImg(${escJs(url)})">`:'';
}

function toggleTJ(id){
  const body=document.getElementById('body-'+id);const arr=document.getElementById('arr-'+id);
  const open=body.classList.contains('open');
  body.classList.toggle('open',!open);if(arr)arr.textContent=open?'▼':'▲';
  if(!open)loadImagesInView(id);
}

async function loadImagesInView(tradeId){
  const images=await lireCapturesTrade(tradeId);
  // v=6 (constat 29) : lecture ou signature en échec → « Captures indisponibles (réseau
  // ?) » avec Réessayer (avant : grilles vides, comme un trade sans capture).
  const relancer=`loadImagesInView(${escJs(tradeId)})`;
  const fl=document.getElementById(`fl-${tradeId}`);
  const indisponible=()=>{
    ['entry','close','file'].forEach((type,k)=>{const el=document.getElementById(`ig-${type}-${tradeId}`);if(el)el.innerHTML=k?'':capturesIndispo(0,relancer);});
    if(fl)fl.innerHTML='';
  };
  if(images===null){indisponible();return;}
  // v=6 (constat 31) : vignettes = images seulement ; tout autre fichier, quel que soit
  // son onglet, est listé par son nom avec son lien (avant : un PDF d'Entrée ou de
  // Clôture partait dans une <img> cassée, et celui de Fichiers n'avait pas de lien).
  const grilles=['entry','close','file'].map(type=>({
    el:document.getElementById(`ig-${type}-${tradeId}`),
    imgs:images.filter(i=>i.image_type===type&&estImage(i)),
  })).filter(g=>g.el);
  if(fl)grilles.push({el:fl,imgs:images.filter(i=>!estImage(i))});
  grilles.forEach(g=>{g.el.innerHTML=g.imgs.length?'<div class="spin"></div>':'';});
  // v=5 : toutes les vignettes du trade signées en UNE requête (avant : une par image)
  const liens=await signerChemins(grilles.flatMap(g=>g.imgs.map(i=>i.storage_path)));
  if(grilles.some(g=>g.imgs.length)&&!Object.keys(liens).length){indisponible();return;}
  grilles.forEach(g=>{if(g.imgs.length)fillImgGrid(g.el,g.imgs,liens,relancer);});
}

// liens : { chemin: url } déjà signés (signerChemins) ; sinon signés ici en une requête.
// v=6 (constat 29) : une capture non signée est comptée et dite (avant : absente sans trace).
async function fillImgGrid(container,imgs,liens,relancer){
  if(!liens){
    container.innerHTML='<div class="spin"></div>';
    liens=await signerChemins(imgs.map(img=>img.storage_path));
  }
  const manquantes=imgs.filter(img=>estImage(img)&&!liens[img.storage_path]).length;
  container.innerHTML=imgs.map(img=>vignetteHTML(img,liens[img.storage_path])).join('')+(manquantes?capturesIndispo(manquantes,relancer):'');
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

// ─── SAISIE DES NOMBRES (v=6, données honnêtes) ───
// Message sous un champ (élément « <id>-msg ») ; texte vide = effacé.
function msgChamp(id,texte,ton='err'){
  const m=document.getElementById(id+'-msg');
  if(m){m.textContent=texte||'';m.style.display=texte?'block':'none';m.style.color=ton==='info'?'var(--amber)':'var(--red)';}
  const el=document.getElementById(id);
  if(el){if(texte&&ton==='err')el.setAttribute('aria-invalid','true');else el.removeAttribute('aria-invalid');}
}
// Nombre d'un champ de saisie (« 1,5 » ou « 1.5 » ; vide = null). Un texte illisible est
// signalé sous le champ et rendu NaN : l'appelant n'enregistre alors rien. Avant : champ
// type=number, un Chrome en anglais lisait « 1,5 » comme 15, enregistré sans alerte.
function nombreSaisi(id){
  const v=lireDecimal(document.getElementById(id)?.value);
  msgChamp(id,Number.isNaN(v)?'Nombre illisible : écris par exemple 1,5 ou -0,75.':'');
  return v;
}

// ─── QUICK CLOSE ───
function toggleQuickClose(id){const el=document.getElementById('qcf-'+id);if(el)el.classList.toggle('open');}
// R calculable depuis les prix : entrée et SL saisis, risque positif dans le sens du trade.
function rrCalculable(dir,entry,sl){return !!(+entry&&+sl&&(dir==='LONG'?entry-sl:sl-entry)>0);}
// v=6 (données honnêtes) : le R « Auto » suit chaque frappe du prix de sortie tant que
// l'utilisateur ne l'a pas tapé lui-même (dataset.auto, effacé par l'oninput de qc-rr).
// Avant : figé au premier caractère (« 1 » de 149.10 → -245.33R enregistré).
function calcQuickRR(id,dir,entry,sl){
  const rrField=document.getElementById('qc-rr-'+id);if(!rrField)return;
  if(rrField.value!==''&&rrField.dataset.auto!=='1')return;
  const exit=lireDecimal(document.getElementById('qc-exit-'+id)?.value);
  if(!exit||!rrCalculable(dir,entry,sl)){rrField.value='';delete rrField.dataset.auto;return;}
  const risk=dir==='LONG'?entry-sl:sl-entry,realized=dir==='LONG'?exit-entry:entry-exit;
  rrField.value=(realized/risk).toFixed(2);rrField.dataset.auto='1';
}
async function submitQuickClose(id){
  // v=6 (données honnêtes) : lireDecimal et non +v||null : un R ou un P&L de 0 (BE)
  // s'enregistre 0 (avant : NULL, ou refus « Entrez au moins le R:R réalisé »).
  const exit=nombreSaisi('qc-exit-'+id),rr=nombreSaisi('qc-rr-'+id),pnl=nombreSaisi('qc-pnl-'+id);
  if([exit,rr,pnl].some(Number.isNaN)){toast('Nombre illisible : corrige le champ signalé (rien n\'est enregistré)','err');return;}
  // v=6 (revue) : les champs reprennent les valeurs déjà saisies (tradeHTML) et un champ
  // laissé vide GARDE la valeur en base (avant : NULL, un R ou un P&L saisi dans la fiche
  // était effacé à la clôture). Seuls les champs tapés partent, avec le statut.
  const t=(S.trades||[]).find(x=>x.id===id)||{};
  const maj={status:'closed'};
  if(exit!==null)maj.exit_price=exit;
  if(rr!==null)maj.actual_rr=rr;
  if(pnl!==null)maj.pnl_amount=pnl;
  const{error,count}=await sb.from('trades').update(maj,{count:'exact'}).eq('id',id);
  if(error){toast('Erreur : '+error.message,'err');return;}
  // v=6 (revue) : aucune ligne touchée (trade supprimé entre-temps, accès retiré) ≠ succès
  if(count===0){toast('Rien n\'a été clôturé : ce trade n\'existe plus ou tu n\'y as plus accès.','err');await rechargerTrades(false);return;}
  // v=6 (arbitrage du 20/10/2026) : clore sans R reste possible, mais le message le dit
  // (avant : « Trade clôturé ✅ » seul, et le trade comptait comme un BE).
  toast(rr===null&&!aResultat(t)?'Trade clôturé — R non saisi : mis à part dans les stats (complète-le dans le Journal)':'Trade clôturé ✅','ok');await rechargerTrades();
}

// ─── TRADE MODAL ───
async function openTrade(id=null){
  // v=6 (données honnêtes) : en vue d'un autre espace (admin), un nouveau trade partirait dans
  // l'espace d'appartenance tout en étant rattaché à un compte de l'espace consulté.
  if(!id&&S.currentWorkspaceId&&S.workspaceId&&S.currentWorkspaceId!==S.workspaceId){
    toast(`Tu consultes ${S.currentWorkspace?.name||'un autre espace'} : reviens à ton espace (${S.workspace?.name||'espace d\'appartenance'}) pour créer un trade.`,'err');
    return;
  }
  resetModal();
  const t=id?S.trades.find(x=>x.id===id):null;
  // v=6 (données honnêtes) : compte et trader CHOISIS dans des listes visibles. Avant : champs
  // cachés jamais remplis (erreur SQL brute) ou hérités du dernier trade ouvert, sans le dire.
  // Présélection seulement s'il n'y a qu'un compte, et pour le trader connecté. La valeur d'un
  // trade ouvert absente des listes (compte inactif…) y est ajoutée au lieu d'être perdue.
  const comptes=[...S.accounts],traders=[...S.users];
  // v=6 (revue) : comptes jamais lus (lecture en échec) ≠ « aucun compte actif » ; le compte du
  // trade n'est alors pas dit « hors liste » (la liste n'a pas pu être lue).
  const comptesNonCharges=echecsLecture.accounts==='jamais';
  if(t?.account_id&&!comptes.some(a=>a.id===t.account_id))comptes.push({id:t.account_id,name:(t.accounts?.name||'Compte')+(comptesNonCharges?'':' (hors liste)')});
  if(t?.user_id&&!traders.some(u=>u.id===t.user_id))traders.push({id:t.user_id,name:t.users?.name||'Trader'});
  if(!t&&S.appUser&&!traders.some(u=>u.id===S.appUser.id))traders.push(S.appUser);
  const options=(vide,l)=>`<option value="">${vide}</option>`+l.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  const acc=document.getElementById('m-acc'),usr=document.getElementById('m-user');
  acc.innerHTML=options(comptes.length?'— Choisis un compte —':(comptesNonCharges?'— Comptes non chargés (réseau ou serveur) —':'— Aucun compte actif —'),comptes);
  usr.innerHTML=options('— Choisis le trader —',traders);
  // V9.2 FIX FUSEAU : fmtYMD (local) au lieu de toISOString (UTC)
  document.getElementById('m-date').value=fmtYMD(new Date());
  if(id){
    S.editId=id;document.getElementById('m-title').textContent='Modifier Trade';document.getElementById('del-btn').style.display='inline-flex';
    if(t)fillModal(t);
    // v=6 (constat 29) : lecture en échec = null (dit dans l'onglet), distincte de [] (aucune).
    S.existingImgs=await lireCapturesTrade(id);await renderExistingImgs();
  }else{
    S.editId=null;document.getElementById('m-title').textContent='Nouveau Trade';document.getElementById('del-btn').style.display='none';
    if(comptes.length===1)acc.value=comptes[0].id;
    if(S.appUser)usr.value=S.appUser.id;
  }
  majLibellePnl(); // v=6 (constat 11) : P&L dans la devise du compte choisi
  document.getElementById('trade-modal').classList.remove('hidden');
  initRichEditor();
}

function fillModal(t){
  // v=6 (données honnêtes) : seul null donne un champ vide (avant : v||'') ; un 0 saisi
  // (break-even) s'affiche « 0 » au lieu d'un vide lu comme un oubli puis écrasé.
  const fv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v==null?'':String(v);};
  fv('m-instr',t.instrument);fv('m-dir',t.direction);fv('m-acc',t.account_id);fv('m-user',t.user_id);fv('m-date',t.trade_date);
  fv('m-sess',t.session);fv('m-tf',t.timeframe);fv('m-setup',t.setup_type);fv('m-strat',t.strategy);fv('m-analysis',t.analysis_notes);loadRichEditor(t.analysis_notes||'');
  fv('m-entry',t.entry_price);fv('m-sl',t.sl_price);fv('m-tp',t.tp_price);fv('m-lot',t.lot_size);fv('m-enotes',t.entry_notes);
  fv('m-exit',t.exit_price);fv('m-arr',t.actual_rr);fv('m-pnl',t.pnl_amount);fv('m-status',t.status);fv('m-plan',t.plan_respected);
  // v=6 : qualité « non renseignée » tant qu'elle n'est pas choisie (avant : curseur à 7,
  // enregistré 7/10 sur tout nouveau trade et à la place d'un NULL à chaque modification).
  fv('m-mgmt',t.management_notes);fv('m-lessons',t.lessons);fv('m-quality',t.execution_quality);
  // v=6 (arbitrage du 20/10/2026) : un trade clos sans R saisi le dit dans sa fiche.
  if(t.status==='closed'&&!aResultat(t))msgChamp('m-arr','R non saisi : ce trade est mis à part dans les stats (0 = break-even).','info');
  calcRR();calcActualRR();
}

async function renderExistingImgs(){
  // v=5 : les captures des trois onglets signées en UNE requête (avant : une par image)
  // v=6 (constat 31) : un fichier non image est montré par son nom (avant : invisible).
  // v=6 (constat 29) : lecture (S.existingImgs null) ou signature en échec → dit dans
  // l'onglet, « déjà enregistrées » (avant : onglet vide, et on recollait des doublons).
  // Pas de Réessayer ici : il effacerait les aperçus des captures pas encore envoyées.
  if(S.existingImgs===null){['entry','close','file'].forEach(type=>{const c=document.getElementById('prev-'+type);if(c)c.innerHTML=capturesIndispo(0,null,true);});return;}
  const images=S.existingImgs;
  const liens=await signerChemins(images.map(i=>i.storage_path));
  for(const type of['entry','close','file']){
    const imgs=images.filter(i=>i.image_type===type);
    const c=document.getElementById('prev-'+type);if(!c||!imgs.length)continue;
    const manquantes=imgs.filter(i=>estImage(i)&&!liens[i.storage_path]).length;
    c.innerHTML=imgs.map(i=>vignetteHTML(i,liens[i.storage_path])).join('')+(manquantes?capturesIndispo(manquantes,null,true):'');
  }
}

// v=6 (données honnêtes) : une fiche neuve repart d'un trade VIDE pour tous les champs que
// fillModal remplit (un futur champ ne peut plus être oublié). Avant : seule une liste était
// vidée ; session, unité de temps, setup (champs cachés), sens, statut, plan, compte et
// trader du dernier trade ouvert partaient en silence avec le nouveau trade.
function resetModal(){
  S.pendingUps=[];S.existingImgs=[];S.editId=null;
  fillModal({direction:'LONG',status:'open'});
  document.getElementById('rr-display').textContent='Entrez entrée, SL et TP pour calculer le R:R.';
  const _ad=document.getElementById('arr-display');_ad.innerHTML='';_ad.style.display='none';
  ['m-arr','m-pnl','m-acc','m-user','m-save'].forEach(id=>msgChamp(id,''));
  ['entry','close','file'].forEach(t=>{const el=document.getElementById('prev-'+t);if(el)el.innerHTML='';});
  document.getElementById('flist-modal').innerHTML='';mTab(0,document.querySelector('.modal-tab'));
}

function closeTrade(){document.getElementById('trade-modal').classList.add('hidden');}
function mTab(idx,el){S.ongletFiche=idx;document.querySelectorAll('.modal-tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.modal-tc').forEach(t=>t.classList.remove('active'));if(el)el.classList.add('active');document.getElementById('mt-'+idx).classList.add('active');}

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

// v=6 (données honnêtes) : le R calculé depuis les prix (anciens trades) est PROPOSÉ
// sous le champ, jamais écrit à la place de la saisie. Avant : il remplissait « R:R
// réalisé » en silence (bandeau caché) et la sauvegarde l'enregistrait comme saisi,
// y compris à la place d'un 0 (break-even).
function calcActualRR(){
  const entry=+document.getElementById('m-entry').value,sl=+document.getElementById('m-sl').value,exit=+document.getElementById('m-exit').value;
  const dir=document.getElementById('m-dir').value,el=document.getElementById('arr-display');
  const af=document.getElementById('m-arr');
  el.innerHTML='';el.style.display='none';
  if(!entry||!sl||!exit||af.value.trim()!=='')return;const risk=dir==='LONG'?entry-sl:sl-entry;if(risk<=0)return;
  const realized=dir==='LONG'?exit-entry:entry-exit,arr=(realized/risk).toFixed(2);
  el.style.display='block';
  el.innerHTML=`R:R non saisi. Calculé depuis les prix : <span style="color:${+arr>=0?'var(--green)':'var(--red)'};font-weight:700">${+arr>=0?'+':''}${arr}</span> <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('m-arr').value='${arr}';calcActualRR()">Utiliser cette valeur</button>`;
}

// Aperçu d'une capture en attente d'envoi dans la grille de son onglet (un fichier non image :
// son nom dans la liste). enEchec : capture dont l'envoi a échoué, marquée pour le réessai.
function apercuCapture(file,type,enEchec=false){
  const c=document.getElementById('prev-'+type)||document.getElementById('prev-file');if(!c)return;
  if(file.type.startsWith('image/')){const r=new FileReader();r.onload=e=>{const img=document.createElement('img');img.src=e.target.result;img.className='img-thumb';img.onclick=()=>bigImg(e.target.result);if(enEchec){img.style.outline='2px solid var(--red)';img.title='Non envoyée : « Sauvegarder » pour réessayer';}c.appendChild(img);};r.readAsDataURL(file);}
  else{const fl=document.getElementById('flist-modal');if(fl){const d=document.createElement('div');d.style.cssText='padding:2px 0;font-size:10px;font-family:Arial,monospace;color:'+(enEchec?'var(--red)':'var(--text2)');d.textContent='📄 '+file.name+(enEchec?' (non envoyé)':'');fl.appendChild(d);}}
}
function addUpload(input,type){
  Array.from(input.files).forEach(file=>{S.pendingUps.push({file,type});apercuCapture(file,type);});
}

async function saveTrade(){
  const btn=document.getElementById('save-btn');btn.disabled=true;btn.innerHTML='<div class="spin"></div>';
  try{
    const instr=document.getElementById('m-instr').value.trim().toUpperCase();if(!instr){toast('Instrument requis','err');return;}
    // v=6 (données honnêtes) : compte et trader choisis, sinon rien n'est enregistré (avant :
    // erreur SQL brute « null value in column "account_id"… », ou valeurs héritées).
    const acc=document.getElementById('m-acc').value,usr=document.getElementById('m-user').value;
    const motifCompte=echecsLecture.accounts==='jamais'?'Comptes non chargés (réseau ou serveur) : réessaie':'Choisis un compte';
    msgChamp('m-acc',acc?'':motifCompte+'.');msgChamp('m-user',usr?'':'Choisis le trader.');
    if(!acc||!usr){toast((acc?'Choisis le trader':motifCompte)+' (rien n\'est enregistré)','err');return;}
    const rr=calcRR();
    const status=document.getElementById('m-status').value;
    // v=6 (données honnêtes) : 0 reste 0, « 1,5 » vaut 1.5, un texte illisible est refusé.
    const arr=nombreSaisi('m-arr'),pnl=nombreSaisi('m-pnl');
    if(Number.isNaN(arr)||Number.isNaN(pnl)){mTab(2,document.querySelectorAll('.modal-tab')[2]);toast('Nombre illisible : corrige le champ signalé (rien n\'est enregistré)','err');return;}
    const payload={instrument:instr,direction:document.getElementById('m-dir').value,account_id:acc,user_id:usr,trade_date:document.getElementById('m-date').value||null,session:document.getElementById('m-sess').value||null,timeframe:document.getElementById('m-tf').value||null,setup_type:document.getElementById('m-setup').value||null,strategy:document.getElementById('m-strat').value||null,analysis_notes:document.getElementById('m-analysis').value||null,entry_price:+document.getElementById('m-entry').value||null,sl_price:+document.getElementById('m-sl').value||null,tp_price:+document.getElementById('m-tp').value||null,lot_size:+document.getElementById('m-lot').value||null,entry_notes:document.getElementById('m-enotes').value||null,exit_price:+document.getElementById('m-exit').value||null,risk_rr:rr,actual_rr:arr,pnl_amount:pnl,status,execution_quality:lireDecimal(document.getElementById('m-quality').value),plan_respected:document.getElementById('m-plan').value||null,management_notes:document.getElementById('m-mgmt').value||null,lessons:document.getElementById('m-lessons').value||null};
    let tid=S.editId;
    if(tid){
      const{error,count}=await sb.from('trades').update(payload,{count:'exact'}).eq('id',tid);if(error)throw error;
      // v=6 (revue) : aucune ligne touchée (trade supprimé entre-temps, accès retiré) ≠ succès ;
      // la fiche reste ouverte avec la saisie
      if(count===0){const m='Rien n\'a été enregistré : ce trade n\'existe plus ou tu n\'y as plus accès (ta saisie reste dans la fiche).';msgChamp('m-save',m);toast(m,'err');await rechargerTrades(false);return;}
    }
    else{
      const{data,error}=await sb.from('trades').insert(payload).select().single();if(error)throw error;tid=data.id;
      // v=6 : le trade existe désormais ; une nouvelle sauvegarde (réessai) le modifie au lieu
      // d'en créer un second.
      S.editId=tid;
    }
    // v=6 (données honnêtes) : chaque capture est vérifiée. En cas d'échec, la fiche reste
    // ouverte avec les seules captures à renvoyer, et le message le dit. Avant : « Trade
    // sauvegardé ✅ », fiche fermée, captures perdues en silence.
    const envois=S.pendingUps.slice();
    const res=await Promise.allSettled(envois.map(({file,type})=>uploadFile(file,tid,type)));
    const echecs=envois.filter((_,i)=>res[i].status!=='fulfilled'||!res[i].value?.ok);
    if(echecs.length){
      S.pendingUps=echecs;
      document.getElementById('m-title').textContent='Modifier Trade';document.getElementById('del-btn').style.display='inline-flex';
      S.existingImgs=await lireCapturesTrade(tid);
      ['entry','close','file'].forEach(t=>{const el=document.getElementById('prev-'+t);if(el)el.innerHTML='';});
      document.getElementById('flist-modal').innerHTML='';
      await renderExistingImgs();
      echecs.forEach(({file,type})=>apercuCapture(file,type,true));
      const n=echecs.length,noms=echecs.map(e=>e.file.name).join(', ');
      const bilan=`Trade enregistré, mais ${n} capture${n>1?'s':''} sur ${envois.length} non envoyée${n>1?'s':''} (${noms})`;
      msgChamp('m-save',bilan+'. Elle'+(n>1?'s sont restées':' est restée')+' dans la fiche : « Sauvegarder » pour réessayer.');
      toast(bilan+' : réessaie','err');
      await rechargerTrades();return;
    }
    toast(status==='closed'&&arr===null?'Trade sauvegardé — R non saisi : mis à part dans les stats':'Trade sauvegardé ✅','ok');closeTrade();await rechargerTrades();
  }catch(e){console.error(e);toast('Erreur : '+(e?.code==='23502'?'un champ obligatoire est vide':e.message),'err');}
  finally{btn.disabled=false;btn.innerHTML='💾 Sauvegarder';}
}

// v=6 (données honnêtes) : rend {ok:true} ou {ok:false,nom,etape}. Avant : un échec d'envoi
// était seulement journalisé et l'enregistrement en base jamais vérifié. Si l'enregistrement
// échoue, le fichier envoyé est retiré du stockage (au mieux : ce retrait peut être refusé).
async function uploadFile(file,tradeId,imageType){
  const ext=file.name.split('.').pop();const path=`trades/${tradeId}/${imageType}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const envoi=await sb.storage.from(BUCKET).upload(path,file);
  if(envoi.error){console.error(envoi.error);return {ok:false,nom:file.name,etape:'envoi'};}
  const{error}=await sb.from('trade_images').insert({trade_id:tradeId,image_type:imageType,storage_path:path,filename:file.name,file_size:file.size,mime_type:file.type});
  if(error){console.error(error);try{await sb.storage.from(BUCKET).remove([path]);}catch(_){}return {ok:false,nom:file.name,etape:'enregistrement'};}
  return {ok:true};
}

async function deleteTrade(){
  showConfirm('Supprimer ce trade ?','Action irréversible.',async()=>{
    const{error,count}=await sb.from('trades').delete({count:'exact'}).eq('id',S.editId);if(error){toast('Erreur','err');return;}
    // v=6 (revue) : aucune ligne supprimée (déjà supprimé, accès retiré) ≠ « Trade supprimé »
    if(count===0){toast('Rien n\'a été supprimé : ce trade n\'existe plus ou tu n\'y as plus accès.','err');closeTrade();await rechargerTrades(false);return;}
    toast('Trade supprimé','ok');closeTrade();await rechargerTrades();
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
  // v=6 (constats 68-69) : en vue d'un autre espace, les trades test partiraient
  // dans l'espace d'appartenance (déclencheur), rattachés à un compte de l'espace
  // consulté. On refuse et on dit pourquoi (avant : avertissement aussitôt effacé
  // par « 7 trades test insérés ✅ »).
  if (S.currentWorkspaceId && S.workspaceId && S.currentWorkspaceId !== S.workspaceId) {
    toast('Tu consultes ' + (S.currentWorkspace?.name || '?') + ' : reviens à ton espace (' + (S.workspace?.name || '?') + ') pour insérer des données test.', 'err');
    return;
  }
  const accId=S.accounts[0]?.id,userId=S.appUser?.id;
  if(!accId){toast(echecsLecture.accounts?'Comptes non chargés (réseau ou serveur) : réessaie avant d\'insérer des données test.':'Aucun compte actif dans ton espace : impossible de rattacher les données test.','err');return;}
  const{error,count}=await sb.from('trades').insert(TEST_TRADES.map(t=>({...t,account_id:accId,user_id:userId})),{count:'exact'});
  if(error){toast('Données test non insérées : '+messageErreur(error)+'.','err');return;}
  // Succès dit avec le nombre COMPTÉ par le serveur, l'espace et les dates (hors du mois affiché).
  const annees=[...new Set(TEST_TRADES.map(t=>t.trade_date.slice(0,4)))].join(', ');
  toast((count==null?'Données test insérées':count+' trade(s) test inséré(s)')+' dans '+(S.workspace?.name||'ton espace')+' (datés de '+annees+') ✅','ok');
  await rechargerTrades();
}

// v=6 (constat 67) : ces suppressions n'ont aucun filtre d'espace ; seule la règle
// d'accès les borne (super-admin : tous les espaces ; membre : tout son espace).
// La confirmation dit cette portée et le bilan donne le nombre COMPTÉ par le
// serveur (avant : « Données test supprimées » même quand rien ne l'était).
function bilanSuppression(count,quoi,aucun){
  if(count==null)return 'Suppression faite (nombre non communiqué par le serveur)';
  return count===0?aucun:count+' '+quoi;
}
function vueActive(){return S.currentWorkspace?.name||'la vue active';}
async function deleteTestData(){
  const portee=S.isSuperAdmin
    ?'Tous les trades TEST de TOUS les espaces auxquels tu as accès seront supprimés, pas seulement ceux de '+vueActive()+'.'
    :'Tous les trades TEST de l\'espace '+(S.workspace?.name||'?')+' seront supprimés'+(S.workspace?.is_shared?', y compris ceux des autres membres.':'.');
  showConfirm('Supprimer les données test ?',portee,async()=>{
    const{error,count}=await sb.from('trades').delete({count:'exact'}).eq('is_test',true);
    if(error){toast('Données test non supprimées : '+messageErreur(error)+'.','err');return;}
    toast(bilanSuppression(count,'trade(s) test supprimé(s)','Aucun trade test à supprimer'),'ok');await rechargerTrades();
  });
}

function confirmReset(){
  if(!S.isSuperAdmin){toast('Action réservée à l\'administrateur','err');return;}
  showConfirm('⚠ Supprimer tous les trades ?','Tous les trades (réels et test) de TOUS les espaces auxquels tu as accès seront supprimés, pas seulement ceux de '+vueActive()+'. Comptes, soldes et rapports ne sont pas touchés. IRRÉVERSIBLE.',async()=>{
    const{error,count}=await sb.from('trades').delete({count:'exact'}).neq('id','00000000-0000-0000-0000-000000000000');
    if(error){toast('Trades non supprimés : '+messageErreur(error)+'.','err');return;}
    toast(bilanSuppression(count,'trade(s) supprimé(s), tous espaces confondus','Aucun trade à supprimer'),'ok');await rechargerTrades();
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
  const day=now.getDay();
  const mon=new Date(now);mon.setDate(now.getDate()-(day===0?6:day-1));
  // v=6 (AJOUT 1) : le mois affiché est celui du LUNDI courant (une semaine est
  // listée dans le mois de son lundi) ; avant, du 1er au 4/10, octobre s'ouvrait
  // sur la semaine du 28/09 avec « 26 Oct → 1 Nov » surligné.
  S_rptMonth=fmtYM(mon);
  S._rptLundi=fmtYMD(mon);S._rptSemaineChoisie=false; // v=6 (AJOUT 6)
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
  // v=6 (constat 50) : jamais d'envoi sur une semaine non lue (Ctrl+V reste possible)
  if(S._rptCharge!==true){toast('Rapport de la semaine non chargé : capture non enregistrée','err');return;}
  if(!window._curImgCache)window._curImgCache={};
  const key=zone+'-'+code;
  // v=6 (constat 52) : la capture affichée avant ce dépôt, remise si l'envoi échoue
  const avant=window._curImgCache[key]||null;
  if(avant?.uploading){toast('Envoi déjà en cours sur cette zone : attends la fin','err');return;}
  // v=6 (constat 51) : la capture appartient à la semaine CHARGÉE au moment du
  // dépôt ; si l'on change de semaine pendant l'envoi, elle est enregistrée dans
  // SA semaine sans rien modifier à l'écran de l'autre, et le message la nomme.
  const cible={gen:S._rptGen,semaine:S._rptSemaine,ws:S._rptWs};
  // 1) Affichage immédiat via dataURL pour feedback instantané
  const dataUrl=await new Promise(res=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.readAsDataURL(file);});
  if(S._rptGen!==cible.gen){toast('Semaine changée avant l\'envoi : capture non enregistrée','err');return;}
  const apercu={url:dataUrl,isRemote:false,uploading:true};
  window._curImgCache[key]=apercu;
  montrerCapture(code,zone,apercu);
  const ici=()=>S._rptGen===cible.gen&&window._curImgCache[key]===apercu; // l'écran montre encore cet envoi
  // 2) Persister en DB immédiatement
  try{
    const{path,url}=await persistCurImg(code,zone,file,cible);
    if(ici()){const fin={url:url||dataUrl,isRemote:true,path,signeLe:url?Date.now():0};window._curImgCache[key]=fin;montrerCapture(code,zone,fin);}
    toast('Capture enregistrée : '+code+' · '+libZone(zone)+' — sem. du '+jourMois(cible.semaine)+' ✅','ok');
  }catch(e){
    console.error('Image upload failed:',e);
    // v=6 (constat 52) : l'ancienne capture est intacte en base → elle revient ;
    // l'aperçu non enregistré ne reste jamais affiché comme une capture.
    if(ici()){window._curImgCache[key]=avant;montrerCapture(code,zone,avant);}
    toast('Capture non enregistrée ('+code+' · '+libZone(zone)+') : '+(e.message||e),'err');
  }
}
// v=6 (constat 62) : le nom de la zone tel que l'écran l'affiche (avant, toute
// zone du BILAN était annoncée « Graphique Hebdo »). BILAN_ZONES est lu à l'appel.
function libZone(z){
  if(z==='pm')return 'Politique Monétaire';
  if(z==='gh')return 'Graphique Hebdomadaire';
  const b=BILAN_ZONES.find(x=>x.key===z);
  return b?b.title:z;
}
// Affiche dans la zone ce que dit le cache (capture, envoi en cours, ou rien).
// Les éléments sont relus par id : un rendu a pu les remplacer entre-temps.
// v=6 (AJOUT 7) : {attente} = capture dont le lien se renouvelle (zone marquée,
// sans image cassée) ; {ko} = capture qui ne peut pas s'afficher, et c'est dit.
function montrerCapture(code,zone,c){
  const img=document.getElementById('cpimg-'+zone+'-'+code);
  const hint=document.getElementById('cphint-'+zone+'-'+code);
  const zoneEl=document.getElementById('cpz-'+zone+'-'+code);
  const src=(c&&!c.attente&&!c.ko&&c.url)||'';
  const pleine=!!src||!!(c&&c.attente);
  if(img){img.src=src;img.style.display=src?'block':'none';}
  if(hint){
    hint.style.display=pleine?'none':'';
    const txt=hint.querySelector('.txt'); // texte du gabarit gardé, remis hors échec
    if(txt){
      if(txt._invite===undefined)txt._invite=txt.innerHTML;
      txt.innerHTML=c&&c.ko?'⚠ Capture indisponible (lien expiré ou réseau) — rouvre l\'onglet Rapports pour la recharger':txt._invite;
    }
  }
  if(zoneEl){zoneEl.classList.toggle('has-img',pleine);zoneEl.classList.toggle('uploading',!!(c&&c.uploading));}
}
// v=6 (AJOUT 7) : filet — une capture qui ne se charge pas le dit, au lieu d'une
// image cassée. Un src vide est une zone vide, pas une erreur.
function captureIndisponible(img){
  if(!img||!img.getAttribute('src'))return;
  const m=/^cpimg-([a-z]+)-([A-Z]+)$/.exec(img.id||'');
  if(m)montrerCapture(m[2],m[1],{ko:true});
}
// v=6 (AJOUT 7) : un lien signé vaut 1 h (signerChemins). Avant d'afficher une
// capture dont le lien a plus de 50 min, on signe de nouveau, en UN lot, toutes
// les captures périmées de la semaine ; en attendant, la zone reste marquée.
const LIEN_VALIDE_MS=50*60*1000;
function lienPerime(c){return !!(c&&c.isRemote&&c.path&&Date.now()-(c.signeLe||0)>LIEN_VALIDE_MS);}
function afficherCaptures(code,zones){
  const cache=window._curImgCache||{},gen=S._rptGen;
  let perimees=false;
  for(const zone of zones){
    const c=cache[zone+'-'+code];if(!c)continue;
    if(lienPerime(c)){perimees=true;montrerCapture(code,zone,{attente:true});}
    else montrerCapture(code,zone,c);
  }
  if(perimees)resignerCaptures().then(()=>{
    if(gen!==S._rptGen||S_curCode!==code)return; // autre semaine ou autre devise : son rendu s'en charge
    const c2=window._curImgCache||{};
    for(const zone of zones){const c=c2[zone+'-'+code];if(c)montrerCapture(code,zone,lienPerime(c)?{ko:true}:c);}
  });
}
let _resignature=null;
function resignerCaptures(){
  if(_resignature)return _resignature; // un seul lot à la fois, partagé
  const gen=S._rptGen,cache=window._curImgCache||{};
  const cles=Object.keys(cache).filter(k=>lienPerime(cache[k]));
  _resignature=signerChemins(cles.map(k=>cache[k].path)).then(liens=>{
    if(gen!==S._rptGen)return;
    const t=Date.now();
    for(const k of cles){const c=cache[k];if(c&&liens[c.path]){c.url=liens[c.path];c.signeLe=t;}}
  }).finally(()=>{_resignature=null;});
  return _resignature;
}

// Upload + INSERT ; v=6 (constat 52) : l'ancienne capture de la zone n'est retirée
// qu'APRÈS l'enregistrement de la nouvelle (avant : retirée d'abord, perdue si
// l'envoi échouait). v=6 (constat 51) : vers la semaine et l'espace du dépôt
// (cible) ; rend {path,url}.
async function persistCurImg(code,zone,file,cible){
  const c=cible||{gen:S._rptGen,semaine:S._rptSemaine,ws:S._rptWs};
  const week=c.semaine,wsId=c.ws;
  if(!week||!wsId)throw new Error('Semaine ou espace manquant');
  // a) Récupérer ou créer le report
  let rptId=null;
  const{data:ex,error:le}=await sb.from('currency_reports').select('id').eq('week_start',week).eq('workspace_id',wsId).maybeSingle();
  if(le)throw le;
  if(ex)rptId=ex.id;
  else{
    const{data:nr,error}=await sb.from('currency_reports').insert({week_start:week,workspace_id:wsId}).select().single();
    if(error)throw error;
    rptId=nr.id;
  }
  // v=6 (constat 51) : « rapport courant » seulement si l'écran montre toujours cette semaine
  if(S._rptGen===c.gen)S._currentRptId=rptId;
  // b) Récupérer ou créer l'entry
  let entryId=null;
  const{data:ex2,error:le2}=await sb.from('currency_report_entries').select('id').eq('report_id',rptId).eq('currency',code).maybeSingle();
  if(le2)throw le2;
  if(ex2)entryId=ex2.id;
  else{
    const{data:ne,error}=await sb.from('currency_report_entries').insert({report_id:rptId,currency:code,last_edited_by_client:CLIENT_ID}).select().single();
    if(error)throw error;
    entryId=ne.id;
    if(S._entryIdToCurrency&&S._rptGen===c.gen)S._entryIdToCurrency[entryId]=code;
  }
  // c) Anciennes images de cette zone : lues maintenant, retirées après (f)
  const{data:olds,error:le3}=await sb.from('currency_report_images').select('id,storage_path').eq('entry_id',entryId).eq('image_type',zone);
  if(le3)throw le3;
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
  if(ie){try{await sb.storage.from(BUCKET).remove([path]);}catch(_){}throw ie;} // pas de fichier orphelin
  // f) La nouvelle est enregistrée : on retire les anciennes, par leurs ids. Un
  // échec laisse un doublon, sans perte (le chargement garde la plus récente).
  if(olds&&olds.length){
    try{
      const{error:de}=await sb.from('currency_report_images').delete().in('id',olds.map(o=>o.id));
      if(de)throw de;
      const{error:re}=await sb.storage.from(BUCKET).remove(olds.map(o=>o.storage_path));
      if(re)console.error('Fichier de l\'ancienne capture non retiré :',re);
    }catch(e){console.error('Ancienne capture non retirée (doublon sans perte) :',e);}
  }
  // g) Lien signé du fichier qu'on vient de déposer (le cache est l'affaire de setCurImg)
  let url=null;
  try{
    const{data:u}=await sb.storage.from(BUCKET).createSignedUrl(path,3600);
    url=u?.signedUrl||null;
  }catch(_){}
  return{path,url};
}

// Suppression : DB + Storage + cache local
// v=6 (constat 53) : la capture ne disparaît pour de bon qu'une fois retirée en
// base (chaque lecture et le DELETE sont vérifiés) ; un échec la remet et le dit,
// un succès aussi. Pas de suppression pendant son envoi (elle reviendrait).
async function clearCurImg(code,zone){
  if(S._rptCharge!==true){toast('Rapport de la semaine non chargé : rien n\'est supprimé','err');return;} // v=6 (constat 50)
  const key=zone+'-'+code;
  const avant=(window._curImgCache||{})[key]||null;
  if(avant?.uploading){toast('Envoi en cours : attends la fin pour supprimer cette capture','err');return;}
  const gen=S._rptGen,week=S._rptSemaine,wsId=S._rptWs;
  if(window._curImgCache)window._curImgCache[key]=null;
  montrerCapture(code,zone,null);
  try{
    if(!week||!wsId)throw new Error('Semaine ou espace manquant');
    const{data:rpt,error:e1}=await sb.from('currency_reports').select('id').eq('week_start',week).eq('workspace_id',wsId).maybeSingle();
    if(e1)throw e1;
    // Pas de rapport, d'entrée ou de ligne : rien n'est en base, la zone est déjà vide
    const{data:entry,error:e2}=rpt?await sb.from('currency_report_entries').select('id').eq('report_id',rpt.id).eq('currency',code).maybeSingle():{data:null};
    if(e2)throw e2;
    const{data:imgs,error:e3}=entry?await sb.from('currency_report_images').select('id,storage_path').eq('entry_id',entry.id).eq('image_type',zone):{data:[]};
    if(e3)throw e3;
    if(imgs&&imgs.length){
      const{error:de}=await sb.from('currency_report_images').delete().in('id',imgs.map(i=>i.id));
      if(de)throw de;
      // Lignes retirées : un fichier resté dans le stockage est invisible (orphelin), on le note
      try{const{error:re}=await sb.storage.from(BUCKET).remove(imgs.map(i=>i.storage_path));if(re)console.error('Fichier de capture non retiré (orphelin) :',re);}
      catch(re){console.error('Fichier de capture non retiré (orphelin) :',re);}
    }
    toast('Capture supprimée : '+code+' · '+libZone(zone),'ok');
  }catch(e){
    console.error('clearCurImg DB:',e);
    if(S._rptGen===gen&&window._curImgCache&&window._curImgCache[key]===null){window._curImgCache[key]=avant;montrerCapture(code,zone,avant);}
    toast('Capture non supprimée ('+code+' · '+libZone(zone)+') : '+(e.message||e),'err');
  }
}

// v=6 (constat 49) : ouvrir l'onglet Rapports enregistre d'abord la saisie en
// cours ; si c'est impossible, la vue reste telle quelle (rien n'est effacé).
// v=6 (AJOUT 6) : page restée ouverte d'une semaine à l'autre — la semaine
// courante (◆) est recalculée ; si l'utilisateur n'a pas choisi de semaine, la
// nouvelle semaine courante s'ouvre (après l'enregistrement de l'ancienne).
async function loadCurrencyReport(){
  if(!(await flushAndSaveBeforeSwitch())){toast('Saisie du rapport non enregistrée : elle reste à l\'écran, réessaie','err');return;}
  const lundi=lundiDe(fmtYMD(new Date()));
  if(S._rptLundi&&S._rptLundi!==lundi){
    if(S._rptSemaineChoisie){
      S._rptLundi=lundi;
      // v=6 (revue) : nouveau mois proposé ; la semaine choisie et son mois restent affichés
      if(construireBarreMois()){activerMois(S_rptMonth);const mp=document.getElementById('rpt-month-pick');if(mp)mp.value=S_rptMonth;}
      buildWeeksForMonth(S_rptMonth);
    }
    else buildRptMonthBar();
  }
  await chargerRapport();
}
// Charge la semaine du champ rpt-week. Appelée après un flush réussi (ou une
// saisie que l'utilisateur a choisi d'abandonner) : les caches peuvent repartir
// de zéro. S._rptSemaine / S._rptWs = la semaine et l'espace CHARGÉS, où
// partent les enregistrements (jamais la valeur courante du champ).
async function chargerRapport(){
  const week=document.getElementById('rpt-week')?.value;
  if(!week)return;
  // V9.3 FIX FND-001 : filtre par workspace_id (rapports partagés)
  const wsId=S.currentWorkspaceId||S.workspaceId;
  // v=6 (constat 50) : rien d'éditable tant que la semaine n'est pas lue
  // (S._rptCharge) ; S._rptGen distingue ce chargement des suivants.
  const gen=S._rptGen=(S._rptGen||0)+1;
  S._rptCharge=false;S._rptErreur=null;S._rptSemaine=week;S._rptWs=wsId;
  // v=6 (constat 49) : un échec abandonné ne reste pas affiché sur une autre semaine
  if(['error','saving'].includes(document.getElementById('autosave-indicator')?.className))afficherSauvegarde(''); // v=6 (revue) : « En cours… » d'une autre semaine non plus
  renderCurrencyView();
  let q=sb.from('currency_reports').select('*,currency_report_entries(*,currency_report_images(*))').eq('week_start',week);
  if(wsId)q=q.eq('workspace_id',wsId);
  let rep;
  try{rep=await q.maybeSingle();}catch(e){rep={data:null,error:e};}
  if(gen!==S._rptGen)return; // un chargement plus récent a pris la main
  const{data,error}=rep;
  window._curBiasCache={};window._curNotesCache={};window._curImgCache={};
  window._curLastSaved={}; // V9.4 — reset signatures pour le merge save
  // V9.4 : track le report id courant pour la synchro realtime
  // v=6 (constat 50) : jamais l'id d'une autre semaine (les écritures y partiraient)
  S._currentRptId=null;
  // V9.4 : map entry_id → currency pour les updates realtime
  S._entryIdToCurrency={};
  if(error){
    // v=6 (constat 50) : une lecture ratée (réseau, doublon…) n'est pas une
    // semaine vide : on le dit, on propose de réessayer, rien n'est modifiable.
    console.error('Lecture du rapport impossible :',error);
    S._rptErreur=error.message||String(error);
    renderCurrencyView();refreshCurrencyBtnColors();
    subscribeRealtimeForCurrentReport(); // sans rapport : se désabonne
    return;
  }
  S._currentRptId=data?.id||null;
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
    if(gen!==S._rptGen)return;
    const signeLe=Date.now(); // v=6 (AJOUT 7) : un lien signé vaut 1 h
    for(const[zone,code,chemin]of aSigner){
      // v=6 (revue) : sans lien signé (réseau, refus), la capture n'est pas une zone vide :
      // elle passe par le renouvellement (AJOUT 7), puis « Capture indisponible ».
      window._curImgCache[zone+'-'+code]=liens[chemin]?{url:liens[chemin],isRemote:true,path:chemin,signeLe}:{url:null,isRemote:true,path:chemin,signeLe:0};
    }
  }
  S._rptCharge=true;
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
// v=6 (constat 49) : la saisie diffère-t-elle de ce qui est en base ? Une devise
// sans signature compte comme [null,null] : tout effacer est une modification à
// écrire ; visiter une devise vide sans rien taper n'en est pas une.
function signatureSaisie(code){
  const b=(window._curBiasCache||{})[code],n=(window._curNotesCache||{})[code];
  return JSON.stringify([b===undefined||b===''?null:b,n===undefined||n===''?null:n]);
}
function rapportModifie(){
  const enBase=window._curLastSaved||{};
  return [...CURRENCIES.map(c=>c.code),'BILAN'].some(code=>signatureSaisie(code)!==(enBase[code]??'[null,null]'));
}
// V9.4 : sauve bias + notes avant changement. Les images sont déjà persistées au dépôt.
// v=6 (constat 49) : rend true si l'on peut quitter la semaine affichée (tout est
// écrit, ou rien n'a changé), false si l'enregistrement a échoué : la saisie reste
// alors à l'écran et en cache, l'indicateur le dit. La minuterie d'auto-save est
// annulée : c'est ce flush qui enregistre (encore une fois si l'on a tapé pendant).
async function flushAndSaveBeforeSwitch(){
  clearTimeout(_autoSaveTimer);
  flushCurrentViewToCache();
  if(S._rptCharge!==true||!rapportModifie())return true; // rien d'éditable, ou rien de changé
  try{
    let g;
    do{
      g=++_autoSaveGen;afficherSauvegarde('cours');
      await saveCurrencyReport(true);
      clearTimeout(_autoSaveTimer);
    }while(g!==_autoSaveGen);
    afficherSauvegarde('ok');
    return true;
  }catch(e){
    console.error('Flush save failed:',e);
    afficherSauvegarde('erreur');
    return false;
  }
}
// v=6 (constats 49, 58) : la saisie n'a pas pu être écrite → rien ne change
// (semaine, mois, espace) ; continuer quand même, c'est l'abandonner : on le
// demande (jamais en silence).
function proposerAbandon(continuer){
  showConfirm('Saisie non enregistrée',
    'Ta saisie de la semaine du '+jourMois(S._rptSemaine)+' n\'est pas en base. Rien n\'a changé : réessaie (indicateur en bas à droite), ou continue quand même en abandonnant cette saisie.',
    ()=>{clearTimeout(_autoSaveTimer);continuer();},'Abandonner ma saisie');
}
// v=6 (constat 58) : changement d'espace — le rapport affiché appartenait à
// l'autre espace : plus aucune écriture n'y part et la vue ne le montre plus
// (rechargée si Rapports est ouvert, sinon au prochain clic sur l'onglet).
function quitterRapport(){
  clearTimeout(_autoSaveTimer);
  S._rptGen=(S._rptGen||0)+1; // un envoi en vol finit dans son espace, sans toucher l'écran
  S._currentRptId=null;S._rptCharge=false;S._rptErreur=null;S._entryIdToCurrency={};
  window._curBiasCache={};window._curNotesCache={};window._curImgCache={};window._curLastSaved={};
  unsubscribeRealtime();
  if(['error','saving'].includes(document.getElementById('autosave-indicator')?.className))afficherSauvegarde(''); // v=6 (revue) : « En cours… » d'une autre semaine non plus
  renderCurrencyView();refreshCurrencyBtnColors();
}
function jourMois(ymd){return ymd?ymd.slice(8,10)+'/'+ymd.slice(5,7):'';}

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
          // v=6 (FND-02 complété) : nettoyer les enfants AVANT de les sortir de la
          // balise retirée — sortis, ils ne seraient plus parcourus par cette boucle.
          walk(c);
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
            // span sans couleur valide → on le déballe (enfants nettoyés d'abord, v=6)
            walk(c);
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
    text.innerHTML=peersOnCur.map(p=>`<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${couleurSure(p.color,'#f0c040')};margin-right:4px"></span>${esc(p.user)} édite ${S_curCode}`).join(' &nbsp;·&nbsp; ');
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

// v=6 (constat 59) : les enregistrements passent l'un après l'autre — deux
// INSERT simultanés de la même entrée, ou un UPDATE ancien arrivé après un plus
// récent, ne sont plus possibles.
let _rptEcritures=Promise.resolve();
function saveCurrencyReport(silent=false){
  const gen=S._rptGen;
  const tour=_rptEcritures.then(()=>enregistrerRapport(silent,gen));
  _rptEcritures=tour.catch(()=>{});
  return tour;
}
// v=6 (constat 48) : en mode silencieux (auto-save, changement de semaine), un
// échec REMONTE à l'appelant — avant, il était avalé et l'indicateur affichait
// « ✓ Sauvegardé » pour un texte qui n'était pas en base. Les lectures sont
// vérifiées : une entrée illisible n'est plus prise pour une entrée absente.
async function enregistrerRapport(silent,gen){
  try{
    if(gen!==S._rptGen)return; // v=6 : semaine quittée entre-temps (saisie abandonnée)
    // v=6 (constat 50) : jamais d'écriture sur une semaine non lue (elle écraserait l'existant)
    if(S._rptCharge!==true)throw new Error('Rapport de la semaine non chargé');
    flushCurrentViewToCache();
    // v=6 (constat 49) : la semaine et l'espace CHARGÉS — pas le champ, qui porte
    // déjà la date suivante quand on change de semaine — et les caches de CETTE
    // semaine (un rechargement les remplace par d'autres objets).
    const week=S._rptSemaine,wsId=S._rptWs;
    if(!window._curLastSaved)window._curLastSaved={};
    const biais=window._curBiasCache||{},notes=window._curNotesCache||{},enBase=window._curLastSaved;
    if(!week)throw new Error('Semaine non chargée');
    if(!wsId)throw new Error('Espace inconnu, sauvegarde impossible');
    // V9.4 — saveCurrencyReport ne touche QUE bias + notes (images via persistCurImg).
    let rptId=S._currentRptId;
    if(!rptId){
      const{data:ex,error:le}=await sb.from('currency_reports').select('id').eq('week_start',week).eq('workspace_id',wsId).maybeSingle();
      if(le)throw le;
      if(ex)rptId=ex.id;
      else{
        const{data:nr,error}=await sb.from('currency_reports').insert({week_start:week,workspace_id:wsId}).select().single();
        if(error)throw error;
        rptId=nr.id;
      }
      if(S._rptGen===gen)S._currentRptId=rptId;
    }
    let touchedSomething=false;
    // V9.10 — On itère sur les 8 devises + l'entry spéciale BILAN (notes uniquement)
    const saveCodes=[...CURRENCIES.map(c=>c.code),'BILAN'];
    for(const code of saveCodes){
      // Valeurs CURRENTES en cache local
      const localBias=biais[code];      // string | undefined | ''
      const localNotes=notes[code];     // string | undefined
      const localBiasNorm=(localBias===undefined||localBias==='')?null:localBias;
      const localNotesNorm=(localNotes===undefined||localNotes==='')?null:localNotes;
      // Signature pour le shortcut "rien à faire"
      const sig=JSON.stringify([localBiasNorm,localNotesNorm]);
      if((enBase[code]??'[null,null]')===sig)continue; // v=6 : sans signature = [null,null]
      // Lire l'entry existante pour merge intelligent
      const{data:ex2,error:le2}=await sb.from('currency_report_entries').select('id,bias,notes,last_edited_by_client').eq('report_id',rptId).eq('currency',code).maybeSingle();
      if(le2)throw le2;
      // V9.4 FIX BIAS — Merge intelligent :
      // Si on n'a JAMAIS touché à ce champ localement (cache vide pour cette devise),
      // on PRÉSERVE la valeur distante. Cela évite d'écraser les notes/bias d'un autre user
      // quand on enregistre sur une autre devise.
      const everTouchedHere=enBase.hasOwnProperty(code+'__touched');
      // Champ par champ : si jamais touché localement → garde la valeur distante
      const biasInCache=biais.hasOwnProperty(code);
      const notesInCache=notes.hasOwnProperty(code);
      const mergedBias=biasInCache?localBiasNorm:(ex2?.bias||null);
      const mergedNotes=notesInCache?localNotesNorm:(ex2?.notes||null);
      // Skip si rien à enregistrer
      if(mergedBias===null&&mergedNotes===null&&!ex2){enBase[code]=sig;continue;}
      // Skip si l'entry existante a déjà ces valeurs
      if(ex2&&ex2.bias===mergedBias&&ex2.notes===mergedNotes){enBase[code]=sig;continue;}
      const payload={bias:mergedBias,notes:mergedNotes,last_edited_by_client:CLIENT_ID,updated_at:new Date().toISOString()};
      if(ex2){
        const{error}=await sb.from('currency_report_entries').update(payload).eq('id',ex2.id);
        if(error)throw error;
      }else{
        const{data:ne,error}=await sb.from('currency_report_entries').insert({report_id:rptId,currency:code,...payload}).select().single();
        if(error)throw error;
        if(ne&&S._entryIdToCurrency&&S._rptGen===gen)S._entryIdToCurrency[ne.id]=code;
      }
      enBase[code]=JSON.stringify([mergedBias,mergedNotes]);
      touchedSomething=true;
    }
    if(touchedSomething){
      // La saisie est écrite ; seule la date du rapport ne suit pas : on le note.
      const{error:de}=await sb.from('currency_reports').update({updated_at:new Date().toISOString()}).eq('id',rptId);
      if(de)console.error('Date du rapport non mise à jour :',de);
    }
    if(!silent)toast('Rapport sauvegardé ✅','ok');
  }catch(e){console.error(e);if(silent)throw e;toast('Erreur : '+(e.message||e),'err');}
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
      {key:'balance', label:'Solde commercial', unit:'', desc:"Solde de la balance commerciale (exports − imports), en milliards dans la devise de la zone (Mds USD pour les États-Unis, Mds EUR pour la zone euro…)."},
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
//       v=6 (#42) PIB (gdp) : trimestriel, d = DERNIER mois du trimestre (T1 → 'AAAA-03'),
//       affiché « T1 AAAA » (jamais le mois de publication : il donnerait un trimestre faux)
//       v=6 (#44) balance commerciale (trade) : en MILLIARDS de la devise de la zone (le code
//       de zone est le code ISO de la devise) ; convertir si la source publie en millions
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

// v=6 (UX-03) — Âge du relevé macro en mois entiers (dates locales, sans
// millisecondes) : les chiffres sont saisis à la main, rien ne les actualise.
function ageReleveMacro(maintenant=new Date()){
  const [y,m,d]=MACRO_DATA_UPDATED.split('-').map(Number);
  let mois=(maintenant.getFullYear()-y)*12+(maintenant.getMonth()-(m-1));
  if(maintenant.getDate()<d)mois--;
  return Math.max(0,mois);
}
function afficherFraicheurMacro(){
  const el=document.getElementById('macro-fraicheur');if(!el)return;
  const mois=ageReleveMacro();
  el.hidden=mois<1;
  el.textContent=mois<1?'':'⚠ Chiffres relevés à la main le '+fmtDateFr(MACRO_DATA_UPDATED)
    +' (il y a '+(mois>=12?'plus d\'un an':mois+' mois')+') : ils ne se mettent pas à jour tout seuls. '
    +'Vérifie la dernière publication officielle avant de t\'en servir.';
}

function loadMacro(force){
  // Garantir que le sous-indicateur courant existe dans l'onglet courant
  const tab=MACRO_TABS.find(t=>t.key===S_macroTab)||MACRO_TABS[0];
  if(!tab.subs.find(s=>s.key===S_macroSub))S_macroSub=tab.subs[0].key;
  const badge=document.getElementById('macro-updated-badge');
  if(badge)badge.textContent='relevé du '+fmtDateFr(MACRO_DATA_UPDATED);
  afficherFraicheurMacro();
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

// V9.13 — Tronque une série mensuelle à la période choisie (S_macroPeriod, en années)
// v=6 (#39) : UNE borne commune à toutes les zones, ancrée sur le mois courant (et non
// sur la dernière donnée de chaque série) : « 1 an » = les 12 derniers mois, celui-ci compris.
function debutPeriodeMacro(){
  const n=new Date();
  return fmtYM(new Date(n.getFullYear()-S_macroPeriod,n.getMonth()+1,1));
}
function limitMonthlyToPeriod(series,debutYm){
  if(!series||!series.length)return series;
  return series.filter(d=>d.ym>=debutYm);
}

// Formatte un label YYYY-MM en « janv. 26 »
const _MOIS_FR=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
function fmtYmLabel(ym){
  const y=ym.slice(2,4), m=+ym.slice(5,7);
  return (_MOIS_FR[m-1]||'')+' '+y;
}
// v=6 (#42) : le PIB est trimestriel (saisie : d = dernier mois du trimestre) → « T1 2026 »,
// jamais un mois (« mars 26 » se lisait comme le PIB de mars). Les autres onglets : le mois.
function fmtPeriodeMacro(ym){
  if(S_macroTab!=='gdp')return fmtYmLabel(ym);
  return 'T'+Math.ceil(+ym.slice(5,7)/3)+' '+ym.slice(0,4);
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
  if(srcEl)srcEl.textContent=''; // v=6 : la source n'est citée que s'il y a des chiffres (plus bas)

  // Zones à afficher : comparaison ou zone unique
  const zones=S_macroCompare?[...S_macroCompareZones]:[S_macroZone];

  // Récupérer + tronquer à la période choisie (v=6 #39 : borne commune, datée d'aujourd'hui)
  const debutYm=debutPeriodeMacro();
  const saisies=zones.map(zc=>({zone:zc,data:getMacroSeries(zc)}));
  const allSeries=saisies.map(s=>({zone:s.zone,data:limitMonthlyToPeriod(s.data,debutYm)}));
  const nomPeriode=S_macroPeriod+(S_macroPeriod>1?' ans':' an');
  const couvEl=document.getElementById('macro-couverture');
  if(couvEl)couvEl.textContent='';

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
      // v=6 (UX-03) : dire ce qui manque, où et dans quel relevé — sans renvoyer
      // l'utilisateur vers un outil qu'il n'a pas.
      const nomsZones=zones.map(zc=>MACRO_ZONES.find(z=>z.code===zc)?.name||zc).join(', ');
      // v=6 (#39) : des valeurs saisies, mais toutes avant la période choisie → le dire
      // (ce n'est pas « pas de donnée »).
      const derniere=saisies.filter(s=>s.data.length).map(s=>s.data[s.data.length-1].ym).sort().pop();
      errEl.innerHTML=derniere
        ?'ℹ Aucune valeur de <strong>'+esc(sub.label)+'</strong> sur la période choisie ('+esc(nomPeriode)+') — '+esc(nomsZones)
          +'. Dernière valeur saisie : '+esc(fmtPeriodeMacro(derniere))+'.'
        :'ℹ Pas de donnée pour <strong>'+esc(sub.label)+'</strong> — '+esc(nomsZones)
          +' dans le relevé du '+esc(fmtDateFr(MACRO_DATA_UPDATED))+'.';
    }
    return;
  }

  if(srcEl)srcEl.textContent='Source : Trading Economics · relevé du '+fmtDateFr(MACRO_DATA_UPDATED);
  // v=6 (#39) : ce que la période couvre VRAIMENT (« 5 ans » ne promet pas 5 ans de chiffres).
  if(couvEl){
    const vus=allSeries.flatMap(s=>s.data.map(d=>d.ym)).sort(), n=vus.length;
    const plusCourt=saisies.every(s=>!s.data.length||s.data[0].ym>debutYm);
    couvEl.textContent='Sur '+nomPeriode+' : '+(n>1
      ?n+' valeurs saisies, de '+fmtPeriodeMacro(vus[0])+' à '+fmtPeriodeMacro(vus[n-1])
      :'1 valeur saisie ('+fmtPeriodeMacro(vus[0])+')')
      +(plusCourt?' — l\'historique saisi ne couvre pas toute la période.':'.');
  }

  // Axe X = union des mois (YYYY-MM) de toutes les séries, trié
  const ymSet=new Set();
  allSeries.forEach(s=>s.data.forEach(d=>ymSet.add(d.ym)));
  const yms=[...ymSet].sort();
  const labels=yms.map(fmtPeriodeMacro);

  // Datasets
  const datasets=allSeries.map((s,i)=>{
    const zoneObj=MACRO_ZONES.find(z=>z.code===s.zone);
    const idx=MACRO_ZONES.findIndex(z=>z.code===s.zone);
    const color=MACRO_COLORS[(idx>=0?idx:i)%MACRO_COLORS.length];
    const map={};s.data.forEach(d=>{map[d.ym]=d.value;});
    return {
      label:zoneObj?zoneObj.label+' · '+zoneObj.name:s.zone,
      zone:s.zone, // v=6 (#44) : devise de l'info-bulle
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
    // v=6 : « dernière valeur SAISIE » (pas la dernière publiée), zone nommée en mode Comparer
    latestEl.textContent='Dernière valeur saisie'+(S_macroCompare?' ('+allSeries[0].zone+')':'')+' : '
      +fmtMacroVal(last.value,sub,allSeries[0].zone)+' ('+fmtPeriodeMacro(last.ym)+')';
  }else if(latestEl)latestEl.textContent='';

  // v=6 (#44) : solde commercial en milliards de la devise de chaque zone ; plusieurs
  // devises sur un même axe → le dire (des Mds USD et des Mds JPY ne se comparent pas).
  const devises=S_macroTab==='trade'?allSeries.filter(s=>s.data.length).map(s=>s.zone):[];
  const uneDevise=devises.length===1?devises[0]:'';
  if(descEl&&devises.length>1)descEl.textContent+=' Ici, chaque zone est dans sa propre devise : ces montants ne se comparent pas directement.';

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
            return c.dataset.label+' : '+fmtMacroVal(v,sub,c.dataset.zone);
          }}
        }
      },
      scales:{
        x:{grid:{color:gc,drawBorder:false},ticks:{color:tc,font:{size:9,family:'Arial'},maxRotation:0,autoSkip:true,maxTicksLimit:16}},
        y:{grid:{color:gc,drawBorder:false},
           ticks:{color:tc,font:{size:9,family:'Arial'},callback:v=>S_macroTab==='trade'?v+' Mds'+(uneDevise?' '+uneDevise:''):v+(sub.unit||'')},
           title:{display:devises.length>1,text:'Mds, dans la devise de chaque zone (non comparables)',color:tc,font:{size:9,family:'Arial'}}}
      }
    }
  });

  // Tableau des dernières valeurs (zone de réf, vue simple)
  if(tableWrap){
    if(!S_macroCompare&&refSeries.length){
      const last12=refSeries.slice(-12).reverse();
      tableWrap.innerHTML=`
        <div style="font-family:Arial,monospace;font-size:9px;letter-spacing:.1em;color:var(--amber);margin-bottom:8px">HISTORIQUE ${S_macroTab==='gdp'?'TRIMESTRIEL':'MENSUEL'} · ${esc(MACRO_ZONES.find(z=>z.code===S_macroZone)?.name||'')}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${last12.map(d=>`
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:7px 11px;text-align:center;min-width:74px">
              <div style="font-family:Arial,monospace;font-size:9px;color:var(--text3)">${fmtPeriodeMacro(d.ym)}</div>
              <div style="font-family:Arial,monospace;font-size:13px;font-weight:700;color:var(--text);margin-top:2px">${fmtMacroVal(d.value,sub,S_macroZone)}</div>
            </div>`).join('')}
        </div>`;
    }else{
      tableWrap.innerHTML='';
    }
  }
}

// Formatage d'une valeur macro selon son unité
// v=6 (#36) : 2 décimales quand la 2e compte (un taux directeur bouge par 0,25 :
// 3.75 % et non « 3.8 % », taux qu'aucune banque centrale n'a fixé), sinon 1.
// v=6 (#44) : `zone` (code ISO de la devise) dit de quels milliards on parle (« Mds USD »).
function fmtMacroVal(v,sub,zone){
  if(v===null||v===undefined||isNaN(v))return 'n/d';
  const u=sub.unit||'';
  if(u==='%'){const s=v.toFixed(2);return (s.endsWith('0')?v.toFixed(1):s)+' %';}
  if(S_macroTab==='trade')return (v>=0?'+':'')+v.toFixed(1)+' Mds'+(zone?' '+zone:'');
  if(S_macroTab==='pmi')return v.toFixed(1);
  return v.toFixed(1)+(u?' '+u:'');
}
function fmtDateFr(ymd){
  if(!ymd)return '';
  const [y,m,d]=ymd.split('-');
  return d+'/'+m+'/'+y;
}

// v=6 (revue) : bouton de mois surligné = mois affiché (aucun s'il n'est pas parmi les 3).
function activerMois(mois){
  Array.from(document.getElementById('rpt-month-btns')?.children||[]).forEach(b=>b.classList.toggle('active',b.dataset.month===mois));
}
// Liste des 18 derniers mois et 3 boutons, à partir du mois du jour (sans toucher à la
// semaine affichée). v=6 (revue) : reconstruite aussi quand la page reste ouverte d'un
// mois sur l'autre, sinon le nouveau mois n'est proposé nulle part.
function construireBarreMois(){
  const pick=document.getElementById('rpt-month-pick');
  const btnsEl=document.getElementById('rpt-month-btns');
  if(!pick||!btnsEl)return false;
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
  return true;
}
function buildRptMonthBar(){
  if(!construireBarreMois())return;
  const pick=document.getElementById('rpt-month-pick');
  initCurrencyWeek();
  activerMois(S_rptMonth); // v=6 (AJOUT 1)
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
  // v=6 (AJOUT 1) : jamais une autre semaine que celle du champ en surbrillance
  if(!autoSelect&&!currentWeek&&mondays.length){
    const lastBtn=wBtns.lastElementChild;if(lastBtn)lastBtn.classList.add('active');
    autoSelect=fmtYMD(mondays[mondays.length-1]);
  }
  if(autoSelect){
    const wd=document.getElementById('rpt-week');if(wd&&!currentWeek)wd.value=autoSelect;
  }
}

// Bouton de semaine en surbrillance = la semaine demandée (aucun si elle n'est pas listée).
function activerSemaine(val){
  const el=document.getElementById('rpt-week-btns');if(!el)return;
  Array.from(el.children||[]).forEach(b=>b.classList.toggle('active',b.dataset.week===val));
}
async function selectWeek(val,btn,abandon){
  // V9.1 FIX : on persiste en base AVANT de changer de semaine
  // v=6 (constat 49) : et on ne change QUE si c'est écrit (sinon on le demande)
  if(!abandon&&!(await flushAndSaveBeforeSwitch())){proposerAbandon(()=>selectWeek(val,btn,true));return;}
  S._rptSemaineChoisie=true;
  activerSemaine(val);
  const wd=document.getElementById('rpt-week');if(wd)wd.value=val;
  await chargerRapport();
}
async function onWeekDateChange(abandon){
  const wd=document.getElementById('rpt-week');if(!wd)return;
  const voulu=wd.value;
  // v=6 (constat 49) : le champ porte DÉJÀ la nouvelle date ; la saisie en cours
  // part dans la semaine chargée, et un échec remet la date de cette semaine.
  if(!abandon&&!(await flushAndSaveBeforeSwitch())){
    wd.value=S._rptSemaine||'';
    proposerAbandon(()=>{wd.value=voulu;onWeekDateChange(true);});
    return;
  }
  if(!voulu){wd.value=S._rptSemaine||'';return;} // champ vidé : on reste sur la semaine affichée
  // v=6 (constat 57) : un rapport couvre la semaine du LUNDI au dimanche ; un autre
  // jour ouvrait un rapport distinct, vide en apparence et invisible depuis les
  // boutons. On ramène au lundi, et on le dit (la date choisie est modifiée).
  const lundi=lundiDe(voulu);
  S._rptSemaineChoisie=true;
  // v=6 (vérifié en base le 11/11/2026 : d'anciens rapports sont datés d'un dimanche ou
  // d'un samedi, ancien calcul de date en UTC) : un rapport enregistré EXACTEMENT à la
  // date choisie s'ouvre tel quel, avec un avertissement, au lieu de devenir inaccessible.
  let cible=lundi;
  if(lundi!==voulu){
    let ancien=null;
    try{const{data,error}=await sb.from('currency_reports').select('id').eq('week_start',voulu).eq('workspace_id',S.currentWorkspaceId||S.workspaceId).maybeSingle();if(!error)ancien=data;}catch(_){}
    if(ancien){cible=voulu;toast('Ancien rapport enregistré sous le '+jourMois(voulu)+' (pas un lundi) : distinct de celui de la semaine du lundi '+jourMois(lundi)+'.','err');}
    else{wd.value=lundi;toast('Semaine du lundi '+jourMois(lundi)+' : un rapport couvre la semaine du lundi au dimanche','ok');}
  }
  const mois=cible.slice(0,7);
  if(mois!==S_rptMonth){
    S_rptMonth=mois;
    const mp=document.getElementById('rpt-month-pick');if(mp)mp.value=mois;
    activerMois(mois); // v=6 (revue) : le bouton de l'ancien mois ne reste pas surligné
    buildWeeksForMonth(mois);
  }
  activerSemaine(cible);
  await chargerRapport();
}
function lundiDe(ymd){const d=dateLocale(ymd);d.setDate(d.getDate()-((d.getDay()+6)%7));return fmtYMD(d);}

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

async function switchRptMonth(val,btn,abandon){
  if(!val)return;
  const mp=document.getElementById('rpt-month-pick');
  // V9.1 FIX : on persiste en base AVANT de changer de mois
  // v=6 (constat 49) : et on ne change QUE si c'est écrit (la liste, qui porte
  // déjà le mois choisi, reprend le mois affiché)
  if(!abandon&&!(await flushAndSaveBeforeSwitch())){
    if(mp)mp.value=S_rptMonth;
    proposerAbandon(()=>switchRptMonth(val,btn,true));
    return;
  }
  S._rptSemaineChoisie=true;
  S_rptMonth=val;
  document.querySelectorAll('#rpt-month-btns .acc-tab').forEach(b=>b.classList.remove('active'));
  if(btn)btn.classList.add('active');
  // V9.10 — Le dropdown reste sur le mois choisi (avant : reset à vide)
  if(mp)mp.value=val;
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
  if(targetVal)activerSemaine(targetVal);
  await chargerRapport();
}

// v=6 (constat 50) : tant que la semaine n'est pas lue, pas de formulaire — une
// saisie partirait sur un rapport inconnu et écraserait l'existant. Un échec de
// lecture le dit (jamais une semaine vide), avec « Réessayer ».
function rapportIndisponible(){
  if(S._rptCharge!==false)return false;
  const view=document.getElementById('cur-single-view');
  if(view){
    const sem=S._rptSemaine?' de la semaine du '+jourMois(S._rptSemaine):'';
    view.innerHTML=S._rptErreur
      ?`<div class="empty"><h3 style="color:var(--red)">Impossible de charger le rapport${esc(sem)}</h3>
        <p>Rien n'est affiché ni modifiable tant qu'il n'est pas chargé : ce qui est en base reste intact.</p>
        <p style="margin:6px 0 12px">Détail : ${esc(S._rptErreur)}</p>
        <button type="button" class="btn btn-ghost btn-sm" onclick="chargerRapport()">↻ Réessayer</button></div>`
      :`<div class="loading"><div class="spin"></div><br><br>Chargement du rapport${esc(sem)}…</div>`;
  }
  return true;
}
function renderCurrencyView(){
  if(rapportIndisponible())return;
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
          <img class="cur-paste-img" id="cpimg-pm-${code}" src="" style="display:none" onerror="captureIndisponible(this)" onclick="event.stopPropagation();bigImg(this.src)">
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
          <img class="cur-paste-img" id="cpimg-gh-${code}" src="" style="display:none" onerror="captureIndisponible(this)" onclick="event.stopPropagation();bigImg(this.src)">
          <div class="cur-paste-hint-v2" id="cphint-gh-${code}">
            <div class="icon">📈</div>
            <div class="txt">📋 Ctrl+V · Cliquer · Glisser<br><span style="font-size:9px;opacity:.7">Chart TradingView hebdomadaire…</span></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  afficherCaptures(code,['pm','gh']); // v=6 (AJOUT 7) : liens périmés renouvelés avant affichage
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
  if(rapportIndisponible())return;
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
          <img class="cur-paste-img" id="cpimg-${z.key}-${code}" src="" style="display:none" onerror="captureIndisponible(this)" onclick="event.stopPropagation();bigImg(this.src)">
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

  // Restaurer les images en cache (v=6, AJOUT 7 : liens périmés renouvelés avant affichage)
  afficherCaptures(code,BILAN_ZONES.map(z=>z.key));
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
let _masqueIndicateur=null;
// v=6 (constat 48) : seul retour d'enregistrement des Rapports (pas de bouton).
// « ✓ Sauvegardé » s'efface au bout de 3 s ; un échec reste affiché, en rouge,
// jusqu'au prochain succès, et se clique pour réessayer.
function afficherSauvegarde(etat){
  const ind=document.getElementById('autosave-indicator');if(!ind)return;
  clearTimeout(_masqueIndicateur);
  ind.onclick=null;ind.title='';
  if(etat==='cours'){ind.textContent='● En cours…';ind.className='saving';}
  else if(etat==='ok'){
    ind.textContent='✓ Sauvegardé';ind.className='saved';
    _masqueIndicateur=setTimeout(()=>{if(ind.className==='saved')ind.className='';},3000);
  }else if(etat==='erreur'){
    ind.textContent='✗ Non enregistré — réessayer';ind.className='error';
    ind.title='Ta dernière saisie n\'est pas en base. Cliquer pour réessayer.';
    ind.onclick=()=>saveCurrencyReportAuto();
  }else ind.className='';
}
// v=6 (constat 59) : +1 à chaque frappe et à chaque enregistrement lancé.
let _autoSaveGen=0;
function scheduleAutoSave(){
  flushCurrentViewToCache();
  _autoSaveGen++;
  afficherSauvegarde('cours');
  clearTimeout(_autoSaveTimer);
  // V9.3 : délai réduit de 2s à 1s pour une sauvegarde plus réactive
  _autoSaveTimer=setTimeout(async()=>{
    await saveCurrencyReportAuto();
  },1000);
}
// v=6 (constat 59) : seul le DERNIER enregistrement lancé, sans frappe plus
// récente, affiche son résultat — la fin d'un enregistrement ancien ne dit plus
// « ✓ Sauvegardé » pendant que les derniers mots attendent encore.
// v=6 (constat 48) : fermer ou recharger la page alors que l'indicateur dit
// « En cours… » ou « Non enregistré » → le navigateur demande confirmation (sa
// propre phrase). L'indicateur ne reflète que les saisies de cet écran.
function avantFermeture(e){
  const etat=document.getElementById('autosave-indicator')?.className;
  if(etat==='saving'||etat==='error'){e.preventDefault();e.returnValue='';}
}
window.addEventListener('beforeunload',avantFermeture);
async function saveCurrencyReportAuto(){
  const g=++_autoSaveGen,r=S._rptGen; // r : la semaine affichée au départ
  afficherSauvegarde('cours');
  try{
    await saveCurrencyReport(true);
    if(g===_autoSaveGen&&r===S._rptGen)afficherSauvegarde('ok');
  }catch(e){
    if(g===_autoSaveGen&&r===S._rptGen)afficherSauvegarde('erreur');
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
      // v=6 (constat 71) : un inscrit sans espace ne peut pas entrer (postLogin le
      // renvoie au formulaire) : « Bloqué : aucun espace », jamais « Actif ».
      const sansEspace = !u.workspace_name;
      const status = !u.auth_user_id
        ? '<span class="admin-status-pill pending">En attente d\'inscription</span>'
        : sansEspace
          ? '<span class="admin-status-pill bloque">Bloqué : aucun espace' + (u.is_super_admin_user ? ' · super admin' : '') + '</span>'
          : (u.is_super_admin_user
              ? '<span class="admin-status-pill admin">Super Admin</span>'
              : '<span class="admin-status-pill active">Actif</span>');
      const last = u.last_sign_in_at ? fDate(u.last_sign_in_at) : '—';
      const wsLabel = u.workspace_name
        ? `<span class="workspace-pill ${u.workspace_is_shared ? 'shared' : ''}">${esc(u.workspace_name)}${u.workspace_is_shared ? ' · 👥' : ' · 🔒'}</span>`
        : '<span style="color:var(--text3);font-size:9px">—</span>';
      const canDelete = !u.is_super_admin_user;
      // v=6 (constat 70) : libellé selon l'état réel, un vrai booléen dans l'appel
      // (avant : « 🗑 Retirer » partout, et l'UUID du compte passé comme drapeau).
      const actions = canDelete
        ? (u.auth_user_id
            ? `<button class="btn btn-red btn-sm" onclick="adminRemove(${escJs(u.email)}, true)">🚫 Retirer l'accès</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="adminRemove(${escJs(u.email)}, false)">✕ Annuler l'invitation</button>`)
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
  } catch (e) {
    const cause = messageErreur(e);
    toast('Email non ajouté : ' + (e?.code === '23505' ? 'cet email est déjà dans la liste' : cause) + '.', 'err');
    return;
  }
  await rafraichirAdmin(); // hors du try : un ajout réussi n'est jamais annoncé « non ajouté »
}

// v=6 (constat 70) : deux actions, chacune décrite telle qu'elle est (avant : « son
// compte reste sauvegardé » pour une personne sans compte, et pour un inscrit la
// seule « Suppression définitive », envoyée avec l'UUID au lieu d'un booléen).
// p_delete_auth vaut toujours false : la suppression définitive d'un compte n'est
// plus proposée tant que l'effet réel de p_delete_auth=true n'est pas relu en base.
function adminRemove(email,inscrit){
  if(!S.isSuperAdmin)return;
  const msg=inscrit
    ?`Retirer l'accès de ${email} ? Son email est retiré de la liste blanche : la personne perd l'accès à l'application. Son compte n'est pas supprimé.`
    :`Annuler l'invitation de ${email} ? Aucun compte n'a encore été créé ; cette adresse n'est plus autorisée à s'inscrire.`;
  showConfirm(inscrit?'Retirer l\'accès':'Annuler l\'invitation',msg,async()=>{
    try{
      const{error}=await sb.rpc('admin_remove_email',{p_email:email,p_delete_auth:false});
      if(error)throw error;
      toast((inscrit?'Accès retiré : ':'Invitation annulée : ')+email,'ok');
    }catch(e){toast((inscrit?'Accès non retiré : ':'Invitation non annulée : ')+messageErreur(e)+'.','err');return;}
    await rafraichirAdmin();
  },inscrit?'RETIRER L\'ACCÈS':'ANNULER L\'INVITATION');
}


