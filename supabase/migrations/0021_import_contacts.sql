-- Import de contacts (clients / prospects) depuis un fichier Excel ou CSV.
--
-- 1) Les fichiers de prospection réels de l'équipe sont surtout des
--    ENTREPRISES (études de notaires, PME, sociétés de BTP...), avec un
--    contact et un secteur d'activité. La table prospects n'avait que
--    first_name/last_name : on ajoute l'entreprise, le contact (nom +
--    fonction) et le secteur, pour ne rien perdre à l'import.
--
-- 2) Détection des doublons entre commerciaux. La RLS empêche un
--    commercial de voir les clients/prospects d'un autre, donc l'écran
--    d'import ne peut pas savoir seul qu'un numéro est déjà suivi par un
--    collègue. Cette fonction (security definer) répond uniquement "ce
--    numéro existe déjà, chez moi ou chez quelqu'un d'autre", sans jamais
--    renvoyer le nom du client ni celui du commercial concerné.
--    Comparaison sur les 8 derniers chiffres (format des numéros togolais),
--    en découpant les champs qui contiennent plusieurs numéros
--    ("22 21 31 06 / 90 99 69 31").

alter table prospects add column if not exists company_name text;
alter table prospects add column if not exists contact_name text;
alter table prospects add column if not exists sector text;

create or replace function check_existing_phones(p_phones text[])
returns table (phone_key text, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select distinct right(regexp_replace(x, '\D', '', 'g'), 8) as k
    from unnest(p_phones) as x
    where length(regexp_replace(x, '\D', '', 'g')) >= 8
  ),
  existing as (
    select right(regexp_replace(part, '\D', '', 'g'), 8) as k, (owner = auth.uid()) as mine
    from (
      select c.assigned_to as owner,
             unnest(regexp_split_to_array(coalesce(c.phone, '') || '/' || coalesce(c.whatsapp, ''), '[/;,*]')) as part
      from clients c
      where c.organization_id = auth_org_id()
      union all
      select p.assigned_to,
             unnest(regexp_split_to_array(coalesce(p.phone, '') || '/' || coalesce(p.whatsapp, ''), '[/;,*]'))
      from prospects p
      where p.organization_id = auth_org_id()
    ) s
    where length(regexp_replace(part, '\D', '', 'g')) >= 8
  )
  select i.k, bool_or(e.mine)
  from input i
  join existing e on e.k = i.k
  group by i.k;
$$;

revoke all on function check_existing_phones(text[]) from public, anon;
grant execute on function check_existing_phones(text[]) to authenticated;

-- 3) Traçabilité des exports : l'export de la liste clients/prospects est
--    réservé à la direction (super_admin, administrateur, manager) côté
--    application, et chaque export est noté dans le journal d'audit.
--    (plpgsql : la nouvelle valeur d'enum n'est utilisée qu'à l'exécution,
--    jamais à la création de la fonction, donc pas d'erreur "unsafe use of
--    new value" si ce fichier est exécuté d'un bloc.)
do $$ begin
  if not exists (select 1 from pg_enum where enumlabel = 'export' and enumtypid = 'audit_action'::regtype) then
    alter type audit_action add value 'export';
  end if;
end $$;

create or replace function log_export(p_table text, p_count int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Non authentifié';
  end if;
  insert into audit_log (organization_id, user_id, table_name, action, new_data)
  values (auth_org_id(), auth.uid(), p_table, 'export'::audit_action, jsonb_build_object('lignes', p_count));
end;
$$;

revoke all on function log_export(text, int) from public, anon;
grant execute on function log_export(text, int) to authenticated;
