-- ============================================================================
-- FND-01 — Empeche un membre de s'auto-promouvoir super-admin (public.users)
-- ============================================================================
-- STATUT : JOUE le 2026-10-18 par Thomas (editeur SQL Supabase).
--   Verifie en lecture (transaction annulee), base de production :
--     - membre -> is_super_admin = true  => REFUSE (SQLSTATE 42501)
--     - membre -> workspace_id           => REFUSE (SQLSTATE 42501)
--     - membre -> color (benin)          => PASSE
--     - admin  -> colonne sensible        => PASSE (verifie avant application)
--     - chemin interne d'inscription      => PASSE (verifie avant application)
--
-- POURQUOI : is_super_admin() depend de public.users.is_super_admin ; la regle
--   RLS users_update laisse un utilisateur modifier SA ligne, le role
--   authenticated a le privilege UPDATE sur la colonne, et aucun declencheur ne
--   la protegeait. Un membre pouvait donc passer is_super_admin = true et
--   obtenir tous les droits admin.
--
-- CHOIX : declencheur en SECURITY INVOKER -> il herite du role de l'appelant.
--   Une requete client PostgREST s'execute comme 'authenticated' (on protege) ;
--   une fonction interne SECURITY DEFINER (liaison a l'inscription) s'execute
--   comme le proprietaire (on laisse passer). En SECURITY DEFINER, current_user
--   vaudrait le proprietaire et la garde ne s'appliquerait jamais (teste).
--
-- RETOUR ARRIERE :
--   drop trigger if exists protect_users_sensitive_trg on public.users;
--   drop function if exists public.protect_users_sensitive();
-- ============================================================================

create or replace function public.protect_users_sensitive()
returns trigger
language plpgsql
security invoker
set search_path to 'pg_catalog','public','auth'
as $fn$
begin
  if current_user = 'authenticated' and not public.is_super_admin() then
    if NEW.is_super_admin is distinct from OLD.is_super_admin
       or NEW.workspace_id is distinct from OLD.workspace_id
       or NEW.email        is distinct from OLD.email
       or NEW.auth_user_id  is distinct from OLD.auth_user_id
       or NEW.id            is distinct from OLD.id then
      raise exception 'Modification non autorisee de colonnes sensibles de public.users'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return NEW;
end;
$fn$;

create or replace trigger protect_users_sensitive_trg
  before update on public.users
  for each row execute function public.protect_users_sensitive();
