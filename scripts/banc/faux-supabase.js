// Faux client Supabase servi au navigateur A LA PLACE de supabase-js (banc
// d'essai, brief 1.8). Il imite ce que l'application attend du vrai client et
// les contraintes du schema reel qui changent son comportement :
//  - trades : account_id, instrument, direction NOT NULL ; direction et
//    status bornes (CHECK) ; workspace_id rempli par le declencheur
//    set_workspace_id_default ;
//  - rpc : un parametre booleen recu sous forme de texte est refuse comme le
//    fait PostgREST (22P02) ;
//  - auth : signOut() emet SIGNED_OUT (l'application recharge la page).
// Toutes les donnees sont fictives (domaine exemple.fr). Les ecritures sont
// relevees dans window.__appels.
(function () {
  'use strict';
  const D = window.__DONNEES || {};
  window.__appels = window.__appels || [];
  const ecouteursAuth = [];
  let session = window.__SESSION || null;
  const PNG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#4da6ff"/></svg>');

  function table(nom) { return (D[nom] = D[nom] || []); }
  function uid() { return 'id-' + Math.random().toString(36).slice(2, 10); }
  function maintenant() { return new Date().toISOString(); }
  function erreur(code, message) { return { data: null, error: { code, message, details: null, hint: null } }; }

  function utilisateurCourant() {
    if (!session) return null;
    return (D.__auth || []).find((u) => u.id === session.user.id) || session.user;
  }
  function espaceCourant() {
    const u = utilisateurCourant();
    if (!u) return null;
    const ae = table('allowed_emails').find((a) => (a.email || '').toLowerCase() === (u.email || '').toLowerCase());
    return ae ? ae.workspace_id : null;
  }

  // Selection imbriquee de PostgREST : "*,users(name,color),accounts(*)"
  function lireSelection(sel) {
    const res = { colonnes: [], liens: [] };
    let prof = 0; let cur = '';
    const morceaux = [];
    for (const c of String(sel || '*')) {
      if (c === '(') prof++;
      if (c === ')') prof--;
      if (c === ',' && prof === 0) { morceaux.push(cur.trim()); cur = ''; } else cur += c;
    }
    if (cur.trim()) morceaux.push(cur.trim());
    for (const m of morceaux) {
      const p = m.indexOf('(');
      if (p < 0) res.colonnes.push(m);
      else res.liens.push({ table: m.slice(0, p).trim(), sel: m.slice(p + 1, -1) });
    }
    return res;
  }
  const CLES = {
    'trades>users': (l) => ({ type: 'un', cle: 'user_id' }),
    'trades>accounts': () => ({ type: 'un', cle: 'account_id' }),
    'currency_reports>currency_report_entries': () => ({ type: 'plusieurs', cle: 'report_id' }),
    'currency_report_entries>currency_report_images': () => ({ type: 'plusieurs', cle: 'entry_id' }),
  };
  function projeter(nomTable, ligne, sel) {
    const s = lireSelection(sel);
    let out = {};
    if (s.colonnes.includes('*')) out = { ...ligne };
    for (const c of s.colonnes) if (c !== '*') out[c] = ligne[c];
    for (const lien of s.liens) {
      const regle = CLES[nomTable + '>' + lien.table];
      if (!regle) continue;
      const r = regle();
      if (r.type === 'un') {
        const cible = table(lien.table).find((x) => x.id === ligne[r.cle]);
        out[lien.table] = cible ? projeter(lien.table, cible, lien.sel) : null;
      } else {
        out[lien.table] = table(lien.table).filter((x) => x[r.cle] === ligne.id).map((x) => projeter(lien.table, x, lien.sel));
      }
    }
    return out;
  }

  const CONTRAINTES = {
    trades(l) {
      for (const c of ['account_id', 'instrument', 'direction']) {
        if (l[c] === null || l[c] === undefined || l[c] === '') return erreur('23502', `null value in column "${c}" of relation "trades" violates not-null constraint`);
      }
      if (!['LONG', 'SHORT'].includes(l.direction)) return erreur('23514', 'new row for relation "trades" violates check constraint "trades_direction_check"');
      if (l.status && !['open', 'closed', 'cancelled'].includes(l.status)) return erreur('23514', 'new row for relation "trades" violates check constraint "trades_status_check"');
      return null;
    },
  };
  const DEFAUTS = {
    trades: (l) => ({ status: 'open', is_test: false, created_at: maintenant(), updated_at: maintenant(), workspace_id: l.workspace_id || espaceCourant() }),
    currency_reports: (l) => ({ created_at: maintenant(), updated_at: maintenant(), workspace_id: l.workspace_id || espaceCourant() }),
    currency_report_entries: () => ({ created_at: maintenant(), updated_at: maintenant() }),
    currency_report_images: () => ({ created_at: maintenant() }),
    trade_images: () => ({ created_at: maintenant() }),
  };

  function requete(nom) {
    const q = { op: 'select', charge: null, filtres: [], tri: [], unique: null, selApres: null, sel: '*', options: {} };
    const api = {
      select(sel) { if (q.op === 'select') q.sel = sel || '*'; else q.selApres = sel || '*'; return api; },
      insert(c) { q.op = 'insert'; q.charge = c; return api; },
      upsert(c, o) { q.op = 'upsert'; q.charge = c; q.options = o || {}; return api; },
      update(c) { q.op = 'update'; q.charge = c; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.filtres.push((l) => l[c] === v || String(l[c]) === String(v)); return api; },
      neq(c, v) { q.filtres.push((l) => l[c] !== v); return api; },
      in(c, v) { q.filtres.push((l) => v.includes(l[c])); return api; },
      is(c, v) { q.filtres.push((l) => l[c] === v); return api; },
      order(c, o) { q.tri.push([c, !o || o.ascending !== false]); return api; },
      limit() { return api; }, range() { return api; },
      maybeSingle() { q.unique = 'peut'; return api; },
      single() { q.unique = 'doit'; return api; },
      then(ok, ko) { return Promise.resolve().then(executer).then(ok, ko); },
    };
    function executer() {
      const L = table(nom);
      const garde = (l) => q.filtres.every((f) => f(l));
      let lignes = [];
      if (q.op === 'select') {
        lignes = L.filter(garde);
        for (const [c, asc] of q.tri.slice().reverse()) lignes.sort((a, b) => ((a[c] > b[c]) - (a[c] < b[c])) * (asc ? 1 : -1));
        lignes = lignes.map((l) => projeter(nom, l, q.sel));
      } else {
        window.__appels.push({ table: nom, op: q.op, charge: JSON.parse(JSON.stringify(q.charge ?? null)) });
        if (q.op === 'insert' || q.op === 'upsert') {
          for (const brut of [].concat(q.charge)) {
            if (q.op === 'upsert' && q.options.onConflict) {
              const k = q.options.onConflict;
              const ex = L.find((l) => l[k] === brut[k]);
              if (ex) { Object.assign(ex, brut); lignes.push({ ...ex }); continue; }
            }
            const l = { id: uid(), ...(DEFAUTS[nom] ? DEFAUTS[nom](brut) : {}), ...brut };
            if (l.workspace_id === undefined && DEFAUTS[nom]) l.workspace_id = espaceCourant();
            const e = CONTRAINTES[nom] && CONTRAINTES[nom](l);
            if (e) return e;
            L.unshift(l); lignes.push({ ...l });
          }
        } else if (q.op === 'update') {
          for (const l of L.filter(garde)) {
            const essai = { ...l, ...q.charge };
            const e = CONTRAINTES[nom] && CONTRAINTES[nom](essai);
            if (e) return e;
            Object.assign(l, q.charge); lignes.push({ ...l });
          }
        } else if (q.op === 'delete') {
          lignes = L.filter(garde);
          D[nom] = L.filter((l) => !garde(l));
        }
        if (q.selApres) lignes = lignes.map((l) => projeter(nom, l, q.selApres));
      }
      if (q.unique) {
        if (lignes.length > 1) return erreur('PGRST116', 'JSON object requested, multiple (or no) rows returned');
        if (!lignes.length && q.unique === 'doit') return erreur('PGRST116', 'JSON object requested, multiple (or no) rows returned');
        return { data: lignes[0] || null, error: null };
      }
      return { data: lignes, error: null };
    }
    return api;
  }

  function booleen(v, nom) {
    if (v === null || v === undefined || typeof v === 'boolean') return null;
    return erreur('22P02', `invalid input syntax for type boolean: "${v}"`);
  }
  const RPC = {
    admin_list_users() {
      return { data: table('allowed_emails').map((ae) => {
        const au = (D.__auth || []).find((u) => u.email.toLowerCase() === ae.email.toLowerCase());
        const pu = table('users').find((u) => (u.email || '').toLowerCase() === ae.email.toLowerCase());
        const w = table('workspaces').find((x) => x.id === ae.workspace_id);
        return { email: ae.email, allowlist_id: ae.id, note: ae.note, display_name: ae.display_name, auth_user_id: au ? au.id : null,
          last_sign_in_at: au ? au.last_sign_in_at : null, is_super_admin_user: !!(au && au.app_metadata && au.app_metadata.role === 'super_admin'),
          profile_name: pu ? pu.name : null, profile_color: pu ? pu.color : null, workspace_id: w ? w.id : null, workspace_name: w ? w.name : null, workspace_is_shared: w ? w.is_shared : null };
      }), error: null };
    },
    admin_list_workspaces() {
      return { data: table('workspaces').map((w) => ({ ...w, member_count: table('allowed_emails').filter((a) => a.workspace_id === w.id).length, trade_count: table('trades').filter((t) => t.workspace_id === w.id).length })), error: null };
    },
    admin_add_email(p) {
      if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(p.p_email || '')) return erreur('P0001', 'Invalid email format');
      table('allowed_emails').push({ id: uid(), email: p.p_email, note: p.p_note, workspace_id: p.p_workspace_id || 'ws-' + uid() });
      return { data: uid(), error: null };
    },
    admin_remove_email(p) {
      const e = booleen(p.p_delete_auth, 'p_delete_auth');
      if (e) return e;
      D.allowed_emails = table('allowed_emails').filter((a) => a.email !== p.p_email);
      return { data: true, error: null };
    },
  };

  function canal(nom) {
    const ecouteurs = [];
    const c = {
      nom,
      on(type, filtre, f) { ecouteurs.push({ type, filtre, f }); return c; },
      subscribe(cb) { setTimeout(() => cb && cb('SUBSCRIBED'), 0); return c; },
      send(m) { window.__appels.push({ canal: nom, envoi: m.event }); return Promise.resolve('ok'); },
      track() { return Promise.resolve('ok'); },
      presenceState() { return window.__PRESENCE || {}; },
      __emettre(type, evt, charge) { ecouteurs.filter((e) => e.type === type && (!e.filtre || !e.filtre.event || e.filtre.event === evt || e.filtre.event === '*')).forEach((e) => e.f(charge)); },
    };
    (window.__canaux = window.__canaux || []).push(c);
    return c;
  }

  window.supabase = {
    createClient() {
      return {
        from: requete,
        rpc: (f, p) => Promise.resolve(RPC[f] ? RPC[f](p || {}) : erreur('PGRST202', 'function not found: ' + f)),
        channel: canal,
        removeChannel() {},
        storage: { from: () => ({
          upload: async (chemin) => { window.__appels.push({ stockage: 'upload', chemin }); return { data: { path: chemin }, error: null }; },
          remove: async (chemins) => { window.__appels.push({ stockage: 'remove', chemins }); return { data: [], error: null }; },
          createSignedUrl: async () => ({ data: { signedUrl: PNG }, error: null }),
          createSignedUrls: async (cs) => ({ data: cs.map(() => ({ signedUrl: PNG })), error: null }),
        }) },
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
          getUser: async () => ({ data: { user: utilisateurCourant() }, error: null }),
          onAuthStateChange(f) { ecouteursAuth.push(f); return { data: { subscription: { unsubscribe() {} } } }; },
          async signOut() { session = null; window.__deconnexions = (window.__deconnexions || 0) + 1; ecouteursAuth.forEach((f) => f('SIGNED_OUT', null)); return { error: null }; },
          async signInWithPassword({ email }) {
            const u = (D.__auth || []).find((x) => x.email === email);
            if (!u) return { data: {}, error: { message: 'Invalid login credentials' } };
            session = { user: u }; return { data: { session, user: u }, error: null };
          },
          async signUp() { return { data: {}, error: { message: 'User already registered' } }; },
          async resetPasswordForEmail() { return { data: {}, error: null }; },
          async updateUser() { return { data: {}, error: null }; },
        },
      };
    },
  };
})();
