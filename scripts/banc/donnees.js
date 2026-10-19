'use strict';
// Donnees FICTIVES du banc d'essai (jamais de vraies donnees : brief 0.3, 1.7).
// Les dates sont relatives au jour du banc pour que le mois courant ait des trades.

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function jourDuMois(decalageMois, jour) {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth() + decalageMois, jour));
}
function lundiCourant() {
  const d = new Date();
  const j = d.getDay();
  d.setDate(d.getDate() - (j === 0 ? 6 : j - 1));
  return iso(d);
}

function donnees({ piege } = {}) {
  // piege(champ) : valeur de texte libre ; par defaut un texte normal.
  const t = (champ, normal) => (piege ? piege(champ) : normal);
  const auth = [
    { id: 'auth-admin', email: 'admin@exemple.fr', app_metadata: { role: 'super_admin' }, last_sign_in_at: '2026-07-01T09:00:00Z' },
    { id: 'auth-trader', email: 'trader@exemple.fr', app_metadata: { role: 'member' }, last_sign_in_at: '2026-07-02T09:00:00Z' },
    { id: 'auth-orphelin', email: 'sans-espace@exemple.fr', app_metadata: { role: 'member' } },
  ];
  const trades = [
    { id: 't1', instrument: t('trades.instrument', 'EURUSD'), direction: 'LONG', status: 'closed', trade_date: jourDuMois(0, 2),
      strategy: t('trades.strategy', 'Cassure de range asiatique avec confirmation de volume sur la session de Londres'),
      session: 'London', timeframe: 'H4', setup_type: t('trades.setup_type', 'Order Block'),
      analysis_notes: t('trades.analysis_notes', 'Ligne 1<div>Ligne 2 : confluence H4</div>'),
      entry_price: 1.0842, sl_price: 1.0798, tp_price: 1.093, exit_price: 1.0934, lot_size: 0.5, risk_rr: 2, actual_rr: 2.1, pnl_amount: 210,
      entry_notes: t('trades.entry_notes', 'Entree sur retest'), management_notes: t('trades.management_notes', 'SL au BE apres +1R'),
      lessons: t('trades.lessons', 'Patience payante'), execution_quality: 8, plan_respected: 'respected' },
    { id: 't2', instrument: 'GBPUSD', direction: 'SHORT', status: 'closed', trade_date: jourDuMois(0, 3), actual_rr: -1, pnl_amount: -100, strategy: 'FVG' },
    { id: 't3', instrument: 'XAUUSD', direction: 'LONG', status: 'closed', trade_date: jourDuMois(0, 5), actual_rr: 0, pnl_amount: 0 },
    { id: 't4', instrument: 'USDJPY', direction: 'LONG', status: 'open', trade_date: jourDuMois(0, 6), entry_price: 148.2, sl_price: 147.6 },
    { id: 't5', instrument: 'NAS100', direction: 'SHORT', status: 'cancelled', trade_date: jourDuMois(-1, 10) },
    { id: 't6', instrument: 'GBPJPY', direction: 'SHORT', status: 'closed', trade_date: jourDuMois(-1, 12), actual_rr: 1.5, pnl_amount: 150 },
    { id: 't7', instrument: 'USDCAD', direction: 'LONG', status: 'closed', trade_date: jourDuMois(-1, 14), actual_rr: null, pnl_amount: null },
  ].map((x) => ({
    account_id: 'acc-1', user_id: 'u-trader', workspace_id: 'ws-equipe', is_test: false,
    created_at: x.trade_date + 'T09:00:00Z', updated_at: x.trade_date + 'T09:00:00Z', ...x,
  }));
  const semaine = lundiCourant();
  return {
    __auth: auth,
    workspaces: [
      { id: 'ws-equipe', name: t('workspaces.name', 'Equipe Demo'), is_shared: true },
      { id: 'ws-perso', name: 'Espace Perso Demo', is_shared: false },
    ],
    allowed_emails: [
      { id: 'ae1', email: 'admin@exemple.fr', workspace_id: 'ws-equipe', note: t('allowed_emails.note', 'Administrateur'), display_name: t('allowed_emails.display_name', 'Admin') },
      { id: 'ae2', email: 'trader@exemple.fr', workspace_id: 'ws-equipe', note: 'Trader' },
      { id: 'ae3', email: 'invite@exemple.fr', workspace_id: 'ws-perso', note: 'Invitation en attente' },
    ],
    users: [
      { id: 'u-admin', name: t('users.name', 'Admin Demo'), color: '#f5a623', email: 'admin@exemple.fr', auth_user_id: 'auth-admin', workspace_id: 'ws-equipe', is_super_admin: true },
      { id: 'u-trader', name: t('users.name#2', 'Trader Demo'), color: t('users.color', '#00d68f'), email: 'trader@exemple.fr', auth_user_id: 'auth-trader', workspace_id: 'ws-equipe' },
    ],
    accounts: [{ id: 'acc-1', name: t('accounts.name', 'Compte Demo'), type: 'main', currency: 'USD', balance: 10000, risk_percent: 1, is_active: true, workspace_id: 'ws-equipe' }],
    trades,
    trade_images: [{ id: 'ti1', trade_id: 't1', image_type: 'entry', storage_path: 'trades/t1/entry/1_a.png', filename: t('trade_images.filename', 'capture.png'), mime_type: 'image/png' },
      { id: 'ti2', trade_id: 't1', image_type: 'file', storage_path: 'trades/t1/file/2_b.pdf', filename: t('trade_images.filename#2', 'releve.pdf'), mime_type: 'application/pdf' }],
    currency_reports: [{ id: 'cr1', week_start: semaine, workspace_id: 'ws-equipe' }],
    currency_report_entries: [
      { id: 'e1', report_id: 'cr1', currency: 'USD', bias: 'bullish', notes: t('currency_report_entries.notes', '<b>Fed</b> attentiste, <span style="color:#00d68f">emploi solide</span>') },
      { id: 'e2', report_id: 'cr1', currency: 'EUR', bias: 'sl_bearish', notes: 'BCE prudente' },
      { id: 'e3', report_id: 'cr1', currency: 'BILAN', bias: null, notes: 'Semaine calme' },
    ],
    currency_report_images: [{ id: 'ci1', entry_id: 'e1', image_type: 'pm', storage_path: 'currency/cr1/USD/pm_1.png', filename: t('currency_report_images.filename', 'pm.png'), created_at: semaine + 'T10:00:00Z' }],
    // Préférences déjà migrées (état réel des comptes existants) : pas d'écriture au démarrage.
    user_preferences: [
      { auth_user_id: 'auth-trader', theme: 'dark', extra: { migrated_v8: true } },
      { auth_user_id: 'auth-admin', theme: 'dark', extra: { migrated_v8: true } },
    ],
  };
}

module.exports = { donnees, lundiCourant };
